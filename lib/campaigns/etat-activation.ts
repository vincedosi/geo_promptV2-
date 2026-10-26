/**
 * @file lib/campaigns/etat-activation.ts — les LECTURES du pré-vol de ⑦ Activation (lot 7, T1).
 *
 * Une seule fonction pour `GET …/activation/prevol` et `POST …/activation/pousser` : le pré-vol que la poussée rejoue
 * est le même, lu de la même façon (une zone a pu bouger entre le pré-vol du client et son clic). Les règles sont
 * pures, dans `lib/campaigns/activation.ts`.
 *
 * Lectures SÉQUENTIELLES, toutes par clé ou par index : stratégie la plus récente, dernière version publiée,
 * empreinte de la zone (RPC `empreinte_zones`, chemin zone seulement), connexions de l'espace, `is_demo` de la
 * campagne, extraction, puis les CP — `lireCodesDeZone` (zone) ou `lireCpPlateforme(…, 'dv360')` (extraction), deux
 * lectures paginées (`db-max-rows = 1000`) bornées.
 */
import { zonesModifiees, type EmpreinteZones } from '@/lib/campaigns/version-strategie';
import { rpcJson } from '@/lib/supabase/rpc-json';
import { lireCodesDeZone } from '@/lib/custom-geo/codes-zone';
import { lireCpPlateforme } from '@/lib/zones/cp-plateforme';
import type { ClientAdmin } from '@/lib/zones/plan-extraction';
import {
  modePoussee, motifsPrevol, sourceDePoussee, type ModeDv360, type Motif, type SourceActivation,
} from '@/lib/campaigns/activation';

interface StrategieActivation {
  id: string; name: string; status: string; scope_type: string; zone_id: string | null;
  forecast_cpm: number | null; total_budget: number | null; in_zone_weights: unknown;
}

export interface EtatActivation {
  strategie: StrategieActivation | null;
  versionPubliee: number | null;
  zonesModifiees: string[];
  source: SourceActivation | null;
  /** L'extraction du plan (source `extraction`), `null` si absente ou introuvable. */
  extraction: { id: string; zone_set_id: string; version: number } | null;
  /** Les CP bruts que DV360 recevrait (zone ou extraction). */
  cpsDv360: string[];
  connexions: { provider: string; auth_method: string | null; status: string }[];
  mode: ModeDv360;
  motifs: Motif[];
}

/**
 * La zone ou l'extraction du plan n'appartient pas à l'espace de l'appelant : la route répond 404 AVANT toute
 * écriture. La campagne a beau être accessible (un super_admin les voit toutes), la poussée part avec la connexion
 * DV360 de l'espace ACTIF — pousser les CP d'un autre espace avec elle est refusé, comme le faisait `targeting/push`
 * avant le lot 7 (« Zone introuvable. »). Relecture 1 du lot 7, I-1.
 */
export interface HorsEspace { horsEspace: string }

/** Une lecture a échoué : l'appelant répond 500, il ne devine pas un pré-vol. */
class ErreurEtatActivation extends Error {}

const lu = <T>(etape: string, r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new ErreurEtatActivation(`${etape} : ${r.error.message}`);
  return r.data;
};

/**
 * Lit l'état d'activation d'une campagne dont l'accès a DÉJÀ été vérifié (`checkCampaignAccess`).
 *
 * @returns L'état, ou {@link HorsEspace} si la zone ou l'extraction du plan est d'un autre espace que `orgId`.
 * @throws {ErreurEtatActivation} Si une lecture échoue (y compris un plafond de lecture paginée franchi).
 */
export async function lireEtatActivation(
  supabase: ClientAdmin, campaignId: string, orgId: string, superAdmin: boolean,
): Promise<EtatActivation | HorsEspace> {
  const strategie = lu('stratégie', await supabase
    .from('bidding_strategies')
    .select('id, name, status, scope_type, zone_id, forecast_cpm, total_budget, in_zone_weights')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as StrategieActivation | null;

  let versionPubliee: number | null = null;
  let modifiees: string[] = [];
  const source = strategie ? sourceDePoussee(strategie) : null;

  // ── L'espace de la source, vérifié AVANT toute autre lecture (I-1) ──────
  let extraction: EtatActivation['extraction'] = null;
  if (source?.type === 'zone') {
    const zone = lu('zone', await supabase
      .from('custom_geo_zones').select('org_id').eq('id', source.zoneId).maybeSingle());
    if (!zone || zone.org_id !== orgId) return { horsEspace: 'Zone introuvable.' };
  } else if (source?.type === 'extraction') {
    extraction = lu('extraction', await supabase
      .from('zone_set_extractions').select('id, zone_set_id, version').eq('id', source.extractionId).maybeSingle());
    if (extraction) {
      const jeu = lu('jeu', await supabase
        .from('zone_sets').select('org_id').eq('id', extraction.zone_set_id).maybeSingle());
      if (!jeu || jeu.org_id !== orgId) return { horsEspace: 'Extraction introuvable dans cet espace.' };
    }
  }

  if (strategie) {
    const derniere = lu('version publiée', await supabase
      .from('strategie_versions')
      .select('version, empreinte_zones')
      .eq('strategie_id', strategie.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle());
    if (derniere) {
      versionPubliee = derniere.version;
      // Même empreinte de CONTENU que `/publier` (sql/159) : comparer deux mesures obtenues autrement rendrait la
      // dérive systématique. Une extraction est figée par construction : seule une zone peut dériver.
      let courante: EmpreinteZones = {};
      if (strategie.zone_id) {
        const emp = lu('empreinte', await supabase.rpc('empreinte_zones', { p_zone_ids: [strategie.zone_id] }));
        courante = rpcJson<EmpreinteZones>(emp) ?? {};
      }
      modifiees = zonesModifiees((derniere.empreinte_zones ?? {}) as EmpreinteZones, courante);
    }
  }

  // Colonnes réelles : `organization_id` (pas `org_id`) et `auth_method` (pas `method`).
  const connexions = lu('connexions', await supabase
    .from('dsp_connections').select('provider, auth_method, status').eq('organization_id', orgId)) ?? [];
  const campagne = lu('campagne', await supabase
    .from('dsp_campaigns').select('is_demo').eq('id', campaignId).maybeSingle());
  const mode = modePoussee(connexions, campagne?.is_demo === true);

  let cpsDv360: string[] = [];
  try {
    if (source?.type === 'zone') {
      cpsDv360 = await lireCodesDeZone(supabase, source.zoneId, 'cp');
    } else if (extraction) {
      cpsDv360 = (await lireCpPlateforme(supabase, extraction.id, 'dv360')).map((l) => l.code_postal);
    }
  } catch (e) {
    if (e instanceof ErreurEtatActivation) throw e;
    throw new ErreurEtatActivation(`codes postaux : ${e instanceof Error ? e.message : String(e)}`);
  }

  const motifs = motifsPrevol({
    aStrategie: strategie !== null,
    superAdmin,
    versionPubliee,
    nZonesModifiees: modifiees.length,
    mode,
    connexionDv360: connexions.some((c) => c.provider === 'dv360'),
    source,
    nCpDv360: cpsDv360.length,
  });

  return { strategie, versionPubliee, zonesModifiees: modifiees, source, extraction, cpsDv360, connexions, mode, motifs };
}
