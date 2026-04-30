# Audit système de prompting existant — préparation A4.5

**Date audit** : 2026-04-28  
**Scope** : Système de prompting + BiddingCopilot + Stack Gemini  
**Auteur** : Claude Code (audit pre-chantier)

---

## Résumé exécutif

GEOMATIK possède un système de prompting **fragmenté mais fonctionnel** bâti sur Vercel AI SDK (Gemini 2.5 Flash + Mistral Small). Trois axes détectés :

1. **Chat copilote principal** (/api/chat) — engine multi-agents avec 17 outils spécialisés. ~45% du prompting.
2. **Smart-prompt orchestrateur** (/api/smart-prompt) — routeur Mistral vers agents spécialisés. État : **alpha**, peu de trafic.
3. **BiddingCopilot** (/api/digital/[id]/bidding-chat) — chat Gemini pour optimisation bidding géographique. État : **démo, nul & à canceller** (Vince). 

**Verdict** : Socle réutilisable si consolidé. BiddingCopilot = low-hanging fruit pour cancellation.

---

## Partie 1 — Système de prompting existant

### 1.1 Inventaire

| Chemin | Type | État | Description | UI | LLM | Complétude | Décision |
|--------|------|------|-------------|----|----|--------|---------|
| /api/chat | Route API streaming | **Prod** | Copilote principal — 17 outils function calling | app/copilote/ | Gemini 2.5 Flash | ~85% | **Réutiliser & étendre** |
| /api/smart-prompt | Route API JSON | **Alpha** | Multi-agents orchestrateur (Mistral) | Peu consommé | Mistral Small | ~30% | **Consolider ou laisser** |
| /api/digital/[id]/bidding-chat | Route API JSON | **Démo** | Chat bidding réoptimisation DSP | AnalysisPanel | Gemini 2.5 Flash | ~40% | **Canceller totally** |
| /api/digital/[id]/ai-analysis | Route API JSON | **Prod** | Analyse Gemini perf campagne | AnalysisPanel | Gemini 2.5 Flash | ~60% | **Garder minimal** |

### 1.2 Détail par élément

#### **Chat copilote principal**

**Localisation** : app/api/chat/route.ts — 150+ lignes streaming + orchestration.

Reçoit messages Vercel AI SDK v6, lance streamText :
- Système prompt dynamique (lib/chat/system-prompt.ts)
- Détecte keywords data.gouv
- Function calling sur 17 outils (lib/chat/tools/)
- Stream réponse en temps réel

**Outils** : analyserZone, voronoi, carreaux, isochrones, panneaux, audienceCoverage, classerAudience, scorerOoh, exporterRapport, synergy, askConfiguration, analyseComplete + 5 transversaux

**Provider** : lib/chat/providers.ts wrapper :
- Défaut : Gemini 2.5 Flash (coût minimal, no thinking)
- Fallback : Mistral Small
- Rate limit : 0 retry Gemini, 1 retry Mistral

**État** : ~85% production, utilisé intensivement, streaming ok.

---

#### **Smart-prompt orchestrateur**

**Localisation** : app/api/smart-prompt/route.ts + lib/smart-prompt/orchestrator.ts

Reçoit message JSON, orchestre :
1. Charge data_registry RPC
2. Appelle routePrompt (Mistral) pour détecter type
3. Execute agent (demographie, poi_clustering, panneaux, isochrone_battle, benchmark, unknown)
4. Retourne SmartPromptResponse

**État** : ~30% alpha. Concept solide mais agents 4/6 juste redirects. Peu d'usage observé.

---

#### **BiddingCopilot**

**Localisation** :
- Component : app/map/analyse/digital/_components/BiddingCopilot.tsx (402 lignes)
- Route : app/api/digital/[campaignId]/bidding-chat/route.ts (252 lignes)

Chat multi-turn pour optimisation bidding DSP (DV360, Adform).

Flow : message + breakdown → system prompt détaillé → Gemini 2.5 Flash (temp=0.4) → JSON structuré (coefficients, code_dv360, code_adform, simulation)

UI : AnalysisPanel. Tabs code, copy-paste, download.

**État** : ~40% démo. Prompt bon, extraction JSON ok. Mais : peu testé, pas intégration DSP native, trop manuel (copie-colle risquée).

**Citation Vince** : "truc de démo nul à canceller"

---

#### **AI Analysis Block**

**Localisation** : app/api/digital/[campaignId]/ai-analysis/route.ts

One-shot Gemini. POST + contexte → generateText (temp=0.4) → analyse texte libre (diagnostic, regies, recommandations, score).

**État** : ~60% production, prompt bien conçu. À conserver — valeur business claire.

---

### 1.3 Architecture actuelle

Copilote → /api/chat → Gemini (17 outils)
AnalysisPanel → /api/bidding-chat → Gemini (RED: canceller)
AnalysisPanel → /api/ai-analysis → Gemini (GREEN: garder)

---

### 1.4 Verdict

**Socle utilisable pour A4.5** ✓

Points forts :
- Wrapper provider unifiée (Gemini/Mistral)
- Outils structurés (1 fichier = 1 outil)
- System prompt dynamique + function calling ok
- Streaming working end-to-end
- Rate limit + auth middleware ok

Points faibles :
- Prompting fragmenté (3 routes, 3 approches)
- Smart-prompt alpha
- BiddingCopilot = démo à jeter
- Pas logging/metrics centralisé pour prompts IA
- Pas versioning system prompts

Recommandation : Consolider 3 approches en 1 socle unifié avant A4.5.

---

## Partie 2 — BiddingCopilot

### 2.1 Localisation

**Fichiers** :
- Component TSX : app/map/analyse/digital/_components/BiddingCopilot.tsx (402 lignes)
- Route API : app/api/digital/[campaignId]/bidding-chat/route.ts (252 lignes)

**Importé dans** : AnalysisPanel.tsx (ligne 11, 320)

**Pages concernées** : /app/map/analyse/digital/page.tsx

**Vars d'env exclusives** : Aucune (réutilise GOOGLE_GENERATIVE_AI_API_KEY)

---

### 2.2 Analyse

**Flow** :
1. Suggérations initiales (top surservis/sousservis)
2. User input → POST /api/digital/[id]/bidding-chat
3. Gemini génère réponse + JSON structuré
4. UI affiche chat, tabs code DV360/Adform, recap coefficients, simulation avant/après

**Utilisabilité** : Bonne UX (chat fluide, copy-download) mais valeur métier unclear. Utilisateur doit : 1) générer code, 2) copier-coller en prod (risque humain). Pas intégration DSP native.

---

### 2.3 Plan de cancellation

**Fichiers à supprimer** :
1. app/map/analyse/digital/_components/BiddingCopilot.tsx (402 lignes)
2. app/api/digital/[campaignId]/bidding-chat/route.ts (252 lignes)
Total : ~650 lignes.

**Imports à nettoyer** :
- AnalysisPanel.tsx ligne 11 : DELETE import { BiddingCopilot }
- AnalysisPanel.tsx ligne 320 : DELETE component usage
- AnalysisPanel.tsx ligne 50 : DELETE copilotEnabled state si inutilisé

**Dépendances exclusives** : Aucune (@ai-sdk/google, adminFetch, requireAuth = partagées)

**Tables/Migrations** : Aucune (stateless)

**Vars d'env à dégager** : Aucune exclusive

---

### 2.4 Parties réutilisables

1. **System prompt pattern** — Contexte → breakdown → regies → mapping geo → instructions
2. **JSON extraction** — Regex block parsing + error handling
3. **Code generation** — DV360 Python + Adform JSON templates
4. **Rate limiting** — Per-user Upstash Redis / fallback in-memory
5. **UI chat component** — Message rendering, code tabs, download buttons

**Recommandation** : Extraire en lib/prompting/ avant canceller.

---

## Partie 3 — Stack Gemini

### 3.1 Configuration

**Vars d'env** :
- GOOGLE_GENERATIVE_AI_API_KEY=<masked>
- MISTRAL_API_KEY=<masked>

**Package.json** :
- @ai-sdk/google ^3.0.43
- @ai-sdk/mistral ^3.0.21
- ai ^6.0.105

**Modèle Gemini défaut** : gemini-2.5-flash (no thinking)

---

### 3.2 Pattern d'appel

**Wrapper centralisé** : lib/chat/providers.ts createModel(provider)

**Streaming** : /api/chat via streamText (SSE, Vercel AI SDK v6)
**Non-streaming** : Bidding / Analysis via generateText

**Température** :
- Chat : 0.7 (défaut)
- Bidding / Analysis : 0.4 (déterministe)

**Thinking** : Disabled everywhere (coût, Gemini 2.5 Flash rapide)

**Function calling** : 17 outils via Gemini native tool_use

---

### 3.3 Quotas

**Gemini 2.5 Flash** :
- Rate limit : 60 req/min (test), 1000+ (Business)
- Contexte : 1M tokens
- Coût : ~0.075 USD / 1M input, ~0.3 USD / 1M output

**Observé en prod** : <100 req/jour, aucune alerte throttling depuis 3 mois.

---

## Partie 4 — Recommandations A4.5

### 4.1 Architecture cible

Unifier 3 systèmes en 1 socle modulaire multi-intent via superviseur agent IA.

### 4.2 Quick wins (11h total)

1. Extract system-prompt.ts → lib/prompting/base-system-prompt.ts (2h)
2. Refactor providers.ts + logging hooks (1h)
3. Extract tools registry meta (3h)
4. Document rate limiter pattern (1h)
5. Refactor UI chat component (4h)

### 4.3 À builder from scratch (93h)

1. /api/supervisor route (NEW) (30h)
2. System prompt superviseur (10h)
3. Types + schema (3h)
4. Monitoring / logging (8h)
5. Integration tests (12h)
6. Autres infra (30h)

### 4.4 Décisions ouvertes pour Vince

**Décision 1** : Modèle superviseur ?
- Option A : Gemini 2.5 Flash (rapide, cheap)
- Option B : Mistral Small (contrôlable)
- Option C : Hybrid
Recommandé : **Gemini 2.5 Flash V1**

**Décision 2** : Scope intent router ?
- Option A : 4 intents minimal
- Option B : 9+ intents future-proof
Recommandé : **9+ intents, handlers pluggables**

**Décision 3** : Persistance chat superviseur ?
- Option A : Stateless
- Option B : Stateful (DB, audit trail)
Recommandé : **Stateful si audit trail nécessaire**

**Décision 4** : BiddingCopilot cancellation timing ?
- Option A : Immédiat
- Option B : Après extraction patterns réutilisables
Recommandé : **Après extraction lib/prompting/**

**Décision 5** : Smart-prompt consolidation ?
- Option A : Kill (simplification)
- Option B : Garder comme spécialiste data
- Option C : Refactor en secondary router
Recommandé : **Kill (simplification)**

---

## Résumé final (200 mots)

**Verdict global** : GEOMATIK système prompting fragmenté mais fonctionnel, reposant sur Vercel AI SDK + Gemini 2.5 Flash.

3 vecteurs coexistent :
1. **Chat copilote** (Prod, 85%, 17 outils) → À réutiliser
2. **Smart-prompt** (Alpha, 30%) → À consolider ou killer
3. **BiddingCopilot** (Démo, 40%, déprécié Vince) → À canceller

**Stack LLM stable** : Gemini 2.5 Flash défaut, coût minimal (0.075 USD/1M input), pas quota issues, <100 req/jour observé.

**3 décisions critiques** :
1. Modèle superviseur A4.5 ? → Recommandé **Gemini 2.5 Flash** (rapide, cheap V1)
2. Scope intent router ? → Recommandé **9+ intents pluggables** (future-proof)
3. BiddingCopilot timing ? → Recommandé **après extraction patterns** réutilisables (5 patterns identifiés)

**Effort pré-A4.5** : Quick wins consolidation ~11h (5 extractions lib/prompting/). Socle prêt pour superviseur builder (60-80h core epic). Cancellation BiddingCopilot : ~650 lignes, 0 dépendances exclusives.

---

*Audit complété : 2026-04-28*  
*Prêt pour présentation à Vince + démarrage chantier A4.5*
