# Refonte du module « Population à risque industriel » — audit et plan

> **Phase 0 de `docs/PROMPT.md`.** Ce document est l'audit demandé avant tout
> code, plus le plan de fichiers qui en découle.
>
> Écrit le 2026-09-19. Toutes les volumétries ci-dessous ont été **mesurées sur
> la base locale ce jour**, jamais reprises d'un document.

---

## Décision préalable : où vont les migrations

`docs/PROMPT.md` dit « Migrations via le MCP Supabase ». **Cette consigne n'est
plus applicable et je ne la suis pas.**

Le MCP Supabase ne parle qu'au projet hébergé `vkkdbygwbrxyogqosten`, qui n'a
plus aucun consommateur et que Vincent supprime le 2026-09-22. `CLAUDE.md`
§ « LE LOCAL D'ABORD » est explicite depuis le 2026-09-18 : tout travail de
développement passe par `psql` dans le conteneur.

C'est exactement la situation qui a produit l'incident du 2026-09-18, où
sql/179 a été appliquée en production parce qu'une règle survivante à son
contexte commandait le mauvais geste. Les migrations de ce chantier vont donc
dans `sql/`, appliquées par
`docker exec supabase_db_genesis_app psql -U postgres -f ...`.

---

## 1. Ce que le module est aujourd'hui

### 1.1 Composants

| Fichier | Lignes | Rôle |
|---|---:|---|
| `components/risques/AnalysePopulationOverlay.tsx` | 1 403 | L'overlay entier : onglet « Population exposée » **et** conteneur de l'autre onglet. **20 `useState`.** Seuil projet : 300 lignes. |
| `components/risques/CarteMiniFrance.tsx` | 488 | Mini-choroplèthe de l'onglet Territoires (SVG, pas MapLibre) |
| `components/risques/OngletRayonInfluence.tsx` | 423 | La courbe cumulée + le curseur |
| `components/risques/elements.tsx` | 156 | Briques présentationnelles déjà extraites |
| `components/risques/Kpi.tsx` | 65 | Tuile de KPI, extraite d'un doublon |

Monté par `app/map/page.tsx:1170`. **Aucun état n'est sérialisé dans l'URL
aujourd'hui** : l'unique `URLSearchParams` du fichier (ligne 608) sert à
construire l'appel API, pas l'adresse de la page. La sérialisation demandée en
phase 1 est donc entièrement neuve.

### 1.2 Logique partagée déjà extraite

- `lib/risques/dimensions.ts` — les 5 mailles, `DIMENSIONS_PROPOSEES` (4, sans
  `arrondissement`), `MODES_ZONE`, `modesValides()`.
- `lib/risques/methode.ts` — `METHODE_CALCUL`, `LIMITES`, `SOURCES` : le texte
  de méthode, partagé écran/classeur.
- `lib/carte/palette-risques.ts` (223 l.), `lib/carte/palette-pprt.ts` (95 l.),
  `lib/carte/nature-zone.ts` (125 l.) — couleurs et conventions de tracé.

### 1.3 Routes API

| Route | RPC appelée | Coût |
|---|---|---|
| `GET /api/risques/exposition/agregats` | `population_exposee_agregee` | **3 à 43 s**, mémorisé dans `exposition_cache` |
| `GET /api/risques/exposition/rayon` | `lire_couverture_rayon`, `compter_sites_rayon` | millisecondes, lit un pré-calcul |
| `GET /api/risques/exposition/cibles` | lit `cibles_exposition` | trivial |
| `GET /api/risques/exposition/export` | `population_exposee_agregee` | idem agrégats + fabrication du classeur |
| `GET /api/risques/[siteId]/exposition` | `population_exposee_site` | ~300 ms par site, cache `seveso_exposition` |
| `GET /api/map/risques-industriels` | `risques_industriels_carte` | 1 259 sites + zones = 4,2 Mo en 323 ms |
| `GET /api/map/pprt` | `pprt_perimetres_carte` | 126 zones, 182 ko, 46 ms à z8 |

### 1.4 Tables

| Table | Lignes (local) | Rôle |
|---|---:|---|
| `poi_france` (catégorie `risque_industriel`) | 96 427 | Les sites. `sous_categorie` = la gravité. |
| `pprt_perimetres` | 664 | Les servitudes PM3 opposables |
| `pprt_documents` | 415 | Les procédures GASPAR |
| `carreaux_filosofi` | 2 324 577 | La population, dans `metadata->>'ind'` |
| `couverture_rayon_risque` | 115 962 | Le pré-calcul de la courbe |
| `exposition_cache` | — | Résultats mémorisés d'`/agregats` |
| `seveso_exposition` | — | Population exposée par site |
| `cibles_exposition` | 24 | Le catalogue des cibles |

---

## 2. Comment la courbe obtient sa lecture immédiate, et ce qu'on peut en tirer

### 2.1 Le mécanisme

`couverture_rayon_risque` porte le grain
**(département × gravité × nature × palier de 100 m)**, avec les 24 cibles en
jsonb et l'**incrément** de population par palier — jamais le cumul, qui se
recalcule au fenêtrage. 115 962 lignes.

`lire_couverture_rayon` rend une grille complète de 100 à 10 000 m. Le composant
la garde en mémoire ; bouger le curseur relit un tableau (`OngletRayonInfluence.tsx:175`).
**Aucun appel réseau au déplacement.** C'est le comportement à préserver.

### 2.2 La question posée par la phase 0 : peut-on en tirer la distance au site le plus proche PAR NIVEAU ?

**Non. Et c'est le constat qui décide de toute la phase 2.**

La table contient bien `gravite ∈ {seveso_haut, seveso_bas, '*'}`. On pourrait
croire la donnée disponible. Elle ne l'est pas, pour deux raisons distinctes :

**a) C'est une distribution MARGINALE, pas jointe.** Chaque ligne dit « combien
d'habitants sont à tel palier du site le plus proche *de cette gravité* ». Un
carreau proche d'un Seveso haut *et* d'un Seveso bas est compté dans les deux
familles de lignes. La table ne sait pas, pour un carreau donné, dire
simultanément `d_haut` **et** `d_bas` — or la règle d'affectation unique
(« Seveso haut prime sur Seveso bas ») a besoin exactement de ce couple.

Mesure du 2026-09-19, carreaux à moins de 10 km, `nature = '*'` :

```
seveso_haut   586 248
seveso_bas    655 977
              ───────
somme       1 242 225
'*' (réel)    914 154   ← minimum par carreau, pas une somme
```

**328 071 carreaux sont à moins de 10 km des DEUX niveaux**, soit **35,9 % des
carreaux exposés**. Ce n'est pas un cas marginal qu'on pourrait arbitrer à la
louche : c'est un tiers du sujet.

**b) La table ignore les régimes hors Seveso.** Son prédicat de construction
(sql/198, CTE `sites`) filtre
`sous_categorie in ('seveso_haut','seveso_bas')`. Le niveau `autres` du modèle
`ProfilRayons` n'a donc **aucune donnée** derrière lui aujourd'hui.

### 2.3 Ce qu'il faut construire à la place

Une table de **distances jointes par carreau**, sans population :

```
carreau_risque_distance(
  carreau_id       bigint primary key,   -- carreaux_filosofi.id
  code_departement text not null,
  code_commune     text,
  code_postal      text,
  d_haut_m         int,                  -- null = au-delà de 10 km
  d_bas_m          int,
  d_autres_m       int,
  dans_pprt        boolean not null
)
```

Dimensionnement : **914 154 lignes** si on garde le périmètre Seveso actuel.
Sans jsonb, la ligne pèse une cinquantaine d'octets : on est autour de **50 Mo**,
contre ~730 Mo si on dénormalisait `metadata`. La population est rejointe par
clé primaire sur `carreaux_filosofi`, et **seulement pour les 914 154 carreaux
concernés**, jamais pour les 2,3 M.

Une fois cette table en place, évaluer un profil de rayons devient une
**opération purement arithmétique** : plus aucune géométrie, plus aucun
`ST_Buffer`, plus aucun `ST_Intersects`. C'est ce qui rend tenable la promesse
de lecture immédiate de la phase 2, et c'est aussi ce qui alimente le prorata
CP de la phase 4 sans second calcul.

### 2.4 Arbitrage que je tranche : `autres` reste hors périmètre en phase 2

Le modèle `ProfilRayons` prévoit `autres: number[]`. Je le **garde dans le
type** (schéma Zod, sérialisation, tests) mais **l'alimente à vide** dans cette
mission, pour une raison mesurée.

Répartition réelle des 99 152 sites ICPE en base locale, comptée le 2026-09-19 :

```
autre           43 195      seveso_haut      717
enregistrement  30 441      seveso_bas       610
autorisation    18 512                    ──────
ied              5 677      Seveso total   1 327
```

Le niveau « Autres » représenterait donc **97 825 sites**, contre 1 327 pour les
deux niveaux Seveso. Or `population_exposee_agregee` refuse au-delà de **3 000
sites retenus** (`trop_de_sites`, sql/190), parce que le coût mesuré est de 2,3
à 4,5 ms par site — 19 521 sites avaient été chronométrés à **88,3 s**. Étendre
le pré-calcul à 97 825 sites multiplierait la construction par soixante-dix sans
qu'aucune demande produit ne l'exige : la finalité déclarée du module est le
**custom bidding différencié Seveso haut / Seveso bas**.

⚠ Ces comptes diffèrent de ceux d'`ARCHITECTURE.md` (41 690 `autre`, 29 665
`enregistrement`, 19 521 `autorisation`), mesurés sur le projet hébergé à une
autre date. La base locale porte 99 152 sites là où la prod en portait 96 427 :
la pagination de l'API Géorisques n'est pas stable, c'est déjà documenté
(`consolider_geo_icpe`, sql/174). Je retiens les chiffres locaux, qui sont ceux
de l'environnement où ce chantier tourne.

L'interface affichera le niveau « Autres » **désactivé avec sa raison écrite**,
jamais absent en silence. Rouvrir le sujet ne demandera qu'un élargissement du
prédicat de `sites_exposition` et une reconstruction.

---

## 3. Schéma réel des tables de campagne

### 3.1 `dsp_campaigns` (5 lignes)

Colonnes utiles : `id uuid`, `name`, `dsp_source`, `advertiser`, `product`,
`date_start`, `date_end`, `organization_id`, `total_budget numeric(12,2)`,
`currency`, `geo_strategy jsonb`, `tolerance_pct`, `overpressure_weight`.

**`is_demo boolean not null default false` existe déjà**, avec un index partiel
`idx_dsp_campaigns_demo WHERE is_demo = true`. Le drapeau demandé par la phase 4
est donc en place : pas de colonne à créer, pas de convention de préfixe à
inventer. Le préfixe `[DEMO]` du nom reste utile pour l'œil, mais c'est
`is_demo` qui fait foi côté code.

### 3.2 `dsp_campaign_data` (477 879 lignes)

Maille disponible : **`postal_code text`**, plus `date`, `city`, `region`,
`code_iris`, `code_commune`, `media`, `actor`, `dsp_source`.

Colonnes de mesure : **`impressions bigint`**, `unique_impressions integer`,
`tracked_ads integer`, `clicks integer`, **`spend numeric(12,4)`**,
`metrics jsonb`. Le coût et le CPM sont donc calculables.

⚠ **Contrainte d'unicité, et elle est plus large que ce que dit la doc.**
L'index d'expression `idx_dsp_data_unique` porte sur **six** expressions :

```
(campaign_id,
 COALESCE(date, '1970-01-01'),
 COALESCE(postal_code, ''),
 COALESCE(city, ''),
 COALESCE(media, ''),
 COALESCE(actor, ''))
```

`ARCHITECTURE.md` en annonce **cinq** et omet `actor` : mesuré le 2026-09-19,
c'est une dérive de la doc, à corriger dans le commit de la phase 4. Un
générateur qui pré-agrégerait sur cinq clés en croyant la doc produirait des
doublons refusés par la base.

Corollaire déjà documenté : cet index d'expression **n'est pas inférable par
`onConflict` de PostgREST**. Le seed fera donc **DELETE ciblé + INSERT par
lots**, jamais un upsert — et lira l'erreur du DELETE, `supabase-js` ne levant
pas.

### 3.3 `campaign_cp_rollup` (10 205 lignes)

Agrégat par CP déjà en place (imps, spend, fenêtres 7 j, `in_target`,
`planned_share`). PK = (campagne × CP × **acteur**) : un CP y apparaît jusqu'à
cinq fois, **il faut sommer avant tout calcul**. Rafraîchi par
`refresh_campaign_rollups`.

---

## 4. Comment la couche des points de sites est branchée aujourd'hui

`app/map/_components/RisqueIndustrielLayer.tsx` (586 lignes) ne rend rien dans
le DOM : elle pilote MapLibre par un effet, comme `CivicIndicatorsLayer` et
`DiffusionMapLayer`. Elle appelle `/api/map/risques-industriels` en GeoJSON —
**pas en MVT**.

Trois couches MapLibre, dans cet ordre :

1. `risques-zone` — la zone calculée, polygone métrique produit par
   `ST_Buffer` sur `geography`. **Contour tireté** : elle n'a aucune valeur
   réglementaire.
2. `risques-halo` — halo en pixels, pour rester lisible quand 500 m font moins
   d'un pixel.
3. `risques-point` — le point net, cerné (`CONTOUR_POINT`, inversé selon le
   thème).

`app/map/_components/PprtLayer.tsx` (284 l.) sert les périmètres opposables en
**trait plein**. La convention tireté/plein vit une seule fois, dans
`lib/carte/nature-zone.ts`. **Elle doit être reconduite telle quelle** par la
nouvelle couche de zones : c'est ce qui distingue le calculé du réglementaire.

Sélection des couches depuis `PanneauCalques.tsx`, réglages dans
`filter-panel/RisqueIndustrielSection.tsx` (706 l.).

⚠ **Contrainte structurelle à respecter** : `lib/carte/degrades.ts` impose
**un seul dégradé de couleur à la fois**. La nouvelle couche « zones de risque »
doit s'enregistrer dans ce registre, sinon elle s'empilera avec les huit
choroplèthes existantes sans qu'aucune légende ne dise laquelle on lit. Les
valeurs sont déclarées deux fois (union `DegradeId` + tableau `DEGRADE_IDS`) et
un type `UnionCouverte` fait échouer `tsc` si la seconde oublie un membre.

---

## 5. Plan de fichiers

### 5.1 À créer — noyau logique (pur, testé sans base)

| Fichier | Responsabilité | Exports |
|---|---|---|
| `lib/risques/profil.ts` | Le modèle `ProfilRayons` et son schéma Zod partagé client/serveur | `ProfilRayons`, `ProfilRayonsSchema`, `PROFIL_DEFAUT`, `normaliserProfil()` |
| `lib/risques/hash-profil.ts` | Empreinte stable d'un profil, clé du cache et des tuiles | `hashProfil(p: ProfilRayons): string` |
| `lib/risques/affectation.ts` | **La règle d'affectation unique**, fonction pure | `classerCarreau(d, profil): Classe`, `Classe`, `CLASSES_ORDRE`, `libelleClasse()` |
| `lib/risques/etat-url.ts` | Sérialisation de l'état partagé dans l'URL | `lireEtatUrl()`, `ecrireEtatUrl()`, `EtatRisque` |
| `lib/risques/prorata.ts` | Ventilation d'un CP vers les classes, au prorata de population | `proratiserCp()` |

### 5.2 À créer — SQL

| Migration | Contenu |
|---|---|
| `sql/203_carreau_risque_distance.sql` | La table de distances jointes + sa construction par bandes de longitude, reprenable (même patron que sql/198) |
| `sql/204_zones_risque_cache.sql` | Cache `(profil_hash, niveau, bande)` avec `geom` 4326, `geom_3857`, index GIST ; `ST_Union` par bande puis `ST_Difference` pour l'exclusivité |
| `sql/205_zones_risque_tuile.sql` | `zones_risque_tuile(z,x,y,profil_hash)` en `ST_AsMVT` |
| `sql/206_diffusion_par_classe.sql` | Croisement campagne × classes, prorata CP mis en cache par `profil_hash` |

### 5.3 À créer — routes et couche carte

- `app/api/risques/profil/bandes/route.ts` — population par niveau et par bande
  pour un profil (lecture arithmétique, pas de géométrie).
- `app/api/risques/zones/[profilHash]/preparer/route.ts` — construit le cache
  d'un profil, flux NDJSON avec progression (règle `CLAUDE.md` : jamais de
  traitement DB silencieux).
- `app/api/tiles/zones-risque/[z]/[x]/[y]/route.ts` — tuiles MVT, **gzip
  obligatoire**, placée sous `/api/tiles/` pour que le matcher par segment de
  `middleware.ts` la protège sans toucher au fichier protégé.
- `app/api/risques/diffusion/route.ts` — l'onglet Diffusion.
- `app/map/_components/ZonesRisqueLayer.tsx` — la couche MVT.
- `scripts/seed-demo-campagne-risque.ts` — la campagne de démo et sa purge.

### 5.4 À créer — interface

`components/risques/` : `EcranRisque.tsx` (assemblage), `ContexteRisque.tsx`
(l'état unique), `BarreFiltres.tsx`, `BandeauKpi.tsx`, `OngletRayons.tsx`,
`OngletTerritoires.tsx`, `OngletDiffusion.tsx`, `PanneauProfil.tsx`,
`TableauBandes.tsx`.

### 5.5 À modifier

- `components/risques/AnalysePopulationOverlay.tsx` — **vidé** de son état et
  de son onglet vers les fichiers ci-dessus ; ne reste que le montage.
- `components/risques/OngletRayonInfluence.tsx` — la courbe devient
  **sélecteur** (marqueurs déplaçables, clic pour ajouter un anneau).
- `lib/carte/degrades.ts` + `lib/carte/calques-actifs.ts` — enregistrer
  `'zones-risque'` dans les deux déclarations.
- `lib/version.ts` — `ZONES_RISQUE_TILE_VERSION`, à bumper à tout changement de
  schéma de tuile.
- `ARCHITECTURE.md` — dans le même commit que chaque phase, et correction des
  cinq/six colonnes d'`idx_dsp_data_unique`.

### 5.6 À supprimer

Rien avant la fin de la phase 1. Les doublons entre les deux anciens onglets
partent au moment où le second consommateur disparaît, jamais avant — règle
vérifiée par grep, comme pour `SuiviMapLayer`.

---

## 6. Écart de total annoncé d'avance

La phase 2 impose que toutes les sommes soient additives. C'est un **changement
de définition**, et il fera bouger des chiffres :

- Aujourd'hui, `population_exposee_agregee` unit les zones **à l'intérieur de
  chaque carreau** et compte un habitant une fois. `ARCHITECTURE.md` annonce
  **421 214** sur la France en mode par défaut — chiffre mesuré sur le projet
  hébergé, à re-mesurer en local avant de s'en servir de référence, la base
  locale portant 99 152 sites contre 96 427 en prod.
- Demain, chaque carreau reçoit **une seule classe** (haut > bas > autres). Le
  total « exposé, tous niveaux » restera le même, mais la **ventilation par
  niveau changera** : les 328 071 carreaux aujourd'hui comptés dans les deux
  marges seront attribués au seul niveau Seveso haut.

**MESURÉ le 2026-09-19**, profil par défaut (haut 1/2/5 km, bas 0,5/1 km,
PPRT à part), cible `ind`, France entière :

| | ancien affichage (marginal) | règle d'affectation unique | écart |
|---|---:|---:|---:|
| Seveso seuil haut | 13 585 817 | 13 585 902 | **+85** |
| Seveso seuil bas | 1 055 801 | 517 797 | **−538 004** |
| **somme affichée** | **14 641 618** | **14 103 699** | **−537 919** |

La prédiction est vérifiée à la lettre : le seuil haut ne bouge pas (les 85
habitants gagnés viennent de carreaux couverts par un périmètre PPRT mais au-delà
du dernier anneau), le seuil bas est **divisé par deux**, et la somme des deux
égale enfin le total.

Autrement dit, l'écran annonçait **537 919 habitants de plus qu'il n'y en a**,
soit **3,8 %** — non pas parce qu'un nombre était faux, mais parce que deux
nombres exacts ne devaient pas être additionnés. C'est le défaut le plus
difficile à repérer : chaque moitié résiste à la vérification.

---

## 7. Ordre d'exécution et points de contrôle

| Phase | Livrable vérifiable | Commit |
|---|---|---|
| 0 | Ce document | `docs: audit du module risque avant refonte` |
| 1 | Un écran, un état, sérialisé dans l'URL. Aucun changement de chiffre. | `refactor(risques): un seul ecran, un seul etat` |
| 2 | `affectation.ts` + sql/203 + l'atelier Rayons. Écart de total mesuré et écrit. | `feat(risques): atelier de rayons et regle d affectation unique` |
| 3 | sql/204-205 + `ZonesRisqueLayer`. `EXPLAIN ANALYZE` sur la tuile. | `feat(risques): couche MVT des zones de risque` |
| 4 | sql/206 + seed + onglet Diffusion. | `feat(risques): onglet diffusion et campagne de demonstration` |
| 5 | Export, états vides, tests, `npm run catalogue` propre. | `feat(risques): finitions, export et tests` |

Contrôles à chaque phase, sans exception : `npx tsc --noEmit`, `npm run lint`,
`npm run test:unit`, et `EXPLAIN ANALYZE` sur toute nouvelle requête PostGIS.
