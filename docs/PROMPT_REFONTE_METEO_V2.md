# REFONTE MODULE GÉO MÉTÉO — Zones admin + barre progression + chargement rapide

## CONTEXTE

Le module Géo Météo existe sur la branche `feat/meteo-geo-digital`. Il fonctionne mais a 3 problèmes majeurs :
1. **Grille de carrés moche** — des rectangles uniformes mal alignés sur la France, pas exploitables visuellement
2. **Chargement trop lent** — quota Open-Meteo explosé, timeouts, le loader "750/3825 points" n'aboutit pas
3. **Pas de barre de progression** — l'utilisateur ne sait pas ce qui se passe pendant le chargement

## CHANGEMENT D'APPROCHE — PLUS DE GRILLE

**AVANT (cassé) :** on génère une grille de carrés uniformes sur la France (1600+ points), on appelle Open-Meteo avec tous ces points → quota explosé, carrés moches, clip France approximatif.

**APRÈS (nouveau) :** on requête **1 point par zone admin existante** (centroïde du département, CP, ou région). La carte Météo (3ème carte) affiche les **mêmes polygones** que les cartes Ratio/Impressions mais colorés par la valeur météo.

Résultat : plus de grille, plus de clip, plus de problème de quota. Les zones météo ont exactement la même forme que les zones admin. Lecture croisée immédiate.

---

## SKILLS OBLIGATOIRES — LIRE AVANT TOUT CODE

```
@systematic-debugging @smart-explore @executing-plans
```

Lis aussi `CLAUDE.md` et le spec existant `docs/superpowers/specs/2026-04-13-meteo-geo-zones-design.md`.

---

## ⛔ FICHIERS INTERDITS

```
app/api/isochrone-battle/route.ts
app/api/isochrone-battle/apply-battle/route.ts
Toute fonction PostGIS contenant "battle" ou "isochrone_battle"
app/api/tiles/[z]/[x]/[y]/route.ts
Migration 043
```

## ⛔ RÈGLES ABSOLUES

- TypeScript strict — jamais de `any`, toujours `catch (e: unknown)`
- Dark theme GEOMATIK : `#111111` fond, teal `#4ecdc4` accent
- Inline styles (pas Tailwind) — cohérent avec le reste de la page analyse/digital
- `fetch()` standard pour les endpoints digital (pas `adminFetch`)
- Rien n'est hardcodé — palettes, seuils, labels qualitatifs sont dérivés des stats du dataset

---

## PHASE 0 — AUDIT DU CODE EXISTANT

```bash
# 1. Quels fichiers météo existent déjà ?
find app/ lib/ -path "*meteo*" -o -path "*Meteo*" | head -30

# 2. La route API actuelle
cat app/api/meteo-geo/route.ts

# 3. Le hook actuel
cat app/map/analyse/digital/_hooks/useMeteoGeo.ts 2>/dev/null || \
  grep -rn "meteo\|Meteo" app/map/analyse/digital/ --include="*.ts" --include="*.tsx" | head -20

# 4. Le composant panneau actuel
cat app/map/analyse/digital/_components/MeteoGeoPanel.tsx

# 5. Comment la 3ème carte (Météo) est rendue
grep -rn "meteo\|Meteo\|météo" app/map/analyse/digital/_components/SyncMap.tsx | head -20

# 6. Les tables de référence géo — centroïdes disponibles ?
# Via Supabase MCP :
# SELECT column_name FROM information_schema.columns WHERE table_name = 'ref_departements' AND column_name LIKE '%centr%' OR column_name LIKE '%lat%' OR column_name LIKE '%lon%';
# SELECT column_name FROM information_schema.columns WHERE table_name = 'ref_codes_postaux' AND column_name LIKE '%centr%' OR column_name LIKE '%lat%' OR column_name LIKE '%lon%';
# SELECT column_name FROM information_schema.columns WHERE table_name = 'ref_regions' AND column_name LIKE '%centr%' OR column_name LIKE '%lat%' OR column_name LIKE '%lon%';

# 7. Si pas de centroïdes, vérifier si on peut les calculer
# SELECT code, nom, ST_Y(ST_Centroid(geom)) as lat, ST_X(ST_Centroid(geom)) as lon FROM ref_departements LIMIT 3;

# 8. Le RPC filter_points_in_france — existe encore ?
# SELECT proname FROM pg_proc WHERE proname LIKE '%france%' OR proname LIKE '%meteo%';
```

**RÉSUME ce que tu trouves AVANT de modifier quoi que ce soit.**

---

## PHASE 1 — CENTROÏDES DES ZONES ADMIN

### 1A. Ajouter les centroïdes aux tables de référence (si absents)

```sql
-- ref_departements
ALTER TABLE ref_departements ADD COLUMN IF NOT EXISTS centroid_lat double precision;
ALTER TABLE ref_departements ADD COLUMN IF NOT EXISTS centroid_lon double precision;
UPDATE ref_departements SET 
  centroid_lat = ST_Y(ST_Centroid(geom)),
  centroid_lon = ST_X(ST_Centroid(geom))
WHERE centroid_lat IS NULL;

-- ref_codes_postaux
ALTER TABLE ref_codes_postaux ADD COLUMN IF NOT EXISTS centroid_lat double precision;
ALTER TABLE ref_codes_postaux ADD COLUMN IF NOT EXISTS centroid_lon double precision;
UPDATE ref_codes_postaux SET 
  centroid_lat = ST_Y(ST_Centroid(geom)),
  centroid_lon = ST_X(ST_Centroid(geom))
WHERE centroid_lat IS NULL;

-- ref_regions
ALTER TABLE ref_regions ADD COLUMN IF NOT EXISTS centroid_lat double precision;
ALTER TABLE ref_regions ADD COLUMN IF NOT EXISTS centroid_lon double precision;
UPDATE ref_regions SET 
  centroid_lat = ST_Y(ST_Centroid(geom)),
  centroid_lon = ST_X(ST_Centroid(geom))
WHERE centroid_lat IS NULL;
```

Appliquer via `apply_migration` MCP. Vérifier avec un SELECT après.

### 1B. RPC pour récupérer les centroïdes

Créer une RPC `get_zone_centroids(scale text)` :

```sql
CREATE OR REPLACE FUNCTION get_zone_centroids(p_scale text)
RETURNS TABLE(code text, lat double precision, lon double precision)
LANGUAGE sql STABLE AS $$
  SELECT 
    CASE p_scale
      WHEN 'region' THEN code::text
      WHEN 'departement' THEN code::text
      WHEN 'cp' THEN code_postal::text
    END,
    centroid_lat,
    centroid_lon
  FROM 
    CASE p_scale
      WHEN 'region' THEN ref_regions
      WHEN 'departement' THEN ref_departements
      WHEN 'cp' THEN ref_codes_postaux
    END;
$$;
```

**Note :** si le CASE sur le FROM ne fonctionne pas en SQL, utilise 3 branches IF/ELSIF en plpgsql.

---

## PHASE 2 — REFONTE `/api/meteo-geo/route.ts`

### Nouveau contrat API

```
GET /api/meteo-geo?scale=departement&variable=precipitation&startDate=2026-04-07&endDate=2026-04-14
```

### Nouveau flow

```
1. Recevoir scale, variable, startDate, endDate
2. Appeler RPC get_zone_centroids(scale) → liste de {code, lat, lon}
3. Vérifier cache filesystem :
   - hash = md5(scale + variable + startDate + endDate)
   - chemin = /tmp/meteo-cache/{hash}.json
   - Si existe et pas expiré → retourner directement
4. Appeler Open-Meteo en batchs de 1000 coordonnées :
   - Régions : 13 points → 1 appel
   - Départements : 96 points → 1 appel
   - CP : ~6200 points → 7 appels séquentiels (1s entre chaque pour respecter quota)
5. Pour chaque batch, construire l'URL :
   GET https://api.open-meteo.com/v1/forecast
     ?latitude=48.1,48.2,...  (CSV)
     &longitude=2.3,2.4,...   (CSV)
     &daily=precipitation_sum (ou temperature_2m_mean, wind_speed_10m_max, sunshine_duration)
     &start_date=2026-04-07
     &end_date=2026-04-14
     &timezone=Europe/Paris
6. Agréger les valeurs daily sur la période :
   - precipitation : SUM (total pluie sur la période)
   - temperature_2m : MEAN (moyenne sur la période)
   - wind_speed_10m : MAX (vent max sur la période)
   - sunshine_duration : SUM (total heures soleil)
7. Construire le mapping : { [code_zone]: { value: number, unit: string } }
8. Écrire en cache filesystem
9. Retourner :
   {
     "data": { "75": { "value": 12.5, "unit": "mm" }, "59": { "value": 38.2, "unit": "mm" }, ... },
     "metadata": {
       "variable": "precipitation",
       "unit": "mm",
       "startDate": "2026-04-07",
       "endDate": "2026-04-14",
       "scale": "departement",
       "stats": { "min": 0.0, "max": 38.2, "mean": 8.7 },
       "totalZones": 96,
       "batchesTotal": 1,
       "cachedAt": null
     }
   }
```

### Variables Open-Meteo

| Variable UI | Paramètre daily Open-Meteo | Agrégation période | Unité |
|------------|---------------------------|-------------------|-------|
| Précipitations | `precipitation_sum` | SUM | mm |
| Température | `temperature_2m_mean` | MEAN | °C |
| Vent | `wind_speed_10m_max` | MAX | km/h |
| Ensoleillement | `sunshine_duration` | SUM | heures (diviser par 3600, Open-Meteo retourne en secondes) |

### Mode historique vs prévisions

```typescript
function getOpenMeteoHost(startDate: string, endDate: string): string {
  const today = new Date().toISOString().split('T')[0];
  if (endDate > today) return 'https://api.open-meteo.com'; // forecast
  if (startDate >= '2022-01-01') return 'https://historical-forecast-api.open-meteo.com'; // recent
  return 'https://archive-api.open-meteo.com'; // archive
}
```

### Cache filesystem

```typescript
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';

const CACHE_DIR = '/tmp/meteo-cache';
const CACHE_TTL_HISTORY = 24 * 60 * 60 * 1000; // 24h
const CACHE_TTL_FORECAST = 60 * 60 * 1000;     // 1h

function getCacheKey(scale: string, variable: string, startDate: string, endDate: string): string {
  return createHash('md5').update(`${scale}-${variable}-${startDate}-${endDate}`).digest('hex');
}
```

### Streaming de progression (SSE)

**NON.** On ne fait pas de SSE pour la météo. La route retourne un JSON classique. La progression est gérée côté client via des appels successifs (voir Phase 4).

**MAIS** : pour les CP (7 batchs), la route doit supporter un query param `?batch=3` qui ne fetch que le batch N. Le client appelle séquentiellement batch 1, 2, 3... et met à jour la barre entre chaque appel. Comme ça le client sait où en est le chargement.

**Correction :** en fait non, c'est trop complexe. Fais plutôt un seul appel qui retourne tout, et la barre de progression est juste un loader indéterminé pour régions/départements (1 appel, <1s) ou un timer estimé pour les CP (7 appels, ~7s).

**APPROCHE FINALE pour la progression :**
- Régions / Départements (1 appel) : pas de barre, juste un spinner sur le bouton "Appliquer"
- Codes Postaux (7 appels) : barre de progression déterminée, mise à jour après chaque batch côté serveur. Utiliser un **fetch streaming** (ReadableStream) qui envoie des chunks de progression :

```
{"progress": 1, "total": 7, "status": "fetching"}
{"progress": 2, "total": 7, "status": "fetching"}
...
{"progress": 7, "total": 7, "status": "done", "data": {...}, "metadata": {...}}
```

Le client lit le stream ligne par ligne (NDJSON), met à jour la barre à chaque ligne, et traite les données quand il reçoit `status: "done"`.

---

## PHASE 3 — REFONTE DU HOOK `useMeteoGeo`

### State simplifié

```typescript
interface MeteoGeoState {
  variable: 'precipitation' | 'temperature_2m' | 'wind_speed_10m' | 'sunshine_duration';
  mode: 'forecast' | 'history';
  startDate: string;
  endDate: string;
  
  // Données
  data: Record<string, { value: number; unit: string }> | null; // code_zone → valeur météo
  metadata: MeteoMetadata | null;
  
  // Chargement
  loading: boolean;
  progress: { current: number; total: number } | null; // pour la barre
  error: string | null;
}
```

### Fetch avec streaming NDJSON

```typescript
async function fetchMeteoData(scale: string, variable: string, startDate: string, endDate: string) {
  setLoading(true);
  setProgress(null);
  setError(null);
  
  try {
    const res = await fetch(`/api/meteo-geo?scale=${scale}&variable=${variable}&startDate=${startDate}&endDate=${endDate}`);
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        
        if (chunk.status === 'fetching') {
          setProgress({ current: chunk.progress, total: chunk.total });
        } else if (chunk.status === 'done') {
          setData(chunk.data);
          setMetadata(chunk.metadata);
          setProgress(null);
        }
      }
    }
  } catch (e: unknown) {
    setError(e instanceof Error ? e.message : 'Erreur inconnue');
  } finally {
    setLoading(false);
  }
}
```

### Interaction avec la 3ème carte

Quand `data` change, le hook passe les valeurs météo au composant de la 3ème carte. La carte utilise les **mêmes polygones GeoJSON** que les cartes Ratio/Impressions, mais enrichit chaque feature avec la propriété météo :

```typescript
// Dans le code qui prépare les features de la 3ème carte :
features.forEach(f => {
  const code = f.properties.code; // code département, CP, ou région
  const meteo = data?.[code];
  f.properties.meteo_value = meteo?.value ?? null;
  f.properties.meteo_unit = meteo?.unit ?? '';
});
```

Le `fill-color` de la 3ème carte est piloté par `meteo_value` au lieu de `population`.

---

## PHASE 4 — BARRE DE PROGRESSION UI

### Composant `MeteoProgressBar`

Ajouter dans `MeteoGeoPanel.tsx`, entre le bouton "Appliquer" et les stats :

```tsx
{/* Barre de progression */}
{loading && (
  <div style={{ marginTop: 12 }}>
    {progress ? (
      // Barre déterminée (mode CP, plusieurs batchs)
      <>
        <div style={{
          height: 4,
          background: '#1a1a1a',
          borderRadius: 2,
          overflow: 'hidden',
          marginBottom: 6
        }}>
          <div style={{
            height: '100%',
            width: `${(progress.current / progress.total) * 100}%`,
            background: '#4ecdc4',
            borderRadius: 2,
            transition: 'width 0.3s ease'
          }} />
        </div>
        <div style={{
          fontSize: 11,
          color: '#888',
          textAlign: 'center'
        }}>
          Chargement météo… {progress.current}/{progress.total} requêtes
        </div>
      </>
    ) : (
      // Spinner indéterminé (mode régions/départements, 1 seul appel)
      <div style={{
        fontSize: 11,
        color: '#888',
        textAlign: 'center',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8
      }}>
        <div style={{
          width: 14,
          height: 14,
          border: '2px solid #333',
          borderTopColor: '#4ecdc4',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite'
        }} />
        Chargement météo…
      </div>
    )}
  </div>
)}
```

### Bouton "Appliquer" disabled pendant le chargement

```tsx
<button
  onClick={handleApply}
  disabled={loading}
  style={{
    width: '100%',
    padding: '10px 16px',
    background: loading ? '#1a3a38' : '#4ecdc4',
    color: loading ? '#666' : '#111',
    border: 'none',
    borderRadius: 6,
    fontWeight: 600,
    fontSize: 13,
    cursor: loading ? 'not-allowed' : 'pointer',
    transition: 'background 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  }}
>
  {loading && (
    <div style={{
      width: 14,
      height: 14,
      border: '2px solid #333',
      borderTopColor: '#4ecdc4',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite'
    }} />
  )}
  {loading ? 'Chargement…' : 'Appliquer'}
</button>
```

### CSS animation (ajouter une fois dans le composant ou dans un style global)

```tsx
// En haut du composant ou dans useEffect
const styleEl = document.createElement('style');
styleEl.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
if (!document.head.querySelector('[data-meteo-style]')) {
  styleEl.setAttribute('data-meteo-style', '');
  document.head.appendChild(styleEl);
}
```

---

## PHASE 5 — MODIFIER LA 3ÈME CARTE

### Dans `SyncMap.tsx` ou le composant qui rend la 3ème carte :

Quand le mode météo est actif (`scale === 'meteo'` ou un flag `meteoEnabled`), la 3ème carte :

1. **Titre** : change de "Population {indicateur}" à "Meteo {variable}" (ex: "Meteo Précipitations")
2. **Source GeoJSON** : utilise les **mêmes features** que les autres cartes (polygones départements/CP/régions) mais avec `meteo_value` comme propriété de couleur
3. **Palette** : différente par variable météo :
   ```typescript
   const METEO_PALETTES: Record<string, string[]> = {
     precipitation:     ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'], // blanc → bleu
     temperature_2m:    ['#2166ac', '#67a9cf', '#f7f7f7', '#ef8a62', '#b2182b'], // bleu → rouge (divergente)
     wind_speed_10m:    ['#f7fcf5', '#a1d99b', '#41ab5d', '#ef6548', '#b30000'], // vert → rouge
     sunshine_duration: ['#525252', '#969696', '#fdd49e', '#fdbb84', '#e6550d'], // gris → orange
   };
   ```
4. **Légende** : barre de gradient avec min/max dynamiques et unité
5. **Popup hover** : affiche la valeur météo + un label qualitatif

### Palette data-driven MapLibre

```typescript
function buildMeteoPaint(variable: string, stats: { min: number; max: number }): maplibregl.FillPaint {
  const palette = METEO_PALETTES[variable];
  const { min, max } = stats;
  const step = (max - min) / (palette.length - 1);
  
  return {
    'fill-color': [
      'case',
      ['==', ['get', 'meteo_value'], null], '#1a1a1a', // pas de donnée = gris foncé
      [
        'interpolate', ['linear'],
        ['get', 'meteo_value'],
        ...palette.flatMap((color, i) => [min + step * i, color])
      ]
    ],
    'fill-opacity': 0.85
  };
}
```

---

## PHASE 6 — POPUP HOVER ENRICHI

Au hover d'une zone sur la 3ème carte, le popup affiche :

```
┌────────────────────────────────────┐
│ Nord (59)                          │
│                                    │
│ ☁ Précipitations : 38.2 mm        │
│   Forte pluie                      │
│                                    │
│ Période : 7-14 avril 2026          │
└────────────────────────────────────┘
```

Labels qualitatifs (dérivés des percentiles du dataset, pas hardcodés) :

```typescript
function getQualitativeLabel(value: number, stats: { min: number; max: number }, variable: string): string {
  const pct = (value - stats.min) / (stats.max - stats.min); // 0 à 1
  
  const labels: Record<string, string[]> = {
    precipitation:     ['Sec', 'Faible pluie', 'Pluie modérée', 'Forte pluie', 'Très forte pluie'],
    temperature_2m:    ['Très froid', 'Froid', 'Frais', 'Doux', 'Chaud'],
    wind_speed_10m:    ['Calme', 'Brise légère', 'Vent modéré', 'Vent fort', 'Tempête'],
    sunshine_duration: ['Très couvert', 'Couvert', 'Éclaircies', 'Ensoleillé', 'Grand soleil'],
  };
  
  const idx = Math.min(Math.floor(pct * 5), 4);
  return labels[variable]?.[idx] ?? '';
}
```

---

## PHASE 7 — SUPPRIMER L'ANCIEN CODE GRILLE

Une fois que la nouvelle approche fonctionne :

1. Supprimer `lib/meteo/grid.ts` (génération de grille de carrés)
2. Supprimer la RPC `filter_points_in_france` (plus besoin de clip)
3. Supprimer le code de génération de carrés GeoJSON dans la route
4. Nettoyer le cache `/tmp/meteo-cache/` des anciens fichiers grille
5. Supprimer les références au `MAX_POINTS`, `DEFAULT_RESOLUTION`, `adaptiveResolution`

---

## VÉRIFICATION POST-FIX (`@verification-before-completion`)

### Tests obligatoires

1. **Mode Départements + Précipitations + 7 jours** → carte Météo affiche les 96 départements colorés en bleu, chargement <2s, pas de barre de progression (1 seul appel)
2. **Mode Régions + Température + Aujourd'hui** → 13 régions colorées, <1s
3. **Mode CP + Vent + 14 jours** → barre de progression visible "Chargement météo… 3/7 requêtes", carrés CP colorés, chargement <10s
4. **Switcher variable** (pluie → température → vent → soleil) → palette change, légende se met à jour, pas de crash
5. **Mode Historique + 30 derniers jours** → données chargées correctement
6. **Mode Prévisions + 14 jours** → données prévisions correctement
7. **Hover une zone** → popup avec nom, valeur, unité, label qualitatif
8. **Les cartes Ratio et Impressions** sont INCHANGÉES — elles ne montrent PAS de données météo
9. **Revenir en mode non-météo** (cliquer "Zones Météo" off ou changer de VUE GEO) → la 3ème carte redevient "Population"
10. **Bouton "Appliquer" disabled pendant le chargement** avec spinner
11. **Boutons raccourcis** ("Hier", "7 derniers jours", "30 derniers jours") → dates se mettent à jour ET fetch se déclenche
12. **Deuxième appel avec mêmes paramètres** → cache hit, chargement instantané
13. **Console F12** : aucune erreur, pas de warning

### Tests API (curl)

```bash
# Départements — 1 appel, rapide
curl -s "http://localhost:3000/api/meteo-geo?scale=departement&variable=precipitation&startDate=2026-04-07&endDate=2026-04-14" | head -c 500
# Attendu : JSON avec 96 entrées dans data, metadata.batchesTotal = 1

# Régions — instantané  
curl -s "http://localhost:3000/api/meteo-geo?scale=region&variable=temperature_2m&startDate=2026-04-15&endDate=2026-04-15" | head -c 500
# Attendu : 13 entrées

# CP — streaming NDJSON
curl -s "http://localhost:3000/api/meteo-geo?scale=cp&variable=wind_speed_10m&startDate=2026-04-07&endDate=2026-04-14"
# Attendu : 7 lignes de progression puis 1 ligne finale avec data

# Cache hit
curl -s "http://localhost:3000/api/meteo-geo?scale=departement&variable=precipitation&startDate=2026-04-07&endDate=2026-04-14" | head -c 500
# Attendu : réponse instantanée, metadata.cachedAt != null

# Erreur dates invalides
curl -s "http://localhost:3000/api/meteo-geo?scale=departement&variable=precipitation&startDate=2030-01-01&endDate=2030-01-07"
# Attendu : 400 + message d'erreur clair
```

---

## GIT

```
feat(meteo): add zone centroids to ref tables (migration)
refactor(meteo): replace grid approach with zone admin centroids
feat(meteo): NDJSON streaming progress for CP batches
feat(meteo): progress bar UI in MeteoGeoPanel
feat(meteo): switch 3rd map to meteo palette when active
feat(meteo): hover popup with qualitative labels
chore(meteo): remove old grid code and filter_points_in_france RPC
```

Branch : `feat/meteo-geo-digital` (continue sur la même branche)

---

## RÉSUMÉ DES FICHIERS

### À MODIFIER

```
app/api/meteo-geo/route.ts                              ← Refonte complète (zones admin au lieu de grille)
app/map/analyse/digital/_hooks/useMeteoGeo.ts            ← Refonte state + fetch NDJSON streaming
app/map/analyse/digital/_components/MeteoGeoPanel.tsx    ← Ajouter barre progression + bouton disabled
app/map/analyse/digital/_components/SyncMap.tsx           ← 3ème carte switch Population ↔ Météo
app/map/analyse/digital/page.tsx                         ← Passer meteoData à SyncMap
```

### À CRÉER

```
Migration SQL : centroid_lat/centroid_lon sur ref_departements, ref_codes_postaux, ref_regions
RPC : get_zone_centroids(scale text)
```

### À SUPPRIMER

```
lib/meteo/grid.ts                    ← ancien générateur de grille
RPC filter_points_in_france          ← ancien clip France
```

### INCHANGÉS (ne pas toucher)

```
lib/meteo/types.ts                   ← garde les types existants, étends si besoin
lib/meteo/open-meteo-client.ts       ← adapte pour le nouveau format (1 appel bulk CSV)
lib/meteo/palettes.ts                ← adapte les palettes si nécessaire
```
