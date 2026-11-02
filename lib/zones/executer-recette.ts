/**
 * @file lib/zones/executer-recette.ts — une recette de zone → sa géométrie (spec carte-en-parcours § 16.3).
 *
 * UNE RPC `jsonb` par recette, appelée avec le périmètre et les sources de l'espace ACTIF. Les recettes lourdes sont
 * refusées AVANT tout appel quand le périmètre manque ou est national (`refusPerimetreLocal`) ; la base refait la
 * garde (surface, appartenance d'une zone-périmètre). Un refus est une réponse 422 en français, jamais une exception.
 *
 * Une recette calculée par le serveur (recalculable, ou combinaison) ignore toute géométrie fournie par le client ; une
 * recette FIGÉE (dessin, import, isochrone, capture — `exigeGeometrie`) l'exige, et `zone_dessin` (sql/156) la répare et la découpe sur la France.
 *
 * Chaque RPC est appelée sur le client (`supabase.rpc(…)`), jamais par une référence détachée : `rpc` lit `this.rest`,
 * et `const f = supabase.rpc; f(…)` lève à l'exécution (le faux client du test est une classe pour le prouver).
 */
import type { createAdminClient } from '@/lib/auth';
import { rpcJson, toJson } from '@/lib/supabase/rpc-json';
import { estRecettePays } from './couverture';
import {
  CAPACITE_SYNCHRONE_POI_RAYON, MAX_SOMMETS_FORME, MESSAGES_REFUS, refusPerimetreLocal, type Recette, type RefusRecette,
  type UnitesConstitutives,
} from './recette';

type ClientAdmin = ReturnType<typeof createAdminClient>;
/** Non exporté : aucun consommateur ne le nomme (knip le compterait mort) ; il se lit dans `IssueRecette`. */
type FormeZone = GeoJSON.Polygon | GeoJSON.MultiPolygon;

export interface ContexteRecette {
  orgId: string;
  /** `getOrgSourceIds(…, { vueEspace: true })` : les sources de POI que l’espace voit (lues pour `rayon_poi` seulement, vide sinon). */
  sources: string[];
  /**
   * Les indicateurs visibles de l'espace (`indicateursVisiblesDeLaSession`, sql/288) — lus pour `seuil_territoire`
   * seulement. Absent : tout indicateur est refusé (ferme par défaut).
   */
  indicateurs?: ReadonlySet<string>;
  /** La forme d'une recette figée ; ignorée pour une recette calculée par le serveur. */
  geometrie?: unknown;
}

/**
 * `unites` (B15) : les unités entières dont la forme est l'union, quand le SERVEUR les connaît — codes d'un seuil sur
 * territoires (`zone_seuil_territoire`, sql/320), CP d'une capture de score (la forme en est recalculée). Absente sinon.
 */
export type IssueRecette =
  | {
    ok: true; geometry: FormeZone; surface_km2: number | null; compte: number | null; part_retenue: number | null; population: number | null;
    unites?: UnitesConstitutives;
  }
  | { ok: false; statut: 400 | 404 | 409 | 422 | 500; refus: RefusRecette | null; message: string };

/** La forme commune des réponses `jsonb` des RPC de zone (sql/151, 155, 156, 252, 254-256, 292). */
interface ReponseRpc {
  vide?: boolean; geometry?: unknown; surface_km2?: number | null; compte?: number | null;
  part_retenue?: number | null; population?: number | null; refus?: string;
  /** B15 : `zone_seuil_territoire` (sql/320) — la maille et les codes retenus. */
  maille?: unknown; codes?: unknown;
}

/** B15 : les unités d'une réponse qui les porte (maille CP ou IRIS, codes non vides) ; `null` sinon. */
function unitesDe(r: ReponseRpc): UnitesConstitutives | null {
  if ((r.maille !== 'cp' && r.maille !== 'iris') || !Array.isArray(r.codes) || r.codes.length === 0) return null;
  return r.codes.every((c) => typeof c === 'string') ? { maille: r.maille, codes: r.codes as string[] } : null;
}

/** Ce que rend un appel `supabase.rpc(…)` une fois attendu — seuls `data`, `error.message` et `error.code` sont lus. */
type RequeteRpc = PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;

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
  const unites = unitesDe(r);
  return {
    ok: true, geometry: r.geometry, surface_km2: nombreOuNull(r.surface_km2), compte: nombreOuNull(r.compte),
    part_retenue: nombreOuNull(r.part_retenue), population: nombreOuNull(r.population), ...(unites ? { unites } : {}),
  };
}

/** Attend une requête RPC DÉJÀ lancée sur le client (appel lié) et la traduit en issue HTTP. */
async function lire(nom: string, requete: RequeteRpc): Promise<IssueRecette> {
  const { data, error } = await requete;
  if (error) {
    console.error(`[zones/recette] ${nom} :`, error.message);
    // 22023 (`invalid_parameter_value`) : les RPC de recette lèvent ce code sur un argument hors contrat (opérateur,
    // seuil NULL, plafond) — c'est la requête qui est fausse, pas le serveur.
    // Une forme sans surface (« sans surface », « non surfacique ») se dit comme telle : c'est le dessin qu'il faut
    // reprendre, pas des « paramètres ». Garde défensive : `zone_dessin` (sql/156) rend aujourd'hui `vide` (→ 409
    // forme_vide) plutôt que de lever — ce sont `creer_zone_recette` / `remplacer_geometrie_zone` (sql/253) qui lèvent.
    if (error.code === '22023' && nom === 'zone_dessin' && /surfac/i.test(error.message)) return invalide('La forme dessinée n’a pas de surface.');
    if (error.code === '22023') return invalide('Paramètres de calcul invalides.');
    // `get_composite_zone_geometry` (sql/100) LÈVE au lieu de rendre `vide` quand les zones n'ont aucune géométrie.
    if (nom === 'get_composite_zone_geometry' && error.code === 'P0001' && error.message.includes('aucune geometrie trouvee')) {
      return refuser('forme_vide', 409);
    }
    return ECHEC;
  }
  return issue(nom, lireReponse(data));
}

export async function executerRecette(supabase: ClientAdmin, recette: Recette, ctx: ContexteRecette): Promise<IssueRecette> {
  const local = refusPerimetreLocal(recette);
  if (local) return refuser(local);

  // Le `switch` est exhaustif (aucun `default`) : un type de recette ajouté sans branche ne compile pas. Une recette
  // calculée par le serveur n'y lit jamais `ctx.geometrie` ; seules les quatre figées la lisent.
  switch (recette.type) {
    case 'rayon_point':
      return lire('zone_rayon', supabase.rpc('zone_rayon', { p_lon: recette.lon, p_lat: recette.lat, p_rayon_m: recette.rayon_m }));
    case 'rayon_poi': {
      const p = recette.perimetre;
      if (!p) return refuser('perimetre_absent');
      // La capacité synchrone mesurée, la même pour tout périmètre, refaite en base (sql/285).
      return lire('zone_rayon_poi', supabase.rpc('zone_rayon_poi', {
        p_categorie: recette.categorie, p_rayon_m: recette.rayon_m,
        p_perimetre_type: p.type, p_perimetre_code: p.code,
        p_org_id: ctx.orgId, p_sources: ctx.sources, p_max_poi: CAPACITE_SYNCHRONE_POI_RAYON,
      }));
    }
    case 'seuil_carreaux': {
      const p = recette.perimetre;
      if (!p) return refuser('perimetre_absent');
      // La jumelle (sql/292). Le minimum vient de la RECETTE enregistrée, jamais d'un défaut serveur : toute recette
      // le porte (A5, sql/310 : les recettes d'avant le lot ont reçu 0 explicitement, la base et le schéma l'exigent).
      return lire('zone_seuil_carreaux_min', supabase.rpc('zone_seuil_carreaux_min', {
        p_indicateur: recette.indicateur, p_operateur: recette.operateur, p_seuil: recette.seuil,
        p_perimetre_type: p.type, p_perimetre_code: p.code, p_org_id: ctx.orgId, p_min_menages: recette.min_menages,
      }));
    }
    case 'seuil_territoire': {
      const p = recette.perimetre;
      if (!p) return refuser('perimetre_absent');
      // Un indicateur privé à un autre espace se refuse EXACTEMENT comme un inconnu, au même moment : la RPC teste
      // l'indicateur avant le périmètre et rend `indicateur_inconnu`.
      if (!ctx.indicateurs?.has(recette.indicateur)) return refuser('indicateur_inconnu');
      return lire('zone_seuil_territoire', supabase.rpc('zone_seuil_territoire', {
        p_indicateur: recette.indicateur, p_operateur: recette.operateur, p_seuil: recette.seuil,
        p_perimetre_type: p.type, p_perimetre_code: p.code, p_org_id: ctx.orgId,
      }));
    }
    case 'codes_postaux':
      return lire('get_admin_filter_geometry', supabase.rpc('get_admin_filter_geometry', { p_scale: 'cp', p_codes: [...recette.codes] }));
    case 'combinaison':
      return combiner(supabase, recette, ctx);
    case 'pays':
      // Figée, calculée par le serveur (sql/296) : l'union des régions, aucune géométrie cliente.
      return lire('zone_pays_geometrie', supabase.rpc('zone_pays_geometrie', { p_code: recette.code }));
    case 'capture': {
      // B15 : une capture de score garde ses CP — sa forme est leur union, recalculée ICI (la forme du client n'est pas
      // lue) : la zone est exactement ces CP, comme une liste de CP.
      const u = recette.unites_constitutives;
      if (!u) return figer(supabase, ctx.geometrie);
      const i = await lire('get_admin_filter_geometry', supabase.rpc('get_admin_filter_geometry', { p_scale: 'cp', p_codes: [...u.codes] }));
      return i.ok ? { ...i, unites: { maille: u.maille, codes: u.codes } } : i;
    }
    case 'dessin':
    case 'import':
    case 'isochrone':
      // Figées : la forme vient du client et n'est jamais recalculée — validée, réparée, découpée sur la France.
      return figer(supabase, ctx.geometrie);
  }
}

function estPosition(p: unknown): p is [number, number] {
  return Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/** Un anneau GeoJSON : ≥ 4 positions de deux nombres finis, la dernière égale à la première. */
function anneauValide(a: unknown): boolean {
  if (!Array.isArray(a) || a.length < 4 || !a.every(estPosition)) return false;
  const premier = a[0] as [number, number];
  const dernier = a[a.length - 1] as [number, number];
  return premier[0] === dernier[0] && premier[1] === dernier[1];
}

function polygoneValide(anneaux: unknown): boolean {
  return Array.isArray(anneaux) && anneaux.length > 0 && anneaux.every(anneauValide);
}

/**
 * La structure d'une forme figée, vérifiée AVANT `zone_dessin` : un import maladroit (anneau ouvert, coordonnée texte,
 * position à trois nombres) est une réponse 400 à l'utilisateur, pas une exception de `ST_GeomFromGeoJSON` lue en 500.
 * La géométrie elle-même (auto-intersection, trous) est réparée en base par `ST_MakeValid`.
 */
function formeBienConstruite(g: FormeZone): boolean {
  if (g.type === 'Polygon') return polygoneValide(g.coordinates);
  return g.coordinates.length > 0 && g.coordinates.every(polygoneValide);
}

async function figer(supabase: ClientAdmin, geometrie: unknown): Promise<IssueRecette> {
  if (!estForme(geometrie)) return invalide('Une forme (Polygon ou MultiPolygon) est attendue pour cette recette.');
  // Le plafond d'abord : il borne aussi le parcours de `formeBienConstruite`.
  if (compterSommets(geometrie) > MAX_SOMMETS_FORME) return refuser('trop_de_sommets');
  if (!formeBienConstruite(geometrie)) {
    return invalide('La forme est mal construite : chaque contour doit être fermé, avec au moins quatre points de deux coordonnées.');
  }
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
  const { data, error } = await supabase.from('custom_geo_zones').select('id, recette').eq('org_id', ctx.orgId).in('id', zones);
  if (error) {
    console.error('[zones/recette] opérandes :', error.message);
    return ECHEC;
  }
  if ((data ?? []).length !== new Set(zones).size) return refuser('zone_introuvable', 404);
  // Une zone pays (sql/296) en opérande ferait une forme quasi nationale, que la résolution des codes lirait IRIS par
  // IRIS (2,1 s, 48 540 accès) : refusée avant tout calcul (relecture 1 du groupe A, ④ finitions).
  if ((data ?? []).some((z) => estRecettePays(z.recette))) return refuser('operande_pays');

  switch (recette.operation) {
    case 'union':
      return lire('get_composite_zone_geometry', supabase.rpc('get_composite_zone_geometry', { p_zone_ids: zones }));
    case 'intersection':
      return lire('zone_intersection', supabase.rpc('zone_intersection', { p_zone_ids: zones }));
    case 'difference':
      return lire('zone_difference', supabase.rpc('zone_difference', { p_base: zones[0], p_retires: zones.slice(1) }));
  }
}
