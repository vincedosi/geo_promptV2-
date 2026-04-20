/**
 * GEO.Prompt — Versioning central
 * ⚠️  REGLE DEV: Toute modification de code → incrémenter APP_VERSION
 * Format: MAJOR.MINOR.PATCH
 *   MAJOR = refonte majeure
 *   MINOR = nouvelle feature
 *   PATCH = bugfix / logs / petits ajustements
 */

export const APP_NAME    = 'GEO.Prompt';
export const APP_VERSION = '7.12.0';
export const BUILD_DATE  = '2026-04-20';

// Fichier PMTiles IRIS hébergé sur GitHub Releases (196 MB > limite Supabase Storage 50 MB)
// Les valeurs démographiques sont injectées dynamiquement depuis la DB via setFeatureState
// Régénérer uniquement si les contours IGN changent (rare) — voir .github/workflows/generate-iris-pmtiles.yml
// Fichier servi depuis /public en attendant la première exécution du workflow generate-iris-pmtiles.
// Après upload sur GitHub Releases, basculer vers '/api/iris-tiles-proxy'.
export const IRIS_PMTILES_URL = '/iris_france.pmtiles';

// À incrémenter à chaque migration modifiant la fonction MVT carreaux (get_carreaux_tile / tiles/{z}/{x}/{y})
export const CARREAUX_TILE_VERSION = 11;
