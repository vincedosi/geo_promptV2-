/**
 * @file lib/zones/executer-recette.ts — une recette de zone → sa géométrie (spec carte-en-parcours § 16.3).
 *
 * UNE RPC `jsonb` par recette, appelée avec le périmètre et les sources de l'espace ACTIF. Les recettes lourdes sont
 * refusées AVANT tout appel quand le périmètre manque ou est national (`refusPerimetreLocal`) ; la base refait la
 * garde (surface, appartenance d'une zone-périmètre). Un refus est une réponse 422 en français, jamais une exception.
 *
 * Une recette RECALCULABLE ignore toute géométrie fournie par le client (le serveur la recalcule) ; une recette FIGÉE
 * (dessin, import, isochrone, capture) l'exige, et `zone_dessin` (sql/156) la répare et la découpe sur la France.
 *
 * Chaque RPC est appelée sur le client (`supabase.rpc(…)`), jamais par une référence détachée : `rpc` lit `this.rest`,
 * et `const f = supabase.rpc; f(…)` lève à l'exécution (le faux client du test est une classe pour le prouver).
 */
import type { createAdminClient } from '@/lib/auth';
import { rpcJson, toJson } from '@/lib/supabase/rpc-json';
import {
  MAX_POI_RAYON, MAX_SOMMETS_FORME, MESSAGES_REFUS, refusPerimetreLocal, type Recette, type RefusRecette,
} from './recette';

type ClientAdmin = ReturnType<typeof createAdminClient>;
/** Non exporté : aucun consommateur ne le nomme (knip le compterait mort) ; il se lit dans `IssueRecette`. */
type FormeZone = GeoJSON.Polygon | GeoJSON.MultiPolygon;

export interface ContexteRecette {
  orgId: string;
  /** `getOrgSourceIds(…, { vueEspace: true })` : les sources de POI que l’espace voit. */
  sources: string[];
  /** La forme d'une recette figée ; ignorée pour une recette recalculable. */
  geometrie?: unknown;
}

export type IssueRecette =
  | { ok: true; geometry: FormeZone; surface_km2: number | null; compte: number | null; part_retenue: number | null; population: number | null }
  | { ok: false; statut: 400 | 404 | 409 | 422 | 500; refus: RefusRecette | null; message: string };

/** La forme commune des réponses `jsonb` des RPC de zone (sql/151, 155, 156, 252, 254-256). */
interface ReponseRpc {
  vide?: boolean; geometry?: unknown; surface_km2?: number | null; compte?: number | null;
  part_retenue?: number | null; population?: number | null; refus?: string;
}

/** Ce que rend un appel `supabase.rpc(…)` une fois attendu — seuls `data` et `error.message` sont lus. */
type RequeteRpc = PromiseLike<{ data: unknown; error: { message: string } | null }>;

const ECHEC: IssueRecette = { ok: false, statut: 500, refus: null, message: 'Calcul de la zone impossible.' };

function refuser(refus: RefusRecette, statut: 404 | 409 | 422 = 422): IssueRecette {
  return { ok: false, statut, refus, message: MESSAGES_REFUS[refus] };
}

/** Une recette mal formée qui aurait échappé au schéma (`lireRecette`) : 400, jamais un 500 ni une RPC qui lève. */
function invalide(message: string): IssueRecette {
  return { ok: false, statut: 400, refus: null, message };
}

function estRefus(r: string): r is RefusRecette {
  return Object.prototype.hasOwnProperty.call(MESSAGES_REFUS, r);
}

function estForme(g: unknown): g is FormeZone {
  const t = (g as { type?: unknown } | null)?.type;
  return (t === 'Polygon' || t === 'MultiPolygon') && Array.isArray((g as { coordinates?: unknown }).coordinates);
}

/** Le nombre de sommets d'un Polygon/MultiPolygon (anneaux compris) ; 0 pour toute autre valeur. */
export function compterSommets(g: unknown): number {
  if (!estForme(g)) return 0;
  const polys: unknown[] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let n = 0;
  for (const anneaux of polys) {
    if (!Array.isArray(anneaux)) continue;
    for (const a of anneaux) n += Array.isArray(a) ? a.length : 0;
  }
  return n;
}

function nombreOuNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Une réponse `jsonb` arrive en objet ; certaines anciennes RPC la rendent sérialisée (cf. `source/composite`). */
function lireReponse(data: unknown): ReponseRpc | null {
  if (typeof data === 'string') {
    try { return rpcJson<ReponseRpc>(JSON.parse(data)); } catch { return null; }
  }
  return data !== null && typeof data === 'object' ? rpcJson<ReponseRpc>(data) : null;
}

function issue(nom: string, r: ReponseRpc | null): IssueRecette {
  if (!r) {
    console.error(`[zones/recette] ${nom} : réponse illisible`);
    return ECHEC;
  }
  if (r.refus !== undefined && r.refus !== null) {
    if (estRefus(r.refus)) return refuser(r.refus);
    console.error(`[zones/recette] ${nom} : refus hors contrat`, r.refus);
    return ECHEC;
  }
  if (r.vide || !estForme(r.geometry)) return refuser('forme_vide', 409);
  return {
    ok: true, geometry: r.geometry, surface_km2: nombreOuNull(r.surface_km2), compte: nombreOuNull(r.compte),
    part_retenue: nombreOuNull(r.part_retenue), population: nombreOuNull(r.population),
  };
}

/** Attend une requête RPC DÉJÀ lancée sur le client (appel lié) et la traduit en issue HTTP. */
async function lire(nom: string, requete: RequeteRpc): Promise<IssueRecette> {
  const { data, error } = await requete;
  if (error) {
    console.error(`[zones/recette] ${nom} :`, error.message);
    return ECHEC;
  }
  return issue(nom, lireReponse(data));
}

export async function executerRecette(supabase: ClientAdmin, recette: Recette, ctx: ContexteRecette): Promise<IssueRecette> {
  const local = refusPerimetreLocal(recette);
  if (local) return refuser(local);

  // Le `switch` est exhaustif (aucun `default`) : un type de recette ajouté sans branche ne compile pas. Une recette
  // RECALCULABLE n'y lit jamais `ctx.geometrie` ; seules les quatre figées la lisent.
  switch (recette.type) {
    case 'rayon_point':
      return lire('zone_rayon', supabase.rpc('zone_rayon', { p_lon: recette.lon, p_lat: recette.lat, p_rayon_m: recette.rayon_m }));
    case 'rayon_poi': {
      const p = recette.perimetre;
      if (!p) return refuser('perimetre_absent');
      return lire('zone_rayon_poi', supabase.rpc('zone_rayon_poi', {
        p_categorie: recette.categorie, p_rayon_m: recette.rayon_m,
        p_perimetre_type: p.type, p_perimetre_code: p.code,
        p_org_id: ctx.orgId, p_sources: ctx.sources, p_max_poi: MAX_POI_RAYON,
      }));
    }
    case 'seuil_carreaux': {
      const p = recette.perimetre;
      if (!p) return refuser('perimetre_absent');
      return lire('zone_seuil_carreaux', supabase.rpc('zone_seuil_carreaux', {
        p_indicateur: recette.indicateur, p_operateur: recette.operateur, p_seuil: recette.seuil,
        p_perimetre_type: p.type, p_perimetre_code: p.code, p_org_id: ctx.orgId,
      }));
    }
    case 'seuil_territoire': {
      const p = recette.perimetre;
      if (!p) return refuser('perimetre_absent');
      return lire('zone_seuil_territoire', supabase.rpc('zone_seuil_territoire', {
        p_indicateur: recette.indicateur, p_operateur: recette.operateur, p_seuil: recette.seuil,
        p_perimetre_type: p.type, p_perimetre_code: p.code, p_org_id: ctx.orgId,
      }));
    }
    case 'codes_postaux':
      return lire('get_admin_filter_geometry', supabase.rpc('get_admin_filter_geometry', { p_scale: 'cp', p_codes: [...recette.codes] }));
    case 'combinaison':
      return combiner(supabase, recette, ctx);
    case 'dessin':
    case 'import':
    case 'isochrone':
    case 'capture':
      // Figées : la forme vient du client et n'est jamais recalculée — validée, réparée, découpée sur la France.
      return figer(supabase, ctx.geometrie);
  }
}

async function figer(supabase: ClientAdmin, geometrie: unknown): Promise<IssueRecette> {
  if (!estForme(geometrie)) return invalide('Une forme (Polygon ou MultiPolygon) est attendue pour cette recette.');
  if (compterSommets(geometrie) > MAX_SOMMETS_FORME) return refuser('trop_de_sommets');
  return lire('zone_dessin', supabase.rpc('zone_dessin', { p_geojson: toJson(geometrie) }));
}

async function combiner(
  supabase: ClientAdmin,
  recette: Extract<Recette, { type: 'combinaison' }>,
  ctx: ContexteRecette,
): Promise<IssueRecette> {
  const zones = [...recette.zones];
  // `zone_intersection` calcule première ∩ union(autres) : ce n'est l'intersection que pour DEUX zones (sql/151,
  // fonction gardée telle quelle, React l'emploie). `get_composite_zone_geometry` lève sous deux zones.
  if (recette.operation === 'intersection' && zones.length !== 2) return invalide('L’intersection se fait entre deux zones.');
  if (recette.operation !== 'intersection' && zones.length < 2) {
    return invalide(recette.operation === 'union' ? 'L’union se fait entre deux zones au moins.' : 'La différence se fait entre deux zones au moins.');
  }

  // ≤ 20 identifiants (schéma) : une lecture bornée par construction, une seule requête.
  const { data, error } = await supabase.from('custom_geo_zones').select('id').eq('org_id', ctx.orgId).in('id', zones);
  if (error) {
    console.error('[zones/recette] opérandes :', error.message);
    return ECHEC;
  }
  if ((data ?? []).length !== new Set(zones).size) return refuser('zone_introuvable', 404);

  switch (recette.operation) {
    case 'union':
      return lire('get_composite_zone_geometry', supabase.rpc('get_composite_zone_geometry', { p_zone_ids: zones }));
    case 'intersection':
      return lire('zone_intersection', supabase.rpc('zone_intersection', { p_zone_ids: zones }));
    case 'difference':
      return lire('zone_difference', supabase.rpc('zone_difference', { p_base: zones[0], p_retires: zones.slice(1) }));
  }
}
