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

// ── IRIS : tuiles MVT servies par /api/tiles/iris (TER-001) ─────────────────
//
// Le PMTiles de 361 Mo qui vivait ici n'a JAMAIS atteint la production :
// `.vercelignore` l'excluait du déploiement, et la GitHub Release censée le
// porter répond 404 en anonyme puisque le dépôt est privé. La couche IRIS ne
// s'affichait que sur le poste du développeur. Deux commentaires de cette
// section étaient faux : les valeurs ne passaient pas par `setFeatureState`
// (`applyIrisColor` colore par `['get', colonne]`), et le fichier n'était pas
// « en attente du workflow » — le workflow avait tourné, sans que rien ne s'en
// serve.
//
// À incrémenter à chaque migration changeant le schéma de la tuile IRIS.
// v1 — 2026-09-11 : création. Deux paliers de géométrie (geom_z7 sous z12,
//      geom_3857 au-dessus), plancher à z9, `superficie_km2` pour la 3D.
// v2 — 2026-09-12 : CASCADE d'agrégation (sql/138-139). Les mêmes coordonnées
//      de tuile servent désormais un AUTRE objet — un département à z5, une
//      commune à z7, un IRIS à z9 — et chaque feature porte `niveau`. Toute
//      tuile en cache (jusqu'à une semaine au CDN) est donc périmée : sans ce
//      bump, le front filtrerait sur un `niveau` que l'ancienne tuile n'a pas
//      et la couche resterait vide.
export const IRIS_TILE_VERSION = 2;

/**
 * Zoom au-dessous duquel aucune tuile IRIS n'est servie ni demandée.
 *
 * Source unique : la route, la source MapLibre, les trois couches et l'indice
 * affiché dans le panneau lisent cette constante. Quatre copies du chiffre
 * vivaient dans deux fichiers ; il suffisait d'en changer une pour que la
 * couche demande des tuiles que la route refuse, ou l'inverse.
 *
 * ── Pourquoi 4, et pourquoi 9 était un défaut ──────────────────────────────
 *
 * Le plancher a valu 9 pendant une journée, parce que les 49 448 IRIS ne se
 * servent pas à z5 : 1 694 kB de tuile pour des polygones de 0,6 px. Mais la
 * carte démarre à z5,5, et sous le minzoom d'une source MapLibre ne demande
 * AUCUNE tuile ni n'émet d'erreur : activer la couche depuis la vue France ne
 * montrait rien du tout.
 *
 * La réponse n'était pas de baisser le plancher sur les IRIS bruts — une tuile
 * z8 parisienne couvre 4 251 IRIS et la France tient en ~75 tuiles z8, soit
 * l'incident du 28/03 rejoué. C'était de faire ce que font les carreaux :
 * AGRÉGER. `get_iris_tile` sert maintenant des départements sous z7 et des
 * communes à z7-z8 (sql/138-139), et la France entière tient dans une tuile de
 * 100 kB. Le plancher rejoint donc celui des carreaux, z4.
 *
 * Mesures du 2026-09-12, octets bruts avant gzip :
 *   z4 France entière  101 355      z7 Paris (le pire)  783 551
 *   z5 France          115 463      z8 Paris            353 524
 *   z6 Paris            97 432      z9 Paris            827 012
 */
export const IRIS_ZOOM_PLANCHER = 4;

/**
 * Zoom au-dessous duquel la couche « Périmètre PPRT » ne demande rien.
 *
 * Source unique : la couche MapLibre ET la section du panneau lisent cette
 * constante — deux copies d'un chiffre finiraient par se contredire, et
 * l'utilisateur verrait un bandeau « zoomez » sur une couche qui charge, ou
 * l'inverse.
 *
 * **8 et pas moins, et c'est un calcul de lisibilité avant d'être un calcul
 * d'I/O.** Un PPRT fait 0,94 km de large en moyenne (le plus petit : 2 m).
 * À la latitude 45, la résolution vaut ~110 700 / 2^z mètres par pixel : pour
 * qu'une zone de 2 km couvre au moins 4 px, il faut z >= 7,8.
 *
 * Poids mesuré le 2026-09-17 (664 zones en base) :
 *   France entière   4 948 ko brut · 886 ko simplifié · illisible
 *   vue z8 (6°)        802 ko brut · 182 ko simplifié · 126 zones · 46 ms
 *   Étang de Berre      86 ko brut ·  26 ko simplifié ·  15 zones
 */
export const PPRT_ZOOM_PLANCHER = 8;

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
// v18 — 2026-09-11 : le palier 200 m demarre a z9 (sql/128), choix produit.
//       Mêmes coordonnées de tuile, autre maille : tout cache est périmé.
// v19 — 2026-09-11 : palier 1 km branche sur z9-z11 (sql/129). Les memes
//       coordonnees de tuile servent une autre maille : tout cache est perime.
export const CARREAUX_TILE_VERSION = 19;
