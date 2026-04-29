# Chantier A4.4.5 — Intégration UX Custom Bidding

> Date : 2026-04-29
> Statut : livré, vérifié en navigateur (T1-T7)

## Résumé

Le module Custom Bidding (livré en A4.4) devient trouvable et activable depuis l'app GEOMATIK :
- Sidebar : entrée "Pilotage ML" (badge ML, icône Sparkles) → `/custom-bidding`
- Page détail campagne (Module Campagne Média) : barre conditionnelle 3 cas (Adform / DSP sans strat / DSP avec strat)
- Liste campagnes : badge ML teal sur celles ayant une stratégie active
- Modal d'activation 1-clic alimenté par `bidding_algorithms` / `bidding_objectives`
- Empty state propre sur `/custom-bidding`

## Fichiers livrés

| Fichier | Action |
|---|---|
| `components/AppSidebar.tsx` | +1 entrée "Pilotage ML" (Sparkles, badge ML) |
| `app/api/bidding/strategies/route.ts` | +POST handler (création + check Adform/conflict) |
| `app/api/bidding/algorithms/route.ts` | nouveau — GET liste algos enabled |
| `app/api/bidding/objectives/route.ts` | nouveau — GET liste objectifs enabled |
| `app/map/analyse/digital/_components/CustomBiddingBar.tsx` | nouveau — 3 cas conditionnels |
| `app/map/analyse/digital/_components/ActivateCustomBiddingModal.tsx` | nouveau — modal de création |
| `app/map/analyse/digital/_components/CampaignCard.tsx` | +prop `mlMode`, badge ML conditionnel |
| `app/map/analyse/digital/_components/WelcomeState.tsx` | +fetch des stratégies, propage `mlMode` aux cards |
| `app/map/analyse/digital/page.tsx` | +1 import + `<CustomBiddingBar>` après CampaignContextBar |
| `app/custom-bidding/page.tsx` | empty state propre (icône Sparkles + CTA) |
| `docs/chantier_a4_4_5_ux_integration.md` | ce fichier |

## Logique

### Cas A — Campagne Adform
- Bar discrète "Custom Bidding nécessite une source DSP (TTD, DV360, Meta…)"
- Aucun bouton

### Cas B — DSP sans stratégie
- Bar avec CTA outline teal "Activer Custom Bidding"
- Click → modal `ActivateCustomBiddingModal`
- Modal : nom pré-rempli, algos + objectifs depuis API (1ère ligne par `display_order` pré-sélectionnée), 3 radios mode (suggest par défaut)
- Submit POST `/api/bidding/strategies` → INSERT + redirect `/custom-bidding/[new_id]`

### Cas C — DSP avec stratégie
- Bar accentée teal avec nom stratégie + mode + statut
- Bouton solid teal "Voir le pilotage ML" → `/custom-bidding/[id]`

## Tests E2E vérifiés

| Test | Résultat |
|---|---|
| **T1** Sidebar : "Pilotage ML" → `/custom-bidding` | ✅ |
| **T2** Empty state / liste affichée selon contexte | ✅ |
| **T3** Adform : pas de bouton CB, alert info subtile | ✅ vérifié sur FEU 2025 |
| **T4** DSP sans stratégie : bouton "Activer" → modal → POST → redirect | ✅ vérifié sur campagne test (stratégie créée puis cleanup) |
| **T5** DSP avec stratégie : bouton "Voir le pilotage ML" | ✅ vérifié sur Renault Captur |
| **T6** Badge ML uniquement sur stratégies actives | ✅ Renault Captur visible, 4 Adform sans badge |
| **T7** Adform legacy strict | ✅ 4 / 294 135 / 172 056 383 / 0 strategies Adform |
| **T8** Aucune régression Module Campagne Média | ✅ rendu conservé sur les 4 Adform |

## Garanties

- **Aucune table modifiée** — toutes les tables `bidding_*`, `dsp_campaigns` intactes
- **Aucun algo/objectif hardcodé en TS** — dropdowns alimentés par les routes GET `/algorithms` et `/objectives`
- **Aucun `dsp_source` hardcodé** — seul `'adform'` est filtré (data-driven : tout DSP non-Adform est éligible)
- **Pas de nouvelle dépendance** package.json
- **DESIGN_SYSTEM** : teal `#4ecdc4` accent unique, flat, sentence case, lucide `Sparkles`

## Limites

- Modal utilise des inputs natifs (pas Radix Dialog) pour rester léger et cohérent avec le style inline du Module Campagne Média existant. Acceptable pour MVP, peut être migré vers `components/ui/dialog.tsx` plus tard.
- `WelcomeState` fait un fetch supplémentaire `/api/bidding/strategies` au mount pour propager le `mlMode` aux cards. Coût : 1 requête côté planner. Si gênant, à mettre en cache via SWR ou côté serveur via JOIN dans `/api/digital/campaigns`.
- La 1ère ligne par `display_order` côté objectives donne `maximize_impressions` (display_order=10). Le planner devra sélectionner manuellement `maximize_leads` (display_order=50) pour la démo Renault Captur — comportement attendu par la spec ("1ère ligne par display_order").
