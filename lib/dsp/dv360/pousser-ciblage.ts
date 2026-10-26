/**
 * @file lib/dsp/dv360/pousser-ciblage.ts — pousse des codes postaux sur UN line item DV360, réellement ou en
 * simulation (lot 7, T1, arbitrages A-2 et A-3).
 *
 * Corps extrait de `POST /api/admin/dsp/dv360/targeting/push` : tout ce qui suit la lecture des codes (mapping CP →
 * geo IDs Google, plafond de 2 000 geo IDs, jeton, `bulkAssignGeoRegions`, `logDspEvent`). Deux appelants :
 * - la route `targeting/push`, avec les CP d'une zone (`lireCodesDeZone`) — contrat inchangé ;
 * - `POST /api/campaigns/[campaignId]/activation/pousser`, avec les CP d'une zone OU d'une extraction, en appel DIRECT
 *   (plus d'aller-retour HTTP vers la route ci-dessus avec l'en-tête d'autorisation recopié).
 *
 * ── LE MODE SIMULÉ ───────────────────────────────────────────────────────
 * Une campagne de démo sans connexion DV360 active se pousse en `simule` : MÊMES contrôles (0 CP, 0 CP mappé, plafond)
 * et MÊMES comptes (`pushed_geo_ids`, `unmapped_postal_codes`) que le réel — le mapping est local, zéro I/O. Rien ne
 * part chez Google, et rien n'est lu de `dsp_connections` ni d'aucun jeton : le simulé doit rester atteignable sans
 * connexion, c'est son seul cas d'usage (ruling 1 du lot 7). Journalisé `push_geo_targeting_simule`.
 */
import { resolveAccessToken, bulkAssignGeoRegions, type Dv360ConnectionRow } from '@/lib/dsp/dv360/client';
import { logDspEvent } from '@/lib/dsp/logger';
import { mapPostalCodesToGeoIds, GEO_POSTAL_FR_VERSION } from '@/lib/digital/dv360-geo';
import type { createAdminClient } from '@/lib/auth';

type ClientAdmin = ReturnType<typeof createAdminClient>;

/** Garde-fou : au-delà, passer par l'export fichier (bulkEdit DV360 plafonne les opérations par requête). */
export const MAX_GEO_IDS_PER_PUSH = 2000;

/**
 * Délai de la résolution du jeton Google (rafraîchissement OAuth ou compte de service). `google-auth-library` n'en
 * pose aucun : un point de jeton qui ne répond plus bloquait la boucle de `pousser` sur la première cible, et le
 * `finally` qui clôt le lot n'était jamais atteint (relecture 1 du lot 7, I-2). L'appel bulkEdit, lui, est borné par
 * `fetchAvecDelai` dans `bulkAssignGeoRegions`. Avant le lot 7, `fetchAvecDelai(…, 60 s)` bornait la cible entière.
 */
export const DELAI_JETON_GOOGLE_MS = 30_000;

/** Une promesse bornée : au-delà de `ms`, elle rejette avec un message qui nomme l'étape. */
function avecDelai<T>(promesse: Promise<T>, ms: number, etape: string): Promise<T> {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<never>((_, rejeter) => {
    minuterie = setTimeout(() => rejeter(new Error(`${etape} : aucune réponse après ${ms / 1000} s.`)), ms);
  });
  return Promise.race([promesse, delai]).finally(() => clearTimeout(minuterie));
}

/** `reel` : le ciblage part chez Google ; `simule` : mêmes contrôles et mêmes comptes, aucun appel sortant. */
export type ModePoussee = 'reel' | 'simule';

export interface ParametresPoussee {
  supabase: ClientAdmin;
  orgId: string;
  /** Codes postaux bruts à pousser (une zone, ou les CP DV360 d'une extraction). */
  cps: string[];
  advertiserId: string;
  lineItemId: string;
  /** Ce qui est poussé, pour le journal : `zone « Lyon 5 km »`, `extraction v1 du jeu « … »`. */
  libelle: string;
  mode: ModePoussee;
  /** Contexte ajouté au `detail` du journal (zone, extraction, campagne, lot). Aucun secret. */
  detail?: Record<string, unknown>;
}

export type IssuePoussee =
  | {
    ok: true;
    pushed_geo_ids: number;
    unmapped_postal_codes: string[];
    updated_line_item_ids: string[];
    failed_line_item_ids: string[];
  }
  | { ok: false; status: 400 | 404 | 502; error: string };

/**
 * Pousse le ciblage géographique d'une liste de CP sur un line item (additif : n'efface pas le ciblage existant).
 *
 * @returns Les comptes de la poussée, ou le refus à rendre tel quel (400 contrôle, 404 connexion, 502 Google).
 *   `failed_line_item_ids` non vide avec `ok: true` : DV360 a répondu 200 en refusant le line item — à l'appelant de
 *   le lire, comme avant l'extraction.
 */
export async function pousserCiblageDv360(p: ParametresPoussee): Promise<IssuePoussee> {
  const { supabase, orgId, cps, advertiserId, lineItemId, libelle, mode } = p;

  // En réel seulement : la connexion, lue AVANT les contrôles (l'ordre des réponses de `targeting/push`).
  let conn: Dv360ConnectionRow | null = null;
  if (mode === 'reel') {
    const { data, error } = await supabase
      .from('dsp_connections')
      .select('auth_method, credentials_encrypted, oauth_refresh_token_encrypted, oauth_client_id, oauth_client_secret_encrypted, partner_id')
      .eq('organization_id', orgId).eq('provider', 'dv360').single();
    if (error || !data) return { ok: false, status: 404, error: 'Aucune connexion DV360 enregistrée.' };
    conn = data as Dv360ConnectionRow;
  }

  if (cps.length === 0) return { ok: false, status: 400, error: 'Aucun code postal résolu pour cette zone.' };

  const { mapped, unmapped } = mapPostalCodesToGeoIds(cps);
  if (mapped.length === 0) return { ok: false, status: 400, error: 'Aucun code postal mappé vers un geo ID Google.' };
  if (mapped.length > MAX_GEO_IDS_PER_PUSH) {
    return {
      ok: false,
      status: 400,
      error: `Zone trop large : ${mapped.length} geo IDs (max ${MAX_GEO_IDS_PER_PUSH} par push). Utiliser l'export fichier.`,
    };
  }

  const detail = {
    ...p.detail,
    advertiser_id: advertiserId, line_item_id: lineItemId,
    geo_count: mapped.length,
  };

  if (mode === 'simule') {
    await logDspEvent({
      orgId, provider: 'dv360', category: 'api_call', action: 'push_geo_targeting_simule',
      statusCode: 200, durationMs: 0,
      message: `${mapped.length} geo IDs poussés en SIMULATION sur le line item ${lineItemId} (${libelle}) : rien n'est parti chez Google`,
      detail: { ...detail, unmapped_count: unmapped.length, geotargets_version: GEO_POSTAL_FR_VERSION },
    });
    return {
      ok: true,
      pushed_geo_ids: mapped.length,
      unmapped_postal_codes: unmapped,
      updated_line_item_ids: [lineItemId],
      failed_line_item_ids: [],
    };
  }

  const started = Date.now();
  try {
    const token = await avecDelai(
      resolveAccessToken(conn as Dv360ConnectionRow), DELAI_JETON_GOOGLE_MS, 'Jeton Google DV360',
    );
    const result = await bulkAssignGeoRegions(token, advertiserId, lineItemId, mapped.map((m) => m.geo_id));
    await logDspEvent({
      orgId, provider: 'dv360', category: 'api_call', action: 'push_geo_targeting',
      statusCode: 200, durationMs: Date.now() - started,
      message: `${mapped.length} geo IDs poussés sur le line item ${lineItemId} (${libelle})`,
      detail: {
        ...detail,
        unmapped_count: unmapped.length,
        geotargets_version: GEO_POSTAL_FR_VERSION,
        failed_line_item_ids: result.failedLineItemIds,
      },
    });
    return {
      ok: true,
      pushed_geo_ids: mapped.length,
      unmapped_postal_codes: unmapped,
      updated_line_item_ids: result.updatedLineItemIds,
      failed_line_item_ids: result.failedLineItemIds,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logDspEvent({
      orgId, provider: 'dv360', category: 'api_call', action: 'push_geo_targeting',
      level: 'error', durationMs: Date.now() - started, message: msg, detail,
    });
    return { ok: false, status: 502, error: msg };
  }
}
