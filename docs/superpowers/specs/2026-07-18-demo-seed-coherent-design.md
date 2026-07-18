# Seed démo cohérent — « élections, campagne à corriger » (design)

> Validé par Vincent le 2026-07-18. Problème : la démo pilotage (élections) est
> devenue un Frankenstein au fil des chantiers — budget stratégie 600 000 € vs
> budgets canaux 52 000 €, dates campagne/stratégie désalignées, données ad
> server nationales plaquées sur une stratégie zones strictes (73,5 % de fuite
> hors cible en mode exclusion, récit incohérent). Objectif : un **seed SQL
> unique, versionné et rejouable** qui régénère TOUTE la démo de façon
> cohérente, racontant une **campagne en vol avec 3 problèmes à corriger**.

## Décisions validées

- **Thème conservé** : élections / abstention (cible = CP à forte abstention).
- **Récit** : campagne en vol, dégradée mais **cohérente** — les alertes et la
  carte servent à quelque chose.
- **Méthode** : un seed SQL propre (source de vérité unique), pas de rustines.

## Cible (fixe) — campagne `dccc0000-…-0002`, stratégie `dccc0000-…-0012`

Régénérées en place (mêmes IDs). Le **plan** existant
(`bidding_zone_configs`, 1641 CP cibles sur base abstention) est **conservé
tel quel** — `indicator_cp_values` étant purgée, on ne recalcule pas ; le plan
est la définition de la cible.

## Cadre cohérent (tout s'aligne)

| Paramètre | Valeur | Cohérence |
|---|---|---|
| Période campagne = stratégie | 01/04/2026 → 31/05/2026 (61 j) | identiques |
| Données ad server + DSP | avril seulement (30 j) → as_of 30/04 | campagne **en vol**, temps ~49 % |
| Budget stratégie | **65 000 €** | = somme des canaux |
| Budgets canaux (`geo_strategy`) | dv360 40 000 · ttd 10 000 · tiktok 15 000 | somme = 65 000 |
| Canal meta | **retiré** | plus de « 0 partout » |
| CPM prévu | 6,50 € | cohérent avec la délivrance générée |
| Diffusion | zones strictes (exclusion) | et la délivrance **suit le plan** (~95 % in-target) → fuite hors cible marginale, alerte silencieuse |
| Nom | « Démo pilotage — élections » | on lâche « données réalistes » |
| Annonceur / produit | générique institutionnel (pas de marque fictive) | règle no-fake-brand |

Numérique cohérent : dépense avril ≈ **26 000 €** (40 % du budget à 49 % du
temps → pacing en retard), CPM ad server ≈ 6,50 € → impressions avril ≈ **4 M**
(fini les 49 M pour 52 k€, absurde). ~95 % in-target (3,8 M), ~5 % fuite (0,2 M).

## Les 3 problèmes intentionnels (chacun cohérent, surfacé quelque part)

1. **Pacing en retard** — dépense 40 % à temps 49 % → indice ~0,82 → **alerte
   pacing** dans le cockpit. Porté par la dépense ad server (rollups) vs budget/
   dates stratégie.
2. **CPM TikTok qui dérive** — TikTok à ~9,20 € vs 6,50 € budget, autres canaux
   dans les clous → visible dans le **tableau réconciliation par canal** (le
   CPM ad server global reste ~6,50 → pas d'alerte cockpit CPM ; c'est
   justement l'insight que la réconciliation apporte : « globalement OK, mais
   TikTok surpaie »). Porté par le rapport DSP.
3. **Une région sous-ciblée** — 2 départements à forte présence cible délivrés
   à ~50 % du plan → **hold_index bas localisé** (carte « tenue du plan » rouge)
   + **alerte « N CP cibles sous 70 % »**. Porté par la délivrance ad server par CP.

**Réconciliation** : taux de mesure global ~96 %, dispersion 91–99 % par CP
(jitter déterministe existant) — pas un aplat uniforme.

## Génération — ordre du seed (set-based)

Tout scopé au seul `campaign_id` démo ; idempotent (DELETE ciblé + regénère).

1. **Campagne** : UPDATE `dsp_campaigns` (nom, dates, advertiser/product,
   `geo_strategy.channels` = dv360/ttd/tiktok + budgets + `demo_cpm` par canal
   pour la dérive TikTok, cf. §CPM). `is_demo=true`.
2. **Stratégie** : UPDATE `bidding_strategies` (total_budget 65000, forecast_cpm
   6.50, start 01/04, end 31/05, status active). Plan (`bidding_zone_configs`)
   inchangé.
3. **Ad server** (`dsp_campaign_data`) : DELETE puis INSERT set-based.
   - Univers = CP du plan ayant une géométrie (`ref_codes_postaux`).
   - in-target : imps/jour ∝ `bid_multiplier` du plan × facteur de réalisation
     (1 normal ; **0,5** sur les 2 départements « problème »), réparti ~plat sur
     les 30 jours d'avril. `spend = imps × 6,50/1000`. `media='Display'`.
   - fuite hors cible : ~5 % du volume sur un échantillon de CP hors cible.
   - Calibrage : total dépense avril ≈ 26 000 € (40 % de 65 000).
   - Départements « problème » : les 2 avec le plus de CP cibles (déterminé par
     le plan) — visibles et crédibles.
4. **Rollups** : `SELECT refresh_campaign_rollups(campaign_id)` (reconstruit
   daily + CP depuis l'ad server, avec in_target/planned_share du plan).
5. **Rapport DSP** : `SELECT simulate_dsp_report(campaign_id)` — voir §CPM pour
   la dérive TikTok.

## CPM par canal & dérive TikTok (généralisation de `simulate_dsp_report`)

Pour que la dérive TikTok **survive au bouton « Actualiser »** (qui rappelle
`simulate_dsp_report`), on rend les CPM par canal **config-driven** :
`simulate_dsp_report` lit `geo_strategy.channels.demo_cpm` (objet
`{canal: cpm}`) s'il existe, sinon retombe sur les défauts actuels. Le seed
pose `demo_cpm = { dv360: 6.30, ttd: 6.60, tiktok: 9.20 }`. Généralisation
propre (config, pas de magie), la fonction reste générale.

## Invariants de cohérence (contrat du seed)

- `total_budget` stratégie = Σ budgets canaux.
- dates campagne = dates stratégie ; données ⊂ [start, end].
- diffusion exclusion ⇒ délivrance hors cible marginale (~5 %).
- CPM ad server global ≈ forecast_cpm (pas d'alerte cockpit CPM parasite).
- pacing : dépense_avril / budget < temps_écoulé (retard intentionnel).
- chaque « problème » allume exactement son signal, rien d'autre.

## Vérification (bout-en-bout, après seed)

Sur la démo, en base ET en navigateur :
- Cockpit : pacing indice ~0,82 (orange/rouge), CPM ~6,50 (vert), objectif
  cohérent, **alerte pacing** + **alerte zones sous 70 %**, **pas** d'alerte
  fuite hors cible.
- Réconciliation : taux ~96 %, tableau canaux avec **TikTok ~9,20 €** vs autres
  ~6,3–6,6 €, budgets sommant à 65 000.
- Carte suivi « tenue du plan » : rouge concentré sur les 2 départements
  problème, vert ailleurs.
- Carte réconciliation : dispersion du taux de mesure (pas d'aplat).
- Aperçu : totaux ad server cohérents (~4 M imps, ~26 k€).

## Livrable

- `sql/112_demo_seed_coherent.sql` — le seed complet (appliqué via MCP +
  copié pour le repo). En-tête documentant qu'il est rejouable et scopé démo.
- Modif `sql/111` + fonction en base : `simulate_dsp_report` lit `demo_cpm`.

## Hors périmètre

- L'autre démo (`fd18d97c` nationale) — non touchée.
- Régénération du plan depuis les indicateurs (plan existant réutilisé).
- Génération de format/création (hors périmètre réconciliation v1).
