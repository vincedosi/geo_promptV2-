# Design — Moteur de la boucle de pilotage Magelian (A) : simulateur réactif + pacing période-aware

> Date : 2026-07-04 · Portée : campagnes **digitales**. Sous-projet **A** (le moteur) de [[project_demo_bout_en_bout]].
> Statut : validé en brainstorming (4 sections), en attente de relecture avant plan d'implémentation.
> Mémoire liée : `project_demo_bout_en_bout`, `project_boucle_dsp_adserver`, `project_pacing_plan_vs_reel`.

## Problème

Magelian doit piloter une campagne digitale de bout en bout : définir un plan (budget/poids
par zone) → le pousser sur un DSP → **mesurer** via l'ad server où la pub a réellement été
délivrée vs l'intention (sur-servi / sous-servi par item) → **corriger les enchères** (rebid)
→ re-pousser → converger. Le pacing plan-vs-réel + rebid (mergé le 04/07) fournit la mesure
et la correction, **mais la boucle n'a jamais tourné de bout en bout** : `campaign_plan_snapshot`
est vide en prod, faute de données d'ad server réelles (DV360/Adform/CM360 pas encore branchés).

## Objectif

**Finir le vrai Magelian** en construisant le moteur de la boucle, développé et validé contre
une **campagne fictive à délivrance simulée** (un simulateur qui joue le rôle de l'ad server).
Le moteur est **prod-correct dès maintenant** : le jour où un vrai ad server est branché, on
**débranche le simulateur, on branche l'import réel** — mesure, correction et bilan marchent
à l'identique, sans réécriture. **Bonus** : la campagne fictive sert de démo client.

### Bénéfice mesurable
La boucle tourne : on pousse un plan v1 → le simulateur délivre → le pacing montre un vrai
sous/sur-servi → le rebid corrige → on pousse v2 → la conformité **monte v1→v2→v3**. La
convergence est **réelle** (l'algo fonctionne contre une résistance cachée), pas scriptée.

## Non-objectifs (hors scope de A)

- **Brique B — orchestration agent IA** (copilote guidé/autonome qui raconte la boucle) → spec suivant.
- **Brique C — bilan / report PDF** (courbe de conformité, zone-par-zone avant/après) → spec suivant.
- **Push API réel** vers les DSP (le rebid reste un export fichier comme aujourd'hui ; l'API push n'est pas requise pour finir la boucle).
- **Implémenter tous les fournisseurs** : on conçoit les coutures (interfaces + registre) mais on n'implémente QUE les adaptateurs nécessaires maintenant (simulateur côté ad server ; exports DV360/TikTok existants côté DSP). Adform, CM360, The Trade Desk, Meta, Snapchat = « ajouter un adaptateur » plus tard.
- **Refonte UI** : on ajoute au plus un sélecteur de version dans le `PacingPanel` existant pour observer la convergence.

## Décisions de design (arbitrées en brainstorming)

1. **Version MAX prod-correcte** (approche « période-aware », pas la version simple « éphémère ») : chaque version de plan se mesure sur SA période de délivrance `[period_start, period_end)`, comme un vrai ad server qui reporte des lignes datées.
2. **Vraie table, vrai pipeline** : le simulateur écrit dans la VRAIE `dsp_campaign_data` ; le pacing/rebid/report la lisent inchangés. Isolation par le flag `is_demo` (existe déjà sur `dsp_campaigns`) + scope `campaign_id`, PAS par une table ou une org séparée.
3. **Deux bords agnostiques** : la boucle a deux côtés multi-fournisseurs, abstraits derrière des interfaces — **ad server** (lecture/mesure : simulateur, puis Adform/CM360…) et **DSP/trade desk** (push/bid : DV360/TikTok, puis TTD/Meta/Snapchat…). Le cœur (plan, snapshot, pacing, rebid) ne connaît ni l'un ni l'autre.
4. **Simulateur réactif seedé** : la délivrance réagit au plan poussé contre une résistance cachée fixe → convergence réelle. PRNG seedé → déterministe par le seed (démo reproductible), stochastique par le modèle.
5. **Le « mode démo » est un wrapper** (fixtures + contrôleur seed/simulate/rebid/reset), jamais une branche dans la logique métier.

## Architecture

```
   ADAPTATEURS AD SERVER (lecture)              LE CŒUR (production, agnostique)
  ┌───────────────────────────────┐
  │ démo → simulateur seedé        │──┐  écrit des lignes datées
  │ prod → import Adform/CM360…    │  ├──▶  dsp_campaign_data (datée par période)
  └───────────────────────────────┘  │            │
  plan vN ──push──▶ campaign_plan_snapshot(vN, [period_start, period_end))
                        │                          │
                        └──▶ get_campaign_pacing(campagne, métrique, vN)  ── borné à la période de vN
                                   │  diagnostic sous/sur-servi PAR ITEM
                                   ▼
                            lib/pacing/rebid ──▶ export corrigé ──push──▶ snapshot vN+1
                                   │                                          │
   ADAPTATEURS DSP (push/bid) ◀────┘   (démo → DV360/TikTok fichier ; prod → +TTD/Meta/Snapchat)
```

Le cœur = ce qui est déjà mergé (`campaign_plan_snapshot`, `get_campaign_pacing`, `lib/pacing/*`,
endpoint snapshot). A ajoute : l'**évolution période-aware** du pacing, le **simulateur** (un
adaptateur ad-server), et le **wrapper démo** (fixtures + contrôleur + isolation).

## Le simulateur réactif (cœur technique)

Adaptateur ad-server en mode démo. Pour la période N, à partir du snapshot `vN` + le seed, il
produit la délivrance datée que l'ad server reporterait. Modèle par code postal :

```
délivrance(CP, N) ∝ audience(CP) × saturate( poids_poussé(item du CP, vN) × gain × résistance(CP) ) × (1 + bruit_seedé)
```

- **`audience(CP)`** = `ref_codes_postaux.pop_total` normalisée (portée réaliste : gros CP délivrent plus).
- **`poids_poussé(vN)`** = la part de l'item (depuis le snapshot vN).
- **`résistance(CP)`** ∈ `(0,1]` = facteur **caché, seedé, FIXE** par CP (certains CP répondent mal au bidding : plus chers, moins d'inventaire). C'est l'**imperfection DSP** qui crée l'écart initial. Ex. `résistance(CP) = 0.3 + 0.7 × rng(seed, CP)`.
- **`saturate(x) = x / (1 + x)`** : monotone croissante, rendements décroissants (réaliste). Plus de poids → plus de délivrance, mais bornée.
- La délivrance brute est **normalisée à un volume total** V (impressions de la période) → `impressions(CP)`. `clicks`/`spend` dérivés par CTR/CPM seedés.

**Pourquoi ça converge pour de vrai** : au tour 1, poids ~uniformes → les CP à forte résistance
sont **sous-servis** (saturate(poids×r) faible), d'autres sur-servis. Le rebid **relève le poids
là où c'est sous-servi** → au tour 2, `saturate(poids↑ × r)` monte → la part délivrée se rapproche
de la cible → l'écart baisse. C'est la boucle de feedback réelle contre une résistance fixe. La
conformité monte v1→v2→v3 parce que l'algo **fonctionne**.

**Garde d'isolation** : le simulateur **refuse d'écrire** si la campagne n'a pas `is_demo = true`.

`gain`, `bruit`, la loi de `résistance`, V, CTR/CPM = constantes tunables, couvertes par tests.

## Isolation, fixtures & contrôleur démo (le « mode démo »)

**Fixtures (seed idempotent, IDs stables → re-seeder = même état)** :
- **org** : réutilise `GENESIS (Global)` (`00000000-0000-0000-0000-000000000001`) — pas d'org DEMO (le flag `is_demo` isole au niveau campagne).
- **zone battle** : réutilise `CIRFA BRETAGNE` (`f001b479-b870-4958-978d-e7a98b90de57`, 132 CP, `battle_features` prêts → `get_zone_items_export` marche).
- **campagne** : `is_demo = true`, UUID fixe.
- **plan média initial** : poids sur les 4 items, via `POST /api/custom-geo/media-plan` (existant).

Réutilise les routes existantes (`/custom-geo/save`, `/media-plan`, `/media-plan/snapshot`) — zéro plomberie neuve pour les fixtures.

**Contrôleur démo** — routes `requireAdmin` sous `/api/demo/*`, exposant des primitives (que la brique B composera) :
- `POST /api/demo/seed` → garantit les fixtures + snapshot v1 (`period 1`) + délivrance période 1.
- `POST /api/demo/simulate-period` → le simulateur écrit la délivrance datée de la période courante.
- `POST /api/demo/apply-rebid` → calcule le rebid (`lib/pacing/rebid`), crée le snapshot `vN+1` (période suivante), avance le calendrier.
- `POST /api/demo/reset` → purge délivrance + snapshots **par `campaign_id`**, retour v1 propre.
- `POST /api/demo/teardown` → supprime toute la donnée de la campagne démo.

**Calendrier synthétique** : période N = L jours (défaut L = 30) depuis une date de départ fixe.
Le simulateur date sa délivrance dans `[period_start(N), period_end(N))`.

**Garanties** : `is_demo = true` sur la campagne ; simulateur à garde dure ; purge bornée par
`campaign_id` (index) → aucune fuite vers une vraie campagne ; batch 50 (~132 CP × L jours),
respect I/O Nano ; seed déterministe → reset+re-seed reproductible au pixel.

## Pacing période-aware (évolution prod-correcte)

Aujourd'hui `get_campaign_pacing(campagne, métrique, version)` mesure une version contre **toute**
la délivrance de la campagne. Évolution :

- Ajout de `period_start date`, `period_end date` sur `campaign_plan_snapshot` (migration `sql/097`,
  répétés par version comme `budget`/`cpm`/`dsp`). En prod : fenêtre = date de push → push suivant
  (ou fin de campagne). En démo : le calendrier synthétique.
- La RPC filtre la délivrance (et le spillover, et les totaux) à `[period_start, period_end)` de la
  version demandée (`period_end` NULL = fenêtre ouverte jusqu'à maintenant).
- **Vraie amélioration produit** : le comportement « tout l'historique » actuel est un défaut latent
  pour une campagne multi-plans. Rétrocompat OK (table vide en prod ; les lignes existantes sans
  période → fenêtre ouverte = comportement actuel).
- La **courbe de conformité** (brique C) se lit ensuite version par version, chacune sur sa période —
  l'historique est dans les données, rien à archiver à part.

## Découpage & interfaces (pour le plan)

Unités isolées, dans l'ordre :

1. **`lib/demo/rng.ts`** (pur, testé) : PRNG seedé (mulberry32) + helper `rng(seed, key)` déterministe par clé.
2. **`lib/demo/simulator.ts`** (pur, testé) : `simulateDelivery({ items: SnapshotItem[], audienceByCp, seed, totalVolume }) → DeliveryRow[]` (par CP : impressions/clicks/spend). Propriétés testées : monotonie (poids↑ → délivrance↑), déterminisme (même seed → même sortie), résistance crée un écart.
3. **Migration `sql/097`** : colonnes `period_start`/`period_end` sur `campaign_plan_snapshot` + `get_campaign_pacing` filtré par période. Appliquée via MCP, versionnée. **Extension de l'endpoint snapshot** (`POST /api/custom-geo/media-plan/snapshot`, mergé) : accepte des `period_start`/`period_end` optionnels (défaut NULL = fenêtre ouverte = comportement actuel), écrits sur les lignes de la version. C'est par là que le contrôleur démo pose la période de chaque version.
4. **Fixtures + `lib/demo/fixtures.ts`** : IDs stables, seed idempotent de la campagne fictive (org/zone réutilisées, campagne `is_demo`, plan initial).
5. **Contrôleur `/api/demo/*`** : `seed`, `simulate-period`, `apply-rebid`, `reset`, `teardown` (garde `is_demo`, purge scopée `campaign_id`, insert batch 50, `match_campaign_postal_to_iris`).
6. **Boucle E2E + test de convergence** (test d'acceptation) : `seed` → K tours (`simulate-period` + `apply-rebid`) → asserter la conformité **monotone croissante** / franchissant un seuil.
7. **Observation UI (léger)** : sélecteur de version dans `PacingPanel` (la route pacing supporte déjà `?version=`) pour voir v1/v2/v3.

**Interfaces clés** :
- `SnapshotItem` = `{ zone_id, item_id, expected_share, cps: string[] }` (dérivé de `campaign_plan_snapshot`).
- `DeliveryRow` = `{ postal_code, date, impressions, clicks, spend }`.
- `simulateDelivery(...)` pur → le contrôleur l'insère dans `dsp_campaign_data`.

## Flux de données

- **Seed** : fixtures → snapshot v1 (période 1) → `simulateDelivery(v1)` → insert `dsp_campaign_data` (dates période 1).
- **Tour** : `apply-rebid` (pacing vN → rebid → snapshot vN+1, période N+1) → `simulate-period` (délivrance période N+1) → `get_campaign_pacing(vN+1)` sur période N+1.
- **Reset** : purge `dsp_campaign_data` + `campaign_plan_snapshot` où `campaign_id = démo` → re-seed.
- **Swap prod** : remplacer `simulate-period` par l'import réel (Adform/CM360) qui écrit les mêmes lignes datées ; le reste inchangé.

## Gestion d'erreur

- **Simulateur sur campagne non-démo** → refus (garde `is_demo`), erreur explicite.
- **Zone non expansable** (`get_zone_items_export` NULL) → 422, le seed échoue proprement (fixtures incohérentes signalées).
- **`apply-rebid` sans délivrance de la période courante** → refus (rien à corriger), message clair.
- **Reset/teardown sur campagne non-démo** → refus.
- **Période sans CP** (audience nulle) → délivrance 0, pas de division par zéro.
- **Nano** : tout insert/purge borné + batch 50 ; `EXPLAIN` sur la RPC période-aware.

## Plan de test

- **`lib/demo/rng.ts`** : déterminisme (même seed → même suite), distribution raisonnable.
- **`lib/demo/simulator.ts`** (cœur) : monotonie poids→délivrance ; déterminisme par seed ; la résistance seedée produit un écart sous/sur-servi non trivial ; normalisation au volume V.
- **Convergence (acceptation, intégration)** : K tours → convergence réelle. Métrique = **écart absolu moyen** `mean(|delta_pts|)` sur les items (intra-zone), calculé depuis `get_campaign_pacing` version par version. Assertion : cet écart **décroît de façon monotone** de v1 à vK (tolérance de bruit près), et/ou franchit un seuil (ex. `mean(|delta_pts|) < PACING_TOLERANCE_PTS` à vK). Le test *échoue* si le rebid ne converge pas → protège la promesse « vraie boucle, pas scriptée ».
- **Pacing période-aware** : version N ne voit que la délivrance de la période N ; spillover borné à la fenêtre ; `EXPLAIN` index scan.
- **Isolation** : reset purge uniquement la campagne démo ; simulateur refuse hors `is_demo` ; re-seed idempotent (pas de doublon).

## Migration

- `sql/097_campaign_plan_snapshot_periods.sql` : `ADD COLUMN period_start date, period_end date` (idempotent) + `CREATE OR REPLACE FUNCTION get_campaign_pacing` filtré par période. Appliquée via MCP Supabase, versionnée. Rétrocompat : colonnes NULL → fenêtre ouverte = comportement actuel (aucun snapshot en prod aujourd'hui).
