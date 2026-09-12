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
// v1 — 2026-09-11 : création. Cascade à deux paliers (geom_z7 sous z12,
//      geom_3857 au-dessus), plancher à z9, `superficie_km2` calculée pour la 3D.
export const IRIS_TILE_VERSION = 1;

/**
 * Zoom au-dessous duquel aucune tuile IRIS n'est servie ni demandée.
 *
 * Source unique : la route, la source MapLibre, les trois couches et l'indice
 * affiché dans le panneau lisent cette constante. Quatre copies du chiffre 9
 * vivaient dans deux fichiers ; il suffisait d'en changer une pour que la
 * couche demande des tuiles que la route refuse, ou l'inverse.
 *
 * Pourquoi 9, et pourquoi il ne peut pas descendre — mesuré le 2026-09-12 :
 *
 *   tuile            IRIS couverts   MVT brut
 *   5/15/11            31 149        1 694 kB   (un IRIS fait 0,6 px)
 *   8/129/88 Paris      4 251            —      (la RPC rend NULL sous z9)
 *   9/259/176 Paris     3 387          788 kB
 *
 * Un palier z8 coûterait 4 251 IRIS sur la tuile parisienne, et la France
 * entière tient en ~75 tuiles z8 : un utilisateur qui dézoome déclencherait
 * exactement l'incident du 28/03 (bbox France entière → I/O épuisé → 504).
 *
 * Conséquence assumée : la carte démarre à z5,5 et la couche n'a rien à y
 * montrer. C'est pourquoi l'activer sous ce plancher amène la caméra au
 * plancher (`setIrisVisible`) et pourquoi le panneau l'annonce — une carte
 * vide sans explication passe pour une panne, et c'est ce qui est arrivé.
 */
export const IRIS_ZOOM_PLANCHER = 9;

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
