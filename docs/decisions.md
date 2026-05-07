# Architecture Decision Records (ADR) — MAGELIAN

10 décisions structurantes du projet, avec contexte et justification.

---

## ADR-1 — Supabase comme BaaS

**Contexte** : besoin d'une stack rapide à mettre en place, avec PostgreSQL + PostGIS + Auth + RLS + Edge Functions.

**Décision** : Supabase Pro (compute Nano au démarrage).

**Justification** : PostgreSQL 15 natif + PostGIS pré-installé, RLS performante, JS/Python clients matures, pricing prévisible. Alternative envisagée : Firebase (rejeté pour absence de PostGIS), Render/Hasura (plus de friction setup).

**Conséquences** :
- ✓ Setup infra en 30 min
- ✓ RLS auto sur toutes les tables
- ⚠️ Limites compute Nano : max 250 IOPS, burst 30min/jour. CLAUDE.md liste les patterns interdits (batch > 1 colonne IRIS, bbox France entière sans LIMIT).

---

## ADR-2 — Modal pour le Python ML, pas Edge Functions

**Contexte** : Hoeffding Adaptive Tree (river) est un modèle Python qui doit être ré-entraîné régulièrement. Besoin d'un endpoint HTTPS fiable, peu cher.

**Décision** : Modal (modal.com) — Python serverless HTTPS. Free tier $30/mois suffit.

**Justification** : Edge Functions Supabase sont en TypeScript (pas adapté à `river`). Vercel Functions ne supportent pas Python natif. Modal est conçu pour le Python serverless ML, déploiement en 1 commande, secrets gérés. Latence ~6s par /predict (acceptable).

**Conséquences** :
- ✓ Python natif (river, pandas, numpy installables)
- ✓ Secrets Supabase isolés via `magelian-supabase` Modal Secret
- ⚠️ Une dépendance supplémentaire à monitorer (mais Modal a un bon track record)

---

## ADR-3 — Hoeffding Adaptive Tree comme algo de bidding (pas Random Forest, pas LinUCB)

**Contexte** : chantier A4.2 — benchmark de 5 algos online learning sur le dataset démo Renault Captur.

**Décision** : Hoeffding Adaptive Tree gagnant avec **+91.97% de lift** vs +25% pour LinUCB et négatif pour Thompson/baseline_random/gbm_online.

**Justification** : Hoeffding gère bien les concept drifts (changement de distribution post-J+15), apprend online sans batch, robuste aux features hétérogènes. Cf `docs/chantier_a4_2_benchmark_results.md` pour les courbes lift/CPL.

**Conséquences** :
- ✓ Algo retenu pour V1 production
- ✓ Architecture pluggable (`algos/registry.py`) pour switcher si besoin
- 📌 LinUCB en fallback si Hoeffding diverge (à instrumenter dans un futur chantier)

---

## ADR-4 — Gemini 2.5 Flash partout (pas Pro, pas Claude)

**Contexte** : besoin LLM pour le copilote chat (17 outils) + l'agent superviseur GeoAgent. Coût et latence critiques.

**Décision** : Gemini 2.5 Flash (no thinking) en défaut, Mistral Small en fallback.

**Justification** : 0.075$/M input tokens (vs 5$/M pour GPT-4o), latence 2-6s acceptable, contexte 1M tokens, function calling natif. Pro réservé aux cas où le raisonnement profond est nécessaire (pour V1 GeoAgent : pas le cas — drift analysis est structurée).

**Conséquences** :
- ✓ Coût estimé $0.0002 par drift analysé
- ✓ <100 req/jour observé en démo
- 📌 Si GeoAgent passe à un raisonnement complexe (multi-step planning) → bascule vers Pro à évaluer

---

## ADR-5 — Pattern execution_mode auto/suggest/monitor sur les stratégies

**Contexte** : Hoeffding peut générer 100+ recommandations par jour. Le planner ne veut pas valider chacune, mais ne veut pas non plus que tout parte en auto sans contrôle.

**Décision** : 3 modes (`monitor_only`, `suggest`, `auto`) configurables par stratégie sur `bidding_strategies.execution_mode` + table `bidding_zone_config_proposals` pour la queue de validation.

**Justification** : reflète le cycle d'adoption naturel — démarrage en monitor pour observer, suggest pour valider quelques changements, auto pour les zones à confiance élevée. Pattern data-driven (pas d'enum hardcoded en TS).

**Conséquences** :
- ✓ UI cohérente (bouton 3-ways dans `StrategyHeader`)
- ✓ Backend enforce `apply_bid_change` selon le mode
- ✓ Reflété dans GeoAgent autonomy 5 niveaux (ADR-9)

---

## ADR-6 — Système d'intents pluggable pour GeoAgent (9 intents, registry auto-load)

**Contexte** : GeoAgent doit gérer plusieurs cas d'usage (analyse drift, query data, recommandation, navigation, comparaison campagnes...). Pas envie de tout coder en V1, mais architecture future-proof obligatoire.

**Décision** : `lib/agent/intents/index.ts` avec registry `INTENT_REGISTRY` + auto-load via `loadAllIntents()`. V1 : `analyze_drift` complètement implémenté, 8 autres intents en stubs.

**Justification** : ajout d'un intent = 1 nouveau fichier `lib/agent/intents/<code>.ts` + 1 ligne dans `loadAllIntents()`. Aucune modif de l'orchestrator. Pattern testé sur `analyze_drift` qui fonctionne en E2E.

**Conséquences** :
- ✓ Extension trivial pour les 8 stubs
- ✓ Tests d'intégration possibles intent par intent
- 📌 Tools registry (Vercel AI SDK function calling) pas encore plumbé — viendra avec le 1er intent qui en a besoin

---

## ADR-7 — Adform vs DSP : séparation stricte au niveau métier

**Contexte** : Adform est un adserver (legacy MAGELIAN, 4 campagnes en base = TF1 MAR / FEU 2025 / FR MAR / FR AT, 294 135 lignes, 172 056 383 tracked_ads). Les autres DSP (TTD, DV360, Meta...) sont du programmatic real-time bidding et peuvent recevoir des bid_multipliers.

**Décision** : Custom Bidding désactivé sur Adform (UI affiche un message "Custom Bidding nécessite une source DSP" sur les pages campagnes Adform). Pas de RLS bloquante, juste UX-driven.

**Justification** : Adform n'a pas d'API de bid modulation côté MAGELIAN ; pousser des configs là-dessus est du gaspillage. Le filtrage est au niveau `dsp_campaigns.dsp_source = 'adform'` côté UI.

**Conséquences** :
- ✓ Adform legacy strictement intact à chaque chantier (smoke test SQL systématique)
- ✓ Pas de pollution des stats Custom Bidding par Adform
- 📌 Si un futur chantier "Adform delivery optimization" est lancé, ce sera un module séparé

---

## ADR-8 — PMTiles pour les IRIS bas zoom, MVT côté serveur pour les détails

**Contexte** : 51 000 zones IRIS (~16 400 vraies + virtuelles). À zoom < 11, charger le GeoJSON tue le navigateur (>50MB). À zoom > 11, charger via MVT serveur permet de filtrer par bbox.

**Décision** : PMTiles servies via GitHub Releases (pas Supabase Storage) pour zoom ≤ 10. MVT custom (`/api/iris-tiles/[z]/[x]/[y]`) pour zoom > 10.

**Justification** : PMTiles = 1 seul fichier `.pmtiles` ~50MB compressé, lu par MapLibre via HTTP range requests. Hébergement gratuit GitHub Releases. MVT pour les détails ne pèse que quelques KB par tile, latence ~100ms acceptable.

**Conséquences** :
- ✓ Carto IRIS fluide à tous les zooms
- ✓ Pas de coût Supabase Storage
- 📌 Proxy `/api/iris-tiles-proxy` pour CORS / auth si dépôt PMTiles privé

---

## ADR-9 — 5 niveaux d'autonomie agent (Observer → Full auto)

**Contexte** : GeoAgent doit pouvoir aller du purement réactif (répond aux questions) jusqu'à l'autonomie totale (agit sans validation). Mais transition pas-à-pas obligatoire.

**Décision** : `agent_autonomy_settings.autonomy_level` (0-4) avec scope `user_default` ou `strategy_override`. Niveaux : Observer (0), Explainer (1), Suggester (2 default), Auto-low-risk (3), Full auto (4).

**Justification** : 5 niveaux couvrent bien le spectre d'adoption. Default Suggester (2) car le plus sûr pour démarrer. Override par stratégie permet de pousser les zones de confiance en Auto sans changer le default global.

**Conséquences** :
- ✓ `enforceAutonomy(actions, level)` côté agent route les actions selon le niveau
- ✓ Audit trail systématique (`bidding_agent_actions.autonomy_level_at_time` snapshot)
- 📌 Niveau 1 (Explainer) attend un système de notifications proactif (pas implémenté V1)

---

## ADR-10 — Pattern `adminFetch()` pour le client → API auth

**Contexte** : routes API exigent un Bearer token Supabase (`Authorization: Bearer <jwt>`). Le client doit l'injecter sans dupliquer la logique.

**Décision** : `lib/admin-fetch.ts` exporte `adminFetch(url, options)` — wrapper `fetch()` qui lit la session via `createBrowserClient` et injecte le header.

**Justification** : drop-in replacement pour `fetch()`. Évite la duplication aux ~80 callsites. Fonctionne avec le système RLS Supabase qui décode le JWT côté serveur.

**Conséquences** :
- ✓ Tous les `adminFetch('/api/...')` dans le code passent l'auth
- ✓ Si user logged out → 401 retourné par le route handler
- 📌 Note : `lib/admin-fetch.ts` (pas `lib/auth/fetch.ts`) — historique du nom, à standardiser éventuellement
