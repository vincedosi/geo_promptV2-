# Rapport — audit et refactor IRIS / météo / allergènes / flux routier

> 2026-09-11, mode one-shot. Audit : `docs/AUDIT_IRIS_TERRAIN.md`.

## Ce qu'il faut retenir

**La couche IRIS n'avait jamais fonctionné en production.** Ce n'était pas une
lenteur à optimiser : il n'y avait rien à l'écran, et aucune erreur nulle part.
Tout le reste du lot découle de ce constat.

Les trois autres domaines audités — météo, allergènes, flux routier — ne
souffraient pas du même mal. La météo et le TMJA sont, en l'état, les deux
meilleurs exemples du projet : échantillonnage borné, diffusion NDJSON, gzip,
cache CDN, déduplication. La route des tuiles IRIS a été écrite en les copiant.

## Ce qui a changé

| Constat | État | Preuve |
|---|---|---|
| `TER-001` couche IRIS morte en production | **corrigé** | prod servait `<!DOCTYP` au lieu de `PMTiles` ; désormais tuiles MVT, vérifiées au navigateur |
| `TER-003` IRIS servis à des zooms illisibles | **corrigé** | plancher z9 ; une tuile z5 pesait 1 694 kB pour des IRIS de 0,6 px |
| `TER-002` pollen et air vieux de 70 jours | **à moitié** | péremption désormais signalée ; la donnée, elle, attend les clés Inngest |
| `TER-005` commentaire de perf TMJA faux | **corrigé** | 391 535 octets mesurés contre « ~150 KB » annoncés |
| `TER-004` pyramide IRIS inutile | **aucune action, délibérément** | `geom_z10` garde 98,8 % des points : la reconstruire coûterait un UPDATE sur 49 448 géométries pour un gain nul |
| `TER-006` piège `is_true_iris` | **documenté et verrouillé** | test de garde ; 50 IRIS ruraux, 0 avec le drapeau |

Ajouté par-dessus : **le relief 3D des IRIS**, demandé explicitement.

## Mesures

| | avant | après |
|---|---|---|
| Couche IRIS en production | **rien à l'écran** | tuiles MVT rendues |
| Poids d'une tuile IRIS (Paris) | — | z9 231 kB · z10 154 kB · z13 19 kB |
| Temps de génération (z9) | — | **83 ms** |
| Tuiles demandées sous z9 | jusqu'à 1 694 kB | **aucune** (204) |
| Tests | 593 | **607** (+14) |

## Décisions prises seul, et leur raison

- **Servir les IRIS depuis Postgres plutôt que réparer les PMTiles.** Réparer
  aurait demandé soit de rendre le dépôt public, soit un proxy authentifié — et
  ce proxy avait justement été supprimé en 09/2026 au motif que « les PMTiles le
  remplacent ». Tout l'outillage nécessaire au chemin base dormait déjà :
  `geom_3857`, `geom_z7`, `geom_z10` peuplées sur 49 363 IRIS, index GIST
  compris.
- **Route sous `/api/tiles/iris/` et non `/api/iris-tiles/`.** Le matcher de
  `middleware.ts` raisonne par segment : `/api/iris/:path*` n'aurait pas couvert
  `/api/iris-tiles`. Ce placement protège la route sans toucher à un fichier
  que `CLAUDE.md` déclare protégé.
- **Ne pas filtrer `is_true_iris` côté serveur.** La règle du projet demande ce
  filtre pour l'analyse statistique, et c'est juste — l'appliquer à l'affichage
  effacerait la France rurale.
- **Ne pas reconstruire `geom_z10`.** Un UPDATE sur 49 448 géométries est
  exactement le traitement que le budget d'I/O Nano ne supporte pas, pour 1,2 %
  de points en moins.

## Correctif du 2026-09-12 — la couche ne montrait toujours rien

Remonté par Vincent après test : « j'ai testé, j'ai aucun IRIS qui s'affichent ».
Le rapport ci-dessus affirmait la couche réparée. Elle l'était côté serveur, et
restait invisible côté utilisateur. Trois causes, toutes de mon fait.

**1. La carte démarre à z5,5, le plancher est à z9.** Sous le minzoom d'une
source, MapLibre ne demande AUCUNE tuile et n'émet AUCUNE erreur. Cocher
« Couche IRIS » depuis la vue France par défaut ne produisait donc rien du tout.
J'avais remplacé un affichage cassé par un affichage muet — et je l'avais
« vérifié » en production après avoir moi-même zoomé de six niveaux, ce qui ne
prouvait rien sur le geste réel d'un utilisateur.

**2. « Vrais IRIS uniquement » était coché par défaut.** `CLAUDE.md` dit que
`is_true_iris = true` sert l'analyse statistique et **jamais** l'affichage. La
RPC respectait la règle, le panneau la violait. Mesuré : sur une tuile z10 de
France rurale, 50 IRIS présents, ZÉRO passant le filtre.

**3. Rien ne l'expliquait.** Aucun indice de zoom dans le panneau : une carte
vide sans message se lit comme une panne, et c'est exactement ce qui s'est passé.

### Ce qui a été fait

| Fichier | Changement |
|---|---|
| `lib/version.ts` | `IRIS_ZOOM_PLANCHER` — source unique du plancher, avec les mesures qui interdisent de le baisser |
| `app/api/tiles/iris/[z]/[x]/[y]/route.ts` | lit la constante au lieu d'en garder une copie |
| `app/copilote/_hooks/useMapInit.ts` | les quatre `minzoom: 9` (source + 3 couches) lisent la constante |
| `app/copilote/_hooks/useMapLayers.ts` | `setIrisVisible` remonte la caméra au plancher à l'activation ; relevé du zoom (`zoomend`) exposé au panneau ; défaut `irisTrueOnly` passé à `false` |
| `app/map/_components/filter-panel/IrisSection.tsx` | bandeau « Trop loin pour les IRIS » + bouton « Zoomer » quand la couche est active sous le plancher |
| `tests/unit/carreaux/iris-couche.test.ts` | 13 tests, dont 4 nouveaux sur le plancher unique, la remontée de caméra, l'indice et le défaut du filtre |

### Ce qui a été écarté, et pourquoi

**Baisser le plancher à z8.** C'était mon intention de départ, sur une mesure
que je n'avais pas refaite. Mesuré le 2026-09-12 : la tuile 8/129/88 (Paris)
couvre **4 251 IRIS**, et la 9/259/176 pèse déjà **788 kB** pour 3 387 IRIS —
loin des 231 kB que documentait l'en-tête de la route, qui décrivait un cas
courant et non un plafond. Surtout, la France entière tient en ~75 tuiles z8 :
un utilisateur qui dézoome couche allumée déclencherait l'incident du 28/03
(bbox France entière → I/O épuisé → 504). Un palier z8 aurait acheté un seul
niveau de zoom au prix du risque que `CLAUDE.md` interdit nommément.

Remonter la caméra coûte une tuile. Dézoomer en coûterait soixante-quinze.

### Vérification

Au navigateur, sur `localhost:3000/map`, le 2026-09-12 :

1. Chargement → badge `z5 20km`, « Vrais IRIS uniquement » **décoché**.
2. Un clic sur « Couche IRIS » → la caméra monte seule à `z9 1km`, et les
   contours IRIS s'affichent, France rurale comprise (Berry/Allier), légende
   renseignée (≤ 209 … ≥ 844 sur `pop_15_29`).
3. Cinq dézooms jusqu'à `z4` → le bandeau apparaît :
   « Trop loin pour les IRIS — lisibles à partir du zoom 9 (z4.0) ».
4. Un clic sur « Zoomer » → retour à `z9`, bandeau disparu.

Aucun test unitaire ne pouvait attraper ce défaut : une carte vide est un
succès pour tout ce qui n'est pas un œil. Les tests ajoutés verrouillent les
mécanismes ; c'est le navigateur qui prouve le résultat.

## Cascade de zoom des IRIS — 2026-09-12 (2e passe)

Demande de Vincent après le correctif du silence : *« tu appliques la même
stratégie de zoom que les carreaux pour les IRIS, il faut pouvoir voir les IRIS
quand la France entière est affichée »*. C'était la bonne demande — le correctif
précédent avait rendu l'absence **explicable**, pas l'affichage **possible**.

### Ce qui bloquait

Servir 49 448 IRIS à z5 : 1 694 kB par tuile, pour des polygones de 0,6 px.
Baisser le plancher n'était pas la réponse ; **agréger** l'était, exactement
comme `get_tile` sert des mailles de 20 km, 5 km, 2 km, 1 km ou 200 m selon le
zoom.

### Les paliers, et pourquoi ceux-là

Règle du projet : une maille se lit entre 10 et 40 px.
`m/px = 78271,517 × cos(lat) / 2^z`, soit `53 862 / 2^z` à 46,5°.

| zoom | palier | mailles | taille apparente |
|---|---|---|---|
| z4–z6  | départements | 104    | 23 → 91 px |
| z7–z8  | communes     | 34 921 | 11 → 22 px |
| z ≥ 9  | IRIS         | 49 448 | 31 px à z9 |

z6 est le palier bancal : la commune n'y fait que 5,6 px, le département 91.
Le département l'emporte — une maille trop grande reste lisible, une maille de
5 px est du bruit.

Bonne surprise à la reconnaissance : **les géométries administratives existaient
déjà** (`ref_departements` 104, `ref_communes` 34 921, `geom` renseignée
partout). Aucun `ST_Union` à faire, le coût s'effondre : 4,8 s et 5,4 s pour
construire les deux paliers.

### La règle d'agrégation, et son piège

Sommer un revenu médian n'a aucun sens. La classe d'un indicateur est **dérivée
du nom** (jamais une liste en dur — les colonnes d'`iris` sont dynamiques) et
n'a qu'**une** définition, `classe_iris()` en SQL, que lisent l'agrégateur, le
calcul des bornes **et** le front :

- `effectif` (population, pop_*, nb_*) → **somme**, puis rapporté au km²
- `densite` (densite_*) → **recalculée** depuis les sommes
- `proportion` (part_*, taux_*, indice_*, rev_*) → **moyenne pondérée** par la
  population, sur les seules lignes renseignées

Une première version n'avait que deux classes, et c'était un défaut mesurable :
`densite_pop` est déjà une densité (ne pas rediviser) **mais** sa queue droite
est longue comme celle d'un effectif. Classée `proportion`, elle recevait le
quantile p95 au lieu du p99,9 : son plafond tombait à 14 460 hab/km² au lieu de
60 555, et les 5 % d'IRIS les plus denses — le cœur des villes, là où travaille
un média-planneur — saturaient. La classe portait deux questions distinctes
(« diviser par la surface ? » et « quelle forme de distribution ? ») et les
confondait.

**Validation avant matérialisation**, contre des repères connus :
population 67 760 552 · propriétaires 58,60 % · logements sociaux 14,97 % ·
revenu médian 23 097 € · pop_15_29 11 860 704 (17,5 %). Et après, par
département : Paris 105 km² / 2 113 697 hab / 20 066 hab/km² / 32,8 % ·
Cantal 5 777 km² / 25 hab/km² / 72,2 % · Guyane 83 677 km² / 3,4 hab/km².
Tous conformes à l'INSEE.

### Rendre les paliers comparables

Un département somme ~475 IRIS : sans normalisation, la vue France saturerait et
la vue ville serait vide. La leçon des carreaux s'applique telle quelle —
**densité/km² + échelle log10 + bornes nationales fixes**, le minimum pris sur
le palier le plus grossier et le maximum sur le plus fin.

Une différence avec les carreaux, et elle est structurelle :
`lib/carreaux/bornes.ts` est une table **statique**, parce que les colonnes
Filosofi sont figées. Celles d'`iris` sont dynamiques : une table statique y
serait fausse dès le prochain indicateur importé, et fausse en silence. Les
bornes vivent donc **en base** (`iris_bornes_echelle`) et se reconstruisent avec
les données.

Effet de bord bienvenu : la couche n'appelle plus `/api/iris/stats`, qui faisait
un `percentile_cont` sur 49 448 lignes **par colonne consultée** — un balayage
complet de la table à chaque changement d'indicateur. Un aller-retour de 4 kB
par session le remplace. Cette route n'a désormais plus aucun appelant.

### Ce que la mesure a donné

Octets bruts avant gzip :

| tuile | poids | tuile | poids |
|---|---|---|---|
| z4 France entière | **101 355** | z7 Paris (le pire) | 783 551 |
| z5 France | 115 463 | z8 Paris | 353 524 |
| z6 Paris | 97 432 | z9 Paris | 827 012 |

**La France entière tient dans une tuile de 100 kB.** La plus lourde reste la
z9 parisienne, qui était déjà servie avant ce chantier.

`EXPLAIN (ANALYZE, BUFFERS)` sur le palier commune, tuile 7/64/44 :
Bitmap Index Scan sur `idx_iris_agg_commune_geom`, 2 686 mailles,
**54,9 ms, `shared hit=685`, zéro lecture disque**.

### Le défaut que seul le navigateur a vu

Au test, le panneau annonçait « Communes » quand la carte affichait des
départements, et « IRIS » quand elle affichait des communes — décalé d'un cran
sur **tout le demi-cran supérieur de chaque palier**. MapLibre demande la tuile
`floor(zoom)` : à un zoom de carte de 6,5 la tuile servie est la z6. Mon
`niveauAuZoom()` lisait le zoom exact. Corrigé par un `Math.floor`, et le test
étendu aux zooms fractionnaires — sa première version ne testait que des
entiers, et laissait donc passer précisément ce cas.

### Vérification

Au navigateur, le 2026-09-12 :

1. Chargement à z5,5, un clic sur « Couche IRIS » → **la France entière
   s'affiche**, 104 départements en densité de 15–29 ans, Paris au sommet de
   l'échelle, légende en `/km²` sur échelle log.
2. Zoom cran par cran : z5 Départements · z6 Départements · z7 Communes ·
   z8 Communes · z9 IRIS · z10 IRIS. Le panneau colle à la tuile à chaque cran.
3. Relief 3D au palier IRIS : les bourgs ressortent, les IRIS ruraux restent
   plats. Au palier département : une carte en relief de la France, hauteur
   proportionnelle à la densité de jeunes. La mise à l'échelle par largeur de
   maille tient sur un facteur 700 entre les paliers.

### Fichiers

| Fichier | Changement |
|---|---|
| `sql/138_iris_agregats_cascade.sql` | `classe_iris()` + `construire_iris_agg()` ; tables `iris_agg_departement` / `iris_agg_commune` |
| `sql/139_get_iris_tile_cascade.sql` | `get_iris_tile` devient une cascade à trois paliers, chaque feature portant `niveau` |
| `sql/140_iris_bornes_echelle.sql` | table `iris_bornes_echelle` + `construire_iris_bornes()` |
| `lib/iris/echelle.ts` | normalisation, échelle log, garde-fous d'expression, nommage des paliers |
| `app/api/iris/bornes/route.ts` | sert les bornes nationales, cache CDN 24 h |
| `lib/version.ts` | `IRIS_ZOOM_PLANCHER` 9 → 4, `IRIS_TILE_VERSION` 1 → 2 |
| `app/copilote/_hooks/useMapLayers.ts` | couleur et hauteur sur l'échelle normalisée ; filtre conscient du palier ; `irisStats` → `irisBornes` |
| `app/copilote/_hooks/useMapInit.ts` | arrêts de zoom des contours étendus à toute la cascade |
| `app/map/_components/filter-panel/IrisSection.tsx` | palier affiché, légende en unités réelles |
| `types/database.types.ts` | régénérés (nouvelles tables et fonctions) |
| `tests/unit/iris/cascade-zoom.test.ts` | 18 tests : cohérence des paliers, unicité de la règle, comparabilité |

### Limite connue

82 IRIS (80 253 habitants, **0,12 %**) n'ont pas de commune correspondante dans
`ref_communes` — communes fusionnées ou renommées. Ils sont absents du palier
commune, présents aux paliers département et IRIS. Et quatre indicateurs que le
panneau propose (`nb_emplois`, `nb_emplois_commune`, `part_couples_avec_enfants`,
`part_menages_emmenages_2ans`) sont **entièrement vides en base** : ils
affichent désormais « Aucune donnée pour cet indicateur » au lieu d'une carte
grise sans explication.

## Ce qui reste, et qui n'est pas du code

1. **Clés Inngest en production** — sans elles, pollen et qualité de l'air
   resteront figés. L'écran le dit maintenant ; il ne peut pas le réparer.
2. **Le sort du pipeline PMTiles.** Le workflow `generate-iris-pmtiles`, son
   script d'upload et le bouton « Régénérer PMTiles IRIS » de l'administration
   sont intacts — et n'alimentent plus rien. Soit on les supprime, soit on les
   branche derrière un proxy authentifié si l'on veut revenir aux PMTiles un
   jour. Laisser un bouton qui régénère un fichier que personne ne lit est un
   piège.
3. **Le fichier `public/iris_france.pmtiles` (361 Mo) et `iris_france.geojson`
   (43 Mo)** occupent le disque du poste de développement sans servir. Ni l'un
   ni l'autre n'est suivi par git.

## Ce que l'audit n'a pas trouvé

Dit explicitement pour que personne ne refasse le chemin : rien à redire sur
`/api/meteo-geo` ni sur `/api/tmja-tiles`, au-delà d'un commentaire chiffré à
corriger. Ces deux routes font déjà ce que le reste du projet devrait faire.
