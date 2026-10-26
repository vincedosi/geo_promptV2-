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
 * 3. **Droit insuffisant** (2026-09-15). La poussée ré-appelle en HTTP
 *    `/api/admin/dsp/dv360/targeting/push`, dont le guard est `isSuperAdmin`
 *    STRICT. Un `admin` ou un `client` de l'org propriétaire lisait un pré-vol
 *    `activable: true`, cliquait, et découvrait le refus après l'écriture d'un
 *    `activation_lots` et de ses 50 `activation_cibles`, toutes en échec — 51
 *    lignes pour rien, et un historique vide de sens.
 *
 * Les trois sont rendus comme des `blocages`, pas comme une erreur HTTP : la
 * page doit pouvoir montrer le reste du pré-vol en expliquant ce qui manque.
 *
 * ── Lot 7, ⑦ Activation (T1) ──────────────────────────────────────────────
 * Lectures et règles partagées avec `pousser` (`lib/campaigns/etat-activation.ts`, `lib/campaigns/activation.ts`).
 * Champs ajoutés, les anciens inchangés : `mode_dv360` (`reel` | `simule` | `indisponible`), `n_cp_dv360` (les CP
 * que DV360 recevrait : ceux de la zone, ou ceux de l'extraction du plan), `extraction` (`{ zone_set_id, version }`)
 * et `motifs` (`{ code, message, version? }`), dont `blocages` est la liste des messages. Deux motifs neufs : la
 * connexion DV360 (une campagne de DÉMO sans connexion n'est plus bloquée, elle se pousse en simulé) et
 * `aucun_cp_dv360` (rien à pousser — une extraction Meta + TikTok seuls est légitime, ce n'est pas une erreur).
 * Depuis le lot 7, `pousser` n'appelle plus `targeting/push` en HTTP mais `pousserCiblageDv360` directement : le
 * blocage 3 tient toujours, `pousser` refusant tout autre rôle que super_admin avant d'écrire.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient, isSuperAdmin } from '@/lib/auth';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { lireEtatActivation, type EtatActivation } from '@/lib/campaigns/etat-activation';

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

  // ── Le pré-vol : les mêmes lectures et les mêmes règles que `pousser` (lot 7, T1) ──────────
  let lu: Awaited<ReturnType<typeof lireEtatActivation>>;
  try {
    lu = await lireEtatActivation(supabase, campaignId, orgId, isSuperAdmin(profile));
  } catch (e) {
    console.error('[prevol]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }
  // Zone ou extraction d'un autre espace que l'espace ACTIF : 404, comme `targeting/push` avant le lot 7, et rien
  // n'est écrit (relecture 1 du lot 7, I-1).
  if ('horsEspace' in lu) return NextResponse.json({ error: lu.horsEspace }, { status: 404 });
  const etat: EtatActivation = lu;
  const { strategie } = etat;

  // ── Ce qui serait poussé : les codes postaux de la campagne ───────────
  // Lu des ROLLUPS (déjà agrégés), jamais de `dsp_campaign_data`. Gardé pour React : il compte TOUTES les
  // plateformes et le hors zone pondéré (E2) ; ce que DV360 reçoit est `n_cp_dv360`.
  const { data: nCp, error: erreurCp } = await supabase.rpc('compte_cp_campagne', {
    p_campaign_id: campaignId,
  });
  if (erreurCp) console.error('[prevol] compte cp:', erreurCp.message);

  // Une connexion enregistrée mais en erreur ne permet PAS d'activer : la
  // compter comme un canal disponible ferait échouer le push au premier appel
  // sortant, après avoir laissé croire que tout était prêt.
  const canaux = etat.connexions
    .filter((c) => c.status !== 'error' && c.status !== 'revoked')
    .map((c) => ({ provider: c.provider, methode: c.auth_method, statut: c.status }));

  return NextResponse.json(
    {
      strategie: strategie
        ? {
            id: strategie.id, nom: strategie.name, statut: strategie.status,
            scope: strategie.scope_type, zone_id: strategie.zone_id,
            cpm_previsionnel: strategie.forecast_cpm, budget: strategie.total_budget,
          }
        : null,
      version_publiee: etat.versionPubliee,
      zones_modifiees: etat.zonesModifiees,
      n_codes_postaux: nCp ?? 0,
      canaux_connectes: canaux,
      // Lot 7 (E1-E4) : la source, le mode et les CP que DV360 recevrait ; les motifs codés.
      mode_dv360: etat.mode,
      n_cp_dv360: etat.cpsDv360.length,
      extraction: etat.extraction ? { zone_set_id: etat.extraction.zone_set_id, version: etat.extraction.version } : null,
      motifs: etat.motifs,
      blocages: etat.motifs.map((m) => m.message),
      // Un pré-vol qui ne dit pas qu'il bloque serait pire qu'absent : c'est
      // ce booléen que l'UI branche sur le bouton d'activation.
      activable: etat.motifs.length === 0,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
