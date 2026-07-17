# Suivi en cours de campagne — cockpit media planner (design)

> Validé par Vincent le 2026-07-17. Question métier : « on surpresse une zone,
> on veut voir si cette surpression est tenue » — plus pacing budget/temps et
> CPM sous contrôle. Contrainte de lecture : 12 000 codes postaux ne se lisent
> pas en liste — cockpit par exception.

## Décisions validées

- **Emplacement** : l'onglet **Suivi campagne** de l'overlay MAGELIAN devient le
  cockpit (le chat IA reste à côté ; le Pilotage ML reste l'outil expert).
- **Carte** : pas de mini-carte — bouton « Voir sur la carte » qui replie
  l'overlay et pose une choroplèthe CP sur la carte MapLibre.
- **Référentiel zones** : le **plan de pression** (bid multipliers armés au
  lancement, `bidding_zone_configs`). Indice de tenue = part d'impressions
  réelle ÷ part attendue du plan.
- **Mode démo obligatoire** : tout fonctionne sur la campagne démo pilotage
  (`dccc0000-…-0002`, 185 580 lignes ad server avec spend 100 %).

## Principes de lecture (anti-12 000 CP)

1. **Par exception** : le cockpit n'affiche que ce qui sort des rails
   (alertes) ; le reste est résumé en 4 tuiles.
2. **Agrégation hiérarchique** : cible vs hors-cible → départements → CP d'un
   département au clic (jamais plus de ~500 lignes à l'écran).
3. **« À jour au … »** : toutes les métriques sont calculées à la date du
   dernier point de données ad server (pas à aujourd'hui) — un import en retard
   ne fabrique pas un faux retard de pacing. La date est affichée en tête.

## UI — l'onglet Suivi restructuré

Colonne gauche (le bilan actuel est remplacé par le cockpit), chat IA inchangé
à droite.

### 1. Bandeau de tête — 4 tuiles code couleur

| Tuile | Contenu | Couleur |
|---|---|---|
| Pacing | « Budget 51 % · Temps 49 % » + indice délivrance (budget%÷temps%) | vert 0,9–1,1 · orange 0,75–0,9 / 1,1–1,25 · rouge au-delà |
| CPM | réel cumulé vs prévu (« 6,20 € vs 7,10 € · −13 % ») | vert ≤ prévu+10 % · orange +10–25 % · rouge > +25 % |
| Pression | « Demandée ×2,0 · Obtenue ×1,45 » (voir formule) | vert ≥ 80 % du demandé · orange 60–80 % · rouge < 60 % |
| Objectif | volume à date vs prorata du KPI cible (ou du forecast si pas de KPI) | mêmes paliers que pacing |

### 2. Alertes (règles serveur, max ~6 cartes)

- Zones cibles en sous-délivrance : « N CP cibles sous 70 % du plan (X € de
  spend, Y % du volume cible) » → clic = tableau filtré.
- CPM en dérive : « CPM +N % vs prévu depuis J jours [par canal si multi] ».
- Pacing hors rails : « en retard/avance de N points ».
- Fuite hors cible (zones strictes uniquement) : « N % du volume hors de la
  cible » (attendu ≈ 0).
- Aucune alerte → carte unique « Tout est dans les rails ✓ ».

### 3. Graphes (Recharts)

- **Budget cumulé** : courbe spend cumulé vs droite idéale (budget × t), zone
  de tolérance ±10 %.
- **CPM quotidien** : courbe CPM/jour vs ligne CPM prévu (option par canal).

### 4. Tableau hiérarchique

- Niveau 1 : deux lignes — **Cible** / **Hors cible** (imps, part réelle vs
  part plan, CPM, spend).
- Niveau 2 (déplié par défaut sur Cible) : départements triés par pire indice
  de tenue. Colonnes : impressions, indice de tenue, CPM réel, spend,
  Δ 7 j (volume des 7 derniers jours vs les 7 précédents, en %).
- Niveau 3 (au clic sur un département) : ses CP uniquement, mêmes colonnes.

### 5. Carte

Bouton « Voir sur la carte » → l'overlay se replie, choroplèthe CP (métrique
au choix : indice de tenue ou CPM réel, mêmes paliers de couleur que le
cockpit). Réutilise le pattern `get_digital_campaign_map` (GeoJSON CP bbox).

## Formules

- **Pacing** : `budget% = Σ spend ÷ total_budget stratégie` ;
  `temps% = (as_of − start_date + 1) ÷ (end_date − start_date + 1)` ;
  indice = budget% ÷ temps%.
- **CPM réel** : `Σ spend ÷ Σ impressions × 1000` (cumulé, par jour, par
  canal via `media`).
- **Part attendue du plan** (par CP) : `multiplier_cp ÷ Σ multipliers`
  (approximation uniforme par CP — pas de pondération population en v1).
- **Indice de tenue** (zone = CP ou agrégat) : `part d'impressions réelle ÷
  part attendue du plan` × 100.
- **Pression obtenue** (tuile) :
  - mode `national+surpression` : `(part imps cible ÷ part CP cible) ÷
    (part imps hors cible ÷ part CP hors cible)` — à comparer au ×demandé.
  - mode `zones strictes` (exclusion) : le ratio n'a pas de sens (hors cible
    attendu = 0) → la tuile affiche « Volume dans la cible : N % » et la
    fuite passe en alerte.
- **Objectif** : si `kpi_target` (unité impressions/volume) : réalisé ÷
  (kpi_target × temps%). Sinon : impressions réalisées ÷ (budget% ×
  budget ÷ forecast_cpm × 1000).

## Backend — contrainte Supabase Nano

Les données ad server ne changent **qu'à l'import** → tout est pré-agrégé à ce
moment-là, le cockpit ne lit que des rollups (jamais de scan des 185 k–70 M
lignes à l'ouverture).

### Tables rollup (nouvelles)

- `campaign_daily_rollup` : (campaign_id, date, media) → impressions, clicks,
  spend. ~30–300 lignes par campagne. Alimente pacing + graphes.
- `campaign_cp_rollup` : (campaign_id, postal_code) → impressions, clicks,
  spend, imps_7d et imps_prev7d (deux fenêtres 7 j calées sur as_of, pour le
  Δ 7 j), dept (substring), in_target boolean, planned_share numeric.
  ~6–12 k lignes par campagne.
  Alimente tableau, alertes, carte. `in_target`/`planned_share` copiés depuis
  `bidding_zone_configs` de la stratégie active au moment du refresh.

### RPC (SECURITY DEFINER service_role, comme le reste)

- `refresh_campaign_rollups(campaign_id)` : reconstruit les deux rollups en un
  passage (agrégat SQL simple sur dsp_campaign_data indexé campaign_id).
  Appelée : fin d'import DSP, fin d'absorb, armement/re-lancement d'une
  stratégie (pour planned_share). Progression : l'import affiche l'étape
  « agrégats de suivi » dans son flux SSE existant.
- `get_campaign_suivi(campaign_id)` : lit les rollups + la stratégie et
  renvoie UN jsonb : { as_of, pacing, cpm, pressure, objective, alerts,
  level1, depts, daily }. Les règles d'alerte vivent ici (SQL, seuils
  constants documentés).
- `get_campaign_suivi_cps(campaign_id, dept)` : les CP d'un département
  (drill niveau 3).
- `get_campaign_suivi_map(campaign_id, bbox)` : GeoJSON CP (géométries du
  référentiel CP existant) + indice/CPM, pour la couche carte.

### Route API

- `GET /api/digital/[campaignId]/suivi` (requireAuth + scope org, pattern
  des routes digital existantes) → passe-plat de `get_campaign_suivi`.
- `GET /api/digital/[campaignId]/suivi/cps?dept=` → drill.
- `GET /api/digital/[campaignId]/suivi/map?bbox=` → couche carte.

## Mode démo

- La campagne démo a tout : spend 305 301 €, 49,2 M imps, 6 186 CP, stratégie
  active avec 11 435 zone configs.
- **Recalibrage démo** (données seules, aucun code spécial démo dans le
  cockpit) : la stratégie démo passe à `total_budget = 600 000 €` et
  `end_date = 2026-05-31`. Au « à jour au 30/04 » : temps ≈ 49 %, budget
  ≈ 51 % → indice 1,04 ; CPM 6,20 € vs 7,10 € → −13 %. Lecture en vol
  crédible. (`bidding_daily_state` est vide pour la démo — rien d'autre ne
  dépend de ces valeurs.)
- `refresh_campaign_rollups` est exécutée une fois sur la démo à la migration.

## Hors périmètre (v1)

- Pondération population des parts attendues (approximation par CP en v1).
- Réconciliation DSP ↔ ad server (les deux flux restent séparés).
- Rebid/actions automatiques depuis le cockpit (le chat propose déjà, le
  wizard modifie).
- Seuils d'alerte configurables par l'utilisateur (constantes serveur en v1).
- Multi-devise (EUR partout).

## Fichiers principaux prévus

- `sql/1xx_campaign_rollups.sql` — tables + RPC + backfill démo.
- `app/api/digital/[campaignId]/suivi/{route.ts,cps/route.ts,map/route.ts}`.
- `components/campaign/suivi/` — `SuiviCockpit.tsx` (tuiles + alertes),
  `SuiviCharts.tsx`, `SuiviTable.tsx` (hiérarchie), types partagés + helpers
  purs testés (`lib/campaigns/suivi-metrics.ts` : formules ci-dessus).
- `CampaignSuivi.tsx` : la colonne bilan intègre le cockpit (FinalReport
  reste pour les stratégies terminées).
- Couche carte : `components/map/layers/` selon le pattern CivicHealthMapLayer.
