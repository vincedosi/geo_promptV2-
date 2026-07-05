# AUDIT — Obsolète vs gardé (nouveau Magelian « boucle de pilotage »)

> Date : 2026-07-05 · Statut : **inventaire, aucune suppression effectuée**
> But : lister ce qui, dans l'ancien paradigme « construire une campagne en éditant la carte + layers »,
> ne rentre plus dans le nouveau Magelian, pour préparer un nettoyage **sous-système par sous-système**.
> Ce doc est fait pour être **annoté** : coche/commente chaque sous-système.

## Cadrage — ancien vs nouveau

- **Nouveau Magelian** = piloter une campagne via la **boucle DSP** : import de délivrance réelle → plan/snapshot → pacing (plan-vs-réel) → rebid → bilan.
- **Modèle de campagne validé (Vincent, 2026-07-05)** : choix **au début** de la campagne —
  - **Nationale avec renfort** : base nationale (branding partout) + **part-cible relevée** sur des zones dessinées (ex. CIRFA Bretagne).
  - **Locale** : uniquement les zones dessinées.
  - ⇒ **Le dessin de zones est GARDÉ** (amont du plan local + renfort). Conséquence : la composante **nationale** ajoute une couche « baseline » au plan (`expected_share` = base nationale + renfort), et le pacing ne compte plus le hors-zone comme du pur « spillover » en mode national.

## Règle d'or de l'audit

Ne pas supprimer une **dépendance partagée** (lue par la boucle) même si elle est classée « ancien paradigme ».

### Dépendances PARTAGÉES — à préserver quoi qu'il arrive
| Élément | Ancien usage | Usage boucle (nouveau) |
|---|---|---|
| Table `custom_geo_zones` (+ `_codes`, `_subzones`) | création/résolution/export des zones dessinées | **source du plan** (la zone démo `DEMO_ZONE_ID = f001b479-… « CIRFA BRETAGNE »` est une vraie zone sauvegardée) |
| RPC `get_zone_items_export` | export ciblage DSP pondéré | seed démo (`ensureDemoPlan`) + `createPeriodSnapshot` |
| Table `campaign_plan_snapshot` | snapshot du plan média d'une zone | plan figé lu par `pacing` / `report` |
| Table `dsp_campaigns` (+ `geo_strategy.media_plan`, `is_demo`) | plan média zone | fixtures démo + campagnes réelles |
| Table `dsp_campaign_data` | — | délivrance (simulée/réelle) mesurée par le pacing |
| Table `ref_codes_postaux` | — | audience/CP pour le simulateur |
| RPC `get_national_population_totals` | colonne « % France » du plan média | **repêché** : socle du baseline **national** du nouveau modèle |
| Route `custom-geo/media-plan/snapshot` | fige le plan d'une zone | **pont** carte → pacing |

---

## 🟢 GARDER — cœur nouveau Magelian + amont du plan

### Boucle de pilotage (nouveau paradigme)
- `components/map/overlays/PilotageOverlay.tsx` (overlay Pilotage ML : liste stratégies / détail bilan / wizard / historique)
- `app/custom-bidding/[strategyId]/_components/*` (StrategyHeader, HeroImpact, AgentPanel, CurveTranslator, KpiDeltaCards, DualMap, RevealScatter, AbstentionHistogram, PlayControls, ComparisonTimeline)
- `app/strategies/_components/{StrategyWizard,StrategyHistoryView}.tsx`
- `lib/bidding-ml/*`, `lib/pacing/*`, `lib/report/*`, `lib/demo/*`
- Routes : `app/api/demo/**`, `app/api/pilot`, `app/api/digital/**`
- Démo/pilote : `app/demo/pilote/**` (PilotChatPanel, BilanPanel, ConvergenceChart, ZoneBeforeAfterTable, BudgetCard, KpiStrip, PacingPanel-like)

### Zones dessinées (amont plan local + renfort)
- Capture : `lib/custom-geo/CustomGeoCaptureContext.tsx`, `lib/custom-geo/useCustomGeoLayer.ts`, `components/custom-geo/CustomGeoCaptureModal.tsx`
- Galerie : `app/map/custom-geo/{page,CustomGeoPageClient}.tsx` + `_components/*` (ZoneDetailPanel, ZoneCard, ZonesGrid/Sidebar, dialogs) + `_hooks/*`
- Plan média : `app/map/_components/ZoneMediaPlanPanel.tsx`, `components/map/overlays/ZonesOverlay.tsx`, `lib/custom-geo/{media-plan,cibles,download-export,slug}.ts`, `lib/pacing/snapshot.ts`
- Routes : `app/api/custom-geo/{save,capture,list,stats,source-types,national-totals,[id]/*,media-plan,media-plan/snapshot}`
- Exports DSP (transformateur carte→DSP) : `lib/digital/{dv360-geo,dv360-bidding-script}.ts`, `ZoneDv360Dialog`

### Analyse digitale de campagne (mesure sur carte)
- `app/map/analyse/digital/**` (SyncMap, RailroadPipeline, AnalysisPanel, PacingPanel, KpiCardsDsp, MediaHeatmap, BreakdownChart, …)
- `components/digital/{TripleMapView,AnalysisPanelSwitch,AnalyseV2}.tsx`
- Routes : `app/api/digital/[campaignId]/{map,media,cp-detail,pacing,report}`, `app/api/digital/{codes-postaux,campaigns}`

---

## 🔴 CANDIDAT OBSOLÈTE — jamais touché par la boucle (les « études » de l'ancien Magelian)

> Aucun de ces éléments n'est référencé par `lib/{demo,pacing,report}`, `app/api/{demo,pilot}`.
> **Proposé pour suppression en premier** (ambiguïté nulle). À confirmer.

### Scoring OOH
- UI : `app/map/_components/ScoringPanel.tsx`, `app/map/_components/StudyDashboard.tsx`
- Routes : `app/api/scoring/{route,profiles,profiles/[id],isochrones,dashboard}`
- Export : `app/api/export/ooh-report`, `app/copilote/_lib/ooh-export.ts`
- Tables : `scoring_profiles` ; colonnes de score sur `panneaux_affichage`
- RPC : `compute_panneau_scores`, `compute_panneau_scores_v2`, `compute_isochrone_score`, `find_synergy_billboards`
- Outils IA : `scorer_panneaux_ooh`, `classer_panneaux_audience`, `analyze_poi_synergy`, `analyser_panneaux`, `exporter_rapport_ooh`

### Clustering POI
- UI : `app/map/_components/ClusteringWizard.tsx`, `ClusterPanel.tsx`, `components/Cluster*`, `app/clusters/**`
- Routes : `app/api/poi-clusters/**`
- Tables : `clustering_models`, `clustering_jobs`, `poi_clusters`, `poi_cluster_history`
- Script : `scripts/clustering_poi_filosofi.py`

### Corrélation IRIS × POI
- UI : `app/map/_components/CorrelationPanel.tsx`
- Routes : `app/api/correlation/{compute,analyse,categories,metrics}`
- RPC : `correlation_iris_iris`, `compute_poi_accessibility`, `get_accessibility_inputs`

### Couverture (coverage)
- UI : `components/CoverageResultsPanel.tsx`, `components/map/ClusteringResultsContent.tsx` (partie couverture)
- Routes : `app/api/coverage-{stats,breakdown,jobs}`
- RPC : `calculate_coverage_per_group`, `compute_coverage_fast`, `calculate_target_coverage`
- Job Inngest couverture (`lib/inngest/functions/*coverage*`)

### geography_sets (ancien « jeux de zones » via cache isochrone)
- Route : `app/api/geographies`
- RPC : `save_geography_from_cache`, `get_geography_sets`, `get_digital_geography_map`
- Table : `geography_sets`
- UI : `app/copilote/_components/SaveGeographyModal.tsx`

---

## 🟠 À TRANCHER (décisions produit — en attente de Vincent)

### Q1 — Isochrone battle & Voronoï
Ce sont des **outils de DESSIN de zone** (la zone CIRFA démo vient d'un battle).
- Fichiers battle : `app/api/isochrone-battle/**`, `app/api/isochrone-battle-v2`, `app/api/custom-geo/source/battle`, RPC `get_isochrone_battle`, `get_battle_geometry`, `clip_geojson_to_france`, handlers `onDirectBattle*`/`onApplyBattle` dans `FilterPanel`+`page.tsx`, outil IA `isochrone_battle`.
- Fichiers voronoï : `app/api/custom-geo/source/voronoi`, RPC `get_voronoi_by_category`, `get_voronoi_capture_geometry`, outil IA `voronoi_analysis`.
- **Défaut recommandé : GARDER** (sinon plus de source pour la zone démo / le renfort).

### Q2 — Layers d'analyse socio-démo & terrain
IRIS, carreaux Filosofi, POI, OOH (affichage), radio FM/DAB+, météo, TMJA, indicateurs civiques/santé.
- Certains servent à **capturer une zone** (`useCustomGeoLayer`) → contributifs au plan.
- **Défaut recommandé : garder le cœur** (IRIS/carreaux/POI) ; **dégraissage à valider** des périphériques (radio, météo, TMJA, civic/santé, OOH scoring).
- Routes concernées si dégraissage : `app/api/map/*`, `app/api/radio/**`, `app/api/meteo-geo/**`, `app/api/civic-indicators/**`, `app/api/admin/radio/**` + tables `emetteur_radio*`, `radio_stations`, `pollen_map_daily`, `atmo_map_daily`, `civic_health_cache`.

### Q3 — Copilote IA de la carte (geo.prompt)
`app/copilote/**`, `useToolProcessor`, outils IA de construction/analyse.
- **Défaut recommandé : GARDER en élaguant** les outils rattachés aux sous-systèmes supprimés (scoring, clustering, corrélation, couverture, synergy).

---

## Approche de suppression (quand les arbitrages sont posés)

**⚠️ Ce n'est pas un `rm`.** `app/map/page.tsx` (~2800 l.) et `FilterPanel.tsx` (~4341 l.) câblent tout via props/handlers/état. Supprimer un sous-système = **débranchage chirurgical** de ces fichiers-dieu.

Par sous-système, dans cet ordre (dépendances feuilles d'abord) :
1. Retirer l'entrée UI (bouton/section dans FilterPanel/IconBar/overlay).
2. Retirer le composant + ses props dans `page.tsx` / parent.
3. Supprimer routes API + outils IA (`useToolProcessor`) associés.
4. Supprimer libs/hooks/composants dédiés devenus orphelins (vérifier `grep` d'usage).
5. SQL (tables/RPC) : **via MCP Supabase**, en DERNIER, après confirmation qu'aucune autre route ne les lit (drop RPC puis table ; garder un backup/export si données).
6. `npx tsc --noEmit` + `npm run build` + vérif navigateur ciblée à chaque étape.
7. 1 sous-système = 1 branche = 1 merge indépendant.

**Ordre proposé (du plus sûr au plus délicat)** : geography_sets → Couverture → Corrélation → Clustering → Scoring OOH → (puis, si validés) dégraissage layers terrain → élagage outils copilote.

## Checklist décisionnelle (à annoter)

- [ ] Scoring OOH — supprimer ?
- [ ] Clustering POI — supprimer ?
- [ ] Corrélation — supprimer ?
- [ ] Couverture — supprimer ?
- [ ] geography_sets — supprimer ?
- [ ] Q1 Battle/Voronoï — garder (défaut) / supprimer / mixte : __________
- [ ] Q2 Layers terrain — garder tout / dégraisser (liste) / minimal : __________
- [ ] Q3 Copilote carte — garder+élaguer (défaut) / garder tout / supprimer : __________
- [ ] Composante **nationale avec renfort** : nouvelle feature à concevoir (baseline `get_national_population_totals` + sur-pondération renfort) — cycle brainstorm→spec→plan séparé.
