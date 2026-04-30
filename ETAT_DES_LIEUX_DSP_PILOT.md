# État des lieux — Custom Bidding / DSP Pilot

**Date** : 2026-04-28 14:15 (GMT+2)
**Branche** : `feat/analyse-v2` (HEAD `40e1f97`, 26 fichiers modifiés non committés)
**Auteur** : audit READ-ONLY (sub-agents A/B/C/D parallèles)
**Sources croisées** : MCP Supabase (DB), filesystem + git (code), Playwright (UI dev locale), Vercel MCP (logs **inaccessibles, 403**)

---

## ⚠️ Note de lecture

Le chantier "DSP Pilot" décrit dans `docs/PROMPT.md` cible **un nouveau schéma `dsp_pilot.*`** distinct du legacy `public.dsp_campaigns`. Le code et la base contiennent déjà le **legacy Adform** (`public.dsp_campaigns`, 4 campagnes, 294 135 lignes) — cette infra est intacte mais ne correspond PAS au chantier 1. Le sub-agent B a tendance à confondre les deux ; le sub-agent A (lecture DB directe) tranche : **`dsp_pilot.*` n'existe nulle part**.

---

## Section 1 — Tableau récapitulatif des chantiers

| # | Chantier | Statut | Preuves | Bloquants |
|---|----------|--------|---------|-----------|
| **1** | Schéma `dsp_pilot.*` (4 tables + RLS + seeds TTD + 10 KPIs) | ❌ **ABSENT** | A.1/A.2/A.3 vides ; aucune migration `dsp_pilot*` ; tables `source_mappings` et `metrics_registry` introuvables (DB + code) | Tout : schéma à créer, RLS, seeds DSP, seeds KPIs |
| **2** | Page `/admin/import-dsp` + parser flexible via `source_mappings` | ❌ **ABSENT** (nouveau) / 🟡 **PARTIEL** (legacy déjà OK) | `/admin/import-dsp` → **404** confirmé via Playwright. Aucun dossier `app/api/admin/import-dsp`, aucune route `import-dsp`. **Mais** `/admin/campaigns` existe avec modal d'import legacy supportant déjà 6 DSP (`adform`, `dv360`, `ttd`, `xandr`, `amazon_dsp`, `other`) via `lib/campaigns/column-mappings.ts` (mapping en dur dans le code, pas via table) | Décision produit : créer la nouvelle archi `/admin/import-dsp` ou étendre l'existante `/admin/campaigns` ? |
| **3** | Visualisation Campagne Média multi-source lisant `dsp_pilot.*` | ❌ **ABSENT** (multi-source réel) / ✅ **FAIT** (single-source legacy) | `app/map/analyse/digital/*` lit exclusivement `public.dsp_campaign_data` (40+ fichiers ; 0 référence `dsp_pilot`). Source = colonne `public.dsp_campaigns.dsp_source` mais 100% des rows sont `adform` | Pas de bloquant tant que `dsp_pilot.*` n'existe pas |
| **4** | Custom Bidding (`bidding_*` + Hoeffding + drift events) | ❌ **ABSENT** (ML) / 🟡 **PARTIEL** (UI chat Gemini) | Aucune table `bidding_*` (A.12 vide) ; **0 référence "Hoeffding" ou "drift"** dans le code ; ce qui existe : `BiddingCopilot.tsx` + `BiddingRecommendation.tsx` + route `/api/digital/[campaignId]/bidding-chat` (chat Gemini multi-turn) | Tout l'algo ML, le tracking de drift, le store des recommandations |
| **+** | **Custom Geo Capture** | ✅ **FAIT** (plomberie) / 🟡 **USAGE FAIBLE** | Tables `custom_geo_zones` (2 lignes), `custom_geo_zone_codes` (2 849 lignes), 10 RPCs, 14 migrations (du 19/04 au 28/04), hook `useCustomGeoLayer` + `CustomGeoCaptureContext`, 6 fichiers consommateurs, RPC `aggregate_dsp_by_custom_zone` (croisement DSP × zones) | Seules 2 zones live, 2 source_type sur 9+ déclarés (`composite`, `isochrone_battle`) ; pas de zone `iris_selection` / `carreaux_filosofi` / `drawing` réelle |
| **−** | **Adform legacy** (non-régression) | ✅ **INTACT** | 4 campagnes / 294 135 lignes (cf. INSPECTION_DSP_IMPORT.md ✓), modal d'import opérationnel, `/admin/campaigns` rendue avec stats correctes | — |

---

## Section 2 — Détail "Zones custom en place"

L'utilisateur a déclaré "les zones customs sont en place". Vérification précise :

| Question | Réponse | Preuve |
|----------|---------|--------|
| Hook `useCustomGeoLayer` implémenté ? | ✅ OUI | `lib/custom-geo/useCustomGeoLayer.ts` (52 lignes) + `CustomGeoCaptureContext.tsx` |
| Modes de capture opérationnels ? | ✅ Plomberie générique en place pour 9 types ; **2 exercés réellement** | `source-type-labels.ts` déclare : `isochrone_battle`, `carreaux_filosofi`, `iris_selection`, `voronoi_cells`, `radio_coverage`, `meteo_grid`, `poi_clusters`, `tmja_routes`, `admin_filter`. DB ne contient que `composite` (×1) et `isochrone_battle` (×1) |
| Table `custom_geo_zones` existe ? | ✅ OUI | Schéma `public` ; colonnes : `id`, `name`, `description`, `org_id`, `created_by`, `source_type`, `source_metadata jsonb`, `geometry`, `bbox`, `feature_count_iris`, `feature_count_cp`, `resolved_at`, `audience_stats jsonb`, `audience_computed_at`, `created_at`, `updated_at` |
| RLS + indexes ? | ✅ RLS activée | 4 policies (`select_by_org`, `insert_by_user`, `update_by_creator`, `delete_by_creator`) ; codes via 1 policy SELECT (writes via RPC SECURITY DEFINER) |
| Zones concrètes en base ? | 🟡 2 zones | `CIRFA bretagne` (isochrone_battle, 699 IRIS, 132 CP) ; `test-debug-2026-04-28` (composite, 1 907 IRIS, 96 CP) |
| Modules map qui sauvegardent ? | ✅ `useCustomGeoLayer` câblé dans 6 fichiers | `app/map/_components/CaptureLayers.tsx`, `app/map/_components/FilterPanel.tsx`, `app/map/analyse/digital/page.tsx`, `lib/custom-geo/CustomGeoCaptureContext.tsx`, `app/dev/test-custom-geo-capture/page.tsx` |
| Liaison aux codes postaux ? | ✅ Table `custom_geo_zone_codes` | 2 849 lignes au total, schéma `(zone_id, code_type, code)`. `code_type` accepte `cp`, `iris`, `dept`, `region` (extension v2 du 28/04) |
| RPCs liées | ✅ 10 RPCs | `create_custom_geo_zone`, `resolve_custom_geo_zone_codes` (×2 surcharges), `get_custom_geo_zone_feature`, `get_custom_geo_zones_stats`, `list_custom_geo_source_types`, `admin_list_custom_geo_zones`, `admin_get_custom_geo_stats`, `aggregate_dsp_by_custom_zone`, `custom_geo_zones_before_write` |

**Conclusion section 2** : la plomberie est complète et propre. Le système est **utilisable mais peu utilisé**. Il existe déjà un branchement DSP × zones (`aggregate_dsp_by_custom_zone`) qui sera la base du chantier 4.

---

## Section 3 — Adform legacy (non-régression)

| Vérification | Attendu (INSPECTION_DSP_IMPORT.md) | Mesuré | Statut |
|--------------|-------------------------------------|--------|--------|
| `public.dsp_campaigns` count | 4 | 4 | ✅ |
| `public.dsp_campaign_data` count | 294 135 | 294 135 | ✅ |
| `dsp_source` values | `adform` uniquement | `adform` × 4 | ✅ |
| `/admin/campaigns` UI | Liste + import + suppression | Liste rendue (TF1 MAR, FEU 2025, FR MAR., FR AT) + dropdown 6 DSP + multi-tenant org | ✅ |
| Module Campagne Média (`/map/analyse/digital`) | Breakdown / heatmap / KPI / chat bidding | 20+ composants présents, 40+ refs `dsp_campaign*` dans le code | ✅ |

**Conclusion** : aucune régression sur le legacy. Toutes les routes `/api/digital/*` et `/api/admin/campaigns/*` listées dans `ARCHITECTURE.md` sont présentes côté code.

---

## Section 4 — Diagnostic des incohérences

| # | Incohérence | Impact | Recommandation |
|---|-------------|--------|----------------|
| **I-1** | Modal d'import propose 6 DSP (adform/dv360/ttd/xandr/amazon_dsp/other) mais le mapping de colonnes (`lib/campaigns/column-mappings.ts`) ne couvre vraiment qu'`adform`. Les autres tombent sur un fallback Adform | Si un user upload un CSV TTD/DV360, le parser va probablement crasher ou produire des données fausses sans erreur claire | Soit cacher les options non implémentées, soit créer la table `source_mappings` (chantier 2) pour gérer dynamiquement |
| **I-2** | Sub-agent B a comptabilisé les migrations `20260408_dsp_campaigns*` et `20260409_dsp_*` comme preuves du chantier 1, mais ces migrations créent `public.dsp_campaigns` (legacy Adform) — **pas le schéma `dsp_pilot.*`** demandé | Risque de croire que le chantier 1 est fait alors qu'il est à zéro côté DB | Refaire le décompte uniquement sur `schemaname='dsp_pilot'` (résultat = 0) |
| **I-3** | Le sub-agent D (Vercel logs) **n'a pas pu accéder** au projet `genesis-app` (403 Forbidden — projet absent du scope MCP de la team `vincedosis-projects`) | Aucun signal sur ce qui tourne réellement en prod | Re-link Vercel : sur https://vercel.com/account/integrations → Claude → vérifier scope + ré-auth ; ou `vercel link` dans le repo |
| **I-4** | `useCustomGeoLayer` déclare 9 source_type mais seuls 2 sont exercés en base (composite, isochrone_battle) | On ne sait pas si `iris_selection`, `carreaux_filosofi`, `drawing` marchent vraiment end-to-end | Test manuel via Playwright des 4 modes principaux avant chantier 4 |
| **I-5** | `BiddingCopilot.tsx` + route `/api/digital/[campaignId]/bidding-chat` existent et tournent, mais aucune table `bidding_*` ne stocke les recommandations | Les conseils Gemini ne sont pas auditables, pas de feedback loop possible, pas de drift detection | Si chantier 4 est démarré : table `bidding_recommendations` + `bidding_drift_events` à modéliser |
| **I-6** | 26 fichiers modifiés non committés sur `feat/analyse-v2` (cf. `git status`) | Risque de perdre des fixes en cours | Committer ou stasher avant tout chantier neuf |

---

## Section 5 — Recommandation : prochaine action concrète

**Décision préalable nécessaire** : que souhaite-t-on entre ces deux scénarios ?

- **A.** Reset / reformuler le chantier 1 — reconnaître que le legacy `public.dsp_campaigns` couvre déjà la fonction "import DSP multi-source" (avec quelques extensions minimes) et **abandonner le schéma `dsp_pilot.*` séparé**. Avantage : économise 2 chantiers entiers (1 et 2), réduit la dette schéma.
- **B.** Garder le plan initial — créer le schéma `dsp_pilot.*` propre (4 tables + RLS + seeds + parser via `source_mappings`) en parallèle du legacy, puis migrer.

**Si A est retenu** (recommandé pour vélocité) → prochain prompt à lancer :

> Étendre l'import existant `/admin/campaigns` pour qu'il fonctionne réellement avec DV360 et TTD (et non plus seulement Adform en fallback) :
> 1. Crée une table `public.dsp_source_mappings(dsp_source text, column_pattern text, target_field text, is_required bool, transformer text)` au lieu d'avoir les mappings en dur dans `lib/campaigns/column-mappings.ts`.
> 2. Seed-la avec les 3 mappings concrets : Adform (déjà en place, à traduire en rows), DV360, TTD.
> 3. Refactor `lib/campaigns/column-mappings.ts:getMappingForSource()` pour lire la DB via Supabase admin client (avec cache mémoire pour éviter les hits I/O multiples — règle Nano du CLAUDE.md).
> 4. Ajoute un test d'upload TTD/DV360 dans Playwright pour valider le parsing.
> 5. Référence : INSPECTION_DSP_IMPORT.md, lib/campaigns/column-mappings.ts:16-31.

**Si B est retenu** → relance d'abord la création du schéma `dsp_pilot.*` strict :

> Crée le schéma `dsp_pilot.*` selon docs/PROMPT.md chantier 1 — migration unique avec : tables `campaigns`, `campaign_data`, `source_mappings`, `metrics_registry` ; RLS multi-tenant identique à `public.dsp_campaigns` ; seeds : 1 ligne TTD dans `source_mappings`, 10 KPIs dans `metrics_registry`. Migration nommée `20260428_dsp_pilot_v1.sql`. Aucune migration de données depuis `public.*` à ce stade.

**Quoi qu'il en soit, AVANT de démarrer** : commit/stash des 26 fichiers modifiés en cours sur `feat/analyse-v2` (incohérence I-6), puis re-link Vercel pour récupérer l'observabilité (I-3).

---

## Section 6 — Annexes (sortie brute des sub-agents)

### A — Inspection base Supabase (MCP)

```
A.1 schémas custom (hors système) : supabase_migrations uniquement.
A.2 dsp_pilot.tables : []
A.3 dsp_pilot.columns : []
A.7 dsp_pilot.rowsecurity : []
A.8 dsp_pilot.policies : []
A.5 dsp_pilot.source_mappings : table inexistante
A.6 dsp_pilot.metrics_registry : table inexistante

A.9 Adform legacy :
  public.dsp_campaigns       : 4
  public.dsp_campaign_data   : 294135

A.10 tables %zone% / %custom% (hors bruit pg_catalog) :
  auth.custom_oauth_providers
  public.custom_geo_zone_codes
  public.custom_geo_zones
  public.geography_zones

A.11 counts :
  custom_geo_zones      : 2
  custom_geo_zone_codes : 2849
  geography_zones       : 93

A.11bis distribution source_type :
  composite        : 1
  isochrone_battle : 1

A.12 tables bidding_% : []

A.13 RPCs (%pilot% / %bidding% / %custom_zone% / %custom_geo%) :
  10 RPCs, toutes custom_geo_* ou aggregate_dsp_by_custom_zone.
  ZÉRO RPC pilot ou bidding.

A.14 migrations matchant : 14, toutes custom_geo*. Plus récente :
  20260428071254_resolve_custom_geo_add_dept_region_v2
  Aucune dsp_pilot* ni bidding*.

Recherche élargie %source_mapping% / %metrics_registry% / %pilot% : []

Aucune écriture effectuée.
```

### B — Inspection codebase

```
B.1 Migrations DSP/bidding/custom_zone/custom_geo (lecture supabase/migrations/) :
  20260408_dsp_campaigns.sql            ← legacy Adform, PAS dsp_pilot
  20260408_dsp_stats_rpc.sql            ← legacy
  20260409_dsp_impression_stats.sql     ← legacy
  + 14 migrations custom_geo_* (cf. A.14)
  Aucune migration nommée dsp_pilot* ni bidding*.

B.2 Routes API import-dsp : aucun dossier app/api/admin/import-dsp/.
    Page /admin/import-dsp/page.tsx : ABSENTE.
    Routes existantes côté legacy : app/api/admin/campaigns/{import,preview,populate-postal}/route.ts.

B.3 Custom-geo files :
  lib/custom-geo/CustomGeoCaptureContext.tsx
  lib/custom-geo/source-type-labels.ts
  lib/custom-geo/useCustomGeoLayer.ts
  Consommateurs useCustomGeoLayer (6 fichiers) :
    app/dev/test-custom-geo-capture/page.tsx
    app/map/_components/CaptureLayers.tsx
    app/map/_components/FilterPanel.tsx
    app/map/analyse/digital/page.tsx
    lib/custom-geo/CustomGeoCaptureContext.tsx
    lib/custom-geo/useCustomGeoLayer.ts

B.4 Composants Campagne Média : 20+ fichiers dans app/map/analyse/digital/ (AnalysisPanel, BreakdownChart, KpiSummary, MediaHeatmap, MapLegend, SyncMap, BiddingCopilot, BiddingRecommendation, …)

B.5 Composants bidding (tous existants, sans ML local) :
  app/api/digital/[campaignId]/bidding-chat/route.ts
  app/map/analyse/digital/_components/BiddingCopilot.tsx
  app/map/analyse/digital/_components/BiddingRecommendation.tsx

B.6 grep "dsp_pilot" --include="*.ts" --include="*.tsx" . : 0 résultat
B.7 grep "CustomZone|custom_zone|customZone" : 23 fichiers (app/admin/sources/_components/CustomZonesTab/* et hooks/types) — fonctionnalité d'admin différente, à ne pas confondre

B.8 Doc :
  docs/PROMPT.md (692 lignes — le brief actuel)
  docs/superpowers/plans/2026-04-08-dsp-campaign-import.md (1849 lignes — plan legacy)

B.9 Branches matchant : aucune (juste main, feat/analyse-v2 actuelle).
B.9b Commits récents matchant :
  23213a7 fix(bidding-copilot): toutes les couleurs hardcodées passées en vars themed
  5a2bd34 feat(custom-geo): intégration dans /map/analyse/digital
  8b6d7a4 feat(custom-geo): fondations generiques (table + RPC + API + composant)
  ce8c600 feat(digital-bidding): copilot chat + code generation + simulation

B.10 git status : 26 modifiés / 23 supprimés / 7 untracked
     HEAD : 40e1f97 fix(map): /map carte tronquée au mount
```

### C — Inspection UI navigateur (Playwright, dev locale `localhost:3000`)

```
URL                              Statut    Observations
---------------------------------------------------------------------------
/admin                           404       Page introuvable
/admin/dsp-pilot                 404       Page introuvable
/admin/import-dsp                404       Page introuvable
/admin/import-dsp/page           404       Page introuvable
/custom-bidding                  404       Page introuvable
/admin/campaigns                 200       Liste 4 campagnes Adform (TF1 MAR, FEU 2025,
                                           FR MAR., FR AT). DEBUG bandeau jaune visible.
                                           Bouton "Importer une campagne" (modal).
                                           Bouton "Peupler codes postaux + matcher IRIS".
                                           Multi-tenant via combobox org.
/admin/campaigns/import          302→200   Redirige vers /admin/campaigns (pas une page).
/map/custom-geo                  200       2 zones affichées (CIRFA bretagne / test-debug-2026-04-28).
                                           Sidebar "TYPE DE SOURCE" : Tous(2), composite(1), isochrone_battle(1).
                                           Preview map "undefined, undefined" (mini-bug d'affichage bbox).

Modal /admin/campaigns "Importer une campagne" :
  - Fichier (CSV ou XLSX)
  - Source DSP (dropdown) : adform | dv360 | ttd | xandr | amazon_dsp | other
  - Organisation (dropdown) : 4 orgs disponibles
  - Nom (auto-détecté depuis le fichier)
  - Boutons : Annuler / Analyser le fichier

Sidebar nav (left) : aucun lien "Import DSP", "DSP Pilot", "Custom Bidding".

public.dsp_campaigns colonnes :
  id, name, dsp_source, advertiser, date_start, date_end,
  total_tracked_ads, countries, created_at, created_by,
  organization_id, total_unique_impressions

public.dsp_campaigns.dsp_source distribution : adform × 4 (uniquement)
```

### D — Inspection logs runtime Vercel

```
ECHEC — outil Vercel inaccessible (8/8 requêtes en 403 Forbidden).

Diagnostic :
  list_teams → team_SzpLZyLJbWFyLTgAYa9eBhac (vincedosis-projects) accessible.
  list_projects(teamId) → {"projects": []}.
  get_project(prj_amWqjAzOi0Azss1zbeH3Et2soB9H) → 404.
  get_project("genesis-app") → 404.

Cause probable :
  - L'intégration MCP Claude→Vercel est connectée à la team mais le scope projet
    n'inclut pas genesis-app (config "Specific Projects" sans cocher genesis-app),
  - OU le projet vit sous une autre team Vercel,
  - OU SAML SSO sur la team bloque le token MCP.

Action requise :
  https://vercel.com/account/integrations → Claude → vérifier scope projets.
  OU : vercel link dans C:\GENESIS\genesis_app pour ré-aligner.

Audit reportable une fois l'accès rétabli (8 requêtes prêtes à rejouer).
```

---

## Verification finale (`@verification-before-completion`)

1. ✅ Le rapport répond à "Où en est-on sur Custom Bidding / DSP Pilot ?" → chantiers 1/2/3/4 absents en tant que `dsp_pilot.*`, legacy Adform OK, Custom Geo Capture OK plomberie.
2. ✅ La section 5 propose 2 prompts actionnables (scénarios A et B) à copier-coller selon décision produit.
3. 🟡 Sources croisées : DB ✓, code ✓, UI ✓, **logs Vercel manquants (I-3)** — flag explicite dans le rapport.
4. ✅ Incohérences détectées : 6 listées en section 4.

`git status` final : 1 fichier untracked = `ETAT_DES_LIEUX_DSP_PILOT.md`.
