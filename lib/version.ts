/**
 * GEO.Prompt — Versioning central
 * ⚠️  REGLE DEV: Toute modification de code → incrémenter APP_VERSION
 * Format: MAJOR.MINOR.PATCH
 *   MAJOR = refonte majeure
 *   MINOR = nouvelle feature
 *   PATCH = bugfix / logs / petits ajustements
 */

export const APP_NAME    = 'GEO.Prompt';
export const APP_VERSION = '7.19.0';
export const BUILD_DATE  = '2026-04-28';

// Fichier PMTiles IRIS hébergé sur GitHub Releases (196 MB > limite Supabase Storage 50 MB)
// Les valeurs démographiques sont injectées dynamiquement depuis la DB via setFeatureState
// Régénérer uniquement si les contours IGN changent (rare) — voir .github/workflows/generate-iris-pmtiles.yml
// Fichier servi depuis /public en attendant la première exécution du workflow generate-iris-pmtiles.
export const IRIS_PMTILES_URL = '/iris_france.pmtiles';

// À incrémenter à chaque migration modifiant la fonction MVT carreaux (get_carreaux_tile / tiles/{z}/{x}/{y})
// v13 — 2026-04-24 : expose code_dept + code_region dans les props MVT (JOIN ref_departements)
//       pour filtre territorial client-side (setFilter) sans refetch.
// v14 — 2026-09-10 : expose superficie_km2 (sql/122), indispensable à la normalisation
//       en densité de la couche carreaux. Sans ce bump, une tuile d'avant la migration
//       reste servie jusqu'à 1 h (Cache-Control: public, max-age=3600 + cache mémoire
//       serveur) : toutes ses valeurs sont écartées faute de dénominateur, et la couche
//       reste à plat.
export const CARREAUX_TILE_VERSION = 15;
