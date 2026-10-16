
## 17. Écarts à la livraison (lots 1-2)

- **Bouton « Autres », hors du fil** (T11b, Vincent 14/10) : Panneaux OOH et Radio quittent ② pour un bouton au niveau des étapes mais hors du parcours (ni numéro, ni `Alt+N`, `?etape=autres`) — on ne construit pas de zones avec eux.
- **8 référentiels communs et non 10** (A10 amendé) : IRIS, carreaux, indicateurs CP, transport, TMJA, ICPE et PPRT, santé, météo ; OOH et radio vivent dans `JEUX_AUTRES`.
- **« Plus de données communes (n) »** et non « Autres données communes » : « Autres » ne nomme que le bouton hors fil (arbitrage du chef de projet).
- **Pastille « renseignée » de ④** (T14) : s'allume quand le score composite ou les zones à risque sont sur la carte ; ces dégradés ne renseignent plus ②. Le seuil du fil compact remonte à 640 px (pire cas mesuré 635 px : à remesurer à chaque étape qui s'allume).
- **Transport = arrêts sur la carte** : la pastille « affiché » de la ligne transport s'allume sur les arrêts affichés, les types choisis vivant dans le panneau (« aucun type » = tous). Le bloc « Actifs » compte encore les types choisis : les deux règles divergent, à trancher à la revue UX de la carte.

## 17 bis. Écarts à la livraison (lot 3)

Branche `feat/carte-zones-recette`, de `64b4944d` (fin du lot 2) à `7530beec` (vague de correctifs finale du 16/10) — non poussée, non fusionnée. Aucune migration après sql/256.

- **Isochrones et bataille restent en ④, inchangées** (arbitrage C3) : ③ les CAPTURE (`/api/custom-geo/capture` accepte une recette figée `isochrone`) et y renvoie (« Aller à ④ Analyse ») ; la famille « Autour des POI » ne les lance pas. La recette d'une bataille capturée porte `paliers` en chaîne (« 10,30 ») ; `cache_key` n'est qu'une provenance (le cache peut être purgé, la recette ne se rejoue pas). Une capture MIXTE (bataille + autre couche) s'écrit `{ type: 'capture', source_type: 'composite' }`, une bataille sans POI retombe sur `capture`.
- **Sept RPC neuves** : `resoudre_perimetre`, `creer_zone_recette`, `remplacer_geometrie_zone`, `zone_referencee` (sql/253), `zone_rayon_poi` (254), `zone_seuil_carreaux` (255), `zone_seuil_territoire` (256) ; huit RPC vivantes sans source rapatriées à l'identique (252). Toutes `jsonb` sauf `resoudre_perimetre` (une ligne) et `zone_referencee` (un texte) : résultats d'une ligne, sans risque de troncature (P23).
- **La commune de ① reste un texte libre** résolu par son nom en base (homonymes refusés, Paris/Lyon/Marseille = union des arrondissements ; Marseille = 235,4 km², l'aire exacte des 16 arrondissements) — Q-F ouverte.
- **Le seuil sur carreaux s'arrête au département** (zone-périmètre ≤ 12 000 km²) — Q-G ouverte ; le rayon autour des POI est découpé par le périmètre — Q-H ouverte.
- **Une zone citée ne se supprime ni ne se recalcule** : `zone_referencee` (stratégie, jeu de zones, composite, combinaison, périmètre d'une recette) garde le `DELETE /api/custom-geo/[id]` comme le recalcul ; les codes `zone_referenced_by_strategy` / `zone_member_of_composite` sont retirés. Effet assumé : une zone d'un jeu de zones ou servant de périmètre n'est plus supprimable.
- **Le 409 est reformulé et la combinaison n'est plus recalculable** (`3d63517b`) : « Cette zone est utilisée par un plan, un jeu de zones ou une autre zone : elle ne peut pas être recalculée. » (il disait « dupliquez-la », action qui n'existe pas) ; `combinaison` sort de `TYPES_RECALCULABLES` côté Angular et serveur (409 `forme_figee`) — ses opérandes sont figés, la recalculer ne changeait rien.
- **« Restreindre à » se fait entre deux zones exactement** (P14) : `zone_intersection` calcule A∩(B∪C), pas l'intersection de N zones ; la RPC reste telle quelle (React s'en sert).
- **« Mes zones » affiche la recette** (« Forme figée » pour les zones d'avant le lot), libellés propres pour les `recette_*`, libellé de catalogue + unité pour un seuil sur territoires ; « Recalculer » relit la liste et redessine la zone affichée EN PLACE (`254a955b`).
- **Le catalogue d'indicateurs est lu une fois par page** : `CatalogueIndicateursService` fourni par `CartePage` (`7530beec`), et non plus par chaque panneau (jusqu'à trois `GET /api/cibles/indicators`). Le nom proposé par le pied de recette n'est remplacé à l'arrivée du catalogue que s'il n'a pas été touché.
- **Un 207 est une réussite partout** (`a71fafbc`) : opérations, atelier, capture et « Mes zones » affichent le message de la route au lieu de proposer un nouveau clic (qui doublait la zone) ; une réponse perdue (statut 0, 2xx sans `zone_id`) vide l'atelier et dit « vérifiez Mes zones ».
- **Les créateurs CP / rayon / dessin et les opérations écrivent par `POST /api/zones`** avec leur recette ; `/api/custom-geo/save` n'est plus appelé que par React. `geom_centroid` reste NULL et n'est pas employé (`ST_Centroid(geom_3857)`).
- **Quota** (`f5185336`) : des variables `UPSTASH_*` mortes (`.env.local`, hôte qui ne résout plus) faisaient payer cinq tentatives à chaque appel — 24 s pour un 409 de recalcul — et un délai dépassé rendait `success: true` sans compteur. Client Redis sans nouvelle tentative, `timeout` traité comme un échec qui bascule sur `consommer_quota`, Upstash coupé 5 min après un échec (un seul log). Les deux variables sont en plus vidées dans `.env.development.local` (non suivi).
- **Mesures (local)** : vérifications du 16/10 — 2 339 tests unitaires, 2 369 Angular, intégration 289/301 (« habitants » de zone-risque admis, deux fichiers verts relancés seuls sur base froide), knip ramené à 141. Seuil carreaux sur une zone « IDF » (11 899 km² mesurés par la garde, sous les 12 000) : 2,92 s, **91 127 buffers**.

**Points pour Vincent** (tranchés par le chef de projet, coût si faux entre parenthèses) :

| # | Constat | Tranché au lot 3 |
|---|---|---|
| V-1 | Rayon autour des POI : seuls les POI DU périmètre comptent — un lycée juste hors du département n'apporte pas sa bande intérieure. | Gardé, cohérent avec Q-H « le périmètre borne » et sans élargir les lectures (un `ST_DWithin` + nouvelle mesure I/O). |
| V-2 | Seuil sur carreaux : une part calculée sur un dénominateur imputé minuscule passe le seuil (0,4 ménage → 100 %). La spec n'exclut que les dénominateurs nuls. | Gardé ; question produit : un minimum de ménages / d'individus par carreau (une clause `and den >= N`). |
| V-3 | « Restreindre à » limité à 2 zones (React faisait A∩(B∪C) en le présentant comme une intersection). | Deux zones (enchaîner des intersections deux à deux plus tard). |
| V-4 | Pas de bouton « Dupliquer » : le 409 ne le propose plus, la combinaison n'est pas recalculable. | Hors lot 3 (un « Dupliquer » / « enregistrer comme nouvelle zone » plus tard). |
| V-5 | Bataille V2 non capturable (elle n'a pas de clé de cache) ; la capture V1 n'écrit aucune sous-zone ; capture lente (~31 s mesurés au T11, 15 s le 16/10 à la première, 2-4 s ensuite). Préexistants, ④ inchangée (C3). | Admis (une clé de cache V2 dans un lot ultérieur). |
| V-6 | « Créer la zone » du score composite s'écrit `capture` de source `score` avec sa géométrie : la provenance (indicateurs, poids) est perdue, la zone ne se recalcule pas. | Admis, au propriétaire de ④. |
| V-7 | La garde des 12 000 km² admet une zone-périmètre en forme d'IDF (12 012 km² officiels, 11 899 mesurés) : ≈ 91 000 buffers par appel, ≈ 1,1 M par minute et par compte au quota de 12. | Admis, conforme au chiffre de l'A-7 ; abaisser le plafond si l'IDF doit être refusée. |
| V-8 | Codes région / département comparés tels quels : un « 2a » minuscule rendrait un résultat vide en silence (sql/253 et 256). Les codes viennent de `ref_departements`, en majuscules. | Laissé en dette (`upper(trim())` dans deux fonctions). |
| V-9 | Quota : variables Upstash mortes neutralisées par le disjoncteur (ci-dessus). | Fait (`f5185336`) ; supprimer les variables de `.env.local` relève de Vincent. |

**Preuves navigateur de la vague finale** (16/10, Angular :4200 + Next :3000 du worktree, deux thèmes, captures `L3-preuve-*` dans `.superpowers/sdd/2026-10-14-carte-en-parcours-lot-3/`) : (1) une combinaison (« Fusionner » de deux zones des Bouches-du-Rhône) n'offre pas « Recalculer », et le recalcul d'un membre rend le nouveau 409 ; (2) Analyse → ③ « Par seuil » → « Mes zones » (une zone seuil sur territoires listée) : **un** `GET /api/cibles/indicators` ; (3) catalogue retardé de 25 s : le nom saisi pendant la lecture reste ; (4) KML « 5, 43 » : 1 polygone, 4,5 km² sur le territoire (84 % des 5,41 km² du rectangle) ; (5) capture d'une bataille V1 seule (CIRFA Bretagne, Marine nationale) → `recette.parametres.paliers = "10,30"`, capture bataille + IRIS → `source_type = composite`, recette `capture` (lu en base). Aucun défaut trouvé ; vus en passant, préexistants : le bandeau vert « Zone créée » reste affiché, l'aperçu ne recadre pas la carte. Zones de test supprimées, espace actif rétabli (BMW GROUP).

## 2. Décisions de Vincent (12/10/2026) — non rediscutées ici

| # | Décision |
|---|---|
| V1 | La carte devient un **parcours** sur le modèle du module risque Angular : fil d'étapes horizontal en haut ; le panneau ne montre que l'étape courante ; la carte reste la même du début à la fin. Le rail et ses 5 panneaux disparaissent. |
| V2 | **① Périmètre › ② Données › ③ Analyse › ④ Zones › ⑤ Plan › ⑥ Activation › ⑦ Live.** Entrée par n'importe quelle étape, pastille « renseignée ». Une **boîte à outils** hors du fil (Mes analyses, Mes zones, fond de carte, légende, Aide, Réglages, fiches de détail). |
| V3 | **⑦ = la campagne en live** (le Suivi V2 React). |
| V4 | **Les risques industriels sont de simples POI.** Sites/Rayon/Couverture → une analyse de ③ (couverture par rayon autour de POI) ; l'étape Zones du risque → l'étape ④ GÉNÉRALE. |
| V5 | **Natures de zones** (liste de CP, liste d'IRIS, polygone, point + rayon, ciblage TikTok) : ④ garde la nature, ⑥ envoie à chaque plateforme la nature qu'elle accepte. |
| V6 | ② sépare **Données de l'espace** et **Données communes** ; **sélection recommandée par espace** (réglée dans Accès › fiche espace › Données) ; « Autres données communes » en repli ; un espace sans sélection voit tout. Rien n'est caché, seulement rangé. |
| V7 | **Catalogue des données** : une fiche par jeu (nom, nature, maille, propriétaire, niveau socle/privé/partagé), POI ET indicateurs ; on peut rendre privé un indicateur (abstention → Bercy). |
| V8 | **Droits par espace, jamais par utilisateur.** Super admin = l'espace choisi. « dentsu.explore (interne) » = un espace comme un autre. Ce qui est produit dans un espace y reste. |
| V9 | **Groupes d'espaces = dossiers** (BMW : BMW Auto, BMW Moto, MINI, BMW Réseau ; Armée : Marine nationale, Armée de l'air). Cloisonnement total entre membres d'un groupe ; le groupe ne porte rien et ne se choisit pas sur la carte ; il sert à ranger dans Accès. |
| V10 | **Aucune IA** dans l'app (AIDA est l'IA). |
| V11 | Design system `DESIGN_SYSTEM.md`, interface Angular (racine d'ombre, routes relatives, état dans l'URL). |

Et, de la vision du convertisseur (25/09) : **une zone → un plan PAR
PLATEFORME dans sa maille native**, comparés côte à côte ; toujours au plus
fin ; l'utilisateur choisit quand une plateforme accepte plusieurs mailles ;
registre OUVERT de sources de poids ; le choix des plateformes se fait dans la
campagne, APRÈS la conversion. → **④ EST le convertisseur, ⑥ applique « une
plateforme = sa maille ».**

## 3. L'écran commun

```
┌ barre du parcours ─────────────────────────────────────────────────────────────────┐
│ ● Carte  France › Bretagne    ① Périmètre › ② Données › ③ Analyse › ④ Zones ›     │
│                               ⑤ Plan › ⑥ Activation › ⑦ Live        [outils ▾] ✕ │
├ barre de progression (mg-barre-progression) ───────────────────────────────────────┤
├ bandeau de l'étape (4-6 chiffres, mg-kpi) ─────────────────────────────────────────┤
│ panneau de l'étape (320-900 px, poignée) ║ carte MapLibre permanente   [boîte à    │
│                                          ║                              outils]    │
│                                          ║                     légende unique ↘    │
└──────────────────────────────────────────╨─────────────────────────────────────────┘
```

Repris tel quel du module risque (`features/risques/risque.page.html`) :

- **`mg-fil-etapes`** (`ui/fil-etapes/fil-etapes.component.ts`) : chaque étape
  cliquable dans les deux sens, flèches/Début/Fin, point teal « renseignée »,
  jamais « validée ». Pas un tunnel.
- **`mg-fil-ariane`** (`ui/fil-ariane/`) : « où je regarde » (le périmètre de
  ①), à côté de « où j'en suis » (le fil d'étapes) — deux fils, pas un doublon.
- **Panneau à poignée** (320-900 px, défaut 480), repli « Carte seule » ;
  **le panneau d'une étape reste MONTÉ** quand on en change (`visibility`,
  jamais `@if` sur l'étape qu'on quitte avec un calcul en cours) — patron
  `RisquePage`, commentaire « RIEN NE SE DÉMONTE ENTRE LES ÉTAPES ».
- **Services d'état fournis par la page** (patron A13 du risque, et
  § 4.1 de la spec droits : un changement d'espace recrée la page).
- **`mg-barre-progression` + `ChargementService`** pour tout calcul.
- **Bandeau KPI** (`mg-kpi`) : même emplacement à chaque étape, il change de
  question comme le bandeau du risque change à ⑤ (`bandeau-campagne`).

Nouveau : le **bandeau change par étape** (§ 4), la **boîte à outils** (§ 6),
et un **sélecteur de campagne** dans la barre aux étapes ⑤-⑦ (§ 4.5).

L'espace actif n'est PAS dans le parcours : il se choisit dans la coquille
(badge de session existant, `/api/user/switch-org`). Changer d'espace recrée la
page carte (spec droits § 4.1) et remet le parcours à ①.

## 4. Les sept étapes

Convention : **Entrée → Sortie** = ce que l'étape lit de l'état et ce qu'elle
y dépose. « Repris » = chemin réel vérifié le 2026-10-12. CA =
`angular/src/app/features/carte`, RQ = `angular/src/app/features/risques`.

### ① Périmètre — où je regarde

- **Écran** : France métro / + DROM ; régions et départements (listes
  multiples) ; recherche ville / CP ; « Partir d'une zone enregistrée ». Le
  masque du territoire assombrit le reste de la carte. Bandeau : population,
  IRIS, codes postaux, communes du périmètre.
- **Gestes** : cocher, chercher, choisir une zone enregistrée ; la carte cadre
  le périmètre.
- **Entrée → Sortie** : rien → `perimetre` (codes région/département ou id de
  zone). Il sert de **garde** à tous les calculs de ③ et ④ (déjà le cas :
  `CA/logique/garde-perimetre.ts`).
- **Repris** : panneau Filtre (`CA/panneaux/filtre/*`, `CA/logique/filtre.ts`,
  `CA/etat/sections-filtre.ts`), `POST /api/map/territory-mask`,
  `/api/meteo-geo/zones?scale=`, `/api/custom-geo/list`.
- **Nouveau** : les quatre chiffres du bandeau (lus du référentiel déjà
  chargé, pas de requête de comptage) ; `mg-fil-ariane` alimenté par ①.

### ② Données — ce que je vois

- **Écran** : deux blocs, dans cet ordre.
  1. **Données de l'espace** — POI importés (ex. 177 concessions pour BMW
     GROUP, 101 CIRFA pour Marine nationale), indicateurs privés (ex.
     abstention 2022 pour Bercy), zones, isochrones, campagnes de l'espace.
  2. **Données communes** — s'ouvre sur la **sélection recommandée** de
     l'espace ; le reste dans un repli **« Autres données communes (n) »**.
     Un espace sans sélection voit tout déplié.
  Chaque ligne : nom, nature (POI / carreau / IRIS / indicateur CP / ligne /
  à la demande), maille, interrupteur « afficher », réglages dépliables (là
  où ils existent : indicateur, palette, opacité, relief). Un clic sur le
  nom ouvre la **fiche du catalogue** (§ 7) dans la boîte à outils.
  Bandeau : calques actifs, jeux de l'espace, jeux communs visibles.
- **Gestes** : allumer/éteindre un calque, le régler, chercher un jeu par
  nom.
- **Entrée → Sortie** : `perimetre` → `calques` (liste des jeux affichés et
  leurs réglages).
- **Repris** : panneau Calques entier (`CA/panneaux/calques/*`) — IRIS
  choroplèthe (`/api/iris/bornes`, tuiles), carreaux Filosofi
  (`/api/tiles/{z}/{x}/{y}`, paliers 1/2/5 km), indicateurs civiques
  (`/api/insee-variables/<code>/geojson`), POI (`POST /api/map/pois`,
  `/api/map/categories` avec `origine` espace/commune — livré le 12/10),
  transport, TMJA, panneaux OOH (`POST /api/map/ooh`), radio, météo, santé,
  **sites à risque industriel comme un POI parmi d'autres**
  (`/api/map/risques-industriels`), PPRT (`/api/map/pprt`). Groupes visuels
  `mg-groupe-calques`.
- **Nouveau** : le rangement espace/commun appliqué à TOUS les jeux (pas
  seulement les types de POI) ; la sélection recommandée et son repli ; la
  ligne de jeu uniforme ; « Mes analyses » sort des calques pour la boîte à
  outils.

### ③ Analyse — ce que je calcule

- **Écran** : une liste de cinq analyses (cartes-titres), une seule ouverte à
  la fois ; en bas, « Mes analyses » récentes de l'espace.
  | Analyse | Entrée | Résultat sur la carte | Repris |
  |---|---|---|---|
  | **Couverture par rayon** autour d'un type de POI (NOUVELLE forme de RQ ①-③) | un type de POI de ② (lycées, concessions, sites Seveso…), un profil d'anneaux | anneaux, courbe population/rayon, tableau par territoire | `RQ/etapes/{sites,rayon,couverture}`, `RQ/commandes/{reglette-rayons,panneau-profil,resume-profil}`, `RQ/etapes/rayon/courbe-rayon.component.ts` |
  | Isochrones / bataille V1-V2 | un type de POI, temps | polygones, Voronoï | `CA/panneaux/analyse/outil-isochrones`, `outil-bataille-v2`, `/api/isochrone-battle` (protégé, inchangé) |
  | Clustering | types de POI | grappes, rapport 7 onglets | `CA/panneaux/analyse/clustering/*`, `/api/poi-clusters/*` |
  | Score composite | ≤ 6 indicateurs pondérés | note 0-100 par CP | `outil-score`, `/api/analyses/score` |
  | Corrélation | une campagne, un indicateur | r de Pearson par CP | `outil-correlation`, `/api/analyses/correlation` — voir Q1 |
  Bandeau : selon l'analyse ouverte (ex. couverture : POI, rayon max,
  population couverte, part du périmètre).
- **Gestes** : choisir l'analyse, régler, lancer (barre de progression),
  rejouer une analyse enregistrée, **« Faire une zone de ce résultat » → ④**.
- **Entrée → Sortie** : `perimetre` + `calques` → `analyse` (type + id
  enregistré, `/api/analyses`). Le résultat est un calque ; « Faire une
  zone » le capture (§ ④).
- **Nouveau** : la couverture par rayon **sur n'importe quel type de POI** ;
  la gravité Seveso devient un filtre de nature du type de POI « sites
  industriels », plus une dimension du module (voir Q3).

### ④ Zones — ce que je fabrique, et ce que j'achèterais (le convertisseur)

C'est l'étape RQ ④ rendue générale, telle que décidée le 25/09.

- **Écran**, de haut en bas :
  1. **Source** — d'où vient la zone : capture d'un résultat de ③ ou d'un
     calque de ② (seuil d'indicateur, score, bataille, Voronoï, radio,
     TMJA, carreaux), import d'une liste de CP, liste d'IRIS, dessin
     polygone/rectangle, point + rayon. **La nature est affichée et
     conservée** (§ 8).
  2. **Conversion** — maille d'achat (CP par défaut, IRIS en option
     d'analyse), **seuil de couverture** (curseur, rejoué en ~22 ms sur un
     jeu déjà construit), **Pondéré / Exclusif**, **source de poids**
     (uniforme par défaut, registre ouvert : indicateur, cible carreaux,
     score…). Chiffres : CP touchés, CP retenus, **taux d'utile**, population
     en zone.
  3. **Par plateforme**, côte à côte (une colonne par plateforme) : maille
     native, nombre d'unités, paliers, taux d'utile — ex. DV360 « 1 113 CP
     pondérés, 75,9 % d'utile », TikTok « 14 départements, 3 paliers,
     31 % d'utile ». Quand une plateforme accepte plusieurs mailles (TTD :
     CP ou polygone ; Meta : CP ou point + rayon), un sélecteur.
  4. **Enregistrer le jeu de zones** puis **Extraire** → extraction
     versionnée immuable (v1, v2 « recalage »…), classeur Excel.
  Carte : la double vue de RQ ④ (zone exacte | CP retenus colorés par
  part en zone), bascule. Bandeau : CP retenus, taux d'utile, population en
  zone, part du plan en zone, version.
- **Gestes** : créer depuis une source, combiner (union/intersection/
  différence), régler le seuil, comparer les plateformes, enregistrer,
  extraire.
- **Entrée → Sortie** : `perimetre` + résultat ou calque → `jeu` (id
  `zone_sets`) + `extraction` (id `zone_set_extractions`, version).
- **Repris** : `CA/panneaux/zones/*` (capture, `creer-codes-postaux`,
  `creer-dessin`, `creer-rayon`, `operations-zones`, `mes-zones`),
  `POST /api/custom-geo/save`, `/api/custom-geo/capture`,
  `/api/custom-geo/[id]/export` ; `RQ/etapes/zones/*` et
  `RQ/etat/atelier-jeux.service.ts` ; `/api/zones/jeux` et
  `/api/zones/jeux/[id]/{extractions,cp-geo,grappes,export}` ;
  `lib/zones/{plan,groupes,jeu}.ts` (`plierParCodePostal`, `tauxUtile`,
  groupes de CP indiscernables) ; sql/231 (extractions).
- **Nouveau** :
  - côté base, la **couture minimale** déjà identifiée le 24/09 : une fonction
    générique `cp_couverture_geometrie(geom, cible)` (carreaux dont le
    centroïde est dans la zone, `ST_Subdivide`, CP via `cp_des_points`),
    rendant **`jsonb`** (6 187 CP possibles > 1 000 lignes PostgREST) ;
    `genererPlanCp` prenant « poids d'un carreau » + mode ;
    `zone_set_cp.classe/cluster_id` rendus facultatifs pour une zone sans
    classe de risque ;
  - le **résolveur actuel** `resolve_custom_geo_zone_codes` (`ST_Intersects`,
    « 2 % compte comme 100 % », présent en base seulement) **n'achète plus
    rien** : il reste pour l'affichage historique ;
  - la **colonne `nature`** sur `custom_geo_zones` (cp, iris, polygone,
    point_rayon, tiktok) et la géométrie d'origine conservée ;
  - le tableau **par plateforme** (sorties dans la maille native, paliers
    pour Meta et TikTok, fusion des paliers trop petits sous le seuil TikTok
    de 1 000 personnes, jamais grossir la maille) ;
  - **capacités des plateformes en base** (table `plateformes_geo`), pas en dur.
  - ⚠ refactor du risque **sans changer un chiffre** : tests de
    caractérisation d'abord (« Seveso France » : 1 102 CP retenus, 73,1 %
    d'utile ; simulation 62 → 89).

### ⑤ Plan — ce que je compte acheter

Le wizard React Cible › Canaux › Pression › Stratégie › Lancement, replié en
UNE étape à sections (il n'y a pas de fil dans le fil).

- **Écran** : en tête, le **sélecteur de campagne** (créer / choisir — le
  « hall » React) ; puis quatre sections à bandeau (`mg-entete-section`) :
  1. **Cible** = une **extraction** de ④ (jeu + version), ou « national »,
     ou un indicateur INSEE à seuil (comportement React conservé). Une
     campagne n'a **qu'un** plan (`refresh_campaign_rollups` ne lit qu'une
     stratégie).
  2. **Plateformes et budget** — cocher DV360, The Trade Desk, Meta,
     TikTok, ad server ; budget et période par canal ; chaque plateforme
     reprend sa ligne du tableau de ④ (maille, taux d'utile). C'est ICI que
     se fait le choix des plateformes (décision 25/09).
  3. **Pression** — ×1 à ×3, CPM min/max, stricte ou nationale surpondérée ;
     toujours chiffrée (×M + CPM €).
  4. **Stratégie** — objectif, KPI, capping, rythme.
  Pied : prévision d'impressions, bouton **Préparer l'activation → ⑥**.
  Optionnel : « Simuler une diffusion » (RQ ⑤ généralisé).
  Bandeau : budget, impressions prévues, CPM moyen, plateformes, CP au plan.
- **Entrée → Sortie** : `extraction` → `campagne` (id `dsp_campaigns`) +
  stratégie (`/api/bidding/strategies`, brouillon auto
  `/api/bidding/strategies/drafts`).
- **Repris** : `components/campaign/wizard/steps/{StepCible,StepCanaux,
  StepPression,StepStrategie,StepLancement,SourcePlan,PressureControl,
  ForecastStrip}.tsx` (React, à **porter**, skill
  `porting-react-to-angular`) ; `/api/zones/jeux/[id]/rattacher` ;
  `CA/panneaux/zones/plan-media.component.ts` (plan média des zones) ;
  `RQ/etapes/campagne/*` + `/api/zones/jeux/[id]/simulation` pour la
  simulation.
- **Nouveau** : le portage Angular ; le wizard en sections ; le plan média
  des zones fusionné dans la section Plateformes (plus de bouton flottant).

### ⑥ Activation — ce que j'envoie, plateforme par plateforme

- **Écran** : une carte par plateforme cochée en ⑤. Chacune dit : **la
  nature envoyée** (ex. TTD « 3 polygones exacts » ; DV360 « 1 113 CP
  pondérés — conversion de la zone dessinée »), le mode (**API** ou
  **fichier**), le pré-vol (contrôles), le bouton **Pousser** (DV360) ou
  **Télécharger** (fichier), l'historique, l'annulation. En bas : publier la
  campagne.
  Bandeau : plateformes prêtes, poussées, en erreur ; dernière poussée.
- **Gestes** : lancer le pré-vol, pousser (journal NDJSON en direct, barre
  de progression), télécharger, annuler une poussée, publier.
- **Entrée → Sortie** : `campagne` + `extraction` → envois (historique
  d'activation) ; statut de la campagne.
- **Repris** : `components/campaign/ActivationPanel.tsx` (à porter) ;
  `/api/campaigns/[id]/activation/{prevol,pousser,historique,rollback}` ;
  `lib/dsp/push/dv360.ts`, `lib/digital/dv360-geo.ts` ; exports
  `csv_cp`, `csv_iris`, `geojson`, `dv360_cp`, `dv360_sdf`,
  `bidding_script`, `tiktok_geo` (`/api/custom-geo/[id]/export`) ;
  `/api/zones/jeux/[id]/export`.
- **Nouveau** : la règle « une plateforme = sa maille » appliquée à l'envoi
  (choix automatique de la nature acceptée, conversion annoncée) ; exports
  **TTD polygone/cercle (GeoJSON) et liste d'enchères CP**, **Meta en
  paliers** (un ensemble par palier), **TikTok en paliers** (département ou
  commune) — aujourd'hui seuls DV360 et `tiktok_geo` existent.

### ⑦ Live — la campagne en vol

- **Écran** : le Suivi V2, porté. Barre de contexte et maille France ›
  région › département › CP ; **score d'alignement géographique** ; pacing
  temps / budget / volume ; écart plan vs réel ; trois vignettes carte
  (Impressions, Variable du plan, Alignement — échelles séquentielle et
  divergente du design system) ; part conforme / sous / sur-pression en € ;
  **« Ce qu'il faut corriger »** (≤ 3 constats) ; coût et rythme (CPM réel vs
  prévu) ; territoires déréglés ; « Qui a diffusé » (partenaire × canal) ;
  pression par classe ; réconciliation DSP ⇔ mesure. La grande carte
  montre l'alignement (divergente) au CP. Bandeau : alignement, pacing,
  dépensé, impressions, CPM réel, jours restants.
- **Gestes** : changer de maille, descendre dans un territoire, filtrer par
  acteur, ouvrir un constat (il centre la carte), **« Recaler »** → retour à
  ④ avec la version suivante de l'extraction.
- **Entrée → Sortie** : `campagne` → rien (lecture) ; « Recaler » crée une
  extraction v+1 (origine `recalage`).
- **Repris** : `components/campagne/suivi-v2/*` (`SuiviV2.tsx`,
  `ScoreAlignement`, `ConstatsCorrection`, `CoutEtRythme`, `TrioCartes`,
  `QuiADiffuse`, `PressionParClasse`, `TableauDeregles`…) à porter ;
  `/api/campaigns/[id]/alignement` (+ `/constats`, `/dispersion`,
  `/maille`, `/maille/map`), `/api/campaigns/[id]/pression-classes`,
  `/api/digital/[id]/{suivi,actors,reconcile}` ; rollups
  `campaign_cp_rollup` (déjà calculés, aucun calcul lourd en lecture).
- **Retiré au portage** : `ai-analysis`, `campaign-chat` (V10).

## 5. L'état dans l'URL

Même patron que `RQ/logique/etat-url.ts` (`?risque=`) : un état sérialisé,
relu au chargement, réécrit à chaque geste (`replaceUrl`), sans recréer la
page. Paramètres lisibles et indépendants, pour qu'un lien partagé rouvre la
même étape sur le même objet :

| Paramètre | Contenu | Écrit par |
|---|---|---|
| `etape` | `perimetre` · `donnees` · `analyse` · `zones` · `plan` · `activation` · `live` | le fil |
| `perimetre` | `metro`, `metro+drom`, `r:53`, `d:29,d:56`, `z:<id zone>` | ① |
| `calques` | liste courte des jeux affichés + réglage clé (ex. `iris:men_pauv,poi:lycee`) | ② |
| `analyse` | `<type>:<id>` d'une analyse enregistrée | ③ |
| `jeu`, `x` | id du jeu de zones, id/version de l'extraction | ④ |
| `campagne` | id de campagne | ⑤ ⑥ ⑦ |
| `vue` | centre, zoom, fond (existant) | carte |

Ne vont **pas** dans l'URL (comme le risque) : largeur du panneau, repli,
aperçus de glissement, sections dépliées. La « pastille renseignée » d'une
étape se déduit de l'URL (paramètre présent), sans état caché.
`?customZone=` (`CA/etat/lien-zone.service.ts`) et les anciens `?risque=`
**redirigent** vers `etape=zones&jeu=…` / `etape=analyse&analyse=couverture:…`.

## 6. La boîte à outils

Un groupe de boutons-icônes en haut à droite de la carte, hors du fil, qui
ouvrent un **tiroir** à droite (dans le flux, jamais `position: fixed` —
racine d'ombre). Un seul tiroir ouvert à la fois ; Échap le ferme (pile
`CA/etat/pile-echap.service.ts`).

| Outil | Contenu | Repris |
|---|---|---|
| Mes analyses | analyses de l'espace, rejouer, supprimer → ouvre ③ | `/api/analyses`, section Calques actuelle |
| Mes zones | zones et jeux de l'espace, afficher, exporter → ouvre ④ | `CA/panneaux/zones/mes-zones.component.ts`, `jeux-de-zones.component.ts` |
| Fond de carte | dentsu / clair / satellite, relief | `CA/etat/fond-carte.ts`, `CA/commun/fond-compact.component.ts` |
| Légende | la légende unique, toujours celle des calques actifs | `CA/legende/*` |
| Fiche | fiche du point/IRIS cliqué, fiche catalogue d'un jeu (§ 7) | `CA/couches/detail-iris.component.ts`, popups |
| Aide | aide contextuelle **de l'étape courante** | `CA/panneaux/aide.component.ts` |
| Réglages | préférences de carte, lien vers Accès (super_admin) | `CA/panneaux/reglages.component.ts` |

Retirés : les boutons flottants « Plan média » et « Script bidding DV360 »
(`CA/commun/boutons-flottants.component.ts`) → leurs fonctions vivent en ⑤
et ⑥. « Tout effacer » reste, dans la barre du parcours.

## 7. Catalogue, sélection recommandée, groupes d'espaces

### 7.1 Le catalogue — une fiche par jeu

Aujourd'hui, seuls les jeux importés ont un niveau de droit
(`data_sources.visibilite` socle/privée + `shared_with`, sql/234). Les
indicateurs (`cible_indicator_registry`, 19 lignes ;
`iris_indicator_registry` ; `indicator_cp_values`) et les référentiels
(carreaux, transport, ICPE, radio, TMJA, PPRT, santé, météo) n'en ont pas :
on ne peut donc pas rendre l'abstention privée à Bercy.

**Nouveau** : table `catalogue_jeux` — une ligne par jeu affichable :

| Colonne | Exemple |
|---|---|
| `cle` | `poi:concessions-bmw`, `indicateur:abstention_2022`, `carreaux:filosofi_200m` |
| `nom` | « Taux d'abstention 2022 » |
| `nature` | poi · polygone · carreau · indicateur_iris · indicateur_cp · ligne · a_la_demande |
| `maille` | point · IRIS · carreau 200 m · CP · commune · département |
| `organization_id` | propriétaire (Bercy) |
| `visibilite` | socle · privee (le « partagé » = `shared_with`, comme sql/234) |
| `source_id` | `data_sources.id` quand le jeu en a un — **un seul endroit de vérité** : pour ces jeux, la visibilité reste celle de `data_sources`, le catalogue la lit |
| `mise_a_jour`, `origine` | millésime, fournisseur (INSEE, Géorisques…) |

Règle de lecture : **une seule fonction** décide si l'espace actif voit un jeu
(extension de `sourcesVisiblesDeLaRequete`, `lib/auth/perimetre-donnees.ts`),
et toute route qui sert un indicateur (`/api/insee-variables/<code>/geojson`,
`/api/analyses/score`, `/api/cibles/indicators`) passe par elle. Écran :
fiche dans la boîte à outils (lecture) ; édition dans **Accès** (page Données
de l'admin pour le catalogue entier ; fiche Socle pour socle ↔ privé).
Effectifs : `data_sources.valid_count` ou une colonne figée — jamais de
`COUNT` sur `poi_france`.

### 7.2 La sélection recommandée

**Nouveau** : table `espace_jeux_recommandes (organization_id, cle_jeu)`.
Dans **Accès › fiche espace › onglet Données**
(`angular/src/app/features/admin/espaces/onglet-donnees.component.ts`), une
colonne « Recommandé » (case à cocher) sur les jeux **communs**. À ②, le bloc
« Données communes » montre ces jeux, puis le repli « Autres données
communes ». Aucune sélection = tout déplié. Une recommandation ne donne ni ne
retire aucun droit : elle range.

### 7.3 Les groupes d'espaces

**Nouveau** : table `groupes_espaces (id, nom)` et
`organizations.groupe_id` (facultatif). Dans Accès, la colonne des espaces
(`espaces.page.ts`) les range en dossiers repliables (« BMW » : BMW Auto, BMW
Moto, MINI, BMW Réseau). Le groupe **ne porte rien** : pas de données, pas de
membres, pas de campagnes, aucune règle de droit ne le lit (un test le
verrouille : `grep groupe_id` hors admin = 0). Le sélecteur d'espace de la
coquille peut l'afficher en en-tête de liste, il n'est jamais sélectionnable.

## 8. Natures de zones × plateformes

④ garde la nature ; ⑥ envoie à chaque plateforme celle qu'elle accepte, au
plus fin, et **dit** quand il convertit. Source : doc « Ciblage géographique
des plateformes en France » (25/09,
https://claude.ai/code/artifact/74c6a01c-7782-4372-a9d5-5aadff414c9b).

| Nature de zone | DV360 | The Trade Desk | Meta | TikTok |
|---|---|---|---|---|
| Liste de CP | **natif**, poids par CP (script custom bidding), API branchée | natif **probable** (segments CP FR non confirmés), facteur par ligne | natif, ≤ 50 000 CP, **sans poids** → paliers | **non** → département (ou commune) en paliers |
| Liste d'IRIS | → CP | → **polygones IRIS** (exact) ou CP | → CP en paliers | → département en paliers |
| Polygone | → CP | **natif** (GeoJSON, facteur par groupe de formes) | → CP en paliers | → département en paliers |
| Point + rayon | → CP (rayon de proximité DV360 : non branché) | natif (cercles) | **natif** (≤ 200 points, 1-80 km ; ≥ 15 km en catégorie sensible) | **non** (aucun rayon dans l'API) → département |
| Ciblage TikTok (communes / départements en paliers) | — | — | — | **natif**, ≤ 3 000 zones par groupe, ≥ 1 000 personnes par groupe (UE) |
| Mode d'envoi aujourd'hui | API | fichier | fichier | fichier (OAuth prêt) |

⚠ **Colonne par colonne, À VÉRIFIER dans de vrais comptes** avant d'en faire
une règle (table `plateformes_geo` en base, modifiable sans livraison) :
segments CP FR et borne du facteur chez TTD ; format de clé `FR:75001` chez
Meta ; communes et arrondissements Paris/Lyon/Marseille chez TikTok ; rayon
de proximité DV360. Contraintes réglementaires à porter dans le pré-vol de
⑥ : publicité politique interdite chez Meta et TikTok dans l'UE ;
catégories sensibles Meta sans CP ; facteurs TTD multiplicatifs entre
niveaux (ne pas empiler pays × région × CP).

## 9. Ce qui est retiré

| Retiré | Remplacé par |
|---|---|
| Rail des thèmes et ses 5 panneaux (`CA/rail/*`, `CA/logique/navigation.ts`) | le fil ① → ⑦ |
| Le module risque comme écran à part (route `carte/risques`, `RisquePage`) | ③ couverture par rayon + ④ général ; la route redirige |
| Section « Zones à risque » des calques et son lien vers le module | les sites ICPE sont un POI de ② |
| Boutons flottants Plan média / Script bidding | ⑤ / ⑥ |
| Overlay campagne React (Stratégie, Activation, Suivi, Aperçu) | ⑤ ⑥ ⑦ en Angular ; React gelé puis retiré (Q5) |
| Entrée Assistant, `ai-analysis`, `campaign-chat` | rien (V10) |
| Achat par `ST_Intersects` (`resolve_custom_geo_zone_codes`) | le convertisseur de ④ |

## 10. Hors champ

- Poussée par API vers TTD, Meta, TikTok (fichiers d'abord ; plomberie
  DV360 seule branchée).
- Zones **dynamiques** re-versionnées automatiquement (météo, pollen) : le
  modèle le permet (nouvelle extraction par cycle), pas ce chantier.
- Droits par utilisateur ou par module ; partage d'un objet produit entre
  espaces.
- Écran mobile (< 768 px) au-delà de « le panneau passe sous la carte ».
- Refonte des analyses elles-mêmes (clustering, bataille) : déplacées, pas
  réécrites.
- La 3D, les fonds de carte nouveaux.

## 11. Risques

**I/O (CLAUDE.md § Disk I/O)**
- Changer d'étape **ne relit rien** : services fournis par la page, panneaux
  montés (mesure attendue : zéro appel sur cinq bascules, comme le risque).
- ② : catalogue et sélection = petites tables ; aucun calque n'est chargé
  parce qu'il est « recommandé » — **la recommandation ne précharge pas**.
  Un calque à la fois, à la demande, bbox = viewport, cache `useRef`/signal
  vérifié avant fetch, ≤ 3 appels simultanés.
- ④ : `cp_couverture_geometrie` sur les carreaux 200 m (2,3 M lignes) —
  `EXPLAIN ANALYZE` obligatoire, index GIST, `ST_Subdivide`, garde du
  périmètre de ①, et la construction **sous 60 s** (Kong) ; au-delà,
  brouillon + Inngest. Le seuil se rejoue sans reconstruire (22 ms).
- **Troncature PostgREST à 1 000 lignes** : listes de CP (6 187), d'IRIS
  (49 448), d'extractions → **jumelles `jsonb`** ou `lireTout`, jamais une
  RPC tabulaire ; compléter `tests/unit/db/troncature-postgrest.test.ts`.
- ⑦ : lit des rollups déjà calculés ; ne pas déclencher
  `refresh_campaign_rollups` à l'ouverture.
- Quotas : `lib/api/rate-limit.ts` sur les nouvelles routes de conversion.

**Produit**
- Le parcours peut se lire comme un tunnel : le fil ne bloque jamais, chaque
  panneau dit en une ligne ce qu'il attend (« Aucune zone : partez d'une
  analyse ou dessinez-en une »).
- Refactor du moteur de ④ : tests de caractérisation AVANT (chiffres de
  Seveso France figés).
- Le portage du wizard et du Suivi V2 (React, ~30 composants) est le plus
  gros du chantier : skill `porting-react-to-angular`, preuve navigateur
  dans les deux thèmes, parité verrouillée.
- `app/api/isochrone-battle/route.ts` et `middleware.ts` (protégés) : non
  touchés par ce chantier.

## 12. Découpage en lots — de la valeur tôt

| Lot | Contenu | Valeur livrée | Dépend de |
|---|---|---|---|
| **1. Squelette du parcours** | fil ① → ⑦ sur `CartePage`, panneaux existants rebranchés (Filtre → ①, Calques → ②, Analyse → ③, Zones → ④), boîte à outils, état URL `etape`, rail retiré ; ⑤-⑦ affichent « bientôt » + lien vers la campagne React | la nouvelle navigation, sans aucune perte | — |
| **2. Données rangées** | ② en deux blocs pour tous les jeux, ligne uniforme, sélection recommandée (table + case dans Accès › Données) | chaque client voit d'abord SES données | spec droits (feat/droits-carte) |
| **3. ⑦ Live** | portage du Suivi V2 en Angular, sélecteur de campagne | la démo « pilotage » sans React ; lecture seule, rollups existants, risque I/O faible | 1 |
| **4. Couverture par rayon** | RQ ①-③ généralisé à tout type de POI dans ③ ; ICPE = POI ; redirection `carte/risques` | le module risque disparaît sans perte, l'analyse sert BMW (concessions) ou la Marine (CIRFA) | 1 |
| **5. ④ Convertisseur général** | `cp_couverture_geometrie` jsonb, nature des zones, jeux de zones pour toute zone, tableau par plateforme, extractions ; caractérisation du risque d'abord | le cœur produit : toute zone → plan d'achat honnête | 4 |
| **6. ⑤ Plan** | portage du wizard en sections, cible = extraction, plateformes + budget, pression, stratégie, simulation | créer une campagne dans le parcours | 5 |
| **7. ⑥ Activation** | portage ActivationPanel, une carte par plateforme, exports TTD/Meta/TikTok en maille native, pré-vol réglementaire | la boucle complète ① → ⑦ en Angular | 6 |
| **8. Catalogue et groupes** | `catalogue_jeux`, droits sur les indicateurs (abstention → Bercy), fiche catalogue, groupes d'espaces dans Accès | données privées au-delà des POI ; administration rangée | 2 |

Le lot 8 peut passer avant le 3 si l'abstention Bercy est attendue pour une
démo : il ne dépend que du lot 2. Chaque lot se termine par la mise à jour
d'`ARCHITECTURE.md` (routes, tables, RPC) dans le même commit.

## 13. Questions ouvertes pour Vincent

| # | Question | Recommandation |
|---|---|---|
| Q1 | La **corrélation** (impressions × indicateur) reste-t-elle en ③, ou va-t-elle en ⑦, puisqu'elle lit une campagne diffusée ? | **⑦**, comme bloc « Ce qui explique la diffusion » ; ③ ne garde que des analyses qui précèdent l'achat. |
| Q2 | La **campagne courante** : sélecteur dans la barre aux étapes ⑤-⑦ (une campagne à la fois dans l'URL), ou un hall plein panneau à chaque entrée en ⑤ ? | **Sélecteur dans la barre**, hall seulement quand l'espace n'a aucune campagne ; ⑦ s'ouvre sur la dernière campagne en vol. |
| Q3 | La couverture par rayon généralisée garde-t-elle le **profil d'anneaux par niveau** (Seveso haut/bas) ? | **Oui, mais par valeur d'un champ du type de POI** (gravité pour l'ICPE, aucune pour les lycées → un seul niveau) : on garde la puissance, on perd le cas particulier. |
| Q4 | Une campagne = **un seul plan** aujourd'hui. Faut-il plusieurs extractions par campagne (une par zone, ex. Marseille + Lille) ? | **Non en v1** : un jeu de zones peut déjà contenir plusieurs zones ; plusieurs plans exigeraient de réécrire `refresh_campaign_rollups`. |
| Q5 | Quand **retirer la campagne React** (`MagelianOverlay`) et `/map` React ? | **Geler dès le lot 3, retirer après le lot 7**, une fois la boucle ① → ⑦ prouvée en navigateur sur BMW GROUP et Marine nationale. |

## 14. Décisions (2026-10-13)

Vincent, à la lecture de la maquette (https://claude.ai/artifact/TXJjsdhCEnzrDZwVsCThK1) :
« ah oui il faut sélectionner une campagne, je te laisse faire ». Les cinq
recommandations du § 13 sont donc retenues telles quelles : corrélation en ⑦ ;
sélecteur de campagne dans la barre aux étapes ⑤-⑦ (création seulement si
l'espace n'en a aucune) ; anneaux par valeur d'un champ du type de POI ; un
plan par campagne en v1 ; React gelé au lot 3, retiré après le lot 7. La spec
est validée ; les arbitrages de détail sont délégués au chef de projet.

## 15. Décisions (2026-10-13, après-midi) — le fil suit le module risque

Vincent, après avoir manipulé le lot 1 sur :4202 : « le fil d'Ariane devait
suivre la logique des zones à risque […] on doit définir un type de zones, soit
des rayons, des isochrones, etc […] l'onglet couverture doit être intégré dans
analyses […] garder la logique de ce qu'on a fait pour les zones Seveso à
partir de couverture ». Proposition retenue (8 étapes) :

| # | Étape | Contenu | Équivalent risque |
|---|---|---|---|
| ① | Périmètre | inchangé | — |
| ② | Données | inchangé ; les POI y jouent le rôle des « sites » | Sites |
| ③ | Zones | on choisit un **type de zone** : rayons autour d'un type de POI, isochrones, dessin, codes postaux, seuil d'indicateur | Rayon |
| ④ | Analyse | sur ces zones : **couverture par territoire**, clustering, score | Couverture |
| ⑤ | Jeu de zones | la logique Seveso telle quelle : seuil de couverture, CP retenus, taux d'utile, extraction (le convertisseur du § 4 ④) | Zones |
| ⑥ | Plan | ex-⑤ | Campagne |
| ⑦ | Activation | ex-⑥ | — |
| ⑧ | Live | ex-⑦ | — |

Ce qui change par rapport aux §§ 4 et 12 :

- **Ordre** : Zones passe AVANT Analyse ; l'analyse porte sur des zones déjà
  définies, comme la couverture porte sur un rayon dans le module risque.
- **Couverture par rayon** (lot 4) se découpe en deux : le rayon devient un
  *type de zone* de ③ (avec les isochrones, qui quittent ③ Analyse), la
  couverture par territoire devient une analyse de ④.
- **Convertisseur** (lot 5) devient l'étape ⑤ Jeu de zones à part entière, au
  lieu du bas de l'étape Zones.
- Le lot 1 est réordonné tout de suite (8 étapes, ⑤ « bientôt » jusqu'au
  lot 5, Alt+1…8) ; le déplacement des outils entre ③ et ④ se fait aux lots 4-5.

## 16. Décisions du 14/10 — un seul objet zone, la maille choisie plateforme par plateforme

Vincent, le 14/10 au matin, en corrigeant le tableau du parcours : « Analyse on
travaille pas que sur des CP ou IRIS attention !! ça peut être des polygones…
idem pour Jeu de zones, The Trade Desk le DSP peut travailler sur des zones bien
définies comme des polygones » ; puis : « tu peux lancer la modification du fil
d'Ariane, tout ce que l'on a validé ensemble ». **Ce paragraphe fait foi et
prime sur les §§ 2, 4, 8, 9, 10, 12 et 15** là où ils divergent.

### 16.1 Le fil validé (8 étapes, inchangé en nombre depuis le § 15)

| # | Étape | Ce qu'elle fait | Ce qui existe le 14/10 |
|---|---|---|---|
| ① | Périmètre | l'emprise qui **borne tous les calculs lourds** | panneau Filtre, `garde-perimetre.ts` |
| ② | Données | POI, carreaux Filosofi 200 m, IRIS, CP, variables INSEE, flux routier (TMJA), transport, civique, santé (pollen/air), météo (pluie, température, prévisions) ; sélection recommandée par espace | lot 2 (en livraison) |
| — | **Autres** (hors fil) | bouton de la barre du parcours, au même niveau que les étapes mais séparé, **non numéroté, sans Alt+N** : Panneaux OOH et Radio — on ne construit pas de zone avec | Task 11b du lot 2 |
| ③ | Zones | **toute sélection devient une forme** (polygone), un SEUL objet « zone » quelle que soit sa recette, nommé, enregistré, qui **garde sa recette** pour être recalculé | rayon autour d'UN point, dessin (Polygon ≤ 5 000 sommets), liste de CP, capture, union/intersection/différence |
| ④ | Analyse | plusieurs analyses au choix sur les zones : couverture (population et cible, sur le polygone **tel quel** ou découpé par CP ou IRIS), clustering des POI, score composite, Voronoï, isochrones comparées, croisements radio/trafic/météo. **Rien de l'existant n'est retiré.** | outils du panneau Analyse ; couverture = module risque seul |
| ⑤ | Jeu de zones | on fige ce qui sera acheté ; **l'utilisateur choisit la maille plateforme par plateforme** (rien n'est forcé au plus fin) ; l'écran montre pour chaque plateforme ce qu'elle accepte, un **lien vers sa doc officielle**, et **ce que la maille choisie fait perdre** (diffusion hors zone, habitants manqués) | jeux de zones Seveso au CP |
| ⑥ | Plan | le jeu de zones devient le plan média (budget, pression, CPM) | au CP seulement (React) |
| ⑦ | Activation | export ou push dans le format natif de chaque plateforme, avec la connexion API de l'**espace actif** | DV360 CP/SDF/script + push ; TikTok fichier |
| ⑧ | Live | suivi de campagne **dans la même unité que le plan** ; zones météo recalculées | au CP seulement (React) — la partie la plus lourde |

### 16.2 Les cinq règles transverses

1. **Un seul objet zone.** `custom_geo_zones` porte toutes les zones, quelle
   que soit leur recette ; il n'y a plus de « nature » de zone à choisir à ③
   (V5 et le § 8 sont amendés : la nature devient une propriété de la RECETTE,
   lue par ⑤).
2. **La forme exacte est la vérité.** Elle n'est traduite qu'à ⑤, maille par
   maille, avec la perte chiffrée. ③ et ④ ne convertissent jamais en CP de leur
   propre chef.
3. **Les règles des plateformes vivent dans une table** (capacités, limites,
   lien vers la doc officielle, date du relevé, statut « à vérifier »), jamais
   en dur. Relevé du 14/10 (mémoire `reference_dsp_maille_geo`) : TTD polygone
   (via partenaire, à confirmer) / points GPS + rayon / CP ; DV360 CP (seuil de
   couverture, taux d'utile, logique Seveso) ou cercles ≥ 1 km et ≥ 1 000
   habitants ; Meta ≤ 200 cercles de 1 à 80 km, CP France à vérifier ; TikTok
   communes/départements, pas de CP en France, point + rayon à vérifier.
4. **Une connexion API par espace.** `dsp_connections` est déjà unique par
   `(organization_id, provider)` ; deux espaces qui partagent les mêmes
   identifiants (Marine, Armée de terre) ont deux lignes. L'écran Connexions API
   (admin, lot 6 Angular) gagne « Dupliquer vers un autre espace ».
5. **① borne tout calcul lourd.** Une recette coûteuse (seuil sur carreaux,
   rayon autour de tous les POI d'un type) refuse le périmètre « France
   entière » et porte un plafond écrit ; la recette enregistre le périmètre
   pour qu'un recalcul donne la même forme.

### 16.3 Les recettes de zone (③)

| Famille | Recette | Recalculable |
|---|---|---|
| Autour des POI | rayon autour d'un point ; rayon autour de **tous les POI d'un type** (dans le périmètre) ; isochrones / bataille | oui ; oui ; **forme figée** au lot 3 (ORS externe, quota) |
| Par seuil | carreaux Filosofi (ex. part de ménages pauvres > 40 % → union des carreaux retenus) ; IRIS ou CP au-dessus d'un seuil d'indicateur ; zone pluvieuse (météo) | oui ; oui ; lot météo (§ 16.5, lot 10) |
| À la main | dessin ; **import de polygone GeoJSON / KML** ; liste de CP | forme figée ; forme figée ; oui |
| Combinaisons | union, intersection, différence de zones enregistrées | oui (sur la forme actuelle des opérandes) |
| Capture (existant) | ce qui est affiché (Voronoï, radio, TMJA, score…) | forme figée |

### 16.4 Ce que ce paragraphe remplace, section par section

- **§ 2, V5 (natures de zones)** : la nature n'est plus choisie à ③ ni
  « gardée » comme attribut de zone ; elle se déduit de la recette (une zone
  « liste de CP » est exacte au CP, une zone « rayon » est exacte en cercle).
  La colonne `nature` sur `custom_geo_zones` (§ 4 ④) est abandonnée au profit de
  `recette`.
- **§ 2, vision du 25/09 « toujours au plus fin »** : remplacé par « l'utilisateur
  choisit la maille par plateforme, la perte est affichée ». Le côte à côte par
  plateforme reste.
- **§ 4 ④ Zones (le convertisseur)** : scindé. La **source** devient l'étape ③
  (recettes, § 16.3) ; la **conversion et le tableau par plateforme** deviennent
  l'étape ⑤ Jeu de zones ; la maille d'achat « CP par défaut » disparaît au
  profit du choix par plateforme. `cp_couverture_geometrie` devient une
  couverture **générique** (polygone tel quel, CP ou IRIS) servie à ④.
- **§ 4 ③ Analyse** : la couverture n'est plus « par rayon » seulement ; elle
  porte sur n'importe quelle zone, avec trois découpages (tel quel / CP / IRIS).
  Isochrones et bataille **restent en ④** (leur comparaison est une analyse,
  rien n'est retiré) ; ③ en fait une **recette** en capturant leur résultat
  (forme figée `isochrone`).
- **§ 4 ⑥ Activation, § 8 (tableau natures × plateformes)** : le tableau devient
  la table de référence des plateformes (règle 3). Le mode d'envoi passe par la
  connexion de l'espace actif (règle 4). Les colonnes « à vérifier » restent à
  vérifier (§ 16.7).
- **§ 9 (retiré)** : inchangé, plus une ligne — « la nature de zone choisie à la
  création » est retirée, remplacée par la recette.
- **§ 10 (hors champ)** : la poussée API vers TTD, Meta, TikTok reste hors
  champ ; les **exports fichier** TTD / Meta / DV360 cercles / TikTok communes
  entrent dans le champ (lot 6 ci-dessous). Les zones météo dynamiques : voir
  Q-D, § 16.7.
- **§ 12 (découpage en lots)** : les lots 3 à 8 sont **remplacés** par les lots
  3 à 11 du § 16.5. Le lot 8 (catalogue et groupes) devient le lot 11, inchangé.
- **§ 15** : l'ordre des étapes est confirmé ; « le rayon devient un type de
  zone » est élargi à toutes les recettes du § 16.3 ; « le convertisseur devient
  ⑤ » est confirmé, avec le choix de maille par plateforme.

### 16.5 Le découpage en lots (remplace § 12, lots 3 à 8)

| Lot | Contenu | Valeur | Dépend de |
|---|---|---|---|
| **3. ③ Zones à recette** | rapatriement des RPC vivantes sans source, colonne `recette`, rayon autour des POI d'un type, seuil sur carreaux, seuil IRIS/CP borné, import GeoJSON/KML, exécuteur de recettes et recalcul, panneau ③ par familles, capture des isochrones et de la bataille en recette (elles restent en ④) | toute sélection devient une zone nommée et rejouable | lots 1-2 |
| **4. ④ Couverture générique** | `couverture_geometrie` jsonb (carreaux par centroïde, `ST_Subdivide`, CP par `cp_des_points`, IRIS), trois découpages, analyses existantes branchées sur « la zone choisie », couverture par rayon du risque généralisée (anneaux par champ, Q3) | chiffrer n'importe quelle zone sans la convertir | 3 |
| **5. ⑤ Jeu de zones multi-plateformes** | table `plateformes_geo`, caractérisation Seveso PUIS `zone_sets` généralisé, choix de maille par plateforme, perte chiffrée, pavage polygone → N cercles sous contraintes | figer ce qui sera acheté, plateforme par plateforme | 4 |
| **6. Exports natifs** | depuis le jeu de zones, sans campagne : TTD (polygones / points + rayon / CP), Meta (≤ 200 cercles), DV360 cercles, TikTok communes ; pré-vol réglementaire | des fichiers prêts pour les quatre plateformes | 5 |
| **7. ⑥ Plan + ⑦ Activation en Angular** | portage du wizard en sections et d'ActivationPanel, au CP comme aujourd'hui ; connexion de l'espace actif ; dupliquer une connexion | la boucle ① → ⑦ en Angular | 6 |
| **8. ⑧ Live** | portage du Suivi V2 (CP), sélecteur de campagne | le pilotage sans React | 7 (peut démarrer après 1) |
| **9. Plan et suivi au-delà du CP** | unité du plan = unité du jeu (polygone, cercle, commune), rollups et alignement par unité | ⑥ et ⑧ dans la même unité que ⑤ | 7, 8 |
| **10. Zones météo dynamiques** | si Q-D les sort du hors champ : météo stockée, recette « zone pluvieuse » recalculée par cycle, extraction v+1 | zones qui suivent la météo | 3, 5, 9 |
| **11. Catalogue et groupes** | ex-lot 8, inchangé | données privées au-delà des POI | 2 |

Pourquoi cet ordre : chaque lot consomme l'objet du précédent (zone → chiffres
→ jeu → fichiers → campagne). Les **exports passent avant le plan** parce
qu'ils n'ont pas besoin de campagne (`/api/zones/jeux/[id]/export` existe) :
ils donnent de la valeur aux quatre plateformes sans attendre le portage du
wizard, qui est le plus gros chantier. Le **plan et le suivi au-delà du CP**
sont isolés dans le lot 9 parce que ce n'est pas un portage mais une refonte de
`refresh_campaign_rollups` et de l'alignement — un autre risque.

Plan du lot 3 et sommaire des lots 4 à 11 :
`docs/superpowers/plans/2026-10-14-carte-en-parcours-lot-3.md`.

### 16.6 Constats du 14/10 qui pèsent sur le lot 3

- **`carreaux_filosofi.geom_centroid` est NULL sur les 2 324 577 lignes locales**
  (le rechargement depuis le CSV INSEE du 17/09 ne l'a pas rempli). **Rien n'est
  cassé** (corrigé après relecture le 14/10 : la première version de ce
  paragraphe disait le contraire) : `get_filosofi_profile_for_isochrone` et
  `compute_filosofi_profiles_batch` lisent `COALESCE(geom_centroid,
  ST_Centroid(geom))`, `population_exposee_agregee` calcule déjà
  `ST_Centroid(geom_3857)` ; seul l'index GIST du centroïde ne sert à rien.
  `populate_geom_centroid_async` est la fonction qui REMPLIRAIT la colonne, en
  un `UPDATE` de 2,3 M lignes d'un seul passage : **interdit par la règle Disk
  I/O, ne jamais la lancer.** Le lot 3 emploie `ST_Centroid(geom_3857)`. Il n'y
  a rien à décider (l'ancienne question Q-E est retirée).
- **Huit RPC vivantes du chemin des zones n'ont aucune source dans `sql/`**
  (`get_carreaux_by_zoom` a une version ancienne dans
  `supabase/migrations/008_carreaux_multiresolution.sql`, peut-être divergente
  de la version vivante) :
  `get_carreaux_capture_geometry` (48 s par appel, docs/audit/SCALE_MODEL.md:107),
  `get_carreaux_by_zoom`, `get_admin_filter_geometry`, `get_iris_selection_geometry`,
  `resolve_custom_geo_zone_codes`, `resolve_custom_geo_zone_codes_with_subzones`,
  `transform_geometries_for_save`, `compute_zone_audience_stats`. Après
  l'incident Docker du 22/09, le dump est leur seule copie : le lot 3 les
  rapatrie À L'IDENTIQUE avant toute autre tâche (`get_zone_radius_targets`
  n'a qu'un `ALTER` dans sql/099, hors du chemin du lot 3). Le lot 3 n'en modifie aucune ;
  `get_carreaux_capture_geometry` est remplacée pour ③ par une fonction neuve,
  pas réécrite (React la garde).
- Mesures locales (EXPLAIN ANALYZE, 14/10) : seuil « part de ménages pauvres
  > 40 % » sur les Bouches-du-Rhône **1,7 s / 46 000 buffers / 505 carreaux** ;
  Île-de-France 3,0 s / 90 000 buffers ; Auvergne-Rhône-Alpes à 10 % **21,8 s /
  351 000 buffers / 144 088 carreaux** — d'où le plafond de 20 000 carreaux
  (refus en 1,2 s ; 9 839 carreaux unis en 2,6 s, 39 271 sommets, 843 Ko de
  GeoJSON) ; rayon de 5 km autour des 5 584 lycées limité à ARA **0,8 s** ;
  2 km autour des sites ICPE d'ARA plafonnés à 5 000 **2,0 s** ; seuil IRIS
  (taux de pauvreté ≥ 20 %) sur ARA **0,55 s**.
- Mesure de la relecture (14/10) : le plafond de 20 000 borne les carreaux
  RETENUS, pas les carreaux LUS. Un seuil sélectif (ménages pauvres ≥ 99 %, zéro
  retenu) lit **433 000 buffers sur la région 75** (110 000 hors cache, 10,4 s à
  froid) contre **69 000 sur la Gironde** (0,26 s). D'où la borne du seuil sur
  carreaux au **département** (A-4, Q-G) : la garde « ≤ 100 000 km² » ne refuse
  que la France entière (Nouvelle-Aquitaine, la plus grande région, fait
  84 617 km²).
- Le filtre « commune » de ① est un **texte libre** (`code` = le nom tapé, en
  minuscules, `panneau-filtre-logique.ts:59`), et `ref_communes` porte les
  arrondissements de Paris, Lyon et Marseille (`75101`, `13201`…), pas
  `75056`/`13055`. Le lot 3 résout donc la commune PAR SON NOM en base (Q-F).

### 16.7 Questions OUVERTES pour Vincent

| # | Question | Ce qui en dépend | Recommandation |
|---|---|---|---|
| Q-A | **TTD** : polygone natif dans notre compte, ou polygones via Foursquare (surcoût CPM) et, sinon, points + rayon minimal ? | lot 5 (capacités), lot 6 (export) | vérifier dans le compte dentsu avant le lot 5 ; d'ici là la table porte « à vérifier » |
| Q-B | **TikTok** : le ciblage point + rayon existe-t-il en France (absent de la doc officielle, 1 km min. selon des blogs) ? | lot 5, lot 6 | supposer « non » : communes / départements en paliers |
| Q-C | **Meta** : les CP français (`zips`, clé `FR:75001`) sont-ils acceptés ? | lot 5, lot 6 | supposer « non » : cercles (≤ 200, 1-80 km) |
| Q-D | **Zones météo dynamiques** : restent hors champ (§ 10), ou entrent comme lot 10 ? | lot 10 | hors champ tant que ⑧ n'est pas au-delà du CP (lot 9) |
| Q-F | **Commune de ①** : le filtre commune est un texte libre. Le résoudre par son nom en base (le plan le fait : nom normalisé sans accents ; homonymes refusés avec « tapez son code INSEE (ex. 93066) ou choisissez son code postal » ; Paris, Lyon et Marseille = l'union de leurs arrondissements), ou remplacer la saisie par une liste à choix qui porte le code INSEE ? Mesuré le 14/10 : **10,8 % des communes ont un homonyme** (1 483 noms, 3 781 communes — Saint-Denis ×4 dont 93066 et 97411, Montreuil ×3, Valence ×3, Saint-Pierre ×9) : pour elles, la saisie libre n'aboutit qu'en tapant le code INSEE. | lot 3 (recettes lourdes sur une commune) | résolution par nom au lot 3 ; **la liste à choix en finition de ①**, que ce chiffre justifie |
| Q-G | **Seuil sur carreaux** : limité au département (≈ 69 000 buffers par appel au pire, Gironde), ou admis sur une région (≈ 433 000 buffers par appel au pire, région 75, 10 s à froid) ? | lot 3 (A-4) | département ; la région plus tard, par une table pré-agrégée |
| Q-H | **Rayon autour des POI au bord du périmètre** : la zone est coupée net par le périmètre de ① (un lycée au bord du département donne un demi-cercle). L'accepter, ou laisser les cercles déborder du périmètre ? | lot 3 (L3-1) | couper (le périmètre borne le calcul et le recalcul) |

### 16.8 Arbitrages du chef de projet (délégués le 14/10)

| # | Tranché | Coût si faux |
|---|---|---|
| A-1 | La recette vit dans une colonne **`custom_geo_zones.recette jsonb`** (versionnée `v: 1`), pas dans `source_metadata` (libre, hétérogène, lu par React). Une zone d'avant le 14/10 a `recette = null` : « forme figée ». | une migration de données si l'on veut la fusionner plus tard |
| A-2 | **Recalculer** remplace la forme EN PLACE, et refuse (409) si la zone est référencée par une stratégie, un jeu de zones, un composite, une combinaison ou une recette qui la prend pour périmètre — vérifié AVANT tout calcul : on n'altère jamais une forme qu'un plan achète. | un « enregistrer comme nouvelle zone » à ajouter |
| A-3 | Isochrones, dessin, import, capture = **forme figée** au lot 3 : la recette est gardée, pas rejouée (ORS est externe et à quota). | brancher ORS dans l'exécuteur |
| A-4 | Seuil sur carreaux : périmètre ≤ **département** (région refusée, zone-périmètre ≤ 12 000 km² ; question Q-G), plafond **20 000 carreaux retenus** ; rayon autour des POI d'un type et seuil IRIS/CP : plafonds **5 000 POI / 5 000 territoires**, région admise, national refusé. | ouvrir la région : une liste de types admis |
| A-5 | L'Angular de ③ écrit par les routes neuves (`/api/zones`) ; React gelé garde `/api/custom-geo/save`. Les deux écrivent la même table. | aucun |
| A-6 | Les exports (lot 6) passent AVANT le portage du plan (lot 7), parce qu'ils partent du jeu de zones sans campagne. | réordonner deux lots |
| A-7 | **Un seul quota** pour les trois routes de calcul de zone (aperçu, écriture, recalcul) : 12 appels par minute et par compte, préfixe `geo:rl:zones`. Un aperçu suivi d'un enregistrement coûte 2 jetons, soit 6 zones par minute au plus. Ce qu'il protège : au pire mesuré après la borne au département — une zone-périmètre dense de 12 000 km² (l'IDF, 90 000 buffers par appel ; un département ≤ 69 000) —, ≤ 1,1 M buffers par minute et par compte. | une constante |
