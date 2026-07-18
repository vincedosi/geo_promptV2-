# Suivi campagne — vue par acteur (design)

> Sous-projet 1 de « améliorer l'UX/vision du Suivi campagne ». Validé par
> Vincent le 2026-07-18. Objectif : donner au media planner une lecture **par
> acteur** de sa campagne — DSP (dv360, ttd), réseaux sociaux (tiktok), et
> autres régies en direct — via (A) un **filtre global** multi-select qui
> recalcule tout le cockpit sur les acteurs cochés, et (C) un **panneau dédié
> « Par acteur »**. Le sous-projet 2 (complétude : reach/fréquence,
> performance clics/CTR/conversions, complétion) viendra après, séparément.

## Décisions validées (brainstorm)

- **« Acteur »** = tout partenaire média par lequel des impressions ont
  transité : un DSP, une plateforme sociale, ou une régie en direct.
- **Liste unifiée** : DSP + social + régies dans un seul multi-select, colonnes
  au mieux selon la donnée disponible pour chaque acteur.
- **Chemin complet** : la donnée de délivrance (ad server) porte la dimension
  **acteur** → le filtre global recalcule le cockpit *partout* (pacing, CPM,
  objectif, courbes, tableau géo, carte), pas seulement le côté DSP.
- **Panneau « Par acteur » v1** : colonnes **livré · dépense · CPM · part ·
  taux de mesure** (réutilise la donnée existante, pas d'attente du sous-projet 2).
- **Multi-select** : réservé à l'onglet Suivi, en tête de la colonne bilan
  (pas partagé avec Aperçu).
- **Régies démo** : noms génériques descriptifs (règle no-fake-brand) —
  « Régie presse régionale » et « Régie TV connectée ».

## Le modèle « acteur »

L'ad server (`dsp_campaign_data` → rollups) devient la **source unifiée** : c'est
la seule qui couvre *tous* les acteurs uniformément (impressions + dépense).
Chaque ligne de délivrance est attribuée à **un acteur** (colonne `actor`).

**Kind d'un acteur** (dérivé, pas stocké) :
- `dsp` si l'acteur ∈ `geo_strategy.channels.dsps`,
- `social` si ∈ `geo_strategy.channels.socials`,
- `régie` sinon (tout acteur délivré non déclaré comme canal d'achat).

Les acteurs `dsp`/`social` sont **programmatiques** : ils ont un rapport DSP
(`campaign_dsp_report`, `channel = actor`) → **taux de mesure** calculable. Les
`régie` sont en **direct** : ad-server seulement → **taux de mesure N/A**.

### Invariant d'honnêteté : le taux de mesure est scopé aux programmatiques

Le taux de mesure = ad-server ÷ DSP. Il ne vaut que pour la délivrance
**achetée en DSP**. Les régies délivrent des impressions **mesurées mais non
DSP-reportées** ; les inclure dans le « mesuré » global ferait dépasser 100 %.
Donc :

- `get_campaign_reconciliation.global.adserver_impressions` = somme ad-server
  **sur les acteurs programmatiques uniquement** (pas les régies).
- Le panneau « Par acteur » affiche le taux de mesure par acteur programmatique,
  et **« — »** (N/A) pour les régies.

### Fallback : campagnes sans attribution

Colonne `actor` avec `DEFAULT ''`. Les campagnes réelles non enrichies ont un
seul acteur `''` → le panneau montre une ligne « Non attribué », le multi-select
est un no-op, le cockpit se comporte comme aujourd'hui. Dégradation propre, pas
de régression.

## Changements de schéma (rollups)

### `campaign_daily_rollup`
Ajoute `actor text NOT NULL DEFAULT ''`. PK →
`(campaign_id, date, media, actor)`. `media` est conservé (dimension distincte,
souvent bucket unique) ; `actor` s'ajoute.

### `campaign_cp_rollup`
Ajoute `actor text NOT NULL DEFAULT ''`. PK → `(campaign_id, postal_code, actor)`.
`dept`, `in_target`, `planned_share` restent des **faits par CP** (constants
d'un acteur à l'autre pour un même CP) — ils se **répètent** sur chaque ligne
acteur. `impressions/clicks/spend/imps_7d/imps_prev7d` deviennent **par acteur**.

Volumétrie : ~6 200 CP × ~5 acteurs ≈ **31 k lignes** (Nano-safe, < 100 ms).

### `refresh_campaign_rollups`
Ajoute `actor` aux `GROUP BY` (daily : `date, media, actor` ; CP :
`postal_code, actor`). Le `LEFT JOIN plan` reste par CP (in_target/planned_share
inchangés, répétés par acteur). Reste `SECURITY DEFINER`, service_role only.

**Source de l'attribution acteur** : dans l'ad server, `actor` vient d'un champ
de délivrance (`dsp_campaign_data.actor`). En prod, ce champ doit être peuplé
par le tag placement/DSP à l'ingestion (**prérequis d'ingestion documenté**,
hors périmètre de ce sous-projet). Pour la démo, le seed le fabrique.

## Changements RPC

Toutes les fonctions de lecture gagnent un paramètre optionnel
`p_actors text[] DEFAULT NULL`. `NULL` ou tableau vide = **tous les acteurs**
(comportement actuel, aucune régression). Toutes restent `SECURITY DEFINER`,
`search_path = public, pg_catalog`, `REVOKE … / GRANT EXECUTE … TO service_role`.

### Règle de réécriture : group-by-CP-first

Comme `planned_share`/`in_target` se répètent par acteur, **toute agrégation qui
touche `planned_share` doit d'abord collapser les acteurs par CP**. Pattern :

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

`in_target`/`planned_share` dans le `GROUP BY` sont sûrs (constants par CP). En
aval, `SUM(planned_share)` compte chaque CP **une fois** → correct.

### `get_campaign_suivi(p_campaign_id uuid, p_actors text[] DEFAULT NULL)`
- Daily (pacing, CPM, objectif, `daily`) : filtrer `campaign_daily_rollup` par
  `actor = ANY(p_actors)`. Pacing/CPM/objectif se recalculent sur les acteurs
  cochés (dépense et impressions du sous-ensemble).
- CP (level1, depts, alerte zones_under, pression) : passer par le CTE `cp`
  ci-dessus. **Renormalisation** : `v_cp_total_imps` = somme des impressions du
  sous-ensemble → parts et hold_index se renormalisent sur les acteurs cochés
  (piège du collapse mécanique évité).
- `medias` : conservé tel quel (groupé par `media`, filtré par acteur).
- Signature élargie ; l'appel actuel sans `p_actors` reste valide (default NULL).

### `get_campaign_suivi_map(p_campaign_id, p_metric, bbox…, p_actors text[] DEFAULT NULL)`
CTE `total` et la sélection CP filtrées par acteur + group-by-CP-first (le
`total` de renormalisation = somme du sous-ensemble). Le nouveau paramètre
`p_actors` est ajouté **en dernier** (signature rétro-compatible).

### `get_campaign_suivi_cps(p_campaign_id, p_dept, p_actors text[] DEFAULT NULL)`
Idem : `total` et le détail CP par acteur, group-by-CP-first.

### `get_campaign_reconciliation(p_campaign_id, p_actors text[] DEFAULT NULL)`
- `by_channel` : filtré par acteur (les canaux ∈ p_actors), inchangé sinon.
- `global.adserver_impressions` : somme `campaign_daily_rollup` **sur les acteurs
  programmatiques** (∈ dsps ∪ socials) ∩ p_actors → taux de mesure honnête.
- Récupère `dsps`/`socials` depuis `geo_strategy.channels` pour le scope
  programmatique.

### `get_campaign_reconciliation_map(p_campaign_id, p_metric, bbox…, p_actors text[] DEFAULT NULL)`
Filtre le join `campaign_cp_rollup` par acteur (group-by-CP-first pour le
mesuré), le `campaign_dsp_report` par canal ∈ p_actors.

### Nouveau : `get_campaign_actors(p_campaign_id uuid)`
Retourne la **liste complète** des acteurs (non filtrée) — source du multi-select
ET du panneau. Pour chaque acteur : `kind`, `impressions` (livré ad-server),
`spend`, `cpm`, `share_pct` (part du total ad-server), `measure_rate`
(programmatique : ad-server(actor) ÷ DSP-report(channel=actor) ; régie : NULL).

```
RETURNS jsonb  -- { actors: [ { actor, kind, impressions, spend, cpm, share_pct, measure_rate } ... ] }
```

Trié par `impressions DESC`. `SECURITY DEFINER`, service_role only.

### `simulate_dsp_report` (généralisation cohérente)
Aujourd'hui : distribue le total daily par part de budget sur les canaux. Avec
la dimension acteur, **dérive le rapport DSP par canal directement du rollup
per-acteur** : DSP(channel) = ad-server(actor=channel) × 1,03 (sur-déclaration)
× `demo_cpm`. L'attribution acteur se fait **une seule fois** (dans la
délivrance ad-server du seed) ; `simulate_dsp_report` ne redistribue plus. Ne
génère QUE pour les canaux programmatiques (dsps ∪ socials) — pas les régies.

## Changements API

Routes existantes : ajouter `?actors=a,b,c` (CSV, optionnel). Absent = tous.
- `GET /api/digital/[campaignId]/suivi` → passe `p_actors` à `get_campaign_suivi`.
- `GET /api/digital/[campaignId]/reconcile` → passe `p_actors`.
- La route carte suivi (event `magelian:suivi-map`) → `p_actors` à
  `get_campaign_suivi_map` / `get_campaign_reconciliation_map`.

Nouvelle route :
- `GET /api/digital/[campaignId]/actors` → `get_campaign_actors`. `requireAuth`
  + `checkCampaignAccess` (même garde que `/suivi`). `Cache-Control: no-store`.

Toutes lisent les rollups uniquement (jamais `dsp_campaign_data` à chaud).

## Changements UI

### Multi-select « Acteurs » (nouveau composant)
`components/campaign/suivi/ActorFilter.tsx` — dropdown à cases (design system :
input `--bg-level-2`, border `--border-subtle`, focus teal). Défaut = tous
cochés. Placé en tête de la colonne bilan de `CampaignSuivi`, sous le bandeau
« Suivi ». Émet la sélection ; état local dans `CampaignSuivi`.

Comportement : la sélection pilote un **refetch débounced (300 ms)** de `/suivi`
et `/reconcile` avec `?actors=`. Cache `useRef` keyé par `campaignId + acteurs
triés` (respecte la règle Nano « cache avant fetch »). Tous cochés → pas de
param (chemin actuel).

### Panneau « Par acteur » (nouveau composant)
`components/campaign/suivi/ActorPanel.tsx` — section (bandeau dot teal « Par
acteur ») avec :
- Tableau : une ligne par acteur **sélectionné**, badge `kind` (DSP / social /
  régie), colonnes **livré · dépense · CPM · part · taux de mesure** (« — » si
  N/A), tri par livré. Réutilise `fmtInt/fmtCpm/fmtPct/toneColor` +
  `measureRateTone` (DRY).
- Mini bar-chart de répartition du volume (Recharts, même palette que
  `SuiviCharts`).

Alimenté par `/api/digital/[campaignId]/actors` (fetch une fois, non filtré) ;
n'affiche que les acteurs cochés dans le multi-select.

Inséré dans `CampaignSuivi` entre `SuiviCockpit` et `ReconciliationPanel`.

### Carte
`app/map/_components/SuiviMapLayer.tsx` + l'event `magelian:suivi-map` :
`detail.actors?: string[]`. La couche passe `actors` à sa route de fetch. Le
bouton « Voir sur la carte » propage la sélection courante.

### Types
`lib/campaigns/actor-metrics.ts` (nouveau) : `ActorKind`, `ActorRow`,
`ActorsPayload`, ré-export des formats. Testable Vitest pur (comme
suivi-metrics).

## Changements seed démo (`sql/112`)

Le récit actuel est **préservé** (pacing en retard, CPM TikTok qui dérive,
Marseille/Lille sous-délivrés, fuite silencieuse). On **superpose** l'attribution
acteur sans changer les **totaux** (pacing/géo/assertion inchangés) :

- Constante `v_actor_split` : parts programmatiques par budget
  (dv360 ≈ 45 %, ttd ≈ 11 %, tiktok ≈ 17 %) + **2 régies** en direct
  (« Régie presse régionale » ≈ 17 %, « Régie TV connectée » ≈ 10 %). Somme = 1.
- L'INSERT ad-server ventile `day_imps` (et spend/clicks) par acteur selon
  `v_actor_split`, en écrivant `actor`. Répartition déterministe, plate sur les
  CP (pas de biais géo par acteur en v1 — le hold géo par acteur reste ≈ le hold
  global, cohérent).
- `simulate_dsp_report` dérive le rapport DSP des acteurs programmatiques (voir
  §RPC). Les régies n'ont pas de rapport DSP.
- `demo_cpm` inchangé (dérive TikTok 9,20 conservée).

**Assertion étendue** : en plus des alertes (pacing + zones_under présentes,
leak absente), vérifier que `get_campaign_actors` renvoie **≥ 4 acteurs** dont au
moins **1 régie** (`kind = 'régie'`, `measure_rate` NULL) et que le taux de
mesure global reste **90–99 %** (scopé programmatique, non gonflé par les régies).

## Invariants de cohérence (contrat)

- Totaux ad-server (impressions, spend) **inchangés** par l'attribution acteur →
  pacing/CPM/objectif/géo globaux identiques à aujourd'hui (mêmes alertes).
- `Σ share_pct` acteurs = 100 %.
- Taux de mesure global ∈ [90, 99] % (programmatique seul).
- Filtrer à un sous-ensemble d'acteurs renormalise parts/hold (pas de collapse).
- `p_actors = NULL` ⇒ payloads **identiques** aux RPC actuelles.

## Vérification (bout-en-bout, après implémentation)

En base ET en navigateur, sur la démo :
- **Sans filtre** : cockpit identique à aujourd'hui (pacing ~0,80, CPM ~6,50,
  alertes pacing + zones_under, pas de leak). Non-régression stricte.
- **Panneau Par acteur** : ≥ 4 lignes (dv360, ttd, tiktok, 2 régies), parts
  sommant à 100 %, TikTok CPM ~9,20, régies avec « — » en taux de mesure.
- **Filtre = {tiktok}** : cockpit recalculé sur TikTok seul, CPM ~9,20 remonté
  en tuile, parts renormalisées, carte redessinée.
- **Filtre = {dv360, ttd}** : pas de TikTok, CPM plus proche du prévu.
- **Réconciliation** : taux de mesure global 90–99 % (inchangé, régies exclues).
- Tests Vitest : tons + formats de `actor-metrics` ; group-by-CP-first vérifié
  par un test SQL de non-régression (payload `p_actors=NULL` == payload actuel).

## Livrable

- `sql/113_campaign_actors.sql` — ALTER rollups + `refresh_campaign_rollups`
  (actor) + RPC `get_campaign_suivi`/`_map`/`_cps`/reconciliation (`p_actors`) +
  `get_campaign_actors` + `simulate_dsp_report` (dérivé per-acteur). Appliqué via
  MCP + copié pour le repo.
- `sql/112_demo_seed_coherent.sql` — attribution acteur + 2 régies + assertion
  étendue.
- `lib/campaigns/actor-metrics.ts` + tests.
- `components/campaign/suivi/ActorFilter.tsx`, `ActorPanel.tsx` ; câblage
  `CampaignSuivi.tsx` ; `SuiviMapLayer.tsx` + event.
- Route `app/api/digital/[campaignId]/actors/route.ts` + `?actors=` sur suivi /
  reconcile / carte.

## Hors périmètre (sous-projet 2 et au-delà)

- **Complétude cockpit** : reach & fréquence, performance (clics/CTR/
  conversions/CPA), complétion de délivrance.
- **Ingestion réelle** de la dimension acteur (tag placement/DSP) — ici on pose
  le schéma + le fallback `''` ; le peuplement prod est un chantier data séparé.
- Biais géographique **par acteur** dans la démo (attribution plate en v1).
- L'autre démo nationale (`fd18d97c`) — non touchée.
