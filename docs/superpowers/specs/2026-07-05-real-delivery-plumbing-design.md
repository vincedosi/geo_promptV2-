# Source de délivrance réelle — plomberie (point 2) — Design

> Sous-projet du projet boucle de pilotage (voir memory `project_demo_bout_en_bout`).
> Suit A (moteur), B (agent), C (bilan) — tous mergés sur `main`.
> Date : 2026-07-05 · Branche : `feat/real-delivery-plumbing`

## Goal

Permettre de piloter une **vraie** campagne sur de la délivrance **importée** (exports Adform
datés), sans API live : la délivrance réelle atterrit sur la même campagne que son plan, et son
bilan devient lisible via une route générique. On corrige les deux « trous » de plomberie qui
empêchent aujourd'hui une vraie campagne d'entrer dans la machinerie pacing/bilan (déjà générique).

## Contexte & décisions (validées avec Vincent, 2026-07-05)

- **Format d'entrée confirmé** : export Adform **daté**, par jour × commune. Fixture de dev :
  `docs/Adform/Custom GEO_dated_synthetic.xlsx` — synthétique (chiffres inventés) mais
  **structurellement fidèle** à un vrai export Adform daté, généré depuis le vrai fichier
  `docs/Adform/Custom GEO_05_07_2026.xlsx`. Colonnes : `Date, Campaign, Media, City, Country,
  DMA region, Postal Code, Region, Tracked Ads, Unique Reach`. 6 493 lignes, dates
  2026-04-01 → 2026-05-30 (2 périodes de 30 j). Le vrai export daté sera fourni plus tard
  (droits d'accès) ; il aura la même structure.
- **Pas de hack de date** : le fichier étant daté, l'import standard parse la vraie colonne `date`
  et la délivrance se segmente naturellement par période (`get_campaign_pacing` filtre déjà
  `[period_start, period_end)`). L'idée initiale d'injecter une « date de référence » est
  abandonnée (YAGNI).
- **`Unique Reach`** : colonne ignorée (aucun consommateur downstream ; le pacing Adform utilise
  `tracked_ads`). Mappable plus tard si besoin — hors scope.
- **Provider** : Adform d'abord (mapping déjà seedé en base). DV360 différé (nécessite un vrai
  fichier pour seeder son mapping).
- **Surface UI différée** : « corrige les trous d'abord » — on livre la plomberie testable ; la
  surface pour visualiser le bilan d'une vraie campagne (onglet sur `/admin/campaigns/[id]` ou
  sélecteur sur `/demo/pilote`) est une itération suivante.
- **Rebid réel différé** : hors scope.

## État de l'existant (exploré 2026-07-05)

- `app/api/admin/campaigns/import/route.ts` : import SSE, CSV/XLSX, mappings dynamiques en base
  (`dsp_source_mappings`), batch 50. **Crée toujours une nouvelle `dsp_campaigns`** (l.164-179)
  puis insère la délivrance et lance le matching IRIS (`match_campaign_postal_to_iris`).
- `lib/dsp-mapping/` : `loadMappings`, `parseFile`, `parseRow`, transforms (`parse_eu_date`…).
  Mapping `adform` seedé : `date`(requis), `country`(requis), `postal code`→`postal_code`(requis),
  `tracked ads`→`tracked_ads`(requis), + campaign/city/region/dma/media/unique impressions.
- `dsp_campaign_data` : unicite via index EXPRESSION `idx_dsp_data_unique` (campaign_id, COALESCE(date), COALESCE(postal_code), COALESCE(city), COALESCE(media)) — non inferable par onConflict, d'ou DELETE+insert pour l'idempotence ; colonnes date, city,
  country, postal_code, region, dma_region, tracked_ads, impressions, clicks, spend, metrics,
  dsp_source, code_iris…
- `get_campaign_pacing(p_campaign_id, p_metric_field, p_version)` : filtre déjà la délivrance par
  `[period_start, period_end)` de la version de snapshot (sql/097). Métrique : `adform` →
  `tracked_ads`, sinon `impressions` (logique dans `app/api/digital/[campaignId]/pacing/route.ts`).
- `app/api/custom-geo/media-plan/snapshot/route.ts` : crée des snapshots (avec `period_start/end`)
  pour **n'importe quelle** campagne de l'org (pas de verrou démo). C'est le chemin par lequel une
  vraie campagne obtient un plan.
- `lib/report/aggregate.ts` : `buildCampaignReport(supabase, campaignId, metric?)` **déjà
  générique** (brique C). Seule la route démo l'expose.

## Global Constraints

- **Supabase Nano** : import batch 50 (existant), séquentiel. Le vrai export peut être volumineux
  (le brut fait 42 k lignes/jour potentiel) → conserver le batch 50 + progression SSE, aucun
  fan-out parallèle. Le pacing/bilan restent en lecture bornée par campagne.
- **Routes** : `export const dynamic = 'force-dynamic'`. Import = `requireAdmin`. Lecture bilan =
  `requireAuth` + scope org (calque `/api/digital/[id]/pacing`), **PAS** `assertDemo` (vraies
  campagnes). `createAdminClient()` pour l'accès service-role.
- **SQL via MCP Supabase** uniquement (jamais de SQL manuel) ; toute modif schéma/mapping
  s'accompagne d'un fichier `sql/` pour la trace repo.
- **Rétrocompat** : sans `campaign_id`, l'import garde son comportement actuel (crée une campagne).
- **TypeScript strict**, imports absolus `@/`. Pas de nouvelle table.

## Architecture

### Trou 1 — Import vers une campagne existante
`app/api/admin/campaigns/import/route.ts` :
- `ImportFieldsSchema` gagne un champ optionnel `campaign_id: z.string().uuid().optional()`.
- Si `campaign_id` fourni :
  - Charger la campagne (`dsp_campaigns` : `id, organization_id, dsp_source`). 404 si absente.
  - **Scope org** (calque `scopeGuard`) : super_admin sans org OU
    `campaign.organization_id === profile.organization_id`. Sinon 403.
  - **Sauter la création** de `dsp_campaigns` ; utiliser ce `campaign_id`. Le `dsp_source` du
    fichier importé doit être cohérent avec celui de la campagne (sinon la métrique de pacing
    diverge) — si différent, avertir dans l'event SSE `complete` (non bloquant), ne pas écraser
    le `dsp_source` de la campagne.
  - `campaign_organizations` : upsert idempotent inchangé (onConflict do nothing).
- **Idempotence des inserts** : remplacer l'`.insert(batch)` de la délivrance par
  `.upsert(batch, { onConflict: 'campaign_id,date,postal_code,city' })` — un ré-upload d'une même
  période ne casse plus sur la contrainte UNIQUE (remplace). Vaut pour les deux chemins
  (nouvelle campagne = aucun conflit, existante = remplace).
  Caveat pré-existant conservé : la clé UNIQUE exclut `media` ; deux médias même (date,CP,ville)
  se collapsent (dernier gagne). Sans objet pour Adform mono-média ; hors scope de le corriger.
- Le matching IRIS (`match_campaign_postal_to_iris`) reste appelé après les inserts (inchangé).
- Extraire une petite fonction pure `resolveImportTarget(profile, existingCampaign | null)` ou
  au minimum isoler la logique de scope pour testabilité (voir Tests).

### Trou 2 — Lecture bilan générique
`app/api/digital/[campaignId]/report/route.ts` (nouveau) :
- `GET`, `requireAuth` + `authUnauthorized()`. `export const dynamic = 'force-dynamic'`.
- Charger `dsp_campaigns` (`organization_id, dsp_source`). 404 si absente. Scope org identique à
  la route pacing (super_admin sans org OU même org) sinon 403/404.
- `const metric = camp.dsp_source === 'adform' ? 'tracked_ads' : 'impressions';`
- `const report = await buildCampaignReport(supabase, campaignId, metric);`
- Retour `{ report: report | null }`, `Cache-Control: no-store`. catch → `{ error }` 400.

> C'est le pendant générique et org-scopé de `GET /api/demo/report` (démo, admin, assertDemo).

## Data flow (le workflow réel qu'on rend possible)

```
1. (existe) Créer/choisir une campagne + son plan de zones (custom-geo) → snapshot avec périodes
   couvrant les dates de délivrance.
2. (NOUVEAU trou 1) Importer l'export Adform daté EN CIBLANT cette campagne (campaign_id) →
   dsp_campaign_data daté sur la bonne campagne.
3. (existe) get_campaign_pacing segmente la délivrance par période/version.
4. (NOUVEAU trou 2) GET /api/digital/[id]/report → CampaignReport (courbe, avant/après, budget).
```

## Error handling

- `campaign_id` inconnu → 404 `{ error: 'campaign_not_found' }` (import et report).
- `campaign_id` hors org → 403 (import) / 404 (report, ne pas fuiter l'existence).
- Fichier sans colonne `date` (ex. l'ancien « Custom GEO » non daté) → l'import échoue déjà via la
  validation `missingRequired` du mapping (date requis). Message clair conservé — on ne code PAS
  l'injection de date (décision : exports datés uniquement).
- Report d'une campagne sans snapshot → `buildCampaignReport` renvoie `null` → `{ report: null }`.

## Tests

- **Pur / unitaire** : extraire la résolution de cible d'import en une fonction testable
  (ex. `resolveImportScope(profile, campaign): { allowed: boolean; reason?: string }`) et tester :
  super_admin sans org ✓, même org ✓, org différente ✗, campagne absente ✗.
- **Route report** : dépend d'auth réelle → vérif navigateur/curl, pas d'unit.
- **Vérif E2E (navigateur/API authentifié)** :
  1. Créer une campagne de test (non démo) + un snapshot plan sur 2 périodes
     (2026-04-01..04-30, 05-01..05-30) dont les CP recouvrent des communes de la fixture.
  2. Importer `Custom GEO_dated_synthetic.xlsx` en ciblant cette campagne (`campaign_id`) →
     confirmer que les lignes atterrissent datées sur cette campagne (compte, plage de dates).
  3. `GET /api/digital/[id]/report` → CampaignReport cohérent (2 versions segmentées par période,
     budget/écarts calculés sur `tracked_ads`).
  4. Nettoyer la campagne de test.

## Task decomposition (pour writing-plans)

1. `ImportFieldsSchema` + logique `campaign_id` (scope, skip création, upsert idempotent) dans la
   route import ; fonction pure `resolveImportScope` + tests unitaires.
2. Route `GET /api/digital/[campaignId]/report`.
3. Vérif E2E sur la fixture datée (import ciblé + report), nettoyage.

## Hors scope (explicite)

- Surface UI pour visualiser le bilan d'une vraie campagne (onglet/​sélecteur) — itération suivante.
- Mapping DV360 (attend un vrai fichier DV360).
- Capture de `Unique Reach` (aucun consommateur).
- Rebid réel / génération des fichiers d'export DSP pour le tour suivant.
- Correction du caveat multi-média de la contrainte UNIQUE (pré-existant).
