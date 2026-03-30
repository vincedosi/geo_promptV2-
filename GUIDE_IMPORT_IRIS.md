# Guide Complet — Import des Données IRIS dans GENESIS

## Vue d'ensemble

Les données IRIS sont des indicateurs socio-démographiques INSEE au niveau infracommunal (~49 000 zones IRIS en France). GENESIS les utilise pour la choroplèthe carte, le copilote AI, le scoring OOH, et les analyses.

### Architecture des données

```
Table iris (Supabase/PostGIS)
├── Colonnes core (~24 colonnes SQL fixes) → requêtes rapides, copilote, scoring
├── Colonne indicators JSONB → tous les indicateurs secondaires
└── Géométries (geom, geom_3857, geom_z7, geom_z10)

Fichier iris_france.pmtiles (public/)
└── Tuiles vectorielles pré-générées → affichage carte MapLibre
    └── Contient les colonnes core comme propriétés des features
```

### Flux de données complet

```
Fichier CSV INSEE
      │
      ▼
Interface web /dashboard/iris-crawler
      │
      ├── Onglet "Crawler Auto" (datasets RP)
      │     POST /api/iris-import/insee
      │     → Télécharge depuis INSEE
      │     → Parse CSV (papaparse)
      │     → Mapping auto (auto-map.ts)
      │     → Calculs dérivés (computeDerived)
      │     → Upsert batch (update_iris_core_batch RPC)
      │     → TABLE iris
      │
      └── Onglet "Import Manuel" (fichiers CSV libres)
            POST /api/iris-crawler/manual-upload → parse + preview
            POST /api/iris-crawler/manual-validate → validation
            POST /api/iris-crawler/manual-import → upsert
            → TABLE iris

Après import :
      │
      ▼
Régénérer le PMTiles (GitHub Actions)
      │
      ▼
Copier iris.pmtiles → public/iris_france.pmtiles
      │
      ▼
Les IRIS s'affichent sur la carte avec les nouvelles données
```

---

## Étape 1 — Importer les données en base

### Option A : Crawler Auto (datasets RP INSEE)

Le crawler auto télécharge directement depuis le site INSEE. Il gère 5 sources RP :

| Source | Tag | Colonnes core remplies |
|---|---|---|
| Population & tranches d'âge & CSP | `pop` | population, pop_0_14, pop_15_29, pop_30_44, pop_45_59, pop_60_74, pop_75_plus, nb_csp_cadre, nb_csp_employe, nb_csp_ouvrier |
| Ménages | `men` | nb_menages |
| Diplômes & formation | `dip` | nb_diplome_aucun, nb_diplome_bac, nb_diplome_sup, taux_diplome_sup |
| Logement / propriétaires | `log` | taux_proprio |
| Activité / chômage | `act` | taux_chomage (calculé CHOM/ACT×100), taux_emploi (calculé ACTOCC/ACT×100) |

**Comment faire :**
1. Aller sur `/dashboard/iris-crawler`
2. Onglet "Crawler Auto"
3. Sélectionner le millésime (ex: 2022)
4. Cliquer "Importer" → les 5 sources se téléchargent et s'importent automatiquement
5. Durée : ~4-5 minutes pour 49 000 IRIS

**Fichiers impliqués :**
- `app/api/iris-import/insee/route.ts` — route principale
- Fonctions `buildPop()`, `buildMen()`, `buildDip()`, `buildLog()`, `buildAct()` — chacune mappe les colonnes INSEE vers les colonnes core
- `computeDerived()` dans `lib/iris-crawler/storage.ts` — calcule taux_chomage, taux_emploi, taux_diplome_sup, taux_proprio
- `update_iris_core_batch` — RPC SQL qui fait l'upsert (24 colonnes)

### Option B : Import Manuel (fichiers CSV libres)

Pour les fichiers qui ne sont pas dans le crawler auto (ex: Filosofi).

**Comment faire :**
1. Aller sur `/dashboard/iris-crawler`
2. Onglet "Import Manuel"
3. Uploader le fichier CSV
4. Vérifier l'encodage et le séparateur (auto-détectés)
5. Vérifier le mapping des colonnes (auto-map pré-remplit)
6. Valider
7. Importer

**Fichiers impliqués :**
- `app/api/iris-crawler/manual-upload/route.ts` — parse le CSV
- `app/api/iris-crawler/manual-validate/route.ts` — validation
- `app/api/iris-crawler/manual-import/route.ts` — upsert avec split core/JSONB
- `lib/iris-crawler/auto-map.ts` — mapping automatique colonnes CSV → colonnes DB
- `lib/iris-crawler/db-columns.ts` — définition des colonnes core
- `lib/iris-crawler/storage.ts` — logique d'écriture + computeDerived

---

## Étape 2 — Datasets INSEE à importer

### Recensement de la Population (RP) — via Crawler Auto

- **Source** : https://www.insee.fr/fr/statistiques/8268806
- **Millésime** : 2022 (dernier disponible)
- **Couverture** : 49 276 IRIS (France entière)
- **Méthode** : Crawler Auto, tout est automatique

### Filosofi (Revenus / Pauvreté) — via Import Manuel

- **Source** : https://www.insee.fr/fr/statistiques/8229323
- **Millésime** : 2021 (dernier disponible — le 2022 ne sera pas produit)
- **Couverture** : ~16 000 IRIS (communes ≥ 5 000 hab, secret statistique)
- **Fichiers à importer** :

| Fichier | Colonnes core remplies |
|---|---|
| `BASE_TD_FILO_IRIS_2021_DEC.csv` | rev_median, rev_d1, rev_d9, taux_pauvrete, indice_gini |
| `BASE_TD_FILO_IRIS_2021_DISP.csv` | Tout en JSONB (revenus disponibles) |

**Attention** : ne pas importer les fichiers `meta_*` (ce sont des métadonnées).

### Emplois au lieu de travail — PAS ENCORE DISPONIBLE

- **Colonne** : `nb_emplois`
- **Source INSEE** : fichier "Emploi - Population active" (base-ic-emploi-pop-active)
- **Statut** : pas dans le catalogue crawler auto, pas encore importé
- **Action requise** : ajouter ce dataset dans `catalog.ts` ou l'importer manuellement

---

## Étape 3 — Régénérer le PMTiles

Après chaque import de données, le fichier PMTiles doit être régénéré pour que la carte reflète les nouvelles colonnes.

### Méthode : GitHub Actions

1. S'assurer que les 3 fichiers sont à jour :
   - `.github/workflows/generate-iris-pmtiles.yml`
   - `.github/scripts/export-iris-ndjson.mjs` — exporte les IRIS en NDJSON depuis Supabase
   - `.github/scripts/upload-iris-pmtiles.mjs` — uploade sur GitHub Releases

2. Lancer le workflow :
   - GitHub → repo → Actions → "Generate IRIS PMTiles" → Run workflow
   - zoom_min = 5, zoom_max = 14
   - Durée : ~3-4 minutes

3. Le workflow :
   - Exporte les 49k IRIS avec colonnes core depuis Supabase (keyset pagination)
   - Génère le fichier PMTiles avec tippecanoe (z5→z14)
   - Uploade sur GitHub Releases (tag `iris-pmtiles-latest`)

4. Télécharger le fichier et le copier dans le projet :
   ```powershell
   # Télécharger depuis GitHub Releases
   # https://github.com/vincedosi/geo_promptV2-/releases/download/iris-pmtiles-latest/iris.pmtiles
   
   # Copier dans public/
   copy C:\Users\vsidol01\Downloads\iris.pmtiles C:\GENESIS\genesis_app\public\iris_france.pmtiles
   ```

5. Rafraîchir la carte

### Colonnes incluses dans le PMTiles

Le script d'export (`sql/063_export_iris_after.sql`) exporte ces colonnes comme propriétés des tuiles :
- code_iris, nom_iris, type_iris
- population, pop_0_14, pop_15_29, pop_30_44, pop_45_59, pop_60_74, pop_75_plus
- nb_menages, rev_median
- taux_chomage, taux_proprio
- nb_diplome_aucun, nb_diplome_bac, nb_diplome_sup, taux_diplome_sup
- nb_csp_cadre, nb_csp_employe, nb_csp_ouvrier

**⚠️ Si de nouvelles colonnes core sont ajoutées, il faut aussi mettre à jour `sql/063_export_iris_after.sql` pour les inclure dans l'export PMTiles.**

---

## Étape 4 — Ajouter une nouvelle colonne core

Si tu veux ajouter une nouvelle colonne IRIS (ex: `taux_emploi`) :

### 1. Migration SQL
Créer un fichier `sql/0XX_iris_add_COLONNE.sql` :
```sql
ALTER TABLE iris ADD COLUMN IF NOT EXISTS ma_colonne NUMERIC;
```
L'appliquer dans Supabase SQL Editor.

### 2. Rafraîchir le schema cache Supabase
```sql
NOTIFY pgrst, 'reload schema';
```
**Sans ça, Supabase ignore silencieusement la nouvelle colonne dans les upserts.**

### 3. Mettre à jour db-columns.ts
Ajouter la colonne dans `CORE_COLUMNS` ou `IRIS_DB_COLUMNS`.

### 4. Mettre à jour auto-map.ts
Ajouter les patterns/alias INSEE qui mappent vers cette colonne.
Exemple : `P22_EMPLT` → `nb_emplois`

### 5. Mettre à jour la RPC update_iris_core_batch
**CRITIQUE** — La RPC SQL `update_iris_core_batch` a une liste hardcodée de colonnes dans la clause SET. Si la nouvelle colonne n'y est pas, l'upsert l'ignore silencieusement.

```sql
CREATE OR REPLACE FUNCTION update_iris_core_batch(...)
-- Ajouter la nouvelle colonne dans la clause SET
```

### 6. Si la colonne est dérivée (calculée)
Ajouter la formule dans `computeDerived()` dans `lib/iris-crawler/storage.ts`.
Exemples :
- `taux_chomage = P_CHOM1564 / P_ACT1564 × 100`
- `taux_emploi = P_ACTOCC1564 / P_ACT1564 × 100`

### 7. Si la colonne doit apparaître sur la carte
Mettre à jour `sql/063_export_iris_after.sql` pour inclure la colonne dans l'export PMTiles. Puis régénérer le PMTiles.

### 8. Si la colonne doit être utilisée par le copilote
- `lib/chat/tools/analyseComplete.ts` — ajouter dans le type `IrisRow` et le `.select()`
- `lib/chat/system-prompt.ts` — le copilote utilise `IRIS_DB_COLUMNS` dynamiquement, donc ça devrait être automatique
- `app/api/scoring/iris-columns/route.ts` — utilise déjà `IRIS_DB_COLUMNS`, automatique

### Checklist résumé pour une nouvelle colonne

```
[ ] ALTER TABLE iris ADD COLUMN
[ ] NOTIFY pgrst, 'reload schema'
[ ] db-columns.ts — ajouter la colonne
[ ] auto-map.ts — ajouter les patterns INSEE
[ ] update_iris_core_batch — ajouter dans la clause SET
[ ] computeDerived() — si colonne calculée
[ ] 063_export_iris_after.sql — si visible sur la carte
[ ] Régénérer le PMTiles
[ ] Re-importer les données
```

---

## Pièges connus

### 1. "Could not query the database for the schema cache"
**Cause** : Supabase PostgREST ne connaît pas les nouvelles colonnes.
**Fix** : `NOTIFY pgrst, 'reload schema';`

### 2. Colonne NULL après import alors que le CSV contient les données
**Causes possibles (vérifier dans l'ordre)** :
1. La colonne n'existe pas dans la table SQL → `ALTER TABLE ADD COLUMN`
2. Le schema cache n'a pas été rafraîchi → `NOTIFY pgrst`
3. `auto-map.ts` ne reconnaît pas le nom INSEE → ajouter le pattern
4. La colonne n'est pas dans `update_iris_core_batch` → mettre à jour la RPC
5. `computeDerived()` n'est pas appelé (pour les colonnes dérivées) → vérifier la route

### 3. value?.trim is not a function
**Cause** : le parsing CSV retourne des nombres, pas des strings.
**Fix** : `String(value ?? '').trim()` au lieu de `value?.trim()`

### 4. PMTiles — "The object exceeded the maximum allowed size"
**Cause** : Supabase Storage limite à 50 MB. Le fichier fait ~200 MB.
**Fix** : Utiliser GitHub Releases (pas de limite de taille).

### 5. PMTiles — CORS bloqué / 404
**Cause** : Le repo est privé, le proxy n'a pas de token GitHub.
**Fix temporaire** : Copier le fichier dans `public/iris_france.pmtiles`.
**Fix définitif** : Configurer `GITHUB_TOKEN` dans `.env.local` et utiliser le proxy `/api/iris-tiles-proxy`.

### 6. Deux routes d'import différentes
Le crawler auto utilise `POST /api/iris-import/insee` avec ses propres fonctions `buildPop()`, `buildAct()`, etc.
L'import manuel utilise `POST /api/iris-crawler/manual-import` avec `splitRow()` + `computeDerived()`.
**Si un fix est appliqué dans l'un, vérifier qu'il est aussi dans l'autre.**

### 7. Filosofi — secret statistique
Les données Filosofi ne couvrent que ~16 000 IRIS (communes ≥ 5 000 hab).
Les IRIS ruraux auront rev_median, taux_pauvrete, etc. = NULL.
C'est normal, c'est le secret statistique INSEE.

---

## Fichiers clés — Référence rapide

| Fichier | Rôle |
|---|---|
| `lib/iris-crawler/db-columns.ts` | Source de vérité des colonnes core |
| `lib/iris-crawler/auto-map.ts` | Mapping colonnes CSV → colonnes DB |
| `lib/iris-crawler/storage.ts` | Écriture DB + computeDerived() |
| `lib/iris-crawler/parser.ts` | Parsing CSV |
| `app/api/iris-import/insee/route.ts` | Import crawler auto (5 sources RP) |
| `app/api/iris-crawler/manual-import/route.ts` | Import manuel CSV |
| `sql/063_export_iris_after.sql` | Colonnes exportées pour PMTiles |
| `sql/069_iris_update_core_batch_rpc.sql` | RPC upsert (liste des colonnes SET) |
| `.github/workflows/generate-iris-pmtiles.yml` | Workflow génération PMTiles |
| `.github/scripts/export-iris-ndjson.mjs` | Export NDJSON depuis Supabase |
| `.github/scripts/upload-iris-pmtiles.mjs` | Upload PMTiles sur GitHub Releases |
| `lib/version.ts` | URL du fichier PMTiles |
| `app/dashboard/iris-crawler/page.tsx` | UI du crawler + import manuel |
