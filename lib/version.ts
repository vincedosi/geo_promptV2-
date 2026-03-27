/**
 * GEO.Prompt — Versioning central
 * ⚠️  REGLE DEV: Toute modification de code → incrémenter APP_VERSION
 * Format: MAJOR.MINOR.PATCH
 *   MAJOR = refonte majeure
 *   MINOR = nouvelle feature
 *   PATCH = bugfix / logs / petits ajustements
 */

export const APP_NAME    = 'GEO.Prompt';
export const APP_VERSION = '7.4.0';
export const BUILD_DATE  = '2026-03-20';

// Fichier PMTiles IRIS servi depuis /public (Next.js static) — géométries uniquement
// Les valeurs démographiques sont injectées dynamiquement depuis la DB via setFeatureState
// Régénérer uniquement si les contours IGN changent (rare) — voir scripts/export-iris-local.mjs
export const IRIS_PMTILES_URL = '/iris_france.pmtiles';

// À incrémenter à chaque migration modifiant la fonction MVT carreaux (get_carreaux_tile / tiles/{z}/{x}/{y})
export const CARREAUX_TILE_VERSION = 11;
