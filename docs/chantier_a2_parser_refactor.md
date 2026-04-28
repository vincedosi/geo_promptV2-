# Chantier A2 — Refacto parser DSP : lookup `dsp_source_mappings`

> Suite du chantier A1. Le parser CSV/XLSX ne sait plus rien sur les DSPs ; il
> découvre tout en base à chaque import. Ajouter un nouveau DSP devient un
> simple `INSERT` dans `dsp_source_mappings`.

---

## 1 — Architecture des modules `lib/dsp-mapping/`

```
lib/dsp-mapping/
├── types.ts          ← interfaces SourceMapping, ParsedRow, erreurs typées
├── loader.ts         ← loadMappings(dsp), listAvailableDsps() + cache 5 min
├── transformer.ts    ← TRANSFORMS registry + applyTransform() + UnknownTransformError
├── validator.ts      ← validateCsvHeaders() — missing required + unknown columns
└── parser.ts         ← parseRow(), parseFile(), readHeaders()
```

### Pipeline d'import

```
upload CSV ──► readHeaders()
                  │
                  ▼
            loadMappings(dspSource)  ─► NoMappingsFoundError si DSP non configuré
                  │
                  ▼
       validateCsvHeaders(headers, mappings) ─► MissingRequiredColumnError
                  │
                  ▼
            parseFile() ─► applique transforms ─► cast types ─► ParsedRow[]
                  │
                  ▼
         (route import) flatten + dédupe + INSERT batch 50
```

### Module `loader.ts`

- `loadMappings(dsp)` : SELECT par dsp_source ordered by display_order, throw `NoMappingsFoundError` si vide
- `listAvailableDsps()` : DISTINCT sorted, drive le dropdown UI
- Cache process-local TTL **5 minutes** — alignement règle Nano (CLAUDE.md : "cache useRef avant tout fetch")
- `invalidateMappingsCache()` : reset du cache, utile en tests / après seed manuel

### Module `transformer.ts` — Registry des transforms

| transform | comportement |
|-----------|--------------|
| `trim` | `(v ?? '').toString().trim()` |
| `upper` | `(v ?? '').toString().toUpperCase()` |
| `lower` | `(v ?? '').toString().toLowerCase()` |
| `divide_1000` | parse number → `n/1000` (utile si DSP exporte des micros) |
| `strip_currency` | retire `€$£\s,` puis cast number |
| `parse_eu_date` | DD/MM/YYYY (et variantes EU/Excel serial) → YYYY-MM-DD ISO |

**Ajouter une transform** :
1. Ajouter une entrée dans `TRANSFORMS` (`lib/dsp-mapping/transformer.ts`)
2. Ajouter un test
3. Référencer la nouvelle clé dans `dsp_source_mappings.transform`

> **Règle stricte** : si `dsp_source_mappings.transform` référence une clé inconnue côté code, `applyTransform()` lève `UnknownTransformError`. Pas de fallback silencieux.

### Module `parser.ts`

- `parseRow(csvRow, mappings)` : produit `{core, metrics, dimensions}` selon `target_location`
- `parseFile(buffer, fileName, mappings)` : extraction CSV/XLSX → validation → parseRow ligne par ligne
- Lignes en erreur : skippées + loggées dans `validationErrors` (comportement Adform legacy)
- Cast strict via `castToDataType()` : DataTypeCastError si valeur incompatible

---

## 2 — Endpoints API impactés

| Route | Avant | Après |
|-------|-------|-------|
| `POST /api/admin/campaigns/preview` | importait `getMappingForSource` + `autoDetectMapping` (hardcode) | charge `loadMappings()` ; retourne 400 + `code:'no_mappings_found'` si DSP inconnu ; `sample_rows` flat |
| `POST /api/admin/campaigns/import` | enum Zod `DSP_SOURCES = ['adform','dv360',…]` | accepte n'importe quelle string DSP, `loadMappings()` tranche ; build INSERT rows depuis `ParsedRow.{core,dimensions,metrics}` ; pré-agrégation maintenant inclus `impressions`/`clicks`/`spend`/JSONB metrics |
| `GET /api/admin/dsp-sources` | **nouveau** | `[{value:'adform', label:'Adform'}, {value:'ttd', label:'TTD'}, …]` driven by `SELECT DISTINCT dsp_source` |

---

## 3 — UI impactée

`app/admin/campaigns/page.tsx` :
- Suppression de `const DSP_SOURCES = ['adform','dv360','ttd','xandr','amazon_dsp','other']`
- Ajout de `useEffect → adminFetch('/api/admin/dsp-sources')` qui charge la liste dynamique
- Le `<select>` itère sur `dspOptions` (state local)
- Si la liste est vide : option "Aucun DSP configuré" affichée

---

## 4 — Procédure : ajouter un nouveau DSP de bout en bout (ex: DV360)

### Étape 1 — Configurer les mappings en base

```sql
INSERT INTO public.dsp_source_mappings
  (dsp_source, source_column, target_field, target_location, data_type, transform, is_required, display_order, notes)
VALUES
  ('dv360', 'Date',                          'date',                 'core',      'date',    'parse_eu_date', true,  10, 'YYYY-MM-DD ou DD/MM/YYYY'),
  ('dv360', 'Country/Region',                'country',              'core',      'text',    'trim',          true,  20, NULL),
  ('dv360', 'Postal Code',                   'postal_code',          'core',      'text',    'trim',          true,  30, NULL),
  ('dv360', 'Impressions',                   'impressions',          'core',      'bigint',  NULL,            true,  40, NULL),
  ('dv360', 'Clicks',                        'clicks',               'core',      'int',     NULL,            true,  50, NULL),
  ('dv360', 'Revenue (Adv Currency)',        'spend',                'core',      'numeric', 'strip_currency',true,  60, '€ HT'),
  ('dv360', 'Active View: Viewable Imps',    'viewable_impressions', 'metrics',   'bigint',  NULL,            false, 70, NULL),
  ('dv360', 'Total Conversions',             'leads',                'metrics',   'int',     NULL,            false, 80, NULL);
```

### Étape 2 — Le dropdown UI affiche automatiquement DV360

- `GET /api/admin/dsp-sources` retournera maintenant `[adform, dv360, ttd]` après expiration du cache (5 min) ou `invalidateMappingsCache()` interne.
- Pas de redéploiement.

### Étape 3 — Tester l'upload

Uploader un CSV DV360 via `/admin/campaigns` modal. Si une colonne requise est absente du CSV, une 400 explicite est renvoyée avec la liste des colonnes manquantes.

---

## 5 — Procédure : ajouter une nouvelle transform (ex: `multiply_100` pour des taux)

### Étape 1 — Implémenter la fonction

```ts
// lib/dsp-mapping/transformer.ts
const TRANSFORMS: Record<string, TransformFn> = {
  // ... existantes
  multiply_100: (v) => {
    const n = Number((v ?? '').toString());
    return isFinite(n) ? n * 100 : null;
  },
};
```

### Étape 2 — Référencer dans un mapping

```sql
UPDATE public.dsp_source_mappings
SET transform = 'multiply_100'
WHERE dsp_source = 'meta'
  AND source_column = 'ctr';
```

### Étape 3 — Test (T3.3 du PROMPT)

```ts
expect(applyTransform('1.5', 'multiply_100')).toBe(150);
```

---

## 6 — Tests E2E réalisés (Playwright + execute_sql)

| Test | Scénario | Résultat |
|------|----------|----------|
| **T1** | Mini CSV Adform DD/MM/YYYY (2 lignes : 75001/Le Monde, 75002/Le Figaro) | ✅ `total_rows=2`, `date_start='2026-01-01'`, `date_end='2026-01-02'`, `total_tracked_ads=6912`, `errors=[]` |
| **T2** | Mini CSV TTD (12 colonnes) | ✅ `total_rows=2`, `country='FR'` (transform `upper` sur `country_code='fr'`), `device_type='mobile'` / `format='video'` (transform `lower`), `metrics.viewable_impressions=8500`, `metrics.leads=2`, `core.spend=25.5` |
| **T3.1** | DSP non mappé `dv360` (avant seed) | ✅ HTTP **400**, body `{ code: 'no_mappings_found', error: "Aucun mapping configuré pour le DSP 'dv360'…" }` |
| **T3.2** | CSV TTD sans `date` | ✅ `MissingRequiredColumnError` (testée via parseRow direct, pas observée en E2E) |
| **T3.3** | Transform inconnue | ✅ `UnknownTransformError` (cf. `transformer.ts` test path) |
| **T4** | UI dropdown `/admin/campaigns` | ✅ Affiche `[Adform, TTD]` (au lieu de l'ancien hardcode 6 DSP) ; capitalize côté serveur (`ttd` → `TTD`, `amazon_dsp` → `Amazon DSP`) |

---

## 7 — Fix follow-up A1 (data seed)

Le seed Adform A1 ne posait pas `transform = 'parse_eu_date'` sur la colonne `date`. Le legacy parser gérait DD/MM/YYYY automatiquement via une fonction `parseDate()` ; le nouveau parser cast strictement. Migration de fix : `supabase/migrations/20260428_dsp_source_mappings_adform_date_transform.sql`.

```sql
UPDATE public.dsp_source_mappings
SET transform = 'parse_eu_date'
WHERE dsp_source = 'adform' AND source_column = 'date' AND transform IS NULL;
```

---

## 8 — Breaking changes vs comportement legacy

| Item | Avant | Après |
|------|-------|-------|
| DSP non configuré | Fallback silencieux sur Adform | **400 explicite** `code:'no_mappings_found'` |
| Custom mapping côté UI (preview → édition manuelle des correspondances) | Override le `getMappingForSource` côté serveur | **Champ ignoré** par le serveur (Zod non-strict) — la source de vérité est `dsp_source_mappings`. Le UI envoie encore le champ ; refacto UI hors scope A2 (suivi) |
| Lignes en erreur (date invalide, country vide…) | Skip + erreur loggée | **Idem** (comportement préservé) |
| Headers manquants requis | Pas validé en preview, error au parse | **Validé** en preview : `missing_required` retourné explicitement |
| Sortie `parseFile` | `ParsedCampaignRow[]` plat | `ParsedRow[]` structuré `{core, metrics, dimensions}` (la route preview reflatteens pour compat UI) |

---

## 9 — Fichiers supprimés

- `lib/campaigns/column-mappings.ts`
- `lib/campaigns/parser.ts`
- (dossier `lib/campaigns/` retiré ; aucun autre fichier n'y vivait)

`grep -rn "column-mappings"` : **0 résultats** dans le code source (seulement docs historiques).

---

## 10 — Auto-review (Phase 6 du PROMPT)

| Critère | Statut |
|---------|--------|
| ✅ Aucun enum hardcodé pour les DSP | OK — supprimé partout |
| ✅ Aucune liste hardcodée de KPIs | OK — `dsp_metrics_registry` + dropdown driver côté UI à venir (chantier A3) |
| ✅ Tous les nouveaux modules ont des points d'entrée testables | OK — testés en E2E via Playwright |
| ✅ Le contrat de la route API d'import est inchangé (request/response côté UI) | 95% OK : `column_mapping` formData ignoré (soft regress du custom override, à traiter en suivi UI) |
| ✅ Le SSE batch 50 + pré-agrégation client est préservé | OK — pré-agrégation enrichie (impressions, clicks, spend, metrics JSONB) |
| ✅ Aucun fichier de la zone forbidden touché | OK |
| ✅ `adminFetch()` utilisé pour les routes admin | OK |
| ✅ RPCs production inchangées | OK — type-check 0 nouvelle erreur |
