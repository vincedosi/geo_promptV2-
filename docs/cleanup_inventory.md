# Inventaire repo MAGELIAN — pré-cleanup A4.6

> Date : 2026-04-30
> Snapshot : main HEAD `980deaf`

## Volume

| Métrique | Valeur |
|---|---|
| Fichiers `.ts` / `.tsx` | **496** |
| Lignes totales | ~85 000 |
| Routes API (`app/api/**/route.ts`) | **189** |
| Migrations SQL (`supabase/migrations/`) | **39** |
| Tables publiques Supabase | **70** (1 sans RLS = `spatial_ref_sys` PostGIS-OK) |
| Tables sans PK | 1 (`carreaux_1km`) |
| RPCs / functions Postgres | 880 (incl. PostGIS natives) |
| `console.log` dans le code | 149 (hors tests) |
| Occurrences `: any` / `@ts-ignore` | 105 |

## Top 25 fichiers les plus longs (à splitter en P2)

| Lignes | Fichier |
|---|---|
| 3789 | app/map/_components/FilterPanel.tsx |
| 2831 | app/admin/sources/page.tsx |
| 2329 | app/map/page.tsx |
| 1791 | app/admin/import/page.tsx |
| 1650 | app/dashboard/iris-crawler/page.tsx |
| 1526 | app/admin/carreaux-import/page.tsx |
| 1493 | app/map/_components/CorrelationPanel.tsx |
| 1253 | components/CoverageResultsPanel.tsx |
| 1253 | components/ClusterDetails.tsx |
| 1114 | app/integration-panneaux/page.tsx |
| 1061 | app/map/_components/ClusterPanel.tsx |
| 962  | app/copilote/_hooks/useMapLayers.ts |
| 952  | app/copilote/_hooks/useMapInit.ts |
| 916  | app/admin/radio/page.tsx |
| 882  | app/admin/campaigns/page.tsx |
| 877  | components/ClusteringPDFReport.tsx |
| 850  | app/copilote/_components/ChatPanel.tsx |
| 816  | app/map/_components/ClusteringWizard.tsx |
| 796  | app/admin/filosofi-import/page.tsx |
| 735  | components/digital/AnalyseV2.tsx |
| 720  | app/map/analyse/digital/page.tsx |
| 693  | app/map/_components/ScoringPanel.tsx |
| 687  | app/admin/organizations/[id]/page.tsx |
| 655  | app/copilote/_components/MapPanel.tsx |

**Cible** A4.6 : aucun fichier > 500 lignes après refacto P2. **20+ fichiers** dépassent ce seuil → effort estimé 12-15h (P2 dédié).

## Routes API : auth coverage

- **189 routes** trouvées
- **136 routes** ont auth explicite (`requireAuth` / `requireAdmin` / `getSession` / `getUser`)
- **53 routes** sans auth grep'able — à classer en P1 (publiques OK vs vrais oublis)

Liste complète et classification dans `docs/cleanup/security_audit.md`.

## Migrations DB (39)

Toutes les migrations `supabase/migrations/*.sql` sont commit-tracked. Le schéma final inclut :
- 8 tables `bidding_*` (chantier A4.1)
- `bidding_zone_config_proposals` (A4.3)
- `agent_autonomy_settings` + `bidding_agent_actions` (A4.5)
- 24 RPCs métier custom (`get_*`, `aggregate_*`, `match_*`, `compute_*`, etc.)

## Données critiques (intactes — vérif Adform legacy)

| Donnée | Attendu | Mesuré |
|---|---|---|
| `dsp_campaigns` Adform | 4 | 4 ✓ |
| `dsp_campaign_data` Adform rows | 294 135 | 294 135 ✓ |
| `tracked_ads` total Adform | 172 056 383 | 172 056 383 ✓ |

## Recommandations cleanup

Phases priorisées (impact / risque) :
1. **P1 sécurité** — quick wins : classer routes sans auth, doc RLS
2. **P3 DB** — quick wins : ajouter PK sur `carreaux_1km`, doc RPCs orphelines
3. **P4 deps** — patch vulns critical (1) et high (2 — xlsx limite)
4. **P5+P6 docs+onboarding** — high impact pour devs externes
5. **P2 qualité code** — gros effort (12-15h), à reporter en session dédiée
   - 105 `any` à fix
   - 149 console.log à logger ou supprimer
   - 20+ fichiers > 500 lignes à splitter
