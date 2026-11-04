/**
 * Le recalage d'une simulation : de l'extraction v1 à l'extraction v2.
 *
 * POST, flux NDJSON. Lit la diffusion OBSERVÉE des semaines v1, corrige le
 * plan zone par zone (`lib/simulation/recalage.ts`), FIGE le plan corrigé en
 * extraction d'origine `recalage` par la même RPC que la Phase 4
 * (`creer_zone_set_extraction`), puis diffuse les semaines restantes dessus.
 *
 * ⚠ Le plan v2 est une VRAIE extraction, immuable, numérotée à la suite de la
 * v1 : c'est ce qui partirait au custom bidding. Il n'est pas recalculé à la
 * lecture — ce qu'on affiche est ce qu'on a figé.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { chargerJeu } from '@/lib/zones/charger-jeu';
import { lireTout } from '@/lib/supabase/lire-tout';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { rpcJson, toJson } from '@/lib/supabase/rpc-json';
import { diffuserPeriode } from '@/lib/simulation/generateur';
import { cibleParZone } from '@/lib/simulation/alignement';
import { recalageSousDrapeau } from '@/lib/optimisation/plans';
import { dateDuJour, insererLignes, lireEntrees } from '@/lib/simulation/serveur';
import { versCpSimulation } from '@/lib/simulation/entrees';
import type { Agregats, EvenementSimulation } from '@/lib/simulation/payload';
import type { ParamsSimulation } from '@/lib/simulation/types';

export const dynamic = 'force-dynamic';

const limiteur = createRateLimiter({
  max: 4, window: '60 s', prefix: 'geo:rl:zone-set-simulation',
});

const PLAFOND_CP = 8000;

interface LigneExtraction {
  code_postal: string;
  code_canonique: string;
  classe: string;
  cluster_id: string | null;
  cluster_rang: number | null;
  zone_nom: string | null;
  retenu: boolean;
  multiplicateur: number;
  pop_en_zone: number | null;
  pop_totale: number | null;
  part_en_zone: number | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation active.' }, { status: 403 });
  }
  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const { id } = await params;
  const supabase = createAdminClient();

  // Propre au jeu risque (grappes, classes) : 409 du chargeur pour un jeu de zone (lot 5, A-3).
  const charge = await chargerJeu(supabase, id, profile.organization_id, { type: 'risque' });
  if (!charge.ok) return charge.reponse;

  const { data: sim, error: erreurSim } = await supabase
    .from('zone_set_simulations')
    .select('id, campaign_id, statut, date_debut, jours, jour_recalage, params, extraction_v1_id')
    .eq('zone_set_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (erreurSim) return NextResponse.json({ error: 'Simulation illisible.' }, { status: 500 });
  if (!sim) {
    return NextResponse.json({ error: 'Aucune simulation à recaler : lancez-en une d’abord.' }, { status: 404 });
  }
  if (sim.statut !== 'v1') {
    return NextResponse.json(
      { error: 'Cette simulation est déjà recalée. Relancez une simulation pour recaler à nouveau.' },
      { status: 409 },
    );
  }

  const P = sim.params as unknown as ParamsSimulation;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let ferme = false;
      const emettre = (e: EvenementSimulation) => {
        if (ferme) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(e) + '\n')); } catch { ferme = true; }
      };
      const t0 = Date.now();
      let extractionV2: string | null = null;
      let lignesEcrites = false;

      try {
        emettre({ etape: 'preparation', message: 'Lecture de la diffusion des semaines 1 et 2' });

        const { data: brut, error: erreurAgg } = await supabase.rpc('simulation_agregats', { p_simulation: sim.id });
        if (erreurAgg) throw new Error(`Diffusion observée illisible : ${erreurAgg.message}`);
        const agregats = rpcJson<Agregats & { ok: boolean }>(brut);
        if (!agregats?.ok) throw new Error('Diffusion observée illisible.');

        const observees = new Map<string, number>();
        for (const z of agregats.par_zone_jour) {
          if (z.jour >= sim.jour_recalage) continue;
          observees.set(z.cid, (observees.get(z.cid) ?? 0) + Number(z.utiles));
        }

        const entrees = await lireEntrees(supabase, sim.extraction_v1_id);
        const cps = entrees.map(versCpSimulation);
        // `recaler`, ou le service Python, selon `OPTIMISATION_CORRECTION_SOURCE` (`lib/optimisation/plans.ts`). En
        // `python`, une panne du service lève ici : le `catch` plus bas la dit et ne laisse rien à moitié écrit.
        const { valeur: rc } = await recalageSousDrapeau(cps, observees, cibleParZone(cps), P);

        // Les lignes de la v1, recopiées avec leur multiplicateur corrigé : la
        // v2 garde tout ce qui décrit le code postal (bassin, classe, population),
        // et ne change que ce que le recalage décide.
        const { lignes: v1 } = await lireTout<LigneExtraction>(
          (de, a) => supabase
            .from('zone_set_extraction_cp')
            .select('code_postal, code_canonique, classe, cluster_id, cluster_rang, zone_nom, retenu, multiplicateur, pop_en_zone, pop_totale, part_en_zone')
            .eq('extraction_id', sim.extraction_v1_id)
            .order('code_postal')
            .range(de, a),
          PLAFOND_CP,
        );
        const lignesV2 = v1.map((l) => ({
          ...l,
          multiplicateur: rc.multiplicateurs.get(l.code_postal) ?? 0,
        }));

        const { data: resumeV1, error: erreurResume } = await supabase
          .from('zone_set_extractions')
          .select('version, n_cp, n_retenus, taux_utile, population_exposee')
          .eq('id', sim.extraction_v1_id)
          .single();
        if (erreurResume || !resumeV1) throw new Error('Résumé de la v1 illisible.');

        const sommeMult = lignesV2.reduce((t, l) => t + l.multiplicateur, 0);
        const sommeRetenus = lignesV2.filter((l) => l.retenu).reduce((t, l) => t + l.multiplicateur, 0);

        const { data: brutExt, error: erreurExt } = await supabase.rpc('creer_zone_set_extraction', {
          p_zone_set_id: id,
          p_lignes: toJson(lignesV2),
          p_resume: toJson({
            n_cp: resumeV1.n_cp,
            n_retenus: resumeV1.n_retenus,
            taux_utile: resumeV1.taux_utile,
            // Recalculée : c'est la seule grandeur du résumé que le recalage change.
            part_plan_en_zone: sommeMult > 0 ? (sommeRetenus / sommeMult) * 100 : null,
            population_exposee: resumeV1.population_exposee,
          }),
          p_origine: 'recalage',
          p_commentaire: `Recalage de la simulation : semaines 1 et 2 observées sur la v${resumeV1.version}, `
            + `${rc.corrections.size} bassins corrigés, ${rc.dilues.length} codes postaux dilués baissés.`,
          p_created_by: profile.id,
        });
        const ext = rpcJson<{ ok: boolean; id?: string; version?: number; error?: string }>(brutExt);
        if (erreurExt || !ext?.ok || !ext.id) {
          throw new Error(`Extraction recalée impossible : ${erreurExt?.message ?? ext?.error ?? 'raison inconnue'}`);
        }
        extractionV2 = ext.id;

        const { error: erreurLien } = await supabase
          .from('zone_set_simulations').update({ extraction_v2_id: ext.id }).eq('id', sim.id);
        if (erreurLien) throw new Error(`Rattachement de la v2 impossible : ${erreurLien.message}`);

        const lignes = diffuserPeriode(cps, rc.multiplicateurs, P, sim.jour_recalage, sim.jours);
        emettre({
          etape: 'generation',
          message: `Semaines 3 et 4 générées sur la v${ext.version}`,
          lignes: lignes.length,
        });

        lignesEcrites = true;
        let dernier = -1;
        await insererLignes(supabase, sim.campaign_id, sim.date_debut, lignes, (faites) => {
          const pct = Math.floor((faites / lignes.length) * 100);
          if (pct === dernier) return;
          dernier = pct;
          emettre({
            etape: 'insertion', message: 'Écriture de la diffusion recalée',
            faites, total: lignes.length, pourcentage: pct,
          });
        });

        const { error: erreurMaj } = await supabase
          .from('zone_set_simulations')
          .update({ statut: 'v2', lignes_v2: lignes.length })
          .eq('id', sim.id);
        if (erreurMaj) throw new Error(`Mise à jour de la simulation impossible : ${erreurMaj.message}`);

        emettre({
          etape: 'termine', message: `Recalage terminé : semaines 3 et 4 diffusées sur la v${ext.version}`,
          simulation_id: sim.id, lignes: lignes.length, duree_ms: Date.now() - t0,
        });
      } catch (e) {
        console.error('[zones/simulation/recaler] :', e instanceof Error ? e.message : e);
        // Retour à l'état v1, en entier : une v2 à moitié diffusée fausserait
        // la courbe, et une extraction recalée sans diffusion ferait croire
        // qu'un recalage a eu lieu.
        if (lignesEcrites) {
          const { error } = await supabase
            .from('dsp_campaign_data').delete()
            .eq('campaign_id', sim.campaign_id)
            .gte('date', dateDuJour(sim.date_debut, sim.jour_recalage));
          if (error) console.error('[zones/simulation/recaler] nettoyage diffusion :', error.message);
        }
        if (extractionV2) {
          const { error } = await supabase.from('zone_set_extractions').delete().eq('id', extractionV2);
          if (error) console.error('[zones/simulation/recaler] nettoyage extraction :', error.message);
        }
        emettre({ etape: 'erreur', message: e instanceof Error ? e.message : 'Le recalage a échoué.' });
      } finally {
        ferme = true;
        try { controller.close(); } catch { /* déjà fermé */ }
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
