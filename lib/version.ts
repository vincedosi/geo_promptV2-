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
// v15 — 2026-09-11 : palier 20 km (sql/124 + 125), carreaux servis dès z4.
// v16 — 2026-09-11 : RETRAIT de code_dept + code_region (sql/126). Le filtre
//       territorial client-side annoncé par la v13 n'a jamais été construit :
//       personne ne lit ces deux propriétés. Elles coûtaient 10 250 ms sur les
//       11 438 ms d'une tuile z8 — un ST_Intersects par carreau contre les
//       multipolygones départementaux, 2 954 fois. Mesuré, puis retiré : 100 ms.
//       Si le besoin revient, ce sera une colonne matérialisée à l'agrégation,
//       jamais une jointure au moment de servir la tuile.
// v17 — 2026-09-11 : cascade recalee sur la taille apparente des mailles
//       (sql/127). Les memes coordonnees de tuile servent desormais une AUTRE
//       maille : toute tuile en cache est perimee.
export const CARREAUX_TILE_VERSION = 17;
