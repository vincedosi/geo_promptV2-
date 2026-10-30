/**
 * ④ Analyse — les TYPOLOGIES déjà calculées des POI d'une zone (④ finitions, T8, arbitrage A-7 ; Excel n° 34) :
 * `GET /api/zones/[id]/typologies` (`typologies_de_zone`, sql/298). Lecture seule, pour tous ; le calcul d'un modèle
 * reste réservé au super admin (assistant de clustering, inchangé). Logique PURE : types, libellés, entités de la carte.
 */

/** Un POI typé de la zone, pour un modèle (durée, mode). */
export interface PoiType {
  poi_id: string;
  nom: string | null;
  lat: number;
  lng: number;
  categorie: string | null;
  duree: number;
  mode: string;
  version: number;
  cluster_id: number;
  cluster_label: string | null;
  population: number | null;
}

/** Une typologie d'un modèle : ses POI DANS la zone, la population qu'ils couvrent, le profil moyen du cluster. */
export interface Typologie {
  cluster_id: number;
  label: string | null;
  n_poi: number;
  population: number | null;
  profil: Record<string, unknown> | null;
}

/** Le dernier modèle d'un (durée, mode), et ses typologies présentes dans la zone. */
export interface ModeleTypologies {
  duree: number;
  mode: string;
  version: number;
  typologies: Typologie[];
}

export interface ResultatTypologies {
  modeles: ModeleTypologies[];
  /** Au plus 5 000 POI rendus (`tronque` sinon) : les compteurs des typologies portent sur TOUS. */
  pois: PoiType[];
  tronque: boolean;
  motif: 'aucun_poi_type' | null;
}

/** Sans zone analysée : rien à lire. */
export const MESSAGE_SANS_ZONE = 'Choisissez une zone en tête de ④.';
/** Aucun POI typé dans la zone (A-7). */
export const MESSAGE_AUCUN_POI_TYPE = 'Aucun POI typé dans cette zone : les typologies sont calculées par l’équipe dentsu (CIRFA aujourd’hui).';
/** Plus de 5 000 POI typés : la carte n'en montre qu'une partie, le tableau compte tout. */
export const MESSAGE_TRONQUE = 'Plus de 5 000 POI typés dans la zone : la carte n’en montre qu’une partie ; le tableau les compte tous.';

/** Les huit teintes qualitatives (`--nature-*`, catégories sans ordre) et le cerne des points. */
export const JETONS_TYPOLOGIES = {
  t1: 'nature-1', t2: 'nature-2', t3: 'nature-3', t4: 'nature-4', t5: 'nature-5', t6: 'nature-6', t7: 'nature-7', t8: 'nature-8',
  contour: 'poi-contour',
} as const;
export type PaletteTypologies = Record<keyof typeof JETONS_TYPOLOGIES, string>;
const TEINTES = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'] as const;

/** Le jeton CSS d'une typologie (pastille du tableau), par son rang dans le modèle : au-delà de huit, les teintes reviennent. */
export function jetonTypologie(rang: number): string {
  return `var(--${JETONS_TYPOLOGIES[TEINTES[rang % TEINTES.length]]})`;
}

/** La clé d'un modèle (pastille, `track`). */
export function cleModele(m: Pick<ModeleTypologies, 'duree' | 'mode'>): string {
  return `${m.duree}-${m.mode}`;
}

const MODES: Readonly<Record<string, string>> = { drive: 'voiture', 'driving-car': 'voiture', walk: 'à pied', bike: 'vélo' };

/** « 15 min · voiture ». */
export function libelleModele(m: Pick<ModeleTypologies, 'duree' | 'mode'>): string {
  return `${m.duree} min · ${MODES[m.mode] ?? m.mode}`;
}

/** Le nom d'une typologie : son libellé, sinon « Typologie <n> ». */
export function libelleTypologie(t: Pick<Typologie, 'cluster_id' | 'label'>): string {
  return t.label?.trim() || `Typologie ${t.cluster_id + 1}`;
}

/**
 * Les POI du modèle `m`, un point chacun, avec la teinte CALCULÉE de sa typologie (MapLibre ne résout pas `var()` dans
 * `paint` : la couleur part en propriété, lue par `['get', 'couleur']`).
 */
export function entitesTypologies(pois: readonly PoiType[], m: ModeleTypologies, p: PaletteTypologies): GeoJSON.FeatureCollection {
  const rangs = new Map(m.typologies.map((t, i) => [t.cluster_id, i]));
  return {
    type: 'FeatureCollection',
    features: pois
      .filter((x) => x.duree === m.duree && x.mode === m.mode && Number.isFinite(x.lat) && Number.isFinite(x.lng))
      .map((x): GeoJSON.Feature => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [x.lng, x.lat] },
        properties: { cluster_id: x.cluster_id, nom: x.nom ?? '', couleur: p[TEINTES[(rangs.get(x.cluster_id) ?? 0) % TEINTES.length]] },
      })),
  };
}
