# Cockpit campagne — Plan d'implémentation (Increment 1)

> Sous-skill : superpowers:subagent-driven-development. Spec : `docs/superpowers/specs/2026-07-06-phase2-campaign-cockpit-design.md`. Maquette validée : scratchpad `cockpit-mockup.html`.

**But :** transformer `/campaigns/[id]` en cockpit — fil d'Ariane beau + simple (Programmer step-by-step avec mémos) puis Piloter/Bilan qui montent l'existant. Absorber `/custom-bidding` et `/demo/pilote`.

**Architecture :** shell client sur `/campaigns/[id]` avec machine à états de vue (`overview | prog:<k> | pilotage | bilan`). On **réutilise** : `StrategyWizard`, API `/api/bidding/strategies/**`, `FinalReport`, les `_components` custom-bidding. On **n'écrit pas** de logique pilotage/pacing/bilan neuve.

## Contraintes globales (rappel spec)
- Design system MAGELIAN dark-minimal, `var(--token)` uniquement, section headers bandeau + dot teal, Inter/JetBrains Mono, flat, teal #4ecdc4, pas de violet.
- Une étape = une décision, épurée + mémo teal « À quoi sert cette étape » + astuce 💡.
- TS strict, `getSession` API / `getUser` pages, scoping workspace conservé, I/O Nano.
- Réutilisation stricte : monter un composant existant, jamais dupliquer.
- Rien de l'écran d'atterrissage actuel (`/campaigns/[id]`) n'est réécrit — le fil d'Ariane le surplombe.

## Contrat de réutilisation (recon)
- Stratégie de la campagne : `GET /api/bidding/strategies` → filtrer `s.campaign_id === id` (0/1 live). Détail : `GET /api/bidding/strategies/[id]`.
- Création/édition : `StrategyWizard` (props `campaignId, campaignName, mode:'create'|'edit', strategyId?, initialDraft?, consumeDraftId?, onCompleted`). Autosave drafts intégré.
- Détail piloté : `StrategyDetail` (dans `components/map/overlays/PilotageOverlay.tsx`) — **privé, à exporter** ; sinon recomposer via les `_components` exportés (`StrategyHeader, HeroImpact, DualMap, CurveTranslator, AgentPanel, KpiDeltaCards, PlayControls, ComparisonTimeline, AbstentionHistogram, RevealScatter`) + `useViewMode`.
- Bilan : `FinalReport({ strategyId })` — exporté, self-fetch, mono-prop.

---

## Task 1 — Composants présentationnels FilAriane + StepMemo
**Files:** create `app/campaigns/[id]/_components/FilAriane.tsx`, `app/campaigns/[id]/_components/StepMemo.tsx`.
- `FilAriane` props : `{ steps: {key:string,label:string}[], phases: {key:string,label:string}[], activeKey: string, unlockedPiloter: boolean, onSelect(key) }`. Rendu = stepper de la maquette (programmer : done/active + connecteurs teal ; piloter : verrouillé 🔒 si `!unlockedPiloter`). Tokens `var(--…)`, aucune couleur en dur.
- `StepMemo` props : `{ paragraphs: string[], tip: string, mini?: number[] }`. Carte teal « À quoi sert cette étape » + astuce 💡 (fidèle maquette).
- **Gate :** `npx tsc --noEmit` 0 err. (Rendu vérifié en Task 2.)

## Task 2 — Shell cockpit sur /campaigns/[id]
**Files:** modify `app/campaigns/[id]/page.tsx`.
- Extraire le contenu actuel (header, KPI cards, Organisations, tabs pays/région/dép/brutes) tel quel dans une vue `overview` — **zéro changement fonctionnel** (fetchDetail, StatsTable, DataTable, OrganizationsSection, status-override, delete conservés).
- Ajouter `<FilAriane>` au-dessus + état `view` (`overview | prog:cible|zones|budget|strategie|lancement | pilotage | bilan`).
- Charger la stratégie de la campagne (pattern existant, filtre client) → `strategyId` + `status`. `unlockedPiloter = status === 'active' || 'completed'`.
- « Voir la stratégie » ne pousse plus vers `/custom-bidding/{id}` → `setView('pilotage')`.
- Onglets Programmer : pour l'increment 1, `prog:*` monte `<StrategyWizard>` dans le cadre cockpit (création si pas de stratégie, édition sinon) — la belle refonte 5-étapes bespoke = increment 2. Le fil d'Ariane reste la nav visible ; masquer le chrome interne du wizard si double-stepper.
- **Gate :** tsc 0 err + navigateur (cockpit rend, overview intacte, fil d'Ariane clique, /campaigns inchangé par ailleurs).

## Task 3 — Phase Piloter
**Files:** modify `components/map/overlays/PilotageOverlay.tsx` (ajouter `export` à `StrategyDetail`), modify cockpit.
- Exporter `StrategyDetail`. Dans la vue `pilotage`, monter `<StrategyDetail strategyId={strategyId} onEdit={()=>setView('prog:strategie')} onShowHistory={…} />`. Verrouillé si pas de stratégie active (message « Programme d'abord la campagne »).
- Vérifier que l'export ne casse pas l'overlay carte (même composant).
- **Gate :** tsc + navigateur (Pilotage du cockpit == overlay carte, KPI/DualMap OK).

## Task 4 — Phase Bilan
**Files:** modify cockpit.
- Vue `bilan` monte `<FinalReport strategyId={strategyId} />`. Si stratégie non terminée : état « bilan à venir ».
- **Gate :** tsc + navigateur.

## Task 5 — Absorptions (anti-dette)
**Files:** `app/custom-bidding/page.tsx` + `app/custom-bidding/[strategyId]/page.tsx` → remplacer par `redirect()` vers `/campaigns` (liste) et `/campaigns/{campaignId}?view=pilotage` (détail — résoudre campaignId via la stratégie) ; `app/demo/pilote/page.tsx` → `redirect('/campaigns/dede0000-0000-4000-8000-000000000001')` (campagne démo CIRFA). Repointer `app/map/analyse/digital/_components/CustomBiddingBar.tsx:108`. Garder tous les `_components`. Anti-dette : grep `href="/custom-bidding` / `/demo/pilote` → 0 lien mort.
- **Gate :** tsc + `npm run build` + grep anti-dette.

## Task 6 — Vérif finale
- `npm run build` vert, navigateur E2E : ouvrir une campagne → fil d'Ariane → Programmer (wizard) → Pilotage → Bilan ; redirections custom-bidding/demo OK ; 0 erreur console.

---

## Increment 2 (après validation) — reskin bespoke des 5 étapes
Remplacer le `StrategyWizard` embarqué par les 5 écrans simples de la maquette (Cible/Zones/Budget/Stratégie/Lancement) créant une stratégie via `POST /api/bidding/strategies` avec défauts sensés (algorithmes/objectifs lus depuis leurs endpoints). Le wizard riche reste l'échappatoire « expert ».
