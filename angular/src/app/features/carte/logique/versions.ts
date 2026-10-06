/**
 * Copie Angular (lot 4, P6) des constantes de TUILES et de PLANCHERS de `lib/version.ts`
 * (`CARREAUX_TILE_VERSION`, `IRIS_TILE_VERSION`, `IRIS_ZOOM_PLANCHER`, `PPRT_ZOOM_PLANCHER`),
 * verrouillees par tests/unit/angular/carte-couches-paritaire.test.ts (gel P5 etendu a /map).
 *
 * Les trois zooms des ZONES DE RISQUE (`ZONES_RISQUE_ZOOM_*`) sont deja copies par le lot 3 :
 * `features/risques/logique/zooms.ts` — non recopies ici.
 *
 * ⚠ Bumper `CARREAUX_TILE_VERSION` / `IRIS_TILE_VERSION` a tout changement de schema de tuile
 * cote React ET ici : sans bump, une tuile en cache (jusqu'a 1 h / 1 semaine) reste servie avec
 * l'ancien schema pendant que le front attend le nouveau.
 */

// ── IRIS : tuiles MVT servies par /api/tiles/iris (TER-001) ─────────────────
//
// À incrémenter à chaque migration changeant le schéma de la tuile IRIS.
// v1 — 2026-09-11 : création. Deux paliers de géométrie (geom_z7 sous z12,
//      geom_3857 au-dessus), plancher à z9, `superficie_km2` pour la 3D.
// v2 — 2026-09-12 : CASCADE d'agrégation (sql/138-139). Les mêmes coordonnées
//      de tuile servent désormais un AUTRE objet — un département à z5, une
//      commune à z7, un IRIS à z9 — et chaque feature porte `niveau`.
export const IRIS_TILE_VERSION = 2;

/**
 * Zoom au-dessous duquel aucune tuile IRIS n'est servie ni demandée.
 *
 * Source unique : la route, la source MapLibre, les trois couches et l'indice
 * affiché dans le panneau lisent cette constante. Il vaut 4 comme le plancher
 * des carreaux : `get_iris_tile` AGRÈGE (départements sous z7, communes à
 * z7-z8, IRIS au-delà) et la France entière tient dans une tuile de 100 kB.
 * Sous le minzoom d'une source, MapLibre ne demande AUCUNE tuile ni n'émet
 * d'erreur : activer la couche depuis la vue France ne montrerait rien.
 */
export const IRIS_ZOOM_PLANCHER = 4;

/**
 * Zoom au-dessous duquel la couche « Périmètre PPRT » ne demande rien.
 *
 * 8 et pas moins : un PPRT fait 0,94 km de large en moyenne (le plus petit :
 * 2 m) ; pour qu'une zone de 2 km couvre au moins 4 px il faut z >= 7,8.
 * La couche MapLibre ET la section du panneau lisent cette constante.
 */
export const PPRT_ZOOM_PLANCHER = 8;

// À incrémenter à chaque migration modifiant la fonction MVT carreaux (get_carreaux_tile / tiles/{z}/{x}/{y})
// v16 — 2026-09-11 : RETRAIT de code_dept + code_region (sql/126).
// v17 — 2026-09-11 : cascade recalée sur la taille apparente des mailles (sql/127).
// v18 — 2026-09-11 : le palier 200 m démarre à z9 (sql/128), choix produit.
// v19 — 2026-09-11 : palier 1 km branché sur z9-z11 (sql/129).
export const CARREAUX_TILE_VERSION = 19;
