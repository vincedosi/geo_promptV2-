/**
 * POST /api/campaigns/[id]/activation/pousser — pousse le ciblage, ligne par
 * ligne, en disant ce qu'il fait (Tâche 20, 2026-09-13).
 *
 * **Cette route ENVELOPPE le push DV360 existant, elle ne le réécrit pas.**
 * `lib/dsp/dv360/client.ts` et `/api/admin/dsp/dv360/targeting/push` restent
 * intacts : ce qui manquait n'était pas le push, c'était tout ce qui
 * l'entoure — pré-vol, statut par line item, historique, retour arrière.
 *
 * ── Progression NDJSON, et ce n'est pas optionnel ─────────────────────────
 * Règle CLAUDE.md : jamais de traitement silencieux. Un push de vingt line
 * items qui rend une seule réponse à la fin laisse l'utilisateur devant un
 * bouton figé, sans savoir si ça avance, si ça a échoué au troisième, ni ce
 * qui est déjà parti. Chaque ligne du flux porte l'étape, le compteur et le
 * résultat de la cible traitée.
 *
 * ── `etat_avant` est écrit AVANT l'appel sortant ──────────────────────────
 * C'est la seule chose qui rend un retour arrière possible : le push DV360 est
 * ADDITIF, donc sans l'état antérieur on ne saurait pas quoi retirer. L'écrire
 * après l'appel laisserait, en cas d'interruption, une poussée partie et
 * intraçable.
 *
 * ── Ce que cette route refuse ─────────────────────────────────────────────
 * Elle rappelle le pré-vol et s'arrête si `activable` est faux. Un push sur une
 * stratégie non publiée ou dérivée enverrait au DSP un périmètre que personne
 * n'a validé.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { lireCorps } from '@/lib/api/valider-corps';
import { zonesModifiees, type EmpreinteZones } from '@/lib/campaigns/version-strategie';
import { toJson } from '@/lib/supabase/rpc-json';
import type { TableInsert } from '@/lib/supabase/tables';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const IdSchema = z.string().uuid();

/** Au-delà, ce n'est plus une activation mais un import de masse. */
const MAX_CIBLES = 50;

const CorpsSchema = z.object({
  canal: z.string().min(1).max(40),
  advertiser_id: z.string().regex(/^\d+$/),
  /** Line items visés. Le pré-vol les a listés ; le client confirme lesquels. */
  cibles: z.array(z.object({
    line_item_id: z.string().regex(/^\d+$/),
    line_item_nom: z.string().max(200).optional(),
  })).min(1).max(MAX_CIBLES),
});

function ligne(objet: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(objet)}\n`);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée à ce compte.' }, { status: 400 });

  const { id: campaignId } = await params;
  if (!IdSchema.safeParse(campaignId).success) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  }

  // Le corps est lu AVANT d'ouvrir le flux. Le lire dans `start()` du
  // ReadableStream consommerait un corps déjà parti — c'est exactement
  // l'incident du 08/04 (« request.formData() dans ReadableStream.start() »).
  const corps = await lireCorps(request, CorpsSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const { canal, advertiser_id, cibles } = corps.valeur;

  const supabase = createAdminClient();
  const acces = await checkCampaignAccess(supabase, profile, campaignId);
  if (acces !== 'ok') return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });

  // ── Le pré-vol, rejoué côté serveur ───────────────────────────────────
  // Le client a pu l'appeler, mais on ne pousse pas sur la foi d'un appel
  // client : une zone a pu bouger entre son pré-vol et son clic.
  const { data: strategie } = await supabase
    .from('bidding_strategies')
    .select('id, zone_id')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!strategie) {
    return NextResponse.json({ error: 'Aucune stratégie pour cette campagne.' }, { status: 409 });
  }

  const { data: derniere } = await supabase
    .from('strategie_versions')
    .select('version, empreinte_zones')
    .eq('strategie_id', strategie.id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!derniere) {
    return NextResponse.json(
      { error: 'strategie_non_publiee', message: 'Publiez la stratégie avant d’activer.' },
      { status: 409 },
    );
  }

  const courante: EmpreinteZones = {};
  if (strategie.zone_id) {
    const { data: zone } = await supabase
      .from('custom_geo_zones').select('id, updated_at').eq('id', strategie.zone_id).maybeSingle();
    if (zone?.updated_at) courante[zone.id] = zone.updated_at;
  }
  const modifiees = zonesModifiees((derniere.empreinte_zones ?? {}) as EmpreinteZones, courante);
  if (modifiees.length) {
    return NextResponse.json(
      {
        error: 'strategie_derivee',
        message: `${modifiees.length} zone(s) ont changé depuis la publication de la v${derniere.version}. Republiez avant d’activer.`,
        zones_modifiees: modifiees,
      },
      { status: 409 },
    );
  }

  if (!strategie.zone_id) {
    return NextResponse.json(
      { error: 'strategie_sans_zone', message: 'Cette stratégie n’a pas de zone à pousser.' },
      { status: 409 },
    );
  }
  const zoneId = strategie.zone_id;

  // ── Le lot, créé AVANT toute sortie ───────────────────────────────────
  const lotLigne: TableInsert<'activation_lots'> = {
    campaign_id: campaignId,
    org_id: orgId,
    canal,
    version_strategie: derniere.version,
    lance_par: profile.id,
    statut: 'en_cours',
  };
  const { data: lot, error: erreurLot } = await supabase
    .from('activation_lots').insert(lotLigne).select('id').single();
  if (erreurLot || !lot) {
    console.error('[activation/pousser] lot:', erreurLot?.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  const origine = new URL(request.url).origin;
  const autorisation = request.headers.get('authorization') ?? '';

  const flux = new ReadableStream({
    async start(controller) {
      let pousses = 0;
      let echecs = 0;

      controller.enqueue(ligne({
        etape: 'debut', lot_id: lot.id, canal,
        version_strategie: derniere.version, total: cibles.length,
      }));

      for (const [i, cible] of cibles.entries()) {
        controller.enqueue(ligne({
          etape: 'cible', n: i + 1, total: cibles.length,
          line_item_id: cible.line_item_id, statut: 'en_cours',
        }));

        // La ligne de cible est écrite AVANT l'appel sortant — voir l'en-tête.
        const cibleLigne: TableInsert<'activation_cibles'> = {
          lot_id: lot.id,
          line_item_id: cible.line_item_id,
          line_item_nom: cible.line_item_nom ?? null,
          statut: 'en_attente',
          etat_avant: toJson({
            // Le push DV360 est ADDITIF : l'état antérieur qu'il faut retenir
            // est l'ensemble des geo IDs déjà assignés. La route existante ne
            // les rend pas ; on garde donc le contexte qui permet de les
            // relire au moment du retour arrière, plutôt que d'inventer une
            // valeur qu'on n'a pas.
            advertiser_id, line_item_id: cible.line_item_id, zone_id: zoneId,
            releve_le: new Date().toISOString(),
          }),
        };
        const { data: cibleCreee, error: erreurCible } = await supabase
          .from('activation_cibles').insert(cibleLigne).select('id').single();
        if (erreurCible || !cibleCreee) {
          echecs++;
          controller.enqueue(ligne({
            etape: 'cible', n: i + 1, line_item_id: cible.line_item_id,
            statut: 'echec', erreur: 'Enregistrement impossible — poussée non tentée.',
          }));
          continue;
        }

        // ── L'appel sortant : la route DV360 EXISTANTE, telle quelle ────
        try {
          const res = await fetch(`${origine}/api/admin/dsp/dv360/targeting/push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', authorization: autorisation },
            body: JSON.stringify({
              zone_id: zoneId,
              advertiser_id,
              line_item_id: cible.line_item_id,
            }),
          });
          const resultat = await res.json().catch(() => ({}));

          if (res.ok) {
            pousses++;
            await supabase.from('activation_cibles')
              .update({ statut: 'pousse', maj_le: new Date().toISOString() })
              .eq('id', cibleCreee.id);
            controller.enqueue(ligne({
              etape: 'cible', n: i + 1, line_item_id: cible.line_item_id,
              statut: 'pousse', n_geo_ids: resultat.assigned ?? resultat.count ?? null,
            }));
          } else {
            echecs++;
            const message = resultat.error ?? `HTTP ${res.status}`;
            await supabase.from('activation_cibles')
              .update({ statut: 'echec', erreur: String(message).slice(0, 500), maj_le: new Date().toISOString() })
              .eq('id', cibleCreee.id);
            controller.enqueue(ligne({
              etape: 'cible', n: i + 1, line_item_id: cible.line_item_id,
              statut: 'echec', erreur: message,
            }));
          }
        } catch (e) {
          echecs++;
          const message = e instanceof Error ? e.message : String(e);
          await supabase.from('activation_cibles')
            .update({ statut: 'echec', erreur: message.slice(0, 500), maj_le: new Date().toISOString() })
            .eq('id', cibleCreee.id);
          controller.enqueue(ligne({
            etape: 'cible', n: i + 1, line_item_id: cible.line_item_id,
            statut: 'echec', erreur: message,
          }));
        }
      }

      // « partiel » existe comme statut propre : un lot où trois line items sur
      // vingt ont échoué n'est ni un succès ni un échec, et le ranger dans
      // l'un des deux ferait perdre l'information qui compte.
      const statut = echecs === 0 ? 'termine' : pousses === 0 ? 'echec' : 'partiel';
      await supabase.from('activation_lots')
        .update({ statut, termine_le: new Date().toISOString() })
        .eq('id', lot.id);

      controller.enqueue(ligne({
        etape: 'fin', lot_id: lot.id, statut,
        pousses, echecs, total: cibles.length,
      }));
      controller.close();
    },
  });

  return new Response(flux, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
