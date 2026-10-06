/**
 * Copie Angular (lot 4, P6) VERBATIM de `lib/geo/france-admin.ts` (`ISO_MODES`, `ISO_DURATIONS`),
 * de `app/map/_components/filter-panel/analysis-types.ts` et des types PURS des paramètres directs
 * de `filter-panel/types.ts` (`DirectPOISearchParams`, `DirectBattleParams`, `DirectBattleV2Params`,
 * `FillIsochroneCacheParams`). Verrouillée par tests/unit/angular/carte-couches-paritaire.test.ts
 * (gel P5 étendu à /map).
 *
 * `FilterPanelProps` (même fichier React) n'est PAS copié : c'est le contrat d'un composant React
 * (ReactNode, MutableRefObject, MaplibreMap) ; le panneau Angular lit des services, pas des props.
 * Ne pas corriger un défaut ici sans le corriger dans React.
 */

export const ISO_MODES = [
  { id: 'walk',  label: 'Pied'    },
  { id: 'bike',  label: 'Velo'    },
  { id: 'drive', label: 'Voiture' },
];

export const ISO_DURATIONS = [5, 10, 15, 20, 30, 60, 90, 120];

/** Couverture du cache d'isochrones pour la sélection courante. */
export type CacheStatus = {
  total_pois: number;
  total_combos: number;
  cached_combos: number;
  missing_combos: number;
  missing_pois: number;
  cached_pois: number;
} | null;

/** Anneau d'isochrone renvoyé par le calcul, prêt pour ST_Difference. */
export interface BattleRing {
  cirfa_id: string;
  nom: string;
  lat: number;
  lng: number;
  palier: number;
  geojson: string;
}

export interface DirectPOISearchParams {
  poi_types: string[];
  scope: 'metro' | 'all' | null;
  regions: string[];
  depts: string[];
  ville: string;
  rayon_poi: string | null;
  poi_natures?: Record<string, string[]>;
}

export interface DirectBattleParams {
  category: string;
  mode: string;
  max_minutes: number;
  durations: number[];
  filtre_ville?: string;
  filtre_regions?: string[];
  filtre_depts?: string[];
  metropolitaine: boolean;
  force_recalculate?: boolean;
}

export interface DirectBattleV2Params {
  category: string;
  mode: string;
  filtre_ville?: string;
  filtre_regions?: string[];
  filtre_depts?: string[];
  metropolitaine: boolean;
  paliers: number[];
  force_battle?: boolean;
}

export interface FillIsochroneCacheParams {
  category: string;
  mode: string;
  max_minutes: number;
  durations: number[];
  filtre_ville?: string;
  filtre_regions?: string[];
  filtre_depts?: string[];
  metropolitaine: boolean;
}
