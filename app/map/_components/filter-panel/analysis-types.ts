/**
 * Types partagés par les outils d'analyse spatiale (Voronoï, Bataille V2,
 * isochrones ORS). Déplacés hors de FilterPanel.tsx (2026-09-03) pour que les
 * trois outils extraits puissent les typer sans importer le monolithe.
 */

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
