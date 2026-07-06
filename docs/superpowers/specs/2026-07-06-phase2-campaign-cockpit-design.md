# Phase 2 — Cockpit campagne (design)

> Statut : **PROPOSITION à valider par Vincent** (écrit pendant qu'il était AFK, choix best-judgment signalés ⚑).
> Contexte : new Magelian = produit de pilotage de campagne. Le travail de pilotage (Brique A moteur + B agent + C bilan, pacing plan-vs-réel, rebid, import réel, démo bout-en-bout) existe mais est **éparpillé** sans entrée de menu cohérente (Pilotage ML dans le rail carte, `/custom-bidding`, `/demo/pilote` orphelin, `/campaigns/[id]`). Phase 2 = **regrouper** tout ça dans un cockpit par campagne, sous le pilier Campagnes.

## Objectif

Rendre la boucle de pilotage **visible et utilisable au même endroit** : depuis une campagne, on plante la cible, on voit ce qui est délivré, on mesure le pacing plan-vs-réel, on optimise (rebid/agent), on lit le bilan. Le tout **sans réécrire** ce qui existe — on l'orchestre.

## Principe directeur

**Regrouper, pas réécrire.** Chaque zone du cockpit monte des composants qui existent déjà. Zéro duplication, zéro dette : les surfaces absorbées (`/custom-bidding`, `/demo/pilote`) sont retirées de la nav et redirigées, pas laissées orphelines.

## Direction validée (Vincent, 06/07) — **fil d'Ariane step-by-step, super beau + simple, mémos**

Maquette de référence approuvée : `scratchpad/cockpit-mockup.html` (artifact). Cap directeur :
- **Super beau + simple** : une étape = **une décision**, épurée, zéro surcharge.
- **Fil d'Ariane** : la programmation d'une campagne est un parcours guidé pas-à-pas (breadcrumb/stepper), pas un formulaire dense.
- **Mémos** : à chaque étape, une carte teal « À quoi sert cette étape » + une astuce 💡 (pédago, courte).
- 100% design system MAGELIAN (dark, teal, flat, Inter/JetBrains Mono).

## Structure — `/campaigns/[id]` devient le cockpit

Le fil d'Ariane porte deux temps : **Programmer** (parcours guidé) puis **Piloter** (verrouillé tant que non lancé).

```
/campaigns/[id]  — COCKPIT
  ── programmer ──────────────────────────────  ── piloter ──────
  Cible → Zones → Budget → Stratégie → Lancement   Pilotage · Bilan
   (une décision par étape + mémo à droite)         (post-lancement)
```

### Temps 1 — Programmer (fil d'Ariane, 5 étapes)
Chaque étape = un écran focalisé + son mémo. **On réutilise le modèle de données existant** du `StrategyWizard` (identity/geography/objective/budget/mlagent) ; le fil d'Ariane en est la **surface belle et simple**, pas une nouvelle logique.
1. **Cible** — variable de ciblage (INSEE : abstention, âge, revenu…). Le « qui », fixe. ↔ `objective`/`geography.weighting`.
2. **Zones** — périmètre géo (national+DROM / régions / zone custom). La carte est un **outil** ici. ↔ `geography`.
3. **Budget** — budget total, CPM cible, période ; pacing anti-dépassement. ↔ `budget`.
4. **Stratégie** — comment l'enchère bouge (autonomie agent : monitor / suggest / auto). Le « comment ». ↔ `mlagent`.
5. **Lancement** — récap réversible → arme la campagne (passe en Piloter).

### Temps 2 — Piloter (post-lancement, verrouillé avant)
- **Pilotage** — monte le détail Pilotage ML **existant** (`PilotageOverlay` / `custom-bidding/[strategyId]/_components` : `StrategyHeader`, `HeroImpact`, `DualMap` réel-vs-sim, pacing plan-vs-réel, rebid, `AgentPanel`). La boucle délivrance→mesure→optimisation vit là. La carte y est un outil.
- **Bilan** — rapport C existant (`final-report`). « En cours » tant que non terminé.

### Accueil du cockpit
Le détail campagne actuel (KPIs, statut, Organisations, breakdown pays/région/dép/brutes) reste l'**écran d'atterrissage** ; le fil d'Ariane le surplombe. Rien de cet écran n'est réécrit.

## Absorptions (fin des orphelines — anti-dette)
- `/custom-bidding` (liste) + `/custom-bidding/[strategyId]` (détail) → **absorbés dans l'onglet Pilotage**. Les `_components` restent (ils sont l'implémentation) ; les **pages** `page.tsx` sont retirées et redirigées vers `/campaigns/[id]?tab=pilotage`. Le bouton « Voir la stratégie » du détail pointe vers l'onglet.
- `/demo/pilote` → devient une **campagne de démo** dans le portfolio (elle existe déjà : « Démo — pilotage CIRFA »), ouverte dans le cockpit comme les autres. La route `/demo/pilote` redirige vers cette campagne. Plus d'URL cachée.
- Le rail carte garde le bouton **Pilotage** (accès rapide depuis la carte) — mais il ouvre le pilotage *de la campagne active*, cohérent avec le cockpit.

## Ce qu'on NE touche pas
- Zones custom (`/map/custom-geo`) — pas de refonte (règle actée).
- Le moteur de pilotage, les RPC, les routes `/api/bidding/*` et `/api/digital/campaigns|codes-postaux`.
- La carte Explorer et ses overlays (Terrain/Audience/Analyses/Zones).
- Le scoping workspace, l'auth, les contraintes I/O Nano.

## Hors périmètre (⚑ après le cockpit)
- **Point 2** : campagne nationale-avec-renfort / locale (sur-pondération d'une baseline nationale). Se branchera dans l'onglet Aperçu/Plan une fois le cockpit en place. Non spécifié ici.

## Contraintes
- Design system dark-minimal, `var(--token)` uniquement, section headers bandeau + dot teal.
- TS strict, `getSession` API / `getUser` pages, scoping workspace conservé.
- Réutilisation stricte : toute nouvelle vue monte un composant existant ; interdit de dupliquer la logique pilotage/pacing/bilan.

## Décisions ouvertes pour Vincent
1. ⚑ 3 onglets (Aperçu / Pilotage / Bilan) vs 5 phases explicites (Plan / Délivrance / Mesure / Optimisation / Bilan) ?
2. ⚑ Absorber `/custom-bidding` et `/demo/pilote` (les retirer de la nav) — OK ?
3. ⚑ Point 2 après le cockpit — OK ?
```
