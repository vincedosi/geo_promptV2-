/**
 * GET /api/campaigns/[campaignId]/activation/prevol — ce qui SERA poussé, sans rien pousser
 *
 * Tâche 20 (2026-09-13).
 *
 * **Le plan écrivait `previol`** dans son arborescence — coquille manifeste
 * pour « pré-vol ». Corrigé ici : une route mal nommée se recopie ensuite dans
 * chaque appelant et devient impossible à renommer.
 *
 * ── Strictement en LECTURE ────────────────────────────────────────────────
 * Aucun appel d'écriture vers un DSP, aucune ligne créée. Cette route répond à
 * « qu'est-ce qui partirait si je cliquais ? » — et surtout à « pourquoi je ne
 * peux pas encore cliquer ».
 *
 * ── Les deux blocages, et ce qu'ils évitent ───────────────────────────────
 *
 * 1. **Stratégie non publiée.** Pousser un ciblage sans point de repère rend le
 *    retour arrière aveugle : on ne saurait pas à quel état revenir.
 * 2. **Stratégie dérivée** (`zonesModifiees` non vide, Tâche 19). Une zone a
 *    bougé depuis la publication : pousser enverrait au DSP un périmètre que
 *    personne n'a validé, et qui ne correspond ni à la version publiée ni à ce
 *    qu'affiche la carte.
 *
 * Les deux sont rendus comme des `blocages`, pas comme une erreur HTTP : la
 * page doit pouvoir montrer le reste du pré-vol en expliquant ce qui manque.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { zonesModifiees, type EmpreinteZones } from '@/lib/campaigns/version-strategie';
import { rpcJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

const IdSchema = z.string().uuid();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée à ce compte.' }, { status: 400 });

  const { campaignId } = await params;
  if (!IdSchema.safeParse(campaignId).success) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // 404 et jamais 403 — contrat de `lib/campaigns/access.ts`.
  const acces = await checkCampaignAccess(supabase, profile, campaignId);
  if (acces !== 'ok') return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });

  // ── La stratégie de cette campagne ────────────────────────────────────
  const { data: strategie, error: erreurStrat } = await supabase
    .from('bidding_strategies')
    .select('id, name, status, scope_type, zone_id, forecast_cpm, total_budget, updated_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (erreurStrat) {
    console.error('[prevol] strategie:', erreurStrat.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  const blocages: string[] = [];
  if (!strategie) {
    blocages.push('Aucune stratégie n’est définie pour cette campagne.');
  }

  // ── Version publiée et dérive (Tâche 19) ──────────────────────────────
  let version: number | null = null;
  let modifiees: string[] = [];

  if (strategie) {
    const { data: derniere } = await supabase
      .from('strategie_versions')
      .select('version, empreinte_zones')
      .eq('strategie_id', strategie.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!derniere) {
      blocages.push('La stratégie n’a jamais été publiée — publiez-la pour figer le périmètre poussé.');
    } else {
      version = derniere.version;
      // Même empreinte de CONTENU que `/publier` (sql/159) : comparer deux
      // mesures obtenues autrement rendrait la dérive systématique.
      let courante: EmpreinteZones = {};
      if (strategie.zone_id) {
        const { data: emp } = await supabase.rpc('empreinte_zones', {
          p_zone_ids: [strategie.zone_id],
        });
        courante = rpcJson<EmpreinteZones>(emp) ?? {};
      }
      modifiees = zonesModifiees((derniere.empreinte_zones ?? {}) as EmpreinteZones, courante);
      if (modifiees.length) {
        blocages.push(
          `${modifiees.length} zone${modifiees.length > 1 ? 's ont' : ' a'} changé depuis la publication de la v${version} — republiez avant d’activer.`,
        );
      }
    }
  }

  // ── Ce qui serait poussé : les codes postaux de la campagne ───────────
  // Lu des ROLLUPS (déjà agrégés), jamais de `dsp_campaign_data`.
  const { data: nCp, error: erreurCp } = await supabase.rpc('compte_cp_campagne', {
    p_campaign_id: campaignId,
  });
  if (erreurCp) console.error('[prevol] compte cp:', erreurCp.message);

  // ── Les canaux connectés de l'organisation ────────────────────────────
  // Colonnes réelles : `organization_id` (pas `org_id`) et `auth_method` (pas
  // `method`) — les types générés ont attrapé la confusion avant l'exécution.
  const { data: connexions, error: erreurConn } = await supabase
    .from('dsp_connections')
    .select('provider, auth_method, status')
    .eq('organization_id', orgId);
  if (erreurConn) console.error('[prevol] connexions:', erreurConn.message);

  // Une connexion enregistrée mais en erreur ne permet PAS d'activer : la
  // compter comme un canal disponible ferait échouer le push au premier appel
  // sortant, après avoir laissé croire que tout était prêt.
  const canaux = (connexions ?? [])
    .filter((c) => c.status !== 'error' && c.status !== 'revoked')
    .map((c) => ({ provider: c.provider, methode: c.auth_method, statut: c.status }));
  if (!canaux.length) {
    blocages.push(
      (connexions ?? []).length
        ? 'Les connexions DSP de cette organisation sont en erreur ou révoquées.'
        : 'Aucun canal DSP n’est connecté pour cette organisation.',
    );
  }

  return NextResponse.json(
    {
      strategie: strategie
        ? {
            id: strategie.id, nom: strategie.name, statut: strategie.status,
            scope: strategie.scope_type, zone_id: strategie.zone_id,
            cpm_previsionnel: strategie.forecast_cpm, budget: strategie.total_budget,
          }
        : null,
      version_publiee: version,
      zones_modifiees: modifiees,
      n_codes_postaux: nCp ?? 0,
      canaux_connectes: canaux,
      blocages,
      // Un pré-vol qui ne dit pas qu'il bloque serait pire qu'absent : c'est
      // ce booléen que l'UI branche sur le bouton d'activation.
      activable: blocages.length === 0,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
