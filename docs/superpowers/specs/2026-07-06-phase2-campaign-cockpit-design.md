# Phase 2 — Cockpit campagne (design)

> Statut : **PROPOSITION à valider par Vincent** (écrit pendant qu'il était AFK, choix best-judgment signalés ⚑).
> Contexte : new Magelian = produit de pilotage de campagne. Le travail de pilotage (Brique A moteur + B agent + C bilan, pacing plan-vs-réel, rebid, import réel, démo bout-en-bout) existe mais est **éparpillé** sans entrée de menu cohérente (Pilotage ML dans le rail carte, `/custom-bidding`, `/demo/pilote` orphelin, `/campaigns/[id]`). Phase 2 = **regrouper** tout ça dans un cockpit par campagne, sous le pilier Campagnes.

## Objectif

Rendre la boucle de pilotage **visible et utilisable au même endroit** : depuis une campagne, on plante la cible, on voit ce qui est délivré, on mesure le pacing plan-vs-réel, on optimise (rebid/agent), on lit le bilan. Le tout **sans réécrire** ce qui existe — on l'orchestre.

## Principe directeur

**Regrouper, pas réécrire.** Chaque zone du cockpit monte des composants qui existent déjà. Zéro duplication, zéro dette : les surfaces absorbées (`/custom-bidding`, `/demo/pilote`) sont retirées de la nav et redirigées, pas laissées orphelines.

## Structure — `/campaigns/[id]` devient le cockpit

Le détail campagne actuel (KPIs, Organisations, tabs pays/région/dép/brutes, « Voir la stratégie ») devient l'**accueil** du cockpit. On ajoute une barre d'onglets qui raconte la boucle.

⚑ **Choix best-judgment : 3 onglets** (plutôt que 5) — plus proche du code existant, moins de fragmentation. La boucle complète (délivrance → mesure → optimisation) vit *dans* l'onglet Pilotage, matérialisée par les sections déjà présentes dans Pilotage ML.

```
/campaigns/[id]  — COCKPIT
┌──────────┬───────────────────────────────┬────────┐
│  Aperçu  │           Pilotage            │ Bilan  │
└──────────┴───────────────────────────────┴────────┘
```

### Onglet 1 — Aperçu (= le détail campagne actuel)
- KPIs (tracked ads, lignes, pays, lignes France, IRIS matchés), statut & cycle de vie, Organisations (partage workspace), breakdown pays/région/dép/brutes.
- **Rien à réécrire** : c'est la page `/campaigns/[id]` d'aujourd'hui.
- Ajout : plan média de la campagne (cible/budget/CPM) si défini — réutilise `ZoneMediaPlanPanel` / `media-plan` existant.

### Onglet 2 — Pilotage (le cœur, la boucle)
- Monte la stratégie de pilotage de la campagne = **le composant Pilotage ML existant** (`PilotageOverlay` / les composants `custom-bidding/[strategyId]/_components`) : `StrategyHeader`, `HeroImpact`, `DualMap` (réel vs simulé), `CurveTranslator`, pacing plan-vs-réel, rebid, `AgentPanel`, drifts.
- Les sections internes **sont** la boucle : Délivrance (ce qui diffuse) → Mesure (pacing) → Optimisation (rebid/agent).
- Si aucune stratégie : CTA « Créer une stratégie » (le `StrategyWizard` existant), campagne pré-remplie.
- ⚑ La carte (DualMap / choroplèthe) est un **outil dans cet onglet**, pas une destination séparée.

### Onglet 3 — Bilan
- Le rapport C existant (`/api/.../final-report`, bilan de campagne terminée).
- Lisible quand la campagne/stratégie est terminée ; sinon état « en cours, bilan à venir ».

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
