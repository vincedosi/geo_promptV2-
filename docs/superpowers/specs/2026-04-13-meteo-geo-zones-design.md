# Design — Zones Météo dynamiques (Open-Meteo) dans VUE géo

**Date** : 2026-04-13
**Branche** : `feat/meteo-geo-digital`
**Page cible** : `app/map/analyse/digital/`

---

## 1. Contexte et objectif

La page d'analyse digitale (`/map/analyse/digital`) permet de croiser une campagne DSP avec des découpages géographiques : régions, départements, codes postaux, ou zones personnalisées (jeux de géographies importés).

**Objectif** : ajouter une 5ème option dans le sélecteur "Zones personnalisées" du fil d'Ariane VUE géo : "🌤 Zones Météo". Ces zones sont des carrés d'une grille dynamique générée à la volée depuis l'API publique Open-Meteo (gratuite, sans authentification), sur lesquels les données de la campagne DSP sont agrégées spatialement côté serveur.

**Cas d'usage** : "Quelles sont les impressions reçues dans les zones où il pleuvait ?" ou "Prévoir l'impact météo sur la diffusion des 7 prochains jours."

## 2. Principe directeur

La météo n'est **pas** un nouveau paradigme d'affichage. C'est un **jeu de zones virtuel** qui réutilise intégralement le pattern existant `scale='zones' + geographySetId=<uuid>`, en introduisant un **sentinel non-UUID** `geographySetId='meteo'` que le hook détecte pour router vers un endpoint dédié.

Conséquences directes :
- Les 3 cartes synchronisées (IMP / POP / RATIO) affichent les KPIs DSP agrégés par carré météo, **exactement** comme pour les autres zones custom.
- Le format de réponse de l'endpoint météo est **identique** à `/api/digital/[id]/geography/[setId]`.
- Le composant `SyncMap` n'est **pas modifié**.
- Les composants de breakdown, stats, CampaignContextBar fonctionnent sans modification.

## 3. Décisions de design (validées)

| # | Décision | Raison |
|---|---|---|
| D1 | Pas de timeline slider animé. Une période fixe `start → end`, météo agrégée sur toute la période, 1 valeur par carré. | Cohérence avec le pattern zones (photo figée). Sinon refonte complète du pipeline DSP. |
| D2 | Les 3 cartes affichent les KPIs DSP. Pas de 4ème carte "météo". La valeur météo est visible via popup hover + légende du panneau. | Zéro refonte layout. Cas d'usage principal = KPI DSP dans un contexte météo. |
| D3 | Bbox de génération = bbox des IRIS matchés à la campagne (pas France entière). Résolution 0.1° (~11 km) par défaut. | ~200 carrés max par requête, respecte contraintes I/O Supabase Nano. |
| D4 | Cache HTTP : `max-age=3600` pour l'historique, `max-age=900` pour les prévisions. Pas de cache DB. | Open-Meteo gratuit, historique figé, cache Next.js suffit. |
| D5 | Bouton "Appliquer" dans MeteoGeoPanel plutôt que auto-fetch debounced. | Un fetch météo ~= plusieurs secondes, auto-fetch serait frustrant. |
| D6 | Période max historique = 90 jours. Période max prévisions = 16 jours (limite Open-Meteo). Validation serveur, erreur 400 explicite sinon. | Évite timeouts et surcharge. |
| D7 | Pas d'animation Play/Pause. | Sans timeline slider, sans objet. |

## 4. Flow de données

```
User action                     State                           Network
──────────                      ─────                           ───────
VUE géo > Zones perso      →   scale='zones'                    /api/digital/[id]/meteo
→ click "🌤 Zones Météo"       geographySetId='meteo'           ?variable=precipitation
→ configure variable/dates     meteoParams={var,start,end,...}  &startDate=...&endDate=...
→ click "Appliquer"                                             &popField=&metric=
                                                                ↓
                                                        (serveur)
                                                        1. bbox IRIS campagne (SQL)
                                                        2. grille de carrés (Node)
                                                        3. Open-Meteo bulk call
                                                        4. agrégation horaire → 1 valeur/carré
                                                        5. RPC intersection spatiale IRIS × carrés
                                                                ↓
                                                        GeoJSON {
                                                          properties: {
                                                            square_id, weather_value,
                                                            weather_label, impressions,
                                                            pop_value, ratio
                                                          }
                                                        }
```

Le hook `use-digital-data.ts` détecte le sentinel `'meteo'` et ajoute les `meteoParams` à l'URL. Le reste du pipeline (affichage des 3 SyncMap, popup, stats) fonctionne sans modification.

## 5. Composants à créer / modifier

### 5.1. Backend

#### Types partagés
**`lib/meteo/types.ts`** (nouveau)
```typescript
export type MeteoVariable =
  | 'precipitation' | 'temperature_2m' | 'windspeed_10m' | 'sunshine_duration';
export type MeteoMode = 'forecast' | 'history';
export type MeteoAggregation = 'sum' | 'mean' | 'max';

export interface MeteoParams {
  variable: MeteoVariable;
  startDate: string;   // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD
  resolution?: number; // degrés, défaut 0.1
}

export interface MeteoSquare {
  squareId: string;              // 'lat_lon' rounded
  center: [number, number];      // [lon, lat]
  geometry: GeoJSON.Polygon;     // carré
  weatherValue: number;          // agrégée sur la période
}

export interface MeteoStats {
  min: number; max: number; mean: number;
  p20: number; p40: number; p60: number; p80: number;
  unit: string;
}
```

#### Client Open-Meteo
**`lib/meteo/open-meteo-client.ts`** (nouveau)
- 3 hosts selon plage de dates :
  - `api.open-meteo.com` pour prévisions (aujourd'hui → J+16)
  - `historical-forecast-api.open-meteo.com` pour historique récent (2022 → hier)
  - `archive-api.open-meteo.com` pour archive profonde (<2022)
- Si plage chevauche deux hosts → 2 appels parallèles, fusion côté Node
- Batching : max 500 points par requête (limite confortable)
- Endpoint : `/v1/forecast` (ou `/v1/archive`) avec `?latitude=X,Y,Z&longitude=A,B,C&hourly=<variable>&start_date=...&end_date=...&timezone=Europe/Paris`
- Retourne les séries horaires par point
- Try/catch → 502 si Open-Meteo down
- Pas de clé API (Open-Meteo est gratuit, sans auth)

#### Grille et carrés
**`lib/meteo/grid.ts`** (nouveau)
- `generateGrid(bbox, resolution)` → liste de `{lon, lat}` alignés sur une grille régulière
- `buildSquarePolygon({lon, lat}, resolution)` → polygon GeoJSON carré centré sur le point, côté = `resolution` degrés
- `computeSquareId({lon, lat})` → `"lon_lat"` arrondi, stable

#### Agrégation
**`lib/meteo/aggregation.ts`** (nouveau)
- `aggregatePeriod(hourlyValues, variable)` → 1 valeur par point
  - `precipitation` → SUM
  - `temperature_2m` → MEAN
  - `windspeed_10m` → MAX
  - `sunshine_duration` → SUM
- `computeStats(values)` → `{min, max, mean, p20, p40, p60, p80, unit}`
- `qualitativeLabel(value, stats, variable)` → label texte dérivé des percentiles (pas hardcodé)

#### Palettes
**`lib/meteo/palettes.ts`** (nouveau)
- 4 palettes (5 stops chacune) par `MeteoVariable`
- `buildColorExpression(variable, stats)` → expression MapLibre `['interpolate']` avec stops dérivés de `stats.min`/`stats.max`
- Utilisé côté client pour colorer les popups / légendes uniquement (pas les cartes principales qui affichent les KPIs DSP)

#### Route API principale
**`app/api/digital/[campaignId]/meteo/route.ts`** (nouveau, GET)
```
GET /api/digital/[campaignId]/meteo
  ?variable=precipitation
  &startDate=YYYY-MM-DD
  &endDate=YYYY-MM-DD
  &popField=population
  &metric=impressions
  &media=reg1,reg2   (optionnel)
```

**Étapes serveur** :
1. Validation Zod des params (dates bornées, variable dans enum, etc.)
2. `getSession()` (pas `getUser()`)
3. Lecture de la bbox de la campagne via SQL rapide :
   ```sql
   SELECT ST_Extent(i.geom)::text
   FROM dsp_campaign_data d
   JOIN iris i ON i.code_iris = d.code_iris
   WHERE d.campaign_id = $1
   ```
4. Génération de la grille via `grid.ts` : résolution par défaut 0.1°, si la bbox produit > 400 points → résolution doublée (0.2°, puis 0.4°, etc.) jusqu'à passer sous 400 points. La résolution effective est renvoyée dans `meta` pour information.
5. Appel Open-Meteo en bulk via `open-meteo-client.ts`
6. Agrégation horaire → 1 valeur par carré via `aggregation.ts`
7. Appel RPC `get_digital_meteo_aggregation(campaignId, squaresGeoJSON, popField, metric)` → enrichit chaque feature avec `impressions`, `pop_value`, `ratio`
8. Enrichissement côté Node : ajout de `weather_label` (qualitatif) et de `stats` dans la metadata
9. Réponse :
   ```json
   {
     "geojson": { "type": "FeatureCollection", "features": [...] },
     "summary": {
       "in_zone_impressions": 123456,
       "total_impressions": 456789,
       "pct_in_zone": 27.0,
       "total_zones": 182,
       "zones_with_impressions": 141
     },
     "meta": {
       "variable": "precipitation",
       "unit": "mm",
       "startDate": "2025-03-15",
       "endDate": "2025-03-22",
       "stats": { "min": 0, "max": 28.5, "mean": 4.2, "p20": 0.1, "p40": 1.2, "p60": 3.8, "p80": 12.1 }
     }
   }
   ```
10. Headers : `Cache-Control: public, max-age=3600` (historique) ou `max-age=900` (prévisions)

### 5.2. PostGIS (via MCP Supabase `apply_migration`)

#### RPC `get_digital_meteo_aggregation`
**Signature** :
```sql
get_digital_meteo_aggregation(
  p_campaign_id uuid,
  p_squares jsonb,           -- FeatureCollection des carrés avec weather_value en props
  p_pop_field text,
  p_metric text
) RETURNS jsonb                -- FeatureCollection enrichie
```

**Logique** :
1. CTE `squares` : parse le GeoJSON d'entrée via `jsonb_array_elements(p_squares->'features')`, extraction de `square_id` et `weather_value` depuis `properties`, géométrie via `ST_SetSRID(ST_GeomFromGeoJSON(feature->'geometry'), 4326)`
2. `ST_MakeValid` sur chaque carré (prévention auto-intersections ; même si la grille est propre par construction, on reste défensif)
3. CTE `campaign_iris` : récupère uniquement les IRIS matchés à la campagne via `JOIN dsp_campaign_data ON ...`, avec `ST_MakeValid(iris.geom)` (certains IRIS INSEE ont des auto-intersections)
4. Pré-filtre bbox : `squares.geom && campaign_iris.geom` (opérateur bbox, très rapide avec index GIST existant sur `iris.geom`) avant le `ST_Intersects` complet
5. Jointure `ST_Intersects(squares.geom, campaign_iris.geom_valid)` — s'appuie sur l'index GIST de `iris`
6. Pour chaque intersection, poids proportionnel :
   `weight = ST_Area(ST_Intersection(squares.geom, campaign_iris.geom_valid)) / NULLIF(ST_Area(campaign_iris.geom_valid), 0)`
7. Agrégation par `square_id` :
   - `impressions = SUM(iris_impressions * weight)`
   - `pop_value = SUM(iris_pop_value * weight)`
   - `ratio = CASE WHEN SUM(pop_value * weight) > 0 THEN (impressions / pop_value) * 1000 ELSE 0 END`
8. Construction du GeoJSON de retour via `jsonb_build_object` + `jsonb_agg`
9. **Obligatoire** : `EXPLAIN ANALYZE` en dev avant merge. Objectif < 500ms pour 200 carrés × IRIS d'une campagne moyenne. Si dépassement, matérialiser le CTE `campaign_iris` ou ajouter un `LIMIT` sur la pré-sélection.

**Indexes requis** :
- GIST existant sur `iris.geom` (à vérifier avant d'implémenter le RPC). Si absent, migration préalable pour le créer.
- Pas d'index sur les carrés : dataset temporaire ~200 lignes, le scan séquentiel est trivial. L'index GIST côté IRIS suffit pour accélérer la jointure.

### 5.3. Frontend

#### Hook étendu
**`app/map/analyse/digital/_lib/use-digital-data.ts`** (modifié)
- Signature de `fetchMap` étendue : ajout d'un paramètre `meteoParams?: MeteoParams`
- Détection du sentinel : `if (scale === 'zones' && geographySetId === 'meteo' && meteoParams)` → URL = `/api/digital/${campaignId}/meteo?...`
- Le reste du switch inchangé

#### Page
**`app/map/analyse/digital/page.tsx`** (modifié)
- Nouveau state `const [meteoParams, setMeteoParams] = useState<MeteoParams | null>(null)`
- Dans `handleScaleChange` / `handleGeographySetChange` : si la sélection = sentinel `'meteo'`, monter le composant `MeteoGeoPanel`
- Callback `onMeteoApply(params)` : `setMeteoParams(params)` puis `fetchMap(...)` avec les params
- Pas de fetch auto — uniquement sur click "Appliquer"

#### RailroadPipeline
**`app/map/analyse/digital/_components/RailroadPipeline.tsx`** (modifié, lignes ~263-285)
- Dans la section "JEU DE ZONES" affichée quand `scale === 'zones'` :
  - Injection en **tête de liste** d'une entrée virtuelle `{ id: 'meteo', name: '🌤 Zones Météo (Open-Meteo)', nb_zones: null }`
  - Click sur cette entrée → `onGeographySetChange('meteo')`
  - Si `geographySetId === 'meteo'` → afficher badge "dynamique" au lieu du nombre de zones

#### MeteoGeoPanel (nouveau)
**`app/map/analyse/digital/_components/MeteoGeoPanel.tsx`**
- Monté par `page.tsx` en dessous du RailroadPipeline quand `geographySetId === 'meteo'`
- Sections :
  1. **Variable** (pill buttons, 1 seule active) : ☁ Précipitations / 🌡 Température / 💨 Vent / ☀ Ensoleillement
  2. **Mode** (radio) : ◉ Prévisions (→ J+16) / ○ Historique (← passé)
  3. **Raccourcis temporels** :
     - Mode prévisions : `[Aujourd'hui] [3 jours] [7 jours] [14 jours]`
     - Mode historique : `[Hier] [7 derniers jours] [30 derniers jours] [Ce mois] [Mois dernier]`
  4. **Date pickers** (du / au) — inputs date natifs ou composant existant du projet
  5. **Bouton "Appliquer"** — déclenche le fetch via `onMeteoApply(meteoParams)`
  6. **Légende** (affichée après fetch) : barre de gradient avec min/max dynamiques de la variable
- Style : dark theme MAGELIAN, `#111111` fond, teal `#4ecdc4` accent, Inter/JetBrains Mono, sentence case, pas de gradients
- Bornage dates côté client :
  - Prévisions : max `today + 16 jours`
  - Historique : max `today - 1 jour`, plage max 90 jours
- Erreurs de validation affichées inline en dessous du bouton

#### Popup hover enrichi
Le popup existant de `SyncMap.tsx` affiche déjà `nom`, `impressions`, `pop_value`, `ratio`. Il faut l'étendre pour afficher aussi, si présents dans les properties, `weather_value`, `weather_label`, `unit`. Modification conditionnelle : `if (properties.weather_value !== undefined) { ... }`. Aucune modification si les propriétés absentes — les autres zones custom continuent de fonctionner.

## 6. Formats de données

### 6.1. Request → `/api/digital/[campaignId]/meteo`
```
variable:    'precipitation' | 'temperature_2m' | 'windspeed_10m' | 'sunshine_duration'
startDate:   YYYY-MM-DD
endDate:     YYYY-MM-DD
popField:    string (whitelist Zod identique à /map)
metric:      'impressions' | 'unique'
media:       string (optionnel, CSV de régies)
resolution:  number (optionnel, défaut 0.1)
```

### 6.2. Response (200)
```json
{
  "geojson": { "type": "FeatureCollection", "features": [...] },
  "summary": { "in_zone_impressions": ..., "total_impressions": ..., "pct_in_zone": ..., "total_zones": ..., "zones_with_impressions": ... },
  "meta": {
    "variable": "precipitation",
    "unit": "mm",
    "startDate": "2025-03-15",
    "endDate": "2025-03-22",
    "stats": { "min": 0, "max": 28.5, "mean": 4.2, "p20": 0.1, "p40": 1.2, "p60": 3.8, "p80": 12.1 }
  }
}
```

### 6.3. Response errors
- `400` : params invalides, plage hors bornes, dates incohérentes → `{ error: "...", details: {...} }`
- `404` : campagne introuvable
- `502` : Open-Meteo indisponible → `{ error: "Weather API unavailable" }`

## 7. Contraintes et garde-fous

- **Supabase Nano I/O** : le RPC ne doit PAS faire de full-scan sur `iris`. Filtrer d'abord les IRIS matchés à la campagne (JOIN sur `dsp_campaign_data`), puis intersect avec les carrés. À vérifier avec `EXPLAIN ANALYZE`.
- **Middleware auth** : `getSession()` **pas** `getUser()` sur la route API (incident 2026-03-28).
- **adminFetch vs fetch** : utiliser `fetch()` sur cette page (les endpoints `/api/digital/*` sont déjà en `fetch` standard).
- **TypeScript strict** : `catch (e: unknown)`, pas de `any`.
- **Pas de hardcode** : palettes, seuils qualitatifs, bbox, résolution → tout dérivé des réponses API ou des inputs utilisateur.
- **Pas de table Supabase météo** : tout est temps réel. Les zones météo ne sont pas persistées dans `geography_sets`.
- **Fichiers protégés** : ne pas toucher `isochrone-battle`, le middleware auth, les fonctions PostGIS battle.

## 8. Tests de vérification (post-impl)

1. Sélection "🌤 Zones Météo" → MeteoGeoPanel s'affiche avec valeurs par défaut (prévisions, aujourd'hui → J+7, pluie).
2. Click "Appliquer" → les 3 cartes affichent des KPIs DSP agrégés par carré.
3. Popup hover un carré → affiche impressions + pop + ratio + valeur météo + label qualitatif.
4. Changement variable (pluie → température) → nouveau fetch au click "Appliquer", stats updated.
5. Mode historique 30 jours → mêmes comportements, host Open-Meteo historique utilisé.
6. Date > J+16 en prévisions → erreur 400 claire, bouton Appliquer désactivé si invalide.
7. Sortie de "Zones Météo" vers "Zones personnalisées" ou vers "Régions" → état cohérent, pas de crash, pas de fuite de layers.
8. Retour sur "Zones Météo" → MeteoGeoPanel re-monté, dernière config préservée dans le state de page.
9. Périodes > 90 jours historique → 400 clair.
10. Console F12 : aucune erreur, aucun warning MapLibre.
11. `npx tsc --noEmit` pass, `npm run lint` pass.

## 9. Commits prévus

Atomiques, format `type: description` :
```
feat(meteo): add Open-Meteo client with multi-host routing
feat(meteo): add grid generation and square polygon builder
feat(meteo): add period aggregation and qualitative labels
feat(meteo): add /api/digital/[id]/meteo route with validation
feat(meteo): add get_digital_meteo_aggregation RPC
feat(meteo): extend useDigitalData hook with meteo sentinel
feat(meteo): add MeteoGeoPanel UI component
feat(meteo): inject meteo entry in RailroadPipeline zones list
feat(meteo): enrich SyncMap hover popup with weather properties
```

## 10. Fichiers créés / modifiés (récap)

**Créés (backend + lib)** :
- `lib/meteo/types.ts`
- `lib/meteo/open-meteo-client.ts`
- `lib/meteo/grid.ts`
- `lib/meteo/aggregation.ts`
- `lib/meteo/palettes.ts`
- `app/api/digital/[campaignId]/meteo/route.ts`

**Créés (frontend)** :
- `app/map/analyse/digital/_components/MeteoGeoPanel.tsx`

**Modifiés** :
- `app/map/analyse/digital/_lib/use-digital-data.ts`
- `app/map/analyse/digital/page.tsx`
- `app/map/analyse/digital/_components/RailroadPipeline.tsx`
- `app/map/analyse/digital/_components/SyncMap.tsx` (popup hover uniquement)

**Migration SQL (via MCP)** :
- `get_digital_meteo_aggregation` RPC

**Non modifiés** (garantie) :
- `middleware.ts`
- `app/api/isochrone-battle/**`
- Toute fonction PostGIS `*battle*`
- Structure de `scale`, autres valeurs d'enum inchangées (`region`/`departement`/`cp`/`zones` préservées)

---

**Terminal state** : une fois ce spec validé, on passe à `writing-plans` pour générer un plan d'implémentation détaillé étape par étape.
