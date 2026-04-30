# INSPECTION DSP Import & Custom Bidding Readiness

> Inspection only — aucune modification de code, aucune migration appliquée.
> Date : 2026-04-27 · Projet Supabase : `vkkdbygwbrxyogqosten`

---

## 1. Schéma DB actuel

### Table `dsp_campaigns` (4 lignes en prod)

| Colonne | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `name` | text | **NO** | — | Nom campagne |
| `dsp_source` | text | NO | `'adform'` | Pas de CHECK constraint — accepte n'importe quoi |
| `advertiser` | text | YES | NULL | **Toujours NULL en prod (3/3)** |
| `date_start` | date | YES | NULL | **Toujours NULL en prod (3/3)** |
| `date_end` | date | YES | NULL | **Toujours NULL en prod (3/3)** |
| `total_tracked_ads` | integer | YES | 0 | Pré-calcul stocké |
| `total_unique_impressions` | integer | NO | 0 | Pré-calcul stocké |
| `countries` | text[] | YES | NULL | ARRAY de pays distincts (jusqu'à 150 valeurs) |
| `created_at` | timestamptz | YES | `now()` | |
| `created_by` | uuid | YES | NULL | FK `auth.users(id)` (sans ON DELETE) |
| `organization_id` | uuid | YES | NULL | FK `organizations(id)` — **toutes les 4 campagnes pointent sur `00000000-0000-0000-0000-000000000001`** (org placeholder) |

**Indexes** : `dsp_campaigns_pkey (id)`, `idx_dsp_campaigns_org (organization_id)`.
**Triggers** : aucun.
**RLS** : activée — 4 policies (`select`, `insert` no-check, `update`, `delete`) basées sur `get_user_role()` + `get_user_org()` + jointure `campaign_organizations`.

### Table `dsp_campaign_data` (294 135 lignes en prod)

| Colonne | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `campaign_id` | uuid | YES | NULL | FK `dsp_campaigns(id) ON DELETE CASCADE` — **devrait être NOT NULL** |
| `date` | **date** | YES | NULL | **0/294 135 lignes ont une date renseignée** ⚠️ |
| `city` | text | YES | NULL | Ville (libre, non normalisée) |
| `country` | text | NO | — | Champ obligatoire |
| `postal_code` | text | YES | NULL | CP libre (formats hétérogènes : `4472 bk`, `15594`, `9300`…) |
| `region` | text | YES | NULL | Région (libre, libellé brut DSP) |
| `dma_region` | text | YES | NULL | Sous-région (libre) |
| `tracked_ads` | integer | NO | 0 | KPI principal Adform |
| `code_iris` | text | YES | NULL | Résolu par `match_campaign_postal_to_iris` (94% des lignes) |
| `code_commune` | text | YES | NULL | Idem |
| `matched_at` | timestamptz | YES | NULL | Horodatage du match IRIS |
| `media` | text | YES | NULL | Régie/publisher |
| `unique_impressions` | integer | YES | 0 | KPI Adform récent — toutes 0 sur 5/5 lignes échantillon |

**Indexes** :
- `dsp_campaign_data_pkey (id)`
- `idx_dsp_data_campaign (campaign_id)`
- `idx_dsp_data_country (country)`
- `idx_dsp_data_iris (code_iris) WHERE code_iris IS NOT NULL` ← partial
- `idx_dsp_data_postal (postal_code)`
- `idx_dsp_data_unique` UNIQUE composite : `(campaign_id, COALESCE(date, '1970-01-01'), COALESCE(postal_code, ''), COALESCE(city, ''), COALESCE(media, ''))` ⚠️ **Indique que la date était PRÉVUE mais jamais remplie en prod**

**Constraints** : 1 FK (`campaign_id` CASCADE), pas de CHECK.
**Triggers** : aucun.
**RLS** : activée — 2 policies (`select`, `modify`) avec sous-requête sur `dsp_campaigns` + `campaign_organizations`.

### Table `campaign_organizations` (4 lignes — table pivot N:N)

| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `campaign_id` | uuid NOT NULL | FK `dsp_campaigns(id) ON DELETE CASCADE` |
| `organization_id` | uuid NOT NULL | FK `organizations(id) ON DELETE CASCADE` |
| `added_at` | timestamptz DEFAULT `now()` | |
| `added_by` | uuid | FK `auth.users(id)` |

**Indexes** : pkey, UNIQUE `(campaign_id, organization_id)`, `idx_campaign_orgs_campaign`, `idx_campaign_orgs_org`.

### Table `postal_code_commune` (référentiel La Poste)

| Colonne | Type | Notes |
|---|---|---|
| `code_postal` | text NOT NULL | partie de PK |
| `code_commune` | text NOT NULL | partie de PK |
| `nom_commune` | text | |

**Indexes** : pkey composite, `idx_postal_code (code_postal)`.

---

## 2. Volumétrie actuelle

```
campaigns_count                  : 4
data_rows_count                  : 294 135
distinct_campaigns_in_data       : 4   (toutes les campagnes ont des lignes)
distinct_postal_codes            : 16 629
campaign_org_links               : 4
matched_iris_count               : 275 443  (~94% match)
```

Distribution `date` : **0 lignes avec date / 294 135 sans date** → la temporalité n'est PAS exploitée actuellement.

---

## 3. Notion de date / temporalité

### Colonnes liées au temps présentes

| Table | Colonne | Type | Statut prod |
|---|---|---|---|
| `dsp_campaigns` | `date_start` | date | NULL sur 100% des campagnes |
| `dsp_campaigns` | `date_end` | date | NULL sur 100% des campagnes |
| `dsp_campaigns` | `created_at` | timestamptz | Toujours rempli |
| `dsp_campaign_data` | **`date`** | date | **NULL sur 100% des lignes (0 / 294 135)** |
| `dsp_campaign_data` | `matched_at` | timestamptz | Rempli après matching IRIS |

### Verdict temporalité

- **L'infrastructure pour stocker une date par ligne existe déjà** (`dsp_campaign_data.date`) et elle est même intégrée dans la **clé d'unicité** (`idx_dsp_data_unique` utilise `COALESCE(date, '1970-01-01')`).
- **Mais aucune campagne importée à ce jour n'a renseigné cette date** : soit le fichier source ne contenait pas de colonne date, soit le mapping n'a pas été appliqué.
- Le parser `lib/campaigns/parser.ts:83` lit la date **uniquement si la colonne est mappée** (`hasDateCol`) → conditionné à la présence d'une colonne `date|jour|day` dans l'export DSP.
- Le parser détecte automatiquement la colonne via `autoDetectMapping` (`lib/campaigns/column-mappings.ts:42`) et `parseDate` supporte 6 formats : ISO, DD/MM/YYYY, MM/DD/YYYY, YYYY/MM/DD, "DD MMM YYYY" français/anglais, sérial Excel.

**Conclusion** : la maille jour × CP est **déjà supportée par le schéma et le parser**, mais inutilisée car les fichiers Adform actuels exportent uniquement un agrégat sur la période sans dimension date. La migration vers TTD/DV360/Meta avec maille jour ne nécessite **aucun changement de schéma** côté `dsp_campaign_data.date` — juste s'assurer que les exports incluent la colonne date et qu'elle est mappée.

---

## 4. Échantillon de données (anonymisé)

### `dsp_campaigns` — 3 dernières

| id | name_anon | dsp_source | advertiser | date_start | date_end | total_tracked_ads | total_unique_impressions | countries (count) | created_at |
|---|---|---|---|---|---|---|---|---|---|
| `f60c8e59…` | ADV_850f4e | adform | NULL | NULL | NULL | 86 949 839 | 13 231 130 | 144 pays | 2026-04-22 |
| `fd18d97c…` | ADV_b1d5f6 | adform | NULL | NULL | NULL | 70 844 538 | 0 | 168 pays | 2026-04-14 |
| `4290c924…` | ADV_59c6b6 | adform | NULL | NULL | NULL | 2 327 854 | 697 296 | 49 pays | 2026-04-13 |

**Observations** :
- 3/3 campagnes : `dsp_source='adform'` (pas de DV360/TTD/Meta encore en prod)
- 3/3 : `advertiser=NULL` (champ jamais alimenté)
- 3/3 : `date_start/date_end=NULL`
- Volumes hétérogènes (×35 entre min et max)
- Toutes attribuées à l'org placeholder `00000000-…001`

### `dsp_campaign_data` — 5 lignes

```
| campaign_id | date | city                | country     | postal_code | region          | dma_region | tracked_ads | code_iris  | code_commune | matched_at        | media       | unique_impressions |
|-------------|------|---------------------|-------------|-------------|-----------------|------------|-------------|------------|--------------|-------------------|-------------|--------------------|
| 7bbff929    | NULL | s-heer hendrikskind | Netherlands | 4472 bk     | Zeeland         | n/a        | 0           | NULL       | NULL         | NULL              | Goldenbees  | 0                  |
| fd18d97c    | NULL | A aldea             | Spain       | 15594       | La Coruna       | n/a        | 1           | NULL       | NULL         | NULL              | Adot        | 0                  |
| fd18d97c    | NULL | Aalst               | Belgium     | 9300        | Oost-vlaanderen | n/a        | 2           | NULL       | NULL         | NULL              | Adot        | 0                  |
| 7bbff929    | NULL | Castelnau-le-lez    | France      | 34170       | Occitanie       | Herault    | 0           | 340570102  | 34057        | 2026-04-13 09:09  | Meta        | 0                  |
| f60c8e59    | NULL | Aabenraa            | Denmark     | 6200        | Syddanmark      | Aabenraa   | 5           | NULL       | NULL         | NULL              | Antvoice    | 2                  |
```

**Observations** :
- `date=NULL` partout (cf. section 3)
- IRIS matché uniquement pour `country='France'` (RPC `match_campaign_postal_to_iris` filtre par pays)
- `media` rempli avec valeurs hétérogènes : régies (Adot, Antvoice, Goldenbees, Meta…)
- `tracked_ads=0` pour 2/5 lignes échantillon → certaines lignes sont des "0" présents pour traçabilité (impressions vues mais pas trackées)
- `unique_impressions=0` quasi systématiquement → KPI peu exploité dans les exports actuels

---

## 5. Page d'import existante — front + back

### Backend — routes API (`app/api/admin/campaigns/`)

| Route | Méthode | Rôle |
|---|---|---|
| `route.ts` | GET | Liste des campagnes avec stats agrégées (`get_dsp_campaign_stats` RPC) |
| `preview/route.ts` | POST | Parse le fichier sans insert + retourne `column_mapping` détecté + 30 lignes échantillon. Permet à l'utilisateur de valider/corriger le mapping AVANT l'import |
| `import/route.ts` | POST | **Import principal** — SSE streaming (`text/event-stream`). Voir détail ci-dessous |
| `populate-postal/route.ts` | POST | Peuple `ref_codes_postaux` depuis `postal_code_commune` |
| `[id]/route.ts` | GET / DELETE / PATCH | CRUD détail campagne |
| `[id]/match-iris/route.ts` | POST | Relance matching IRIS sur une campagne existante |
| `[id]/organizations/route.ts` | GET / POST | Gestion liens N:N campagne ↔ orgs (multi-tenant) |
| `[id]/organizations/[orgId]/route.ts` | DELETE | Retrait d'une org du lien |

### Détail `/api/admin/campaigns/import` (route critique)

**Fichier** : `app/api/admin/campaigns/import/route.ts` (250+ lignes)

**Flow** :
1. **Auth** : `requireAdmin(request)` (super_admin ou admin)
2. **Parse formData** AVANT le stream (workaround d'un incident `body consumed` du 04-08)
3. **DSP sources acceptées** (Zod enum) : `'adform' | 'dv360' | 'ttd' | 'xandr' | 'amazon_dsp' | 'other'` — **mais seul `adform` a un mapping concret** (`DSP_MAPPINGS.adform` dans `lib/campaigns/column-mappings.ts:18-31`)
4. **Org scope** : super_admin peut viser n'importe quelle org, sinon force `profile.organization_id`. Fallback `'00000000-…001'` si profile sans org
5. **Stream SSE** events typés `CampaignImportEvent` (`types/campaign.ts`) :
   - `parsing` → début parsing
   - `progress` → progression {processed, total, message}
   - `matching` → progression matching IRIS {matched, total_france, message}
   - `error` → erreur fatale
   - `complete` → fin avec stats
6. **Création campaign** : insert dans `dsp_campaigns` + upsert dans `campaign_organizations`
7. **Pré-agrégation client-side** : déduplication par clé `(date|postal_code|city|media)` AVANT insert (réduit le volume)
8. **Batch insert** : `BATCH_SIZE = 50` lignes (respecte les contraintes Nano)
9. **Matching IRIS** post-insert : RPC `match_campaign_postal_to_iris(p_campaign_id)` (uniquement `country='France'`)
10. **Final count** retourné

**Points forts** :
- Streaming SSE conforme à la règle CLAUDE.md "Imports & batch DB — Progression OBLIGATOIRE"
- Batch 50 conforme aux contraintes I/O Nano
- Auto-detection de mapping si headers reconnus
- Custom mapping accepté en input (override possible)

**Limites** :
- 1 seul DSP réellement supporté (`adform`) — les autres tomberont sur le mapping Adform en fallback
- `advertiser` jamais peuplé (champ existe mais aucun import ne le set)
- `date_start/date_end` calculés depuis les `date` des lignes — donc NULL si la colonne date n'est pas présente
- Pas de gestion des KPIs étendus (visits, leads, viewable_impressions, bid_requests, video_completions) — schéma supporte `tracked_ads` + `unique_impressions` uniquement
- Pas de versionning/rollback des imports
- Pas de support multi-fichiers (1 import = 1 fichier)

### Helpers (`lib/campaigns/`)

#### `column-mappings.ts` (129 lignes)

- `DSP_MAPPINGS` : actuellement uniquement `adform` (10 colonnes mappées)
- `autoDetectMapping(headers)` : pattern matching sur 10 cibles avec variantes FR/EN
- `parseDate(raw)` : 6 formats supportés (ISO, DMY, MDY, YMD, "01 Jan 2026", Excel serial)
- `getMappingForSource(dspSource)` : fallback Adform si DSP inconnu

#### `parser.ts` (188 lignes)

- `parseCampaignFile(buffer, fileName, dspSource, customMapping?)` : entry point unique
- Supporte CSV (Papa Parse, fallback latin-1) et XLSX (`XLSX.read`)
- Output typé `CampaignParseResult` avec : rows, campaign_name, countries, date_start, date_end, total_tracked_ads, total_unique_impressions, errors, detected_columns
- Validation minimum : `tracked_ads` + (`postal_code` OU `country`)
- Gestion erreurs ligne-par-ligne (continue malgré erreur unitaire)

### Frontend (`app/admin/campaigns/`)

| Fichier | Rôle |
|---|---|
| `page.tsx` | Liste des campagnes + bouton import + modal d'upload |
| `[id]/page.tsx` | Détail d'une campagne : stats, breakdown média, action delete |

(Composants UI : non lus en détail, hors scope inspection — dispos via Glob)

### Pages "consommatrices" — analyse digital (`app/map/analyse/digital/`)

20 fichiers. Composants notables :
- `_components/CampaignCard.tsx`, `CampaignContextBar.tsx`
- `_components/AnalysisPanel.tsx`, `BreakdownChart.tsx`, `KpiSummary.tsx`
- `_components/MediaHeatmap.tsx`, `MapLegend.tsx`, `SyncMap.tsx`
- `_components/BiddingCopilot.tsx`, `BiddingRecommendation.tsx`, `AiAnalysisBlock.tsx`
- `_components/MeteoGeoPanel.tsx`, `RailroadPipeline.tsx`, `ActionListTable.tsx`
- `_lib/use-digital-data.ts`, `_lib/palettes.ts`

### Routes API "lecture" (`app/api/digital/`)

| Route | Description |
|---|---|
| `campaigns/route.ts` | Liste filtrée par org (RPC `get_digital_campaigns_list`) |
| `codes-postaux/route.ts` | GeoJSON CP dans bbox |
| `[campaignId]/analysis/route.ts` | Breakdown / médias / indicators / heatmap |
| `[campaignId]/map/route.ts` | Choroplèthe CP campagne (RPC `get_digital_campaign_map`) |
| `[campaignId]/media/route.ts` | Régies distinctes (RPC `get_campaign_medias`) |
| `[campaignId]/cp-detail/route.ts` | IRIS d'un CP (RPC `get_digital_cp_iris_detail`) |
| `[campaignId]/ai-analysis/route.ts` | Analyse Gemini perfs géo |
| `[campaignId]/bidding-chat/route.ts` | Chat bidding Gemini multi-turn |
| `[campaignId]/geography/[setId]/route.ts` | Croisement campagne × jeu de zones |
| `[campaignId]/custom-zone/[zoneId]/route.ts` | Croisement campagne × zone custom-geo (RPC `aggregate_dsp_by_custom_zone`) |

### RPCs PostgreSQL liées

```
aggregate_dsp_by_custom_zone     -- Croisement campagne × custom_geo_zones
get_campaign_impressions          -- Stats agrégées
get_campaign_medias               -- Régies distinctes
get_digital_campaign_bbox         -- Bbox d'une campagne
get_digital_campaign_map          -- Choroplèthe CP
get_digital_campaigns_list        -- Liste avec stats
get_dsp_campaign_stats            -- Stats agrégées admin
match_campaign_postal_to_iris     -- Matching CP → IRIS (post-import)
```

---

## 6. KPIs supportés vs roadmap multi-DSP

### KPIs actuellement stockables

| KPI | Colonne `dsp_campaign_data` | Statut |
|---|---|---|
| Impressions trackées | `tracked_ads` | ✅ Utilisé partout |
| Impressions uniques | `unique_impressions` | ⚠️ Existe mais quasi toujours 0 en prod |
| Date | `date` | ⚠️ Existe mais 0/294 135 lignes remplie |
| Code postal | `postal_code` | ✅ |
| Ville | `city` | ✅ libre |
| Pays | `country` | ✅ NOT NULL |
| Région / DMA | `region`, `dma_region` | ✅ libre |
| Régie/publisher | `media` | ✅ |

### KPIs roadmap multi-DSP NON présents en DB

| KPI cible (TTD/DV360/Meta) | Colonne nécessaire | Type suggéré |
|---|---|---|
| Visits / sessions | `visits` | integer |
| Leads / conversions | `leads` | integer |
| Viewable impressions | `viewable_impressions` | integer |
| Unique users (vs unique_impressions) | `unique_users` | integer |
| Bid requests | `bid_requests` | bigint (volumes énormes) |
| Video completions / completes | `video_completions` | integer |
| (Optionnel) Spend | `spend` | numeric(12,2) |
| (Optionnel) Clicks | `clicks` | integer |

**À noter** : ajouter ces colonnes à `dsp_campaign_data` (294k lignes aujourd'hui) reste léger en migration mais demande :
- Un mapping par DSP (DV360, TTD, Meta) dans `lib/campaigns/column-mappings.ts` (actuellement seul Adform)
- Une mise à jour du type `ParsedCampaignRow` (`lib/campaigns/parser.ts:12-23`)
- Une mise à jour du calcul `total_*` agrégé sur `dsp_campaigns`
- Possiblement une refonte de `idx_dsp_data_unique` (qui inclut déjà la date dans son COALESCE)
- Mise à jour des RPCs analytiques (`get_digital_campaign_map`, `get_dsp_campaign_stats`) pour exposer les nouveaux KPIs

---

## 7. Points d'attention pour la migration multi-DSP

### Non-bloquants mais à traiter
1. **`dsp_source` sans CHECK constraint** : ajouter `CHECK (dsp_source IN ('adform','dv360','ttd','xandr','amazon_dsp','meta','other'))` pour éviter les coquilles.
2. **`advertiser` toujours NULL** : décider si le champ doit être peuplé (auto-extract depuis le nom de campagne ?) ou supprimé.
3. **`organization_id` placeholder `00000000-…001`** : 4/4 campagnes utilisent ce fallback. Valider la migration vers les vraies orgs avant d'activer le multi-tenant strict.
4. **`campaign_id` NULLABLE sur `dsp_campaign_data`** : devrait être NOT NULL — une ligne data sans campagne n'a aucun sens.
5. **Cohérence FK `created_by`** : pas de `ON DELETE SET NULL` sur les 2 FK auth.users → si l'admin créateur est supprimé, INSERT/UPDATE planteront.

### Bloquants pour custom bidding par jour × CP
1. **Forcer la présence de la colonne date** dans les exports DV360/TTD/Meta (vs Adform actuel sans date).
2. **Mettre à jour `column-mappings.ts`** avec les schémas DV360/TTD/Meta (10+ colonnes par DSP).
3. **Décider de la stratégie d'agrégation** : aujourd'hui le parser pré-agrège par `(date|postal_code|city|media)` côté client (`import/route.ts:147-176`). Si les nouveaux KPIs sont additifs (visits, leads), OK. Si certains sont ratios (CTR, viewability rate), il faut stocker numérateur + dénominateur.
4. **Performance** : passer de 70k lignes/campagne (Adform actuel) à `jours × CP × media` peut multiplier par 30-100. Vérifier que `BATCH_SIZE=50` reste viable et que les RPCs analytiques tiennent (sur Nano 250 IOPS).
5. **Index `idx_dsp_data_unique`** : déjà composite avec date — pas de refonte nécessaire pour l'unicité, mais à valider sur la nouvelle volumétrie.

### Hors scope mais notable
- Les RPCs `get_digital_campaign_map`, `get_dsp_campaign_stats` agrègent en pleine volée → potentiellement lentes dès qu'on ajoute la dimension temps. Anticiper des **vues matérialisées** ou un pré-agrégat (table `dsp_campaign_daily_stats`) si l'usage analytique multiplie les requêtes.
- Aucun **rate limiting** ni **cache** sur `/api/digital/*` — exposition directe à la lecture intensive.
- La RLS multi-tenant via jointure (`campaign_organizations`) ajoute du coût sur chaque query — performance à mesurer sur volumétrie ×30.

---

## 8. Verdict global

| Dimension | État | Migration multi-DSP |
|---|---|---|
| Schéma table principale | ✅ Sain (date présente, indexes OK, RLS OK) | Ajouter colonnes KPIs étendus |
| Volumétrie | 294k lignes / 4 campagnes (~73k/camp) | Multiplier ×30-100 si maille jour |
| Parser | Robuste (CSV+XLSX+Excel serial+6 formats date) | Ajouter mappings DV360/TTD/Meta |
| Import streaming SSE | Conforme CLAUDE.md, batch 50 | Aucun changement nécessaire |
| RLS multi-tenant | OK via campaign_organizations | À mesurer sous volumétrie ×30 |
| KPIs étendus | ❌ Pas de colonnes pour visits/leads/bid_requests | Ajout schéma + mapping requis |
| Date utilisée | ❌ 0 lignes remplie (alors que colonne existe) | Forcer mapping date dans nouveaux exports |

**Migration recommandée en 3 étapes** :
1. **Migration schéma** (additive, non-destructive) : ajouter `visits`, `leads`, `viewable_impressions`, `unique_users`, `bid_requests`, `video_completions` à `dsp_campaign_data`. Ajouter CHECK sur `dsp_source`.
2. **Mappings DSP** : étendre `lib/campaigns/column-mappings.ts` avec DV360/TTD/Meta + parser dates spécifiques.
3. **Pré-aggregate matérialisé** : créer `dsp_campaign_daily_stats` (vue matérialisée ou table refresh nightly) pour soutenir la lecture par les pages digital sous volumétrie ×30.

**Pas de refonte structurelle nécessaire** — l'architecture actuelle est extensible.

---

*Inspection terminée. Aucune modification appliquée.*
