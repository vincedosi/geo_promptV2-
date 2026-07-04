# Design — Agent de pilotage (B) : copilote qui pilote et raconte la boucle

> Date : 2026-07-04 · Portée : campagnes **digitales**. Brique **B** du module démo/pilotage — voir [[project_demo_bout_en_bout]].
> Statut : validé en brainstorming (4 sections), en attente de relecture avant plan d'implémentation.
> Dépend du **moteur A** (mergé, `8558336`) : routes `/api/demo/*` + pacing période-aware + `lib/demo/controller.ts` + `lib/pacing/*`.

## Problème

Le moteur A (la boucle plan → mesurer → corriger → converger) tourne, mais il faut l'exécuter
« à la main » (appeler les routes une par une). Pour une **démo commerciale** et pour poser les
**fondations d'un agent de pilotage produit**, il manque une couche IA qui **pilote et raconte**
la boucle : un copilote qui explique ce qu'il voit (« Vannes sous-servi de 12 pts »), agit
(corrige l'enchère), et commente la convergence — en appelant les **vrais** outils, pas en
simulant.

## Objectif

Un **agent de pilotage** (Gemini, sur l'infra chat existante) qui déroule la boucle du moteur A
avec deux modes : **guidé** (une action par tour, validée par l'utilisateur — démo pas-à-pas) et
**autonome** (l'agent enchaîne seul, décide de re-corriger tant que non conforme, s'arrête quand
ça converge — et narre chaque tour). Développé sur le moteur A réel.

### Bénéfice mesurable
En démo : on lance l'agent, il raconte la boucle en temps réel pendant qu'une **carte pacing**
montre l'écart fondre (13.9 → 4.6 → 0.79 pts). Pédagogique, vivant, et déjà la bonne structure
pour piloter une vraie campagne plus tard.

## Non-objectifs (hors scope de B)

- **Brique C — bilan / report PDF** (courbe de conformité, zone-par-zone avant/après) → spec suivant.
- **Piloter de vraies campagnes** (données réelles) : B tourne sur la campagne fictive du moteur A ; la généralisation viendra quand une vraie source de délivrance sera branchée.
- **Refonte du copilote généraliste** : l'agent de pilotage est une surface DÉDIÉE ; le copilote carte (`/api/chat`, POI/zones/IRIS) reste intact.
- **Démo multi-opérateurs simultanés** : la campagne démo est un singleton (ID fixe) → un opérateur à la fois.
- **Nouveau moteur d'orchestration** : on réutilise la boucle agentique `streamText` + `stopWhen` existante, pas l'orchestrateur mono-agent `smart-prompt`.

## Décisions de design (arbitrées en brainstorming)

1. **Agent DÉDIÉ** (pas une extension du copilote généraliste) : sa route `/api/pilot`, son system-prompt de pilotage, ses outils, son plafond de steps — mais réutilisant l'infra chat (`streamText` + `stopWhen`, patron d'outils, rendu « 1 outil → 1 composant »).
2. **Autonome = l'agent décide, borné** : il lit le pacing, re-corrige tant que non conforme, s'arrête sur `converged` OU après N tours. Double bornage (soft = flag/prompt, hard = plafond de steps). Le moteur seedé garantit la convergence.
3. **Guidé = une action par tour** : l'agent fait une action, s'arrête, propose la suite ; l'utilisateur relance.
4. **Les outils importent le moteur A directement** (`lib/demo/controller.ts` + `lib/pacing/*`), pas de fetch interne (pattern absent). Refactor : extraire l'orchestration des routes en fonctions du contrôleur, appelées par les routes ET les outils (zéro duplication).
5. **Rendu visuel de la convergence** : une `PacingCard` par mesure/correction, l'écart qui fond en synchro avec la narration.

## Architecture

```
   Surface démo dédiée (app/demo/pilote)
   ┌──────────────────────────────────────────┐
   │  PilotChatPanel  (patron ChatPanel :       │  toggle guidé/autonome
   │  useChat → /api/pilot, 1 outil→1 composant) │
   └───────────────┬────────────────────────────┘
   POST /api/pilot  │  (streamText + stopWhen, Gemini 2.5 flash,
   {mode}           │   system-prompt PILOTAGE, outils PILOTAGE, requireAdmin)
                    ▼
   Outils pilotage (lib/chat/pilot/) ──importent──▶  MOTEUR A (réel)
     demarrer_pilotage → seedDemo()      ┐
     mesurer           → readDemoPacing()├─ lib/demo/controller.ts (+ refactor)
     corriger_enchere  → applyRebid()    │  lib/pacing/{compute,rebid}
     reinitialiser     → resetDemo()     ┘
```

Le cœur agentique (`streamText` + `stopWhen: stepCountIs(...)`, Gemini via `createModel`) et le
patron d'outils (fonction → objet structuré, schéma Zod, rendu par type `tool-<nom>`) sont
**réutilisés tels quels** ; B ajoute une route, un system-prompt, 4 outils, un panneau et une carte.

## Refactor contrôleur + outils

**Refactor (extraction, pas de changement de comportement — couvert par la boucle E2E) :**
`lib/demo/controller.ts` gagne trois fonctions, et les routes `/api/demo/{seed,apply-rebid}`
deviennent de fines enveloppes qui les appellent :
- `seedDemo(supabase, userId): Promise<PilotResult>` — l'orchestration actuelle de la route seed.
- `applyRebid(supabase, userId): Promise<PilotResult>` — l'orchestration actuelle de la route apply-rebid.
- `readDemoPacing(supabase, version?): Promise<PilotPacing>` — enveloppe `get_campaign_pacing` (métrique du dsp_source) + `computePacing` pour la campagne démo.

La garde `is_demo` reste dans ces fonctions. Rien ne change pour le moteur A mergé.

**Les 4 outils** (`lib/chat/pilot/` — registre parallèle, le copilote généraliste intact) :

| Outil | Params | Appelle | Retourne |
|---|---|---|---|
| `demarrer_pilotage` | — | `seedDemo()` | `PilotPacing` (v1) + `delivery_rows` |
| `mesurer` | `version?` | `readDemoPacing()` | `PilotPacing` |
| `corriger_enchere` | — | `applyRebid()` | `PilotPacing` (vN+1) + `delivery_rows` |
| `reinitialiser` | — | `resetDemo()` | `{ ok }` |

`demarrer_pilotage` et `corriger_enchere` **renvoient le pacing résultant** → l'agent voit le
diagnostic sans appel `mesurer` séparé. Les outils importent le contrôleur directement
(`createAdminClient` server-side) ; `requireAdmin` sur `/api/pilot` fournit `userId`.

**Interfaces clés :**
```ts
type PilotStatus = 'sous_servi' | 'sur_servi' | 'conforme' | 'en_attente'; // = PacingStatus
interface PilotItem { item_id: string; item_name: string; expected_share: number; actual_share: number; delta_pts: number; status: PilotStatus; }
interface PilotPacing { version: number; mean_delta: number; converged: boolean; items: PilotItem[]; }
interface PilotResult extends PilotPacing { delivery_rows: number; }
```
`mean_delta = moyenne(|delta_pts|)` ; `converged = mean_delta < CONVERGENCE_TOLERANCE` (constante, défaut 2 pts). Le `status`/`delta_pts` par item + `converged` donnent à l'agent de quoi narrer ET décider.

## Modes guidé / autonome

Le paramètre `mode: 'guide' | 'autonome'` (body de `/api/pilot`) bascule la variante de
system-prompt ET le plafond de steps.

Le **system-prompt de pilotage** (commun) décrit : la boucle, la campagne CIRFA (4 items :
Brest/Rennes/Saint-Brieuc/Vannes), le modèle cible fixe ≠ enchère mobile, les 4 outils, la persona
(un copilote qui parle **avec les chiffres**). Bloc spécifique :
- **Guidé** : « fais UNE action, arrête-toi, dis ce que tu observes et propose la suite ». Plafond `stepCountIs(2)`.
- **Autonome** : « démarre, puis mesure→corrige en boucle, narre chaque tour, arrête-toi quand `converged` OU après `MAX_ROUNDS` (défaut 3) corrections ; ne réinitialise pas sauf demande ». Plafond `stepCountIs(12)` (filet dur).

**Bornage autonome = soft (agent lit `converged`/compte les tours) + hard (`stepCountIs`).**
Constantes tunables : `CONVERGENCE_TOLERANCE = 2`, `MAX_ROUNDS = 3`, `STEP_CAP_GUIDE = 2`, `STEP_CAP_AUTONOME = 12`.

## UI

- **`app/demo/pilote/page.tsx`** — surface dédiée hébergeant `PilotChatPanel`.
- **`PilotChatPanel`** — réutilise le patron `ChatPanel` (`useChat` → `/api/pilot`, rendu par type `tool-<nom>`), avec un toggle **guidé / autonome** en tête, la saisie, le fil.
- **`PacingCard`** — rendu des résultats `demarrer_pilotage`/`mesurer`/`corriger_enchere` : version, les items avec **part cible vs réelle + Δ colorés** (sous-servi = `var(--danger)`, sur-servi = `var(--warning)`, conforme = `var(--brand-teal)`), l'écart moyen, un badge **« conforme »** si `converged`. Design system : tokens `var(--…)`, sentence case, pas de hex.

Le spectateur voit les deux en synchro : l'agent explique, la carte montre l'écart fondre à chaque tour. Aucune refonte — un panneau + une carte ajoutés.

## Flux de données

- **Guidé** : message user → `/api/pilot {mode:'guide'}` → l'agent appelle 1 outil (import contrôleur) → narre + `PacingCard` → s'arrête. User relance.
- **Autonome** : message user → `/api/pilot {mode:'autonome'}` → l'agent enchaîne `demarrer_pilotage` → (narre + carte) → `corriger_enchere` × jusqu'à `converged`/`MAX_ROUNDS` → narration finale, **dans une seule réponse streamée**.
- **Reset** : `reinitialiser` → purge + re-seed (moteur A).

## Gestion d'erreur

- **Erreur d'outil** (seed échoue, zone non expansable, collision is_demo) → l'outil renvoie `{ error }` → l'agent le raconte (« je n'ai pas pu démarrer : … »), pas de crash ; la boucle agentique s'arrête proprement.
- **Emballement autonome** → `stepCountIs` (filet dur), même si le prompt dérape.
- **Agent s'arrête trop tôt / n'appelle pas l'outil** → l'utilisateur relance (le mode guidé est le filet) ; prompt clair + flag `converged` pour minimiser.
- **Campagne démo singleton** → un opérateur ; conflit multi-utilisateurs hors v1 (documenté).
- **Auth** : `/api/pilot` en `requireAdmin` ; les outils héritent du `userId`.

## Plan de test

- **Refactor contrôleur** (`seedDemo`/`applyRebid`/`readDemoPacing`) : **couvert par la boucle E2E du moteur A**, rejouée après extraction (mêmes chiffres 13.9→4.6→0.79). Non-régression des routes `/api/demo/*`.
- **Mapping `readDemoPacing` → `PilotPacing`** (test pur possible sur la transformation) : `status`/`delta_pts` par item, `mean_delta`, `converged = mean_delta < seuil` corrects.
- **`PacingCard`** : rendu + `tsc`, zéro hex, statuts colorés par token.
- **Vérif navigateur** (contrôle final) : lancer en guidé (une action/tour) puis autonome (boucle + arrêt à convergence), voir la narration + les cartes ; console sans erreur.

## Découpage & interfaces (pour le plan)

Unités isolées, dans l'ordre :
1. **Refactor `lib/demo/controller.ts`** : extraire `seedDemo`/`applyRebid`/`readDemoPacing` ; routes `/api/demo/{seed,apply-rebid}` réécrites en enveloppes. (Rejouer l'E2E.)
2. **`lib/chat/pilot/tools.ts` + `schemas.ts`** : les 4 outils (fonctions → objets structurés) + `buildPilotTools(userId)` (schémas Zod). Types `PilotItem`/`PilotPacing`/`PilotResult`.
3. **`lib/chat/pilot/system-prompt.ts`** : `buildPilotSystemPrompt(mode)` + les constantes tunables.
4. **Route `app/api/pilot/route.ts`** : `requireAdmin`, `streamText` + `stopWhen` (plafond selon mode), Gemini, prompt + outils pilotage.
5. **UI** : `app/demo/pilote/page.tsx` + `PilotChatPanel` (patron ChatPanel) + `PacingCard`.

Cohérence des types : `PilotStatus = PacingStatus` (réutilise `lib/pacing/compute`) ; `mean_delta`/`converged` cohérents entre le contrôleur, les outils et la carte.
