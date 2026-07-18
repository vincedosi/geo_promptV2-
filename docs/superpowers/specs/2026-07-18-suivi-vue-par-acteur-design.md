# Suivi campagne — vision 2 piliers + vue par acteur (design)

> Sous-projet 1 de « améliorer l'UX/vision du Suivi campagne ». Validé par
> Vincent le 2026-07-18. Recadrage clé : le Suivi sert à **piloter**, pas à
> réconcilier. Deux piliers de pilotage, déclinés **par acteur**. La
> réconciliation ad-server ↔ DSP ↔ plateforme est **secondaire** (indice de
> confiance sur la donnée, pas la métrique de pilotage).

## La vision — 2 piliers de pilotage

Le media planner suit sa campagne pour vérifier **deux** choses :

1. **Tenue de la pression par zone.** Le plan définit une surpression /
   sous-pression par CP (`bid_multiplier`). La question : la délivrance réelle
   **respecte-t-elle** cette pression ? → `hold_index` par zone (délivré ÷
   planifié, renormalisé), carte « tenue du plan », alerte « CP cibles sous
   70 % ». **Déjà en place** (cockpit de suivi) — c'est le cœur.

2. **Alignement à ~100 % vs l'objectif.** L'ad server **fait foi** (seule source
   de vérité de la délivrance). La question : la délivrance **atteint-elle
   l'objectif, ni sous ni sur** ? Le mieux = **au plus proche de 100 %** ;
   sur-livrer et sous-livrer sont deux dérives symétriques. → tuile objectif du
   cockpit (`objective.pct`), ton « proche de 100 % = bon ».

**La vue par acteur décline ces deux lectures par acteur** (DSP dv360/ttd,
social tiktok, régies en direct). C'est l'objet de ce sous-projet.

**Secondaire (gardé, pas mis en avant) :** un score de réconciliation ad-server
↔ DSP ↔ plateforme — confiance dans la donnée. Le panneau réconciliation
existant reste tel quel.

## Décisions validées (brainstorm)

- **« Acteur »** = tout partenaire média par lequel des impressions ont
  transité : DSP, plateforme sociale, ou régie en direct.
- **Liste unifiée** : DSP + social + régies dans un seul multi-select.
- **Chemin complet** : la délivrance (ad server) porte la dimension **acteur**
  → le filtre global recalcule le cockpit *partout* (pacing, CPM, objectif,
  courbes, tableau géo, carte).
- **(A) filtre global** multi-select qui recalcule tout + **(C) panneau dédié
  « Par acteur »**.
- **Panneau v1** : colonnes **livré · dépense · CPM · part · atteinte objectif**.
  (« atteinte objectif » remplace l'ancien « taux de mesure », qui devient
  secondaire.)
- **Multi-select** : réservé à l'onglet Suivi, en tête de la colonne bilan.
- **Régies démo** : noms génériques (règle no-fake-brand) — « Régie presse
  régionale » et « Régie TV connectée ».

## La métrique « atteinte objectif » (pilier 2, par acteur)

L'objectif global existe déjà dans `get_campaign_suivi` :
`objective.expected` = cible d'impressions **proratisée au temps écoulé**
(`kpi_target` si `objective_code = maximize_impressions`, sinon
`total_budget ÷ forecast_cpm × 1000`), × `time_pct/100`.
`objective.realized` = impressions ad-server totales. `objective.pct =
realized ÷ expected × 100` (peut dépasser 100 % = sur-livraison).

**Par acteur** (interprétation validée — les acteurs s'additionnent) :

```
atteinte_objectif(acteur) = impressions_adserver(acteur) ÷ expected_global × 100
```

- Somme sur tous les acteurs = `objective.pct` global. ✔
- **Distincte de « part »** : `part = imps(acteur) ÷ total_livré` (somme = 100 %,
  toujours) ; `atteinte = imps(acteur) ÷ expected` (somme = atteinte réelle,
  potentiellement ≠ 100 %). Deux colonnes, deux sens.
- **Ton** « proche de 100 % = bon » : appliqué à l'**atteinte GLOBALE** (tuile
  objectif), pas à la contribution d'un acteur isolé (contribuer 20 % n'est pas
  « mauvais »). Le panneau par acteur affiche la contribution sans ton
  d'alerte ; le ton vit sur la tuile objectif du cockpit.

## Le modèle « acteur » (données)

L'ad server (`dsp_campaign_data` → rollups) est la **source unifiée** : la seule
qui couvre tous les acteurs uniformément (impressions + dépense). Chaque ligne
de délivrance porte un `actor`.

**Kind d'un acteur** (dérivé, pas stocké) : `dsp` si ∈
`geo_strategy.channels.dsps`, `social` si ∈ `…socials`, `régie` sinon.

**Fallback** : colonne `actor` avec `DEFAULT ''`. Campagnes réelles non
enrichies → un seul acteur `''` → panneau « Non attribué », filtre no-op,
cockpit inchangé. Dégradation propre.

**Source de l'attribution** : en prod, `dsp_campaign_data.actor` vient du tag
placement/DSP à l'ingestion (**prérequis d'ingestion documenté**, hors périmètre
ici). Pour la démo, le seed le fabrique.

## Changements de schéma (rollups)

### `campaign_daily_rollup`
Ajoute `actor text NOT NULL DEFAULT ''`. PK → `(campaign_id, date, media, actor)`.
`media` conservé.

### `campaign_cp_rollup`
Ajoute `actor text NOT NULL DEFAULT ''`. PK → `(campaign_id, postal_code, actor)`.
`dept`, `in_target`, `planned_share` restent des **faits par CP** (constants d'un
acteur à l'autre pour un même CP) → se **répètent** par ligne acteur.
`impressions/clicks/spend/imps_7d/imps_prev7d` deviennent **par acteur**.
Volumétrie : ~6 200 CP × ~5 acteurs ≈ **31 k lignes** (Nano-safe).

### `refresh_campaign_rollups`
Ajoute `actor` aux `GROUP BY` (daily : `date, media, actor` ; CP :
`postal_code, actor`). `LEFT JOIN plan` inchangé (par CP). Reste
`SECURITY DEFINER`, service_role only.

## Changements RPC

Toutes les fonctions de lecture gagnent `p_actors text[] DEFAULT NULL` **en
dernier paramètre** (rétro-compatible). `NULL`/vide = tous les acteurs
(comportement actuel, aucune régression). Toutes restent `SECURITY DEFINER`,
`search_path = public, pg_catalog`, `REVOKE … / GRANT EXECUTE … TO service_role`.

### Règle de réécriture : group-by-CP-first
`planned_share`/`in_target` se répètent par acteur → **toute agrégation touchant
`planned_share` collapse d'abord les acteurs par CP** :

```sql
WITH cp AS (
  SELECT postal_code, dept, in_target, planned_share,
         SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(spend) AS spend,
         SUM(imps_7d) AS imps_7d, SUM(imps_prev7d) AS imps_prev7d
  FROM campaign_cp_rollup
  WHERE campaign_id = p_campaign_id
    AND (p_actors IS NULL OR actor = ANY(p_actors))
  GROUP BY postal_code, dept, in_target, planned_share
)
```

`in_target`/`planned_share` dans le `GROUP BY` sont sûrs (constants par CP) →
`SUM(planned_share)` compte chaque CP une fois.

### `get_campaign_suivi(p_campaign_id uuid, p_actors text[] DEFAULT NULL)`
- Daily (pacing, CPM, objectif, `daily`) : filtrer `campaign_daily_rollup` par
  `actor`. Pacing/CPM/objectif recalculés sur le sous-ensemble.
- CP (level1, depts, alerte zones_under, pression) : via le CTE `cp`.
  **Renormalisation** : `v_cp_total_imps` = somme du sous-ensemble → parts et
  `hold_index` renormalisés sur les acteurs cochés (pas d'effondrement mécanique).
- `medias` : conservé (groupé par `media`, filtré par acteur).

### `get_campaign_suivi_map(…, p_actors text[] DEFAULT NULL)`
CTE `total` + sélection CP filtrées par acteur, group-by-CP-first.

### `get_campaign_suivi_cps(…, p_actors text[] DEFAULT NULL)`
Idem, détail CP par acteur.

### Nouveau : `get_campaign_actors(p_campaign_id uuid)`
Liste **complète** des acteurs (non filtrée) — source du multi-select ET du
panneau. Réutilise l'objectif de `get_campaign_suivi` (même `expected` proraté).

```
RETURNS jsonb  -- {
--   objective_pct: number|null,        -- atteinte globale (rappel, pour le ton)
--   actors: [ { actor, kind, impressions, spend, cpm,
--               share_pct,                 -- part du livré (somme = 100)
--               objective_attainment } ]   -- imps ÷ expected_global × 100
-- }
```

Trié par `impressions DESC`. `SECURITY DEFINER`, service_role only.

### Réconciliation (secondaire) — inchangée en v1
`get_campaign_reconciliation` / `_map` et `simulate_dsp_report` **ne sont pas
modifiées** dans ce sous-projet. Le panneau réconciliation reste global et
inchangé. (Un score de réconciliation par acteur ad-server ↔ DSP ↔ plateforme
est un chantier séparé — la dimension acteur posée ici le rendra facile plus
tard, mais c'est hors périmètre v1.)

## Changements API

Routes existantes : ajouter `?actors=a,b,c` (CSV, optionnel ; absent = tous).
- `GET /api/digital/[campaignId]/suivi` → `p_actors` à `get_campaign_suivi`.
- Route carte suivi (event `magelian:suivi-map`) → `p_actors` à
  `get_campaign_suivi_map`.

Nouvelle route :
- `GET /api/digital/[campaignId]/actors` → `get_campaign_actors`. `requireAuth`
  + `checkCampaignAccess` (même garde que `/suivi`). `Cache-Control: no-store`.

(`/reconcile` **non touchée** — réconciliation secondaire, reste globale.)

Toutes lisent les rollups uniquement (jamais `dsp_campaign_data` à chaud).

## Changements UI

### Multi-select « Acteurs » — `components/campaign/suivi/ActorFilter.tsx`
Dropdown à cases (design system : `--bg-level-2`, border `--border-subtle`,
focus teal). Défaut = tous cochés. En tête de la colonne bilan de
`CampaignSuivi`, sous le bandeau « Suivi ». État local dans `CampaignSuivi`.

Comportement : la sélection pilote un **refetch débounced (300 ms)** de `/suivi`
(et de la carte si ouverte) avec `?actors=`. Cache `useRef` keyé par
`campaignId + acteurs triés` (règle Nano « cache avant fetch »). Tous cochés →
pas de param (chemin actuel, non-régression).

### Panneau « Par acteur » — `components/campaign/suivi/ActorPanel.tsx`
Section (bandeau dot teal « Par acteur ») :
- Tableau : une ligne par acteur **sélectionné**, badge `kind` (DSP / social /
  régie), colonnes **livré · dépense · CPM · part · atteinte objectif**. Tri par
  livré. Réutilise `fmtInt/fmtCpm/fmtPct` (DRY).
- Mini bar-chart de répartition du volume (Recharts, palette de `SuiviCharts`).

Alimenté par `/api/digital/[campaignId]/actors` (fetch une fois, non filtré) ;
n'affiche que les acteurs cochés. Inséré entre `SuiviCockpit` et
`ReconciliationPanel`.

### Carte
`app/map/_components/SuiviMapLayer.tsx` + event `magelian:suivi-map` :
`detail.actors?: string[]`. La couche passe `actors` à son fetch. « Voir sur la
carte » propage la sélection courante.

### Types — `lib/campaigns/actor-metrics.ts` (nouveau)
`ActorKind`, `ActorRow`, `ActorsPayload`, ré-export des formats. Testable Vitest
pur (comme `suivi-metrics`).

## Changements seed démo (`sql/112`)

Récit **préservé** (pacing en retard, CPM TikTok qui dérive, Marseille/Lille
sous-délivrés, fuite silencieuse). On **superpose** l'attribution acteur **sans
changer les totaux** (pacing/géo/objectif/assertion inchangés) :

- Constante `v_actor_split` : parts par budget (dv360 ≈ 45 %, ttd ≈ 11 %,
  tiktok ≈ 17 %) + **2 régies** en direct (« Régie presse régionale » ≈ 17 %,
  « Régie TV connectée » ≈ 10 %). Somme = 1.
- L'INSERT ad-server ventile `day_imps`/spend/clicks par acteur selon
  `v_actor_split`, en écrivant `actor`. Répartition déterministe, plate sur les
  CP (pas de biais géo par acteur en v1).
- `simulate_dsp_report` **inchangé** (réconciliation globale conservée).
- `demo_cpm` inchangé (dérive TikTok 9,20 conservée dans la réconciliation).

**Assertion étendue** : alertes (pacing + zones_under présentes, leak absente)
+ `get_campaign_actors` renvoie **≥ 4 acteurs** dont **≥ 1 régie** (`kind =
'régie'`) et **Σ share_pct ≈ 100 %**.

## Invariants de cohérence (contrat)

- Totaux ad-server **inchangés** par l'attribution → pacing/CPM/objectif/géo
  globaux identiques (mêmes alertes, même `objective.pct`).
- `Σ share_pct` acteurs = 100 %.
- `Σ objective_attainment` acteurs = `objective.pct` global.
- Filtrer un sous-ensemble renormalise parts/hold (pas de collapse).
- `p_actors = NULL` ⇒ payloads **identiques** aux RPC actuelles (non-régression).

## Vérification (bout-en-bout, après implémentation)

En base ET en navigateur, sur la démo :
- **Sans filtre** : cockpit identique à aujourd'hui (pacing ~0,80, CPM ~6,50,
  alertes pacing + zones_under, objectif inchangé). Non-régression stricte.
- **Panneau Par acteur** : ≥ 4 lignes (dv360, ttd, tiktok, 2 régies), `part`
  sommant à 100 %, `Σ atteinte` = atteinte globale.
- **Filtre = {tiktok}** : cockpit recalculé sur TikTok seul (CPM ~9,20 en tuile,
  parts/hold renormalisés, carte redessinée).
- **Filtre = {dv360, ttd}** : pas de TikTok, CPM plus proche du prévu.
- Tests Vitest : formats de `actor-metrics` ; test SQL de non-régression
  (`p_actors = NULL` == payload actuel de `get_campaign_suivi`).

## Livrable

- `sql/113_campaign_actors.sql` — ALTER rollups + `refresh_campaign_rollups`
  (actor) + `get_campaign_suivi`/`_map`/`_cps` (`p_actors`) +
  `get_campaign_actors`. Appliqué via MCP + copié pour le repo.
- `sql/112_demo_seed_coherent.sql` — attribution acteur + 2 régies + assertion
  étendue.
- `lib/campaigns/actor-metrics.ts` + tests.
- `components/campaign/suivi/ActorFilter.tsx`, `ActorPanel.tsx` ; câblage
  `CampaignSuivi.tsx` ; `SuiviMapLayer.tsx` + event.
- Route `app/api/digital/[campaignId]/actors/route.ts` + `?actors=` sur suivi +
  carte.

## Hors périmètre (sous-projets suivants)

- **Score de réconciliation par acteur** ad-server ↔ DSP ↔ **plateforme**
  (secondaire, demandé mais différé) — la dimension acteur posée ici le prépare.
- **Complétude cockpit** : reach & fréquence, performance (clics/CTR/
  conversions/CPA), complétion de délivrance.
- **Ingestion réelle** de la dimension acteur (tag placement/DSP).
- Biais géographique **par acteur** dans la démo (attribution plate en v1).
- L'autre démo nationale (`fd18d97c`) — non touchée.
