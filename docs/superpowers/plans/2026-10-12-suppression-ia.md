# Suppression de toute l'IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** plus aucune IA dans le code de dentsu.explore (Gemini, Mistral, Vercel AI SDK, agent, smart-prompt, copilote, bilans Gemini, ML Modal) — AIDA (shell dentsu) devient l'IA. Les fonctions NON-IA qui passaient par le chat sont gardées par une route directe.

**Architecture:** six lots indépendants, dans un ordre qui garde `tsc`, les tests et les deux builds verts à chaque lot. Chaque lot supprime du code, retire ses appelants, adapte les tests qui le verrouillaient et met à jour la doc DANS le même commit.

**Tech Stack:** Next.js 15, React (gelé sauf retraits demandés ici), Angular 21, Vitest, PostgreSQL local.

**Décisions de Vincent (2026-10-07 et 2026-10-12, verbatim résumé) :** « supprimer tout ce qui est chatbot IA… le code, le front et le backend, c'est AIDA qui va devenir l'IA » ; « je veux plus rien d'IA dans le code » ; « tu peux sup les tables historiques de chat » ; classement des territoires : supprimé (reco suivie). Voronoï : gardé par une route directe (reco). ML Modal + agent d'enchères : supprimés (reco). `middleware.ts` (protégé) : retirer SEULEMENT les entrées des routes IA — couvert par « plus rien d'IA dans le code », à citer dans le rapport du lot 6.

**Inventaire de référence (2026-10-12) :** `.superpowers/sdd/2026-10-12-suppression-ia/inventaire.md` — chemins et lignes exacts ; le relire avant chaque lot et RE-VÉRIFIER par Grep (le code bouge).

## Global Constraints

- Ne rien supprimer de NON-IA. Garder : k-means du clustering (`/api/poi-clusters/run` et routes non-analyse), l'« assistant » de clustering Angular (formulaire en étapes, pas une IA), `lib/isochrones/fetcher.ts`, `get_campaign_medias`, `get_campaign_stats_by_field`, la sauvegarde des cartes (`useSavedMaps` sans les messages), `lib/bidding-ml/metric-labels.ts` (déplacé vers `lib/bidding/`).
- Base : seules les tables d'HISTORIQUE DE CHAT (`agent_chat_messages`, et la RPC `purge_old_agent_chat_messages`) sont supprimées, après `scripts/local/10-sauvegarder.sh`, par une migration `sql/NNN_suppression_historique_chat.sql` rejouable (`DROP … IF EXISTS`). TOUTES les autres tables/RPC IA (`agent_autonomy_settings`, `agent_recommendations`, `adaptive_model_state`, `bidding_agent_actions`, `bidding_drift_events`, `bidding_algorithms`, `smart_prompt_feedback`, `smart_*`, `classer_territoires`, `get_active_data_registry`, `get_strategy_comparison_data`, colonne `clustering_models.analysis`) restent en base : liste remise au propriétaire en fin de chantier.
- Fichiers protégés : `app/api/isochrone-battle/route.ts` jamais touché ; `middleware.ts` seulement au lot 6, entrées IA seulement.
- Tests verrouillés (`troncature-postgrest`, `derive-documentation`, `navigation/config`, parités Angular, `perimetre-routes`) : on les MET À JOUR (retirer l'entrée supprimée), jamais on ne les désactive.
- Doc à jour dans chaque commit : `ARCHITECTURE.md` (Grep par titre de section), `CLAUDE.md` (Stack, clés IA, « Outils IA », table des fichiers de référence) au lot 6, `README.md`, `.env.example`.
- Variables d'env IA retirées de `.env.example` et de la doc ; `.env.local` / `.env.development.local` du poste : NE PAS les modifier (le propriétaire gère ses clés).
- Base locale seulement ; pas de push sur `main`, pas de PR. Branche `feat/suppression-ia`.
- Vérification de chaque lot : `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build` (Next), et pour les lots qui touchent `angular/` : `cd angular && npx ng test --watch=false` + `npm run build`. Jamais de commande de test dans un pipe.

## Review Focus

1. Un écran React qui montait un composant IA retiré (Suivi › détail technique, Analyse digitale, fiche de cluster, carte) doit toujours s'afficher, sans trou ni erreur console → preuve navigateur du lot concerné.
2. Le bouton Voronoï de `PanneauAnalyse` : même résultat qu'avant (cellules affichées) par la route directe, avec la garde de périmètre (`categorieEntierementVisible`) → test + navigateur au lot 4.
3. `bidding/strategies` (création et lecture d'une stratégie) sans les lectures/écritures d'autonomie : la réponse ne perd que `agent_autonomy_override` → test au lot 2.
4. Les imports déplacés depuis `app/copilote/` (`useMapInit`, `useMapLayers`, `constants`, `MapPanel`, `useSavedMaps`) : la carte React s'ouvre et ses tests de parité lisent les nouveaux chemins → lot 4.
5. Aucun appel restant vers une route supprimée (Grep `/api/chat`, `/api/smart-prompt`, `/api/providers`, `/api/agent`, `final-report`, `ai-analysis`, `generate-analysis`, `/analysis`) ni import de `ai` / `@ai-sdk/*` → contrôle de fin de chaque lot, test permanent au lot 6.

---

### Lot 1 : code IA sans consommateur

Supprimer : routes `app/api/pilot`, `app/api/digital/[campaignId]/campaign-chat`, `app/api/demo/report/narrative` ; `lib/chat/pilot/**`, `lib/campaigns/suivi-chat.ts` ; leurs tests (`tests/unit/campaigns/suivi-chat.test.ts`…). Vérifier par Grep qu'aucun front ne les appelle. Commit : `chore(ia): retrait des routes IA sans appelant (pilot, campaign-chat, narrative)`.

### Lot 2 : agent d'enchères et ML Modal

- `app/layout.tsx` : retirer `AgentProvider`, `AgentTrigger`, `AgentPanel` ; supprimer `app/_components/agent/**`.
- Supprimer `lib/agent/**`, `lib/prompting/**` (y compris `code-generation`, et `tests/unit/prompting/*`), `app/api/agent/**`, `app/api/bidding/train`, `lib/bidding-ml/client.ts`, `lib/inngest/functions/agentAutoPilotDaily.ts` et `agentChatPurgeWeekly.ts` (+ leur enregistrement dans `app/api/inngest/route.ts`), `modal/**`.
- `app/api/bidding/strategies/route.ts` et `[id]/route.ts` : retirer les lectures/écritures `agent_autonomy_settings` / `adaptive_model_state` et la propriété `agent_autonomy_override` (et son type, et l'écran React qui l'affiche s'il existe — Grep). Test : création et lecture d'une stratégie inchangées hors ce champ (Review Focus 3).
- Migration `sql/NNN_suppression_historique_chat.sql` : `DROP FUNCTION IF EXISTS purge_old_agent_chat_messages…; DROP TABLE IF EXISTS agent_chat_messages;` — sauvegarde avant, appliquée en LOCAL, comptes avant/après dans le rapport ; retirer la table de `types/database.types.ts` et de `tests/integration/cloisonnement-rls.test.ts` si listée.
- Doc : ARCHITECTURE « Agent autonome (bidding) », bloc Modal, variables `MODAL_*`.
- Commit : `chore(ia): retrait de l'agent d'enchères, du ML Modal et de l'historique de chat`.

### Lot 3 : bilans Gemini hors carte

- Supprimer `components/campaign/FinalReport.tsx` et `app/api/bidding/strategies/[id]/final-report` ; retirer son montage de `components/campagne/suivi-v2/DetailTechnique.tsx`.
- `lib/bidding-ml/comparison.ts`, `targeting-kpis.ts` supprimés ; `metric-labels.ts` déplacé vers `lib/bidding/metric-labels.ts` (imports corrigés, dont `export/route.ts`) ; dossier `lib/bidding-ml/` supprimé.
- `AiAnalysisBlock.tsx` et `app/api/digital/[campaignId]/ai-analysis` supprimés ; retirés de `AnalysisPanel.tsx` et `components/digital/AnalyseV2.tsx`.
- Analyse Gemini des clusters : routes `poi-clusters/models/[version]/{analysis,generate-analysis}` supprimées, bloc correspondant de `components/ClusterDetails.tsx` retiré, parties Gemini de `scripts/clustering_poi_filosofi.py` retirées (le k-means reste et doit tourner : relancer `--help` ou un essai à blanc si le script en a un).
- Résumé Mistral des sources : `app/api/admin/sources/[id]/summary` supprimé, son bouton dans `app/admin/sources/page.tsx` retiré (« plus rien d'IA »).
- `troncature-postgrest.test.ts` : retirer `get_strategy_comparison_data`.
- Preuve navigateur : Suivi d'une campagne de démo › détail technique, Analyse digitale, fiche d'un cluster, Sources admin : s'affichent, aucune erreur console (Review Focus 1).
- Commit : `chore(ia): retrait des bilans et analyses Gemini`.

### Lot 4 : prérequis avant de couper le chat

- Déplacer `app/copilote/_hooks/useMapInit.ts`, `useMapLayers.ts`, `_lib/constants.ts`, `_components/MapPanel.tsx`, `useSavedMaps.ts` vers `app/map/_hooks/` et `app/map/_lib/` / `app/map/_components/` (`git mv`, contenu inchangé sauf : bouton « recalculer » de `MapPanel` qui renvoyait au chat retiré, et restauration des messages de `useSavedMaps` retirée). Corriger tous les imports et les tests qui lisent ces chemins (`angular/carte-ordre-couches`, `carreaux/iris-couche`, `iris/cascade-zoom`, `angular/carte-couches-paritaire`, `angular/risques-logique-carte-paritaire`…).
- Voronoï : nouvelle route `GET /api/voronoi?categorie=` (Zod, `force-dynamic`, `sourcesVisiblesDeLaRequete` + `categorieEntierementVisible` comme `lib/chat/tools/voronoi.ts`, RPC `get_voronoi_by_category_jsonb`, réponse de même forme que ce que l'outil rendait à l'écran) ; `PanneauAnalyse.tsx` : `handleVoronoi` appelle la route et affiche le résultat par le même chemin d'affichage que le résultat d'outil (lire `useToolProcessor` pour le reproduire sans IA). `troncature-postgrest` : rattacher `get_voronoi_by_category(_jsonb)` à la nouvelle route. Tests de la route + navigateur (Review Focus 2).
- Commit(s) : `refactor(carte): le moteur de la carte quitte app/copilote` puis `feat(carte): Voronoï par une route directe, sans le chat`.

### Lot 5 : copilote React, entrée Assistant, chat

- `app/map/page.tsx` : retirer chat, rate-limit, tool processor, `AIOverlay`, `chatSlot`, props provider, `recalculerIsochrone` ; `filter-panel/types.ts` (`chatSlot`, `sendMessage`) ; `PanneauAnalyse` (`sendMessage`, `send`).
- Supprimer `components/map/overlays/AIOverlay.tsx`, `app/copilote/**` (ce qui reste), `lib/chat/**`, `lib/smart-prompt/**`, `lib/mcp/datagouv.ts`, `components/chat/**`, routes `app/api/chat`, `smart-prompt`, `providers/status` ; sélecteur Gemini/Mistral de `SettingsOverlay.tsx`.
- Entrée « Assistant » (Ctrl+K) : retirée de `lib/navigation/config.ts`, `RailNavigation.tsx` ET d'Angular (`features/carte/logique/navigation.ts`, filtres de `rail.component.ts`, `aide.component.ts`, `carte.page.ts`) — les deux copies ensemble (test de parité). Angular : tuile « geo.prompt / Copilote IA » de l'accueil et boutons Mistral/Gemini de `reglages.component.ts` retirés.
- Désinstaller `ai`, `@ai-sdk/google`, `@ai-sdk/mistral`, `@ai-sdk/react` (`npm uninstall`, lockfile commité).
- Tests : supprimer `tests/unit/chat/*`, `chat-tools/*`, `trim-history`, `integration/voronoi-jsonb` (si remplacé par le test de la route) ; mettre à jour `troncature-postgrest` (retirer `classer_territoires`, `compte_poi_par_categorie`, `get_active_data_registry`, `smart_demographie_top_villes`), `navigation/config.test.ts`, `derive-documentation` (minimum d'entrées de navigation 8 → 7, libellé Assistant), parités et specs Angular nommées dans l'inventaire, `panneau-analyse-garde` (React et Angular).
- Preuve navigateur : `/map` React s'ouvre, rail sans Assistant, Ctrl+K inerte, Voronoï OK ; Angular carte et accueil sans IA, deux thèmes.
- Commit : `chore(ia): retrait du copilote, du chat et de l'entrée Assistant`.

### Lot 6 : configuration, docs, verrou

- `next.config.js` (CSP : `api.mistral.ai`, `generativelanguage.googleapis.com`), `scripts/setup-check.ts`, `app/api/admin/health/route.ts` (contrôle `MISTRAL_API_KEY`) et ses specs Angular (`health.page.spec.ts`, `carte-verification.component.spec.ts`), `.env.example` (`GOOGLE_GENERATIVE_AI_API_KEY`, `MISTRAL_API_KEY`, `MODAL_*`), `derive-documentation` (plus d'exigence MODAL/GOOGLE_GENERATIVE/« Modal »).
- `middleware.ts` (PROTÉGÉ) : retirer `/api/chat`, `/api/providers`, `/api/smart-prompt` des listes et du matcher, RIEN d'autre ; citer l'accord du propriétaire (« plus rien d'IA dans le code », 2026-10-12) dans le message de commit et le rapport.
- Docs : `ARCHITECTURE.md` (Stack, Arborescence, Navigation de /map, Routes API › Chat & Copilote IA, Clustering, Voronoi & Stats villes, Variables d'environnement, Application Angular), `CLAUDE.md` (Stack sans « Vercel AI SDK », retrait des lignes clés IA, Modal, « Outils IA : 1 fichier = 1 outil », ligne « Outil IA » de la table de référence), `README.md`, `docs/deployment.md`, `docs/runbook.md`, `docs/CARTOGRAPHIE.md`.
- Nouveau verrou `tests/unit/securite/aucune-ia.test.ts` : aucun fichier suivi (hors `docs/`, `.superpowers/`, `sql/` historique) n'importe `ai` ou `@ai-sdk/*`, ne lit `GOOGLE_GENERATIVE_AI_API_KEY` / `MISTRAL_API_KEY` / `MODAL_`, n'appelle `generativelanguage.googleapis.com` / `api.mistral.ai`, et `package.json` ne déclare aucun de ces paquets.
- Rapport final : liste des tables/RPC IA restées en base pour décision du propriétaire.
- Commit : `chore(ia): plus aucune IA dans la configuration et la documentation`.
