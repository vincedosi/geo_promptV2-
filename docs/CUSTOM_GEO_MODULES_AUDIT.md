# Custom Geo — Audit des modules carte (Étape 6a)

> Livrable Étape 6a. **Aucun code produit**, rapport d'inventaire uniquement pour préparer le branchement du système `useCustomGeoLayer()` (Étape 5, commit `aa471f1`, v7.10.0).

Date : 2026-04-20

---

## Contexte

Le système Custom Geo Capture est déjà monté globalement dans `app/map/layout.tsx` (Provider + bouton flottant). Il attend que des modules s'y branchent via :

```ts
useCustomGeoLayer({ id, sourceType, label, getGeometry, metadata?, enabled? });
```

Actuellement **zéro module réel branché** → bouton désactivé partout sauf `/dev/test-custom-geo-capture`.

---

## Arborescence réelle `/app/map/*`

```
app/map/
├── layout.tsx                         # Provider Custom Geo + bouton flottant (Étape 5)
├── page.tsx                           # Page carte principale — 2001 lignes monolithique
├── _components/
│   ├── FilterPanel.tsx                # Filtres admin + POIs + OOH + battle + digital + radio…
│   ├── IrisDetailPanel.tsx
│   ├── CorrelationPanel.tsx
│   ├── ClusteringWizard.tsx
│   ├── ClusterPanel.tsx
│   ├── ScoringPanel.tsx
│   └── StudyDashboard.tsx
├── analyse/digital/
│   ├── page.tsx                       # Triple map IMP/POP/RATIO (Étape 3 branchée)
│   ├── _components/                   # RailroadPipeline, AnalysisPanel, SyncMap…
│   └── _lib/
└── custom-geo/                        # EXCLU (galerie, Étape 2)
```

**Nombre réel de pages `/map/*` distinctes** : 2 (hors galerie et démo)
- `/map` — page monolithique contenant 10+ sous-modules logiques
- `/map/analyse/digital` — analyse triple map campagne DSP

---

## Vue d'ensemble — modules inventoriés

Les "modules" de `/map` sont des **sous-systèmes logiques d'une page unique**, pas des pages distinctes. Chacun correspond à un layer MapLibre + un state React dédié.

| # | Module logique | Page hôte | Géométries | Activation | Complexité |
|---|---|---|---|---|---|
| 1 | Zone territoriale filtrée | `/map` | Polygone (bbox/region/dept/commune) | Filtre admin appliqué | **Moyen** |
| 2 | POIs visibles | `/map` | Points | Layer POIs activé | Trivial |
| 3 | Panneaux OOH visibles | `/map` | Points | Layer panneaux activé | Trivial |
| 4 | Battle isochrones (calcul PostGIS) | `/map` | Polygones multi-paliers | Calcul battle terminé | Moyen |
| 5 | Clusters POI | `/map` | MultiPolygon cluster | `clustersVisible=true` | **Moyen** |
| 6 | Wizard clustering highlight | `/map` | Points preview | Pendant config wizard | Trivial (mais peu utile) |
| 7 | TMJA (flux routier) | `/map` | LineString | Layer TMJA activé | Complexe (LineString, pas polygone) |
| 8 | Radio — émetteurs | `/map` | Points | `radioVisible=true` | Trivial |
| 9 | Radio — coverage buffers | `/map` | Polygones buffer | `radioCoverageMode=true` | **Moyen** |
| 10 | Digital DSP (mini choroplèthe) | `/map` | Polygones region/dept/CP | `digitalVisible=true` | Moyen |
| 11 | Corrélation résidus | `/map` | Tuiles MVT IRIS | `residualsMeta !== null` | **Complexe** |
| 12 | IRIS sélectionné (clic unique) | `/map` | Polygone IRIS | `selectedIrisCode !== null` | Trivial |
| 13 | Analyse digital — zone active | `/map/analyse/digital` | Géométrie selon `scale` | Campagne + scale sélectionnés | Moyen (déjà Étape 3, non-branché capture) |

---

## Détail par module

### 1. Zone territoriale filtrée

- **Route** : `/map`
- **Fichier principal** : `app/map/page.tsx` (+ `FilterPanel.tsx`)
- **Géométries** : polygone représentant la zone administrative active (France entière, région, département, commune ou bbox sélectionnée)
- **Source code** : `zoneData: ZoneData | null` (ligne 69), modifié par `FilterPanel`. `ZoneData` contient probablement bbox + nom zone admin.
- **Activation** : user applique un filtre (région/dept/commune) → `zoneData` devient non-null
- **Complexité** : **Moyen** — il faut construire un polygone depuis la bbox (ST_MakeEnvelope) ou fetcher la vraie frontière admin via une RPC dédiée
- **Proposition branchement** :
  - `id: 'map-admin-zone'`
  - `sourceType: 'admin_filter'`
  - `label: ex. "Département 69 (Rhône)"` — dynamique depuis `zoneData.nom`
  - `getGeometry: () => bbox → polygon OU fetch frontière admin RPC`
  - `enabled: zoneData !== null`
  - `metadata: { level: 'departement', code: '69' }`

### 2. POIs visibles

- **Route** : `/map`
- **Fichier** : `app/map/page.tsx` + `FilterPanel.tsx`
- **Géométries** : Points individuels (POI categorie lycée, CIRFA…)
- **Source code** : state dans `FilterPanel` (les POIs filtrés affichés sur la carte)
- **Activation** : filtre POIs appliqué + résultats chargés
- **Complexité** : Trivial — mais une FeatureCollection de Points ne fait pas un polygone. **Il faut un buffer autour** pour produire une zone exploitable (ex: 500m autour de chaque POI), ou un convex_hull
- **Proposition** : à inclure mais uniquement si l'user choisit une transformation `convex_hull` ou `envelope` dans le modal. Sinon l'Union de Points donnera un MultiPoint qui plante `ST_Buffer(0)` fallback.
- **Recommandation** : **exclure pour V1** sauf si on ajoute un "buffer autour des POIs" comme transformation dédiée. Peu utile en pratique — l'user veut capturer une zone, pas un semis de points.

### 3. Panneaux OOH visibles

- Même logique que #2 : points individuels, pas une zone naturelle.
- **Recommandation** : **exclure V1** sauf si envelope/convex_hull suffisent à l'usage.

### 4. Battle isochrones

- **Route** : `/map`
- **Fichier** : résultats dans `battleFeatures: GeoJSON.Feature[]` (ligne 75)
- **Géométries** : MultiPolygon multi-paliers (anneaux isochrones PostGIS)
- **Source code** : state `battleFeatures` rempli après calcul `get_isochrone_battle`
- **Activation** : après user a lancé une bataille isochrone via le chat ou FilterPanel
- **Complexité** : **Moyen** — features ont structure connue, à filtrer et unifier
- **Proposition branchement** :
  - `id: 'map-battle-isochrones'`
  - `sourceType: 'isochrone_battle'`
  - `label: ex. "Battle 20min restaurants (Lyon)"` — depuis metadata battle
  - `getGeometry: () => battleFeatures.map(f => f.geometry)`
  - `enabled: battleFeatures.length > 0`
  - `metadata: { category, duration_minutes, n_pois }`
- **Note** : ne pas toucher à `app/api/isochrone-battle/route.ts` ni aux fonctions PostGIS `battle_*` (fichiers interdits CLAUDE.md). Juste lire le state côté client.

### 5. Clusters POI

- **Route** : `/map`
- **Fichier** : `app/map/page.tsx` + `ClusterPanel.tsx`
- **Géométries** : MultiPolygon des clusters K-means (la forme spatiale de chaque cluster)
- **Source code** : `clusterGeoJSON: ClusterGeoJSON | null` (ligne 81) + `clustersVisible: boolean`
- **Activation** : `clustersVisible === true && clusterGeoJSON !== null`
- **Complexité** : **Moyen** — structure des features à vérifier, probablement 1 feature = 1 cluster
- **Proposition branchement** :
  - `id: 'map-clusters'`
  - `sourceType: 'poi_clusters'`
  - `label: ex. "Clusters POI (5 groupes, durée 60min)"`
  - `getGeometry: () => clusterGeoJSON.features.map(f => f.geometry)`
  - `enabled: clustersVisible && !!clusterGeoJSON`
  - `metadata: { cluster_count, model_version, duration }`

### 6. Wizard clustering highlight

- **Géométries** : Preview des POIs pendant config du clustering — Points, pas une zone.
- **Recommandation** : **exclure** — éphémère, pas exploitable comme zone sauvegardable.

### 7. TMJA — flux routier

- **Géométries** : LineString (axes routiers)
- **Problème** : le système Custom Geo requiert `Polygon/MultiPolygon` (cf. `create_custom_geo_zone` + fallback `ST_Multi(ST_Buffer(v_result, 0))` dans la RPC transform). Une LineString bufferisée donnerait un polygone mais de peu d'intérêt pour l'usage géomarketing.
- **Recommandation** : **exclure V1**. À reconsidérer si besoin métier spécifique émerge.

### 8. Radio — émetteurs (points)

- **Géométries** : Points (émetteurs ANFR)
- Même souci que #2/#3 : semis de points, pas une zone naturelle.
- **Recommandation** : **exclure V1** sauf transformation `convex_hull`/`envelope`.

### 9. Radio — coverage buffers

- **Route** : `/map`
- **Fichier** : `app/map/page.tsx` + composants radio
- **Géométries** : Polygones buffers de couverture calculés pour chaque émetteur visible (présumé — à valider dans la V2)
- **Source code** : state `radioGeoJSON: GeoJSON.FeatureCollection | null` (ligne 93), `radioCoverageMode: boolean` (ligne 92)
- **Activation** : `radioCoverageMode === true && radioGeoJSON !== null`
- **Complexité** : **Moyen** — il faut confirmer que `radioGeoJSON` en mode coverage contient bien des polygones buffer (et non des points)
- **Proposition branchement** :
  - `id: 'map-radio-coverage'`
  - `sourceType: 'radio_coverage'`
  - `label: radioSelectedNom ? 'Couverture Radio ${radioSelectedNom}' : 'Couverture Radio (visible)'`
  - `getGeometry: () => radioGeoJSON.features.filter(f => polygon).map(f => f.geometry)`
  - `enabled: radioCoverageMode && !!radioGeoJSON`
  - `metadata: { systeme_filter, station_id, station_name }`

### 10. Digital DSP (choroplèthe mini)

- **Route** : `/map` (différent du triple map `/analyse/digital`)
- **Fichier** : `app/map/page.tsx` lignes 103-113
- **Géométries** : Polygones (choroplèthe région/dept/CP pour une campagne DSP choisie)
- **Source code** : `digitalVisible` + `digitalCampaignId` + `digitalScale`. Le GeoJSON est fetché mais stocké dans un ref/hook Map — à vérifier pour extraction.
- **Activation** : `digitalVisible === true && digitalCampaignId !== ''`
- **Complexité** : Moyen — le GeoJSON des features est dans les sources MapLibre, pas directement dans un state React exporté. Nécessite soit refactor pour exposer, soit re-fetch léger au moment de la capture.
- **Proposition branchement** : **reporter V2** — complexité de l'extraction > valeur. L'user peut aller sur `/map/analyse/digital` qui a déjà un flow capture potentiel (voir #13).

### 11. Corrélation résidus

- **Géométries** : tuiles vectorielles MVT IRIS avec feature-state coloré par résidu. La géométrie réelle est côté PMTiles/MVT, pas dans le state React.
- **Source code** : `residualsMeta` (métadonnées) + `residualLookupRef` (map de résidus par code_iris)
- **Activation** : `residualsMeta !== null`
- **Complexité** : **Complexe** — extraction nécessiterait de collecter les codes IRIS affichés + fetch geometry via `/api/iris/geojson?codes=...`. Coût I/O Nano à surveiller.
- **Recommandation** : **reporter V2**. À faire en même temps que l'IRIS selection multi-item (#12).

### 12. IRIS sélectionné (clic unique)

- **Route** : `/map`
- **Fichier** : `app/map/page.tsx` lignes 139-142
- **Géométries** : Polygone de l'IRIS cliqué
- **Source code** : `selectedIrisCode: string | null` + `selectedIrisData: IrisDetailData | null`. La géométrie n'est probablement pas dans `selectedIrisData` (c'est le panneau de détail, données socio-démo).
- **Complexité** : Trivial **si la géométrie est fetchée** — sinon petit fetch à `/api/iris/geojson?codes=<code>` à la capture
- **Proposition branchement** :
  - `id: 'map-iris-selection'`
  - `sourceType: 'iris_selection'`
  - `label: 'IRIS ${selectedIrisCode}'`
  - `getGeometry: () => fetch + cache geometry du code IRIS`
  - `enabled: selectedIrisCode !== null`
  - `metadata: { code_iris, code_commune, libelle }`
- **Limitation V1** : 1 seul IRIS à la fois (pas de sélection multi). Pour multi-IRIS, il faudra d'abord créer un "target builder" (hors scope Étape 6).

### 13. Analyse digital — zone active

- **Route** : `/map/analyse/digital`
- **Fichier** : `app/map/analyse/digital/page.tsx`
- **Géométries** : dépend de `scale` :
  - `region/departement/cp` : FeatureCollection entière (pas vraiment "une zone à capturer", l'user voit une choroplèthe France entière)
  - `zones` (geography_sets) : polygones des zones actives
  - `custom_zone` : polygone de la zone custom sélectionnée (Étape 3)
- **Source code** : state `geojson` du hook `useDigitalData()`
- **Activation** : `campaignId && geojson?.features.length > 0`
- **Complexité** : **Moyen** — le payload peut être lourd (6k CP), il faudra décider si on capture la choroplèthe entière ou seulement les top-N par impressions
- **Proposition branchement** :
  - `id: 'digital-active-view'`
  - `sourceType: 'digital_analysis'`
  - `label: 'Analyse ${scale} — ${campaignName}'`
  - `getGeometry: () => geojson.features.map(f => f.geometry)`
  - `enabled: !!campaignId && !!geojson && geojson.features.length > 0`
  - `metadata: { campaign_id, scale, set_id, custom_zone_id, metric }`
- **Commentaire** : déjà intégré avec Custom Geo dans le flow consommation (Étape 3) mais pas en **contributeur de capture**. Ajout mineur.

---

## Cas particuliers

### Dessin libre (draw polygon)
**Aucune lib de dessin libre installée** (`mapbox-gl-draw`, `maplibre-gl-draw`, `terra-draw` absents du `package.json` visible via imports). Le dessin libre n'existe pas actuellement dans l'app.

**Recommandation** : **hors scope Étape 6**. À traiter comme une Étape indépendante (nouvelle feature "dessin libre" à ajouter sur `/map` + branchement Custom Geo immédiat).

### Sélection multi-item
Aucun target builder / sélection multi-IRIS / sélection multi-panneaux détecté. Les sélections actuelles sont **single-item** (`selectedIrisCode: string | null`, `selectedBillboard: SelectedBillboard | null`).

**Recommandation** : à créer comme feature à part avant de pouvoir en faire un contributeur Custom Geo.

### Filtres administratifs
Traité dans #1 via `zoneData`. L'extraction de la vraie géométrie admin (pas juste la bbox) peut nécessiter un fetch dédié à `france_borders` ou `iris.geom` filtrés par code commune/dept.

### Battles isochrones legacy (`geography_sets`)
Déjà branchés **en consommation** dans `/map/analyse/digital` via l'Étape 3 (scale `'zones'`). Pas un contributeur de capture pertinent sur `/map` — l'user ne "voit" pas un geography_set depuis `/map`, il vient du copilote.

---

## Synthèse et recommandation d'ordre

### Priorité 1 — Branchement direct (valeur haute, effort faible)
Valeur démo forte + complexité faible :
1. **Battle isochrones** (#4) — state simple, géométrie déjà prête, cas d'usage très concret
2. **Clusters POI** (#5) — state simple, géométries propres
3. **Radio coverage** (#9) — sous réserve de valider que `radioGeoJSON` contient bien des polygones en mode coverage
4. **IRIS sélectionné** (#12) — avec fetch léger de la géométrie au besoin

### Priorité 2 — Brancher avec un petit refactor
5. **Zone territoriale filtrée** (#1) — nécessite de produire un polygone depuis `zoneData` (bbox → polygon ou fetch admin)
6. **Analyse digital — zone active** (#13) — ajout simple dans `/map/analyse/digital/page.tsx`

### Priorité 3 — V2 ou hors scope
- Digital DSP mini (#10) — refactor pour exposer le GeoJSON
- Corrélation résidus (#11) — complexe MVT
- TMJA (#7) — LineString pas adapté
- POIs/panneaux/émetteurs radio (points) (#2/#3/#8) — sémantiquement peu pertinent comme "zone"

### Hors scope Étape 6
- Dessin libre — lib à installer, feature à créer
- Sélection multi-item — feature à créer

---

## Ordre de branchement recommandé (Étape 6b)

1. **#4 Battle isochrones** (le plus visible, état déjà propre) — *pilote*
2. **#5 Clusters POI** (pattern similaire) — valide la généricité
3. **#9 Radio coverage** (valider la nature de `radioGeoJSON` en coverage mode avant)
4. **#13 Analyse digital zone active** (extension Étape 3) — 3-5 lignes
5. **#12 IRIS sélectionné** (fetch géométrie au besoin)
6. **#1 Zone territoriale** (refactor léger FilterPanel pour exposer la géométrie)

Chaque branchement = 3-10 lignes de code conformément à la promesse Étape 5.

---

## Points à valider avec l'utilisateur avant Étape 6b

1. **Radio coverage** : le state `radioGeoJSON` en mode `radioCoverageMode=true` contient-il bien des polygones buffer (ou juste des points avec rendu circle-stroke) ? Déterminera la faisabilité de #9.
2. **Zone territoriale (#1)** : préférence entre bbox-polygon (rapide, approximatif) vs. fetch frontière admin réelle (plus lourd, plus précis) ?
3. **POIs/panneaux/émetteurs (#2/#3/#8)** : confirmer qu'on les EXCLUT V1 (sémantique zone ≠ semis de points)
4. **Analyse digital en mode `region/departement/cp`** : capturer toute la choroplèthe ou limiter aux top-N par impressions ? Sinon risque de sauvegarder "la France entière" comme zone.
