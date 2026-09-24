/**
 * La simulation de campagne d'un jeu de zones (étape ⑤ du module risque).
 *
 *   GET    → la dernière simulation du jeu, tout ce que l'écran lit, en un appel
 *   POST   → simule les semaines v1 sur une extraction, flux NDJSON de progression
 *   DELETE → purge la simulation (campagne, impressions, extraction recalée)
 *
 * ── UNE SIMULATION PAR JEU ────────────────────────────────────────────────
 *
 * Simuler à nouveau REMPLACE la précédente. Deux simulations d'un même jeu
 * côte à côte ne répondraient à aucune question qu'une seule ne pose pas, et
 * chacune pèse ~80 000 lignes de `dsp_campaign_data`.
 *
 * ── RIEN NE SE MÉLANGE AVEC LES VRAIES CAMPAGNES ──────────────────────────
 *
 * La campagne porte `est_simulation = true` (sql/232), et les trois routes qui
 * listent les campagnes l'écartent. Aucun badge à l'écran : le drapeau est en
 * base, là où il protège quelque chose.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireCorps } from '@/lib/api/valider-corps';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { toJson } from '@/lib/supabase/rpc-json';
import { PARAMS_DEFAUT, diffuserPeriode, planDeLExtraction } from '@/lib/simulation/generateur';
import {
  chargerSimulation, dateDuJour, insererLignes, lireEntrees, purgerSimulations,
} from '@/lib/simulation/serveur';
import { versCpSimulation } from '@/lib/simulation/entrees';
import type { EvenementSimulation } from '@/lib/simulation/payload';
import type { ParamsSimulation } from '@/lib/simulation/types';

export const dynamic = 'force-dynamic';

/** Simuler écrit ~80 000 lignes : plafond serré, il empêche un double clic en boucle. */
const limiteurEcriture = createRateLimiter({
  max: 4, window: '60 s', prefix: 'geo:rl:zone-set-simulation',
});

/** La lecture agrège en base sans rien écrire : plafond large. */
const limiteurLecture = createRateLimiter({
  max: 30, window: '60 s', prefix: 'geo:rl:zone-set-simulation-lecture',
});

const CorpsSchema = z.object({
  version: z.number().int().positive(),
  params: z.object({
    budget: z.number().min(1_000).max(10_000_000).optional(),
    intensite: z.number().min(1).max(3).optional(),
    fuite: z.number().min(0).max(0.5).optional(),
    bruit: z.number().min(0).max(1).optional(),
    amortissement: z.number().min(0).max(1).optional(),
    graine: z.number().int().min(0).max(2_147_483_647).optional(),
  }).default({}),
});

/** Le jeu, s'il appartient à l'organisation. La propriété est vérifiée ICI, pas par RLS. */
async function lireJeu(supabase: ReturnType<typeof createAdminClient>, id: string, orgId: string) {
  return supabase
    .from('zone_sets')
    .select('id, nom, brouillon, construit_le')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
}

/** Le premier jour : la campagne se termine aujourd'hui, elle est passée en entier. */
function dateDebut(jours: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - jours + 1);
  return d.toISOString().slice(0, 10);
}

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation active.' }, { status: 403 });
  }
  const quota = await limiteurLecture(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: jeu, error: erreurJeu } = await lireJeu(supabase, id, profile.organization_id);
  if (erreurJeu) {
    console.error('[zones/simulation] lecture jeu :', erreurJeu.message);
    return NextResponse.json({ error: 'Jeu de zones illisible.' }, { status: 500 });
  }
  if (!jeu) return NextResponse.json({ error: 'Ce jeu de zones est introuvable.' }, { status: 404 });

  try {
    return NextResponse.json(await chargerSimulation(supabase, id));
  } catch (e) {
    console.error('[zones/simulation] assemblage :', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Simulation illisible.' }, { status: 500 });
  }
}

// ── POST ────────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation active.' }, { status: 403 });
  }
  const orgId = profile.organization_id;

  // Le corps est lu AVANT d'ouvrir le flux : le lire dans `start()` le
  // trouverait déjà consommé (incident du 08/04).
  const corps = await lireCorps(request, CorpsSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });

  const quota = await limiteurEcriture(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: jeu, error: erreurJeu } = await lireJeu(supabase, id, orgId);
  if (erreurJeu) {
    console.error('[zones/simulation] lecture jeu :', erreurJeu.message);
    return NextResponse.json({ error: 'Jeu de zones illisible.' }, { status: 500 });
  }
  if (!jeu) return NextResponse.json({ error: 'Ce jeu de zones est introuvable.' }, { status: 404 });

  const { data: extraction, error: erreurExt } = await supabase
    .from('zone_set_extractions')
    .select('id, version')
    .eq('zone_set_id', id)
    .eq('version', corps.valeur.version)
    .maybeSingle();
  if (erreurExt) {
    console.error('[zones/simulation] extraction :', erreurExt.message);
    return NextResponse.json({ error: 'Extraction illisible.' }, { status: 500 });
  }
  if (!extraction) {
    return NextResponse.json(
      { error: `La version ${corps.valeur.version} n’existe pas pour ce jeu. Extrayez d’abord le plan à l’étape ④.` },
      { status: 404 },
    );
  }

  const P: ParamsSimulation = { ...PARAMS_DEFAUT, ...corps.valeur.params };
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let ferme = false;
      const emettre = (e: EvenementSimulation) => {
        if (ferme) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(e) + '\n')); } catch { ferme = true; }
      };
      const t0 = Date.now();
      let campagneId: string | null = null;

      try {
        emettre({ etape: 'preparation', message: 'Lecture du plan de l’extraction' });
        const entrees = await lireEntrees(supabase, extraction.id);
        if (entrees.length === 0) {
          emettre({ etape: 'erreur', message: 'Cette extraction ne porte aucun code postal.' });
          return;
        }

        // Une simulation par jeu : la précédente part avant que la nouvelle naisse.
        await purgerSimulations(supabase, id);

        const debut = dateDebut(P.jours);
        const { data: camp, error: erreurCamp } = await supabase
          .from('dsp_campaigns')
          .insert({
            name: `${jeu.nom ?? 'Jeu de zones'} — simulation sur v${extraction.version}`,
            dsp_source: 'simulation',
            organization_id: orgId,
            created_by: profile.id,
            est_simulation: true,
            date_start: debut,
            date_end: dateDuJour(debut, P.jours),
            total_budget: P.budget,
            currency: 'EUR',
            countries: ['FR'],
          })
          .select('id')
          .single();
        if (erreurCamp || !camp) throw new Error(`Création de la campagne impossible : ${erreurCamp?.message}`);
        campagneId = camp.id;

        const { data: sim, error: erreurSim } = await supabase
          .from('zone_set_simulations')
          .insert({
            zone_set_id: id,
            org_id: orgId,
            campaign_id: camp.id,
            extraction_v1_id: extraction.id,
            date_debut: debut,
            jours: P.jours,
            jour_recalage: P.jourRecalage,
            params: toJson(P),
            statut: 'v1',
            created_by: profile.id,
          })
          .select('id')
          .single();
        if (erreurSim || !sim) throw new Error(`Enregistrement de la simulation impossible : ${erreurSim?.message}`);

        const cps = entrees.map(versCpSimulation);
        const lignes = diffuserPeriode(cps, planDeLExtraction(cps), P, 1, P.jourRecalage - 1);
        emettre({
          etape: 'generation',
          message: `Semaines 1 et 2 générées sur la v${extraction.version}`,
          lignes: lignes.length,
        });

        let dernier = -1;
        await insererLignes(supabase, camp.id, debut, lignes, (faites) => {
          const pct = Math.floor((faites / lignes.length) * 100);
          if (pct === dernier) return;
          dernier = pct;
          emettre({
            etape: 'insertion', message: 'Écriture de la diffusion',
            faites, total: lignes.length, pourcentage: pct,
          });
        });

        const { error: erreurMaj } = await supabase
          .from('zone_set_simulations').update({ lignes_v1: lignes.length }).eq('id', sim.id);
        if (erreurMaj) throw new Error(`Mise à jour de la simulation impossible : ${erreurMaj.message}`);

        emettre({
          etape: 'termine', message: 'Simulation des semaines 1 et 2 terminée',
          simulation_id: sim.id, lignes: lignes.length, duree_ms: Date.now() - t0,
        });
      } catch (e) {
        console.error('[zones/simulation] génération :', e instanceof Error ? e.message : e);
        // Une simulation à moitié écrite est pire qu'aucune : son alignement
        // serait calculé sur une campagne amputée. On retire tout.
        if (campagneId) {
          const { error } = await supabase.from('dsp_campaigns').delete().eq('id', campagneId);
          if (error) console.error('[zones/simulation] nettoyage :', error.message);
        }
        emettre({
          etape: 'erreur',
          message: e instanceof Error ? e.message : 'La simulation a échoué.',
        });
      } finally {
        ferme = true;
        try { controller.close(); } catch { /* déjà fermé par l'annulation du client */ }
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// ── DELETE ──────────────────────────────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation active.' }, { status: 403 });
  }
  const quota = await limiteurEcriture(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const { id } = await params;
  const supabase = createAdminClient();
  const { data: jeu, error: erreurJeu } = await lireJeu(supabase, id, profile.organization_id);
  if (erreurJeu) return NextResponse.json({ error: 'Jeu de zones illisible.' }, { status: 500 });
  if (!jeu) return NextResponse.json({ error: 'Ce jeu de zones est introuvable.' }, { status: 404 });

  try {
    const n = await purgerSimulations(supabase, id);
    return NextResponse.json({ purgees: n });
  } catch (e) {
    console.error('[zones/simulation] purge :', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Purge impossible.' }, { status: 500 });
  }
}
