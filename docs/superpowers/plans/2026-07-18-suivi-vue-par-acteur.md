# Suivi campagne — vue par acteur — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter au Suivi campagne une lecture **par acteur** (DSP/social/régie) — filtre global qui recalcule le cockpit + panneau dédié — et une lecture **atteinte objectif par CP** (carte divergente + bandeau d'écarts).

**Architecture:** L'ad server devient la source unifiée : `dsp_campaign_data` et les deux rollups gagnent une dimension `actor`. Les RPC de lecture gagnent un filtre optionnel `p_actors text[]` (NULL = tous, non-régression stricte). Une métrique `atteinte objectif = imps ÷ (planned_share × objectif_global_proraté)` est ajoutée aux payloads, à la carte (échelle divergente centrée sur 100) et au tableau. Un nouveau `get_campaign_actors` alimente le multi-select + le panneau. La réconciliation DSP est **inchangée** (secondaire).

**Tech Stack:** PostgreSQL 15 + PostGIS (RPC PL/pgSQL, appliqués via MCP Supabase), Next.js 14 App Router (routes API), React 19 + MapLibre GL + Recharts, TypeScript strict, Vitest, Zod.

## Global Constraints

- **Supabase Nano I/O** : les RPC lisent UNIQUEMENT les rollups (`campaign_daily_rollup`, `campaign_cp_rollup`) — JAMAIS `dsp_campaign_data` à chaud. Max 3 requêtes Supabase parallèles. Bbox = viewport, jamais France entière sans LIMIT.
- **Migrations SQL** : appliquées via MCP Supabase (`mcp__…Supabase__apply_migration` / `execute_sql`), JAMAIS de SQL manuel demandé à l'utilisateur. Chaque fichier `sql/NNN_*.sql` est aussi copié dans le repo.
- **Fonctions SQL** : `SECURITY DEFINER`, `SET search_path = public, pg_catalog`, `REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE … TO service_role`.
- **Non-régression** : `p_actors = NULL` ⇒ payloads identiques aux RPC actuelles (aux nouveaux champs `objective_alignment`/`objective_zones` près). Totaux ad-server inchangés par l'attribution acteur.
- **Design System** : couleurs via `var(--token)` uniquement (jamais de hex en dur, sauf le fallback runtime déjà présent dans `readToneColors`). Sentence case. Inter + JetBrains Mono. Focus teal. Pas de violet.
- **No hardcode** : pas d'IDs/colonnes/noms de canaux en dur ; le kind acteur est dérivé de `geo_strategy.channels`. Noms de régies démo génériques (règle no-fake-brand).
- **Routes API** : `export const dynamic = 'force-dynamic'`, `requireAuth` + `checkCampaignAccess`, `Cache-Control: no-store`.
- **Campagne démo** : `dccc0000-0000-4000-8000-000000000002` (stratégie `dccc0000-0000-4000-8000-000000000012`) pour toutes les vérifications en base.

---

### Task 1: Dimension `actor` — schéma + `refresh_campaign_rollups`

**Files:**
- Create: `sql/113_campaign_actors.sql` (bloc 1/6 — ce fichier grandira aux tasks 2-5)
- Apply: via MCP Supabase (`apply_migration` name `campaign_actors_schema`)

**Interfaces:**
- Produces: colonnes `campaign_daily_rollup.actor`, `campaign_cp_rollup.actor`, `dsp_campaign_data.actor` ; `refresh_campaign_rollups(uuid)` inchangée en signature mais peuple `actor`.

- [ ] **Step 1: Écrire le SQL du schéma + refresh dans `sql/113_campaign_actors.sql`**

```sql
-- ============================================================
-- 113 — Dimension « acteur » du suivi campagne (vue par acteur)
-- ============================================================
-- Appliquée le 2026-07-18 via MCP Supabase. L'ad server devient la source
-- unifiée : chaque impression porte un `actor`. Rollups per-acteur ; RPC de
-- lecture filtrables par `p_actors` (NULL = tous, non-régression). Réconciliation
-- DSP inchangée (secondaire). Prérequis : 107 (rollups), 108 (suivi), 109 (map/cps).

-- 1) Colonnes actor. dsp_campaign_data : nullable (peuplé au tag/ingestion, ou
--    par le seed démo). Rollups : NOT NULL DEFAULT '' (entrent dans la PK).
ALTER TABLE public.dsp_campaign_data   ADD COLUMN IF NOT EXISTS actor text;
ALTER TABLE public.campaign_daily_rollup ADD COLUMN IF NOT EXISTS actor text NOT NULL DEFAULT '';
ALTER TABLE public.campaign_cp_rollup    ADD COLUMN IF NOT EXISTS actor text NOT NULL DEFAULT '';

ALTER TABLE public.campaign_daily_rollup DROP CONSTRAINT IF EXISTS campaign_daily_rollup_pkey;
ALTER TABLE public.campaign_daily_rollup ADD  PRIMARY KEY (campaign_id, date, media, actor);
ALTER TABLE public.campaign_cp_rollup    DROP CONSTRAINT IF EXISTS campaign_cp_rollup_pkey;
ALTER TABLE public.campaign_cp_rollup    ADD  PRIMARY KEY (campaign_id, postal_code, actor);

-- 2) refresh_campaign_rollups : ajoute `actor` (COALESCE(d.actor,'')) aux GROUP BY.
CREATE OR REPLACE FUNCTION public.refresh_campaign_rollups(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  v_source text; v_as_of date; v_strategy_id uuid; v_out_mode text;
  v_daily int := 0; v_cp int := 0;
BEGIN
  SELECT dsp_source INTO v_source FROM dsp_campaigns WHERE id = p_campaign_id;
  IF v_source IS NULL THEN RETURN jsonb_build_object('error', 'campaign_not_found'); END IF;

  DELETE FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id;
  INSERT INTO campaign_daily_rollup (campaign_id, date, media, actor, impressions, clicks, spend)
  SELECT p_campaign_id, d.date, COALESCE(d.media, ''), COALESCE(d.actor, ''),
         SUM(CASE WHEN v_source = 'adform' THEN COALESCE(d.tracked_ads, 0)
                  ELSE COALESCE(NULLIF(d.impressions, 0), d.tracked_ads, 0) END),
         SUM(COALESCE(d.clicks, 0)), SUM(COALESCE(d.spend, 0))
  FROM dsp_campaign_data d
  WHERE d.campaign_id = p_campaign_id AND d.date IS NOT NULL
  GROUP BY d.date, COALESCE(d.media, ''), COALESCE(d.actor, '');
  GET DIAGNOSTICS v_daily = ROW_COUNT;

  SELECT MAX(date) INTO v_as_of FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id;

  SELECT s.id, s.out_zone_weights->>'mode' INTO v_strategy_id, v_out_mode
  FROM bidding_strategies s WHERE s.campaign_id = p_campaign_id ORDER BY s.created_at DESC LIMIT 1;

  DELETE FROM campaign_cp_rollup WHERE campaign_id = p_campaign_id;
  INSERT INTO campaign_cp_rollup
    (campaign_id, postal_code, actor, dept, impressions, clicks, spend,
     imps_7d, imps_prev7d, in_target, planned_share)
  WITH raw AS (
    SELECT d.postal_code, COALESCE(d.actor, '') AS actor, d.date,
           CASE WHEN v_source = 'adform' THEN COALESCE(d.tracked_ads, 0)
                ELSE COALESCE(NULLIF(d.impressions, 0), d.tracked_ads, 0) END AS imp,
           COALESCE(d.clicks, 0) AS clk, COALESCE(d.spend, 0) AS sp
    FROM dsp_campaign_data d
    WHERE d.campaign_id = p_campaign_id AND d.postal_code IS NOT NULL
  ),
  plan AS (
    SELECT z.postal_code,
           z.bid_multiplier / NULLIF(SUM(z.bid_multiplier) OVER (), 0) AS planned_share,
           CASE WHEN v_out_mode = 'exclusion' THEN z.bid_multiplier > 0 ELSE z.bid_multiplier > 1 END AS in_target
    FROM bidding_zone_configs z WHERE z.strategy_id = v_strategy_id AND z.is_active
  )
  SELECT p_campaign_id, r.postal_code, r.actor, LEFT(r.postal_code, 2),
         SUM(r.imp), SUM(r.clk), SUM(r.sp),
         COALESCE(SUM(r.imp) FILTER (WHERE r.date > v_as_of - 7), 0),
         COALESCE(SUM(r.imp) FILTER (WHERE r.date <= v_as_of - 7 AND r.date > v_as_of - 14), 0),
         COALESCE(BOOL_OR(p.in_target), false), MAX(p.planned_share)
  FROM raw r LEFT JOIN plan p ON p.postal_code = r.postal_code
  GROUP BY r.postal_code, r.actor;
  GET DIAGNOSTICS v_cp = ROW_COUNT;

  RETURN jsonb_build_object('daily_rows', v_daily, 'cp_rows', v_cp, 'as_of', v_as_of);
END; $$;
REVOKE ALL ON FUNCTION public.refresh_campaign_rollups(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_campaign_rollups(uuid) TO service_role;
```

- [ ] **Step 2: Capturer le total AVANT migration (base de non-régression)**

Via MCP `execute_sql` :
```sql
SELECT SUM(impressions) AS daily_imps FROM campaign_daily_rollup
WHERE campaign_id = 'dccc0000-0000-4000-8000-000000000002';
```
Noter la valeur (ex. `daily_imps = N0`).

- [ ] **Step 3: Appliquer la migration**

`mcp__…Supabase__apply_migration` name `campaign_actors_schema`, query = le SQL du Step 1.

- [ ] **Step 4: Vérifier schéma + non-régression**

`execute_sql` :
```sql
SELECT public.refresh_campaign_rollups('dccc0000-0000-4000-8000-000000000002');
SELECT count(DISTINCT actor) AS actors, SUM(impressions) AS daily_imps
FROM campaign_daily_rollup WHERE campaign_id = 'dccc0000-0000-4000-8000-000000000002';
```
Expected : `actors = 1` (l'acteur `''`, l'ad server démo n'a pas encore d'attribution) et `daily_imps = N0` (identique au Step 2 — l'attribution acteur ne change rien tant que `dsp_campaign_data.actor` est NULL).

- [ ] **Step 5: Commit**

```bash
git add sql/113_campaign_actors.sql
git commit -m "feat(suivi): dimension acteur sur rollups + refresh_campaign_rollups"
```

---

### Task 2: `get_campaign_expected` (helper) + `get_campaign_suivi` filtrable + objectif

**Files:**
- Modify: `sql/113_campaign_actors.sql` (append)
- Apply: via MCP (`apply_migration` name `campaign_suivi_actors`)

**Interfaces:**
- Consumes: rollups per-acteur (Task 1).
- Produces: `get_campaign_expected(uuid) → numeric` ; `get_campaign_suivi(uuid, p_actors text[] DEFAULT NULL) → jsonb` avec, en plus, `objective_alignment` sur chaque `depts[]` et `objective_zones: {under,over}`.

- [ ] **Step 1: Append le helper + la fonction dans `sql/113_campaign_actors.sql`**

```sql
-- 3) Helper : objectif global proratisé (single source pour suivi/map/cps).
--    Indépendant de p_actors (l'objectif est celui de la campagne entière).
CREATE OR REPLACE FUNCTION public.get_campaign_expected(p_campaign_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE s record; v_as_of date; v_time numeric; v_expected numeric;
BEGIN
  SELECT s2.total_budget, s2.forecast_cpm, s2.start_date, s2.end_date, s2.kpi_target, s2.objective_code
  INTO s FROM bidding_strategies s2 WHERE s2.campaign_id = p_campaign_id
  ORDER BY s2.created_at DESC LIMIT 1;
  IF s IS NULL THEN RETURN NULL; END IF;
  SELECT MAX(date) INTO v_as_of FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id;
  IF v_as_of IS NULL OR s.start_date IS NULL OR s.end_date IS NULL OR s.end_date <= s.start_date THEN
    RETURN NULL; END IF;
  v_time := LEAST(1, GREATEST(0, (v_as_of - s.start_date + 1)::numeric / (s.end_date - s.start_date + 1)));
  IF s.kpi_target IS NOT NULL AND s.kpi_target > 0 AND s.objective_code = 'maximize_impressions' THEN
    v_expected := s.kpi_target * v_time;
  ELSIF s.total_budget IS NOT NULL AND s.forecast_cpm IS NOT NULL AND s.forecast_cpm > 0 THEN
    v_expected := s.total_budget * v_time / s.forecast_cpm * 1000;
  END IF;
  RETURN v_expected;
END; $$;
REVOKE ALL ON FUNCTION public.get_campaign_expected(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_expected(uuid) TO service_role;

-- 4) get_campaign_suivi : + p_actors (filtre), + objective_alignment/objective_zones.
--    Sommes de délivrance filtrées par acteur ; parts/spend planifiés = PLAN
--    (non filtrés). CTE `cp` = collapse par CP avec délivrance FILTRÉE dans le
--    SUM (les CP à 0 délivrance restent, planned_share conservé → alignment juste).
CREATE OR REPLACE FUNCTION public.get_campaign_suivi(p_campaign_id uuid, p_actors text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  s record;
  v_as_of date; v_spend numeric := 0; v_imps bigint := 0;
  v_budget_pct numeric; v_time_pct numeric; v_index numeric;
  v_cpm_real numeric; v_cpm_delta numeric;
  v_cp_total_imps bigint := 0; v_in_imps bigint := 0; v_in_spend numeric := 0;
  v_out_imps bigint := 0; v_out_spend numeric := 0; v_in_planned numeric := 0;
  v_in_share numeric; v_out_share numeric;
  v_plan_in_cps int := 0; v_plan_out_cps int := 0;
  v_requested numeric; v_obtained numeric;
  v_realized bigint; v_expected numeric; v_obj_pct numeric; v_obj_basis text;
  v_zones_under int := 0; v_zones_over int := 0;
  v_alerts jsonb := '[]'::jsonb;
  v_level1 jsonb; v_depts jsonb; v_daily jsonb; v_medias jsonb;
  v_under record;
BEGIN
  SELECT s2.id, s2.total_budget, s2.forecast_cpm, s2.start_date, s2.end_date,
         s2.out_zone_weights->>'mode' AS out_mode, s2.kpi_target, s2.objective_code
  INTO s FROM bidding_strategies s2 WHERE s2.campaign_id = p_campaign_id
  ORDER BY s2.created_at DESC LIMIT 1;
  IF s.id IS NULL THEN RETURN jsonb_build_object('error', 'no_strategy'); END IF;

  -- Daily (filtré par acteur)
  SELECT MAX(date), COALESCE(SUM(spend), 0), COALESCE(SUM(impressions), 0)
  INTO v_as_of, v_spend, v_imps
  FROM campaign_daily_rollup
  WHERE campaign_id = p_campaign_id AND (p_actors IS NULL OR actor = ANY(p_actors));
  IF v_as_of IS NULL THEN RETURN jsonb_build_object('error', 'no_rollup'); END IF;

  IF s.start_date IS NOT NULL AND s.end_date IS NOT NULL AND s.end_date > s.start_date THEN
    v_time_pct := ROUND(LEAST(1, GREATEST(0,
      (v_as_of - s.start_date + 1)::numeric / (s.end_date - s.start_date + 1))) * 100, 1);
  END IF;
  IF s.total_budget IS NOT NULL AND s.total_budget > 0 THEN
    v_budget_pct := ROUND(v_spend / s.total_budget * 100, 1);
  END IF;
  IF v_budget_pct IS NOT NULL AND COALESCE(v_time_pct, 0) > 0 THEN
    v_index := ROUND(v_budget_pct / v_time_pct, 2);
  END IF;

  IF v_imps > 0 THEN v_cpm_real := ROUND(v_spend / v_imps * 1000, 2); END IF;
  IF v_cpm_real IS NOT NULL AND s.forecast_cpm IS NOT NULL AND s.forecast_cpm > 0 THEN
    v_cpm_delta := ROUND((v_cpm_real - s.forecast_cpm) / s.forecast_cpm * 100, 1);
  END IF;

  -- Délivrance cible/hors cible (filtrée). in_target constant par CP → FILTER sûr.
  SELECT COALESCE(SUM(impressions), 0),
         COALESCE(SUM(impressions) FILTER (WHERE in_target), 0),
         COALESCE(SUM(spend) FILTER (WHERE in_target), 0),
         COALESCE(SUM(impressions) FILTER (WHERE NOT in_target), 0),
         COALESCE(SUM(spend) FILTER (WHERE NOT in_target), 0)
  INTO v_cp_total_imps, v_in_imps, v_in_spend, v_out_imps, v_out_spend
  FROM campaign_cp_rollup
  WHERE campaign_id = p_campaign_id AND (p_actors IS NULL OR actor = ANY(p_actors));

  -- Part planifiée cible = PLAN (non filtré par acteur, distinct par CP).
  SELECT COALESCE(SUM(planned_share), 0) INTO v_in_planned
  FROM (SELECT DISTINCT postal_code, planned_share, in_target
        FROM campaign_cp_rollup WHERE campaign_id = p_campaign_id) t
  WHERE in_target;

  IF v_cp_total_imps > 0 THEN
    v_in_share := ROUND(v_in_imps::numeric / v_cp_total_imps * 100, 1);
    v_out_share := ROUND(v_out_imps::numeric / v_cp_total_imps * 100, 1);
  END IF;

  SELECT COUNT(*) FILTER (WHERE CASE WHEN s.out_mode = 'exclusion' THEN bid_multiplier > 0 ELSE bid_multiplier > 1 END),
         COUNT(*) FILTER (WHERE NOT (CASE WHEN s.out_mode = 'exclusion' THEN bid_multiplier > 0 ELSE bid_multiplier > 1 END)),
         MAX(bid_multiplier)
  INTO v_plan_in_cps, v_plan_out_cps, v_requested
  FROM bidding_zone_configs WHERE strategy_id = s.id AND is_active;

  IF s.out_mode = 'exclusion' THEN
    v_requested := NULL; v_obtained := NULL;
  ELSIF v_plan_in_cps > 0 AND v_plan_out_cps > 0 AND v_out_imps > 0 THEN
    v_obtained := ROUND((v_in_imps::numeric / v_plan_in_cps) / NULLIF(v_out_imps::numeric / v_plan_out_cps, 0), 2);
  END IF;

  -- Objectif (expected = global via helper ; realized = filtré)
  v_realized := v_imps;
  v_expected := public.get_campaign_expected(p_campaign_id);
  IF s.kpi_target IS NOT NULL AND s.kpi_target > 0 AND s.objective_code = 'maximize_impressions' THEN
    v_obj_basis := 'kpi';
  ELSIF s.total_budget IS NOT NULL AND s.forecast_cpm IS NOT NULL AND s.forecast_cpm > 0 THEN
    v_obj_basis := 'forecast';
  END IF;
  IF v_expected IS NOT NULL AND v_expected > 0 THEN
    v_obj_pct := ROUND(v_realized / v_expected * 100, 1);
  END IF;

  -- Alertes (identiques ; sur données filtrées)
  IF v_index IS NOT NULL AND v_index < 0.85 THEN
    v_alerts := v_alerts || jsonb_build_object('kind', 'pacing',
      'severity', CASE WHEN v_index < 0.70 THEN 'danger' ELSE 'warning' END,
      'title', 'Pacing en retard de ' || ROUND(v_time_pct - v_budget_pct) || ' points',
      'detail', v_budget_pct || ' % du budget pour ' || v_time_pct || ' % du temps');
  ELSIF v_index IS NOT NULL AND v_index > 1.15 THEN
    v_alerts := v_alerts || jsonb_build_object('kind', 'pacing',
      'severity', CASE WHEN v_index > 1.30 THEN 'danger' ELSE 'warning' END,
      'title', 'Pacing en avance de ' || ROUND(v_budget_pct - v_time_pct) || ' points',
      'detail', v_budget_pct || ' % du budget pour ' || v_time_pct || ' % du temps');
  END IF;
  IF v_cpm_real IS NOT NULL AND s.forecast_cpm IS NOT NULL AND v_cpm_real > s.forecast_cpm * 1.25 THEN
    v_alerts := v_alerts || jsonb_build_object('kind', 'cpm', 'severity', 'danger',
      'title', 'CPM à ' || v_cpm_real || ' € — +' || v_cpm_delta || ' % vs prévu',
      'detail', 'CPM prévu : ' || ROUND(s.forecast_cpm, 2) || ' €');
  END IF;

  SELECT COUNT(*) AS n, COALESCE(SUM(spend), 0) AS sp, COALESCE(SUM(impressions), 0) AS im
  INTO v_under
  FROM campaign_cp_rollup
  WHERE campaign_id = p_campaign_id AND in_target AND planned_share > 0
    AND (p_actors IS NULL OR actor = ANY(p_actors))
    AND (impressions::numeric / NULLIF(v_cp_total_imps, 0)) / planned_share * 100 < 70;
  IF v_under.n > 0 THEN
    v_alerts := v_alerts || jsonb_build_object('kind', 'zones_under', 'severity', 'warning',
      'title', v_under.n || ' CP cibles sous 70 % du plan',
      'detail', ROUND(v_under.sp) || ' € de spend · '
        || ROUND(v_under.im::numeric / NULLIF(v_in_imps, 0) * 100, 1) || ' % du volume cible');
  END IF;
  IF s.out_mode = 'exclusion' AND COALESCE(v_out_share, 0) > 5 THEN
    v_alerts := v_alerts || jsonb_build_object('kind', 'leak', 'severity', 'warning',
      'title', v_out_share || ' % du volume hors de la cible',
      'detail', 'Zones strictes : la diffusion hors cible devrait être ~0');
  END IF;

  v_level1 := jsonb_build_array(
    jsonb_build_object('zone', 'cible', 'impressions', v_in_imps, 'share_real', v_in_share,
      'share_plan', ROUND(v_in_planned * 100, 1),
      'cpm', CASE WHEN v_in_imps > 0 THEN ROUND(v_in_spend / v_in_imps * 1000, 2) END,
      'spend', ROUND(v_in_spend, 2)),
    jsonb_build_object('zone', 'hors_cible', 'impressions', v_out_imps, 'share_real', v_out_share,
      'share_plan', ROUND((1 - v_in_planned) * 100, 1),
      'cpm', CASE WHEN v_out_imps > 0 THEN ROUND(v_out_spend / v_out_imps * 1000, 2) END,
      'spend', ROUND(v_out_spend, 2)));

  -- Départements : CTE cp (délivrance FILTRÉE dans le SUM, CP conservés).
  WITH cp AS (
    SELECT postal_code, dept, in_target, planned_share,
           COALESCE(SUM(impressions) FILTER (WHERE p_actors IS NULL OR actor = ANY(p_actors)), 0) AS impressions,
           COALESCE(SUM(spend)       FILTER (WHERE p_actors IS NULL OR actor = ANY(p_actors)), 0) AS spend,
           COALESCE(SUM(imps_7d)     FILTER (WHERE p_actors IS NULL OR actor = ANY(p_actors)), 0) AS imps_7d,
           COALESCE(SUM(imps_prev7d) FILTER (WHERE p_actors IS NULL OR actor = ANY(p_actors)), 0) AS imps_prev7d
    FROM campaign_cp_rollup WHERE campaign_id = p_campaign_id
    GROUP BY postal_code, dept, in_target, planned_share
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.hold_index ASC NULLS LAST), '[]'::jsonb)
  INTO v_depts
  FROM (
    SELECT dept, BOOL_OR(in_target) AS in_target, SUM(impressions) AS impressions,
           CASE WHEN SUM(planned_share) > 0 AND v_cp_total_imps > 0
                THEN ROUND((SUM(impressions)::numeric / v_cp_total_imps) / SUM(planned_share) * 100) END AS hold_index,
           CASE WHEN SUM(planned_share) FILTER (WHERE in_target) > 0 AND v_expected > 0
                THEN ROUND(SUM(impressions) FILTER (WHERE in_target)::numeric
                     / (SUM(planned_share) FILTER (WHERE in_target) * v_expected) * 100) END AS objective_alignment,
           CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(spend) / SUM(impressions) * 1000, 2) END AS cpm,
           ROUND(SUM(spend), 2) AS spend,
           CASE WHEN SUM(imps_prev7d) > 0
                THEN ROUND((SUM(imps_7d) - SUM(imps_prev7d))::numeric / SUM(imps_prev7d) * 100, 1) END AS delta7_pct
    FROM cp WHERE dept IS NOT NULL GROUP BY dept
  ) t;

  -- Zones sous/au-dessus objectif (CP cibles) pour le bandeau d'écarts.
  IF v_expected IS NOT NULL AND v_expected > 0 THEN
    WITH cp AS (
      SELECT postal_code, in_target, planned_share,
             COALESCE(SUM(impressions) FILTER (WHERE p_actors IS NULL OR actor = ANY(p_actors)), 0) AS impressions
      FROM campaign_cp_rollup WHERE campaign_id = p_campaign_id
      GROUP BY postal_code, in_target, planned_share
    )
    SELECT COUNT(*) FILTER (WHERE impressions / (planned_share * v_expected) * 100 < 90),
           COUNT(*) FILTER (WHERE impressions / (planned_share * v_expected) * 100 > 110)
    INTO v_zones_under, v_zones_over
    FROM cp WHERE in_target AND planned_share > 0;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.date), '[]'::jsonb) INTO v_daily
  FROM (
    SELECT date, SUM(impressions) AS impressions, ROUND(SUM(spend), 2) AS spend,
           CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(spend) / SUM(impressions) * 1000, 2) END AS cpm
    FROM campaign_daily_rollup
    WHERE campaign_id = p_campaign_id AND (p_actors IS NULL OR actor = ANY(p_actors))
    GROUP BY date
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.impressions DESC), '[]'::jsonb) INTO v_medias
  FROM (
    SELECT media, SUM(impressions) AS impressions, ROUND(SUM(spend), 2) AS spend,
           CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(spend) / SUM(impressions) * 1000, 2) END AS cpm
    FROM campaign_daily_rollup
    WHERE campaign_id = p_campaign_id AND (p_actors IS NULL OR actor = ANY(p_actors))
    GROUP BY media
  ) t;

  RETURN jsonb_build_object(
    'as_of', v_as_of, 'start_date', s.start_date, 'end_date', s.end_date,
    'pacing', jsonb_build_object('spend', ROUND(v_spend, 2), 'total_budget', s.total_budget,
      'budget_pct', v_budget_pct, 'time_pct', v_time_pct, 'index', v_index),
    'cpm', jsonb_build_object('real', v_cpm_real, 'forecast', ROUND(s.forecast_cpm, 2), 'delta_pct', v_cpm_delta),
    'pressure', jsonb_build_object('mode', COALESCE(s.out_mode, 'exclusion'),
      'requested', v_requested, 'obtained', v_obtained,
      'in_target_share', v_in_share, 'out_share', v_out_share),
    'objective', jsonb_build_object('code', s.objective_code, 'basis', v_obj_basis,
      'kpi_target', s.kpi_target, 'realized', v_realized,
      'expected', ROUND(COALESCE(v_expected, 0)), 'pct', v_obj_pct),
    'objective_zones', jsonb_build_object('under', v_zones_under, 'over', v_zones_over),
    'alerts', v_alerts, 'level1', v_level1, 'depts', v_depts, 'daily', v_daily, 'medias', v_medias);
END; $$;
REVOKE ALL ON FUNCTION public.get_campaign_suivi(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_suivi(uuid, text[]) TO service_role;
```

- [ ] **Step 2: Appliquer** `apply_migration` name `campaign_suivi_actors`, query = SQL du Step 1.

- [ ] **Step 3: Vérifier non-régression + nouveaux champs**

`execute_sql` :
```sql
SELECT
  (public.get_campaign_suivi('dccc0000-0000-4000-8000-000000000002') -> 'objective' ->> 'pct') AS obj_pct,
  jsonb_array_length(public.get_campaign_suivi('dccc0000-0000-4000-8000-000000000002') -> 'alerts') AS n_alerts,
  (public.get_campaign_suivi('dccc0000-0000-4000-8000-000000000002') -> 'objective_zones') AS zones,
  ((public.get_campaign_suivi('dccc0000-0000-4000-8000-000000000002') -> 'depts' -> 0) ? 'objective_alignment') AS has_align;
```
Expected : `n_alerts` inchangé vs avant (2 : pacing + zones_under), `zones` = objet `{under, over}` avec `under ≥ 1`, `has_align = true`, `obj_pct` non nul.

- [ ] **Step 4: Commit**

```bash
git add sql/113_campaign_actors.sql
git commit -m "feat(suivi): get_campaign_suivi filtrable par acteur + atteinte objectif"
```

---

### Task 3: `get_campaign_suivi_map` — filtre acteur + métrique `objectif`

**Files:**
- Modify: `sql/113_campaign_actors.sql` (append)
- Apply: via MCP (`apply_migration` name `campaign_suivi_map_actors`)

**Interfaces:**
- Consumes: `get_campaign_expected` (Task 2).
- Produces: `get_campaign_suivi_map(uuid, p_metric text, bbox×4, p_actors text[] DEFAULT NULL) → json` ; nouveau `p_metric = 'objectif'`.

- [ ] **Step 1: Append la fonction**

```sql
-- 5) get_campaign_suivi_map : + p_actors, + métrique 'objectif' (divergente 100).
CREATE OR REPLACE FUNCTION public.get_campaign_suivi_map(
  p_campaign_id uuid, p_metric text DEFAULT 'hold',
  p_bbox_xmin float8 DEFAULT -5.5, p_bbox_ymin float8 DEFAULT 41.2,
  p_bbox_xmax float8 DEFAULT 9.8, p_bbox_ymax float8 DEFAULT 51.2,
  p_actors text[] DEFAULT NULL)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
  WITH cp AS (
    SELECT r.postal_code, BOOL_OR(r.in_target) AS in_target, MAX(r.planned_share) AS planned_share,
           COALESCE(SUM(r.impressions) FILTER (WHERE p_actors IS NULL OR r.actor = ANY(p_actors)), 0) AS impressions,
           COALESCE(SUM(r.spend)       FILTER (WHERE p_actors IS NULL OR r.actor = ANY(p_actors)), 0) AS spend
    FROM campaign_cp_rollup r WHERE r.campaign_id = p_campaign_id
    GROUP BY r.postal_code
  ),
  total AS (SELECT NULLIF(SUM(impressions), 0)::numeric AS imps FROM cp),
  obj AS (SELECT public.get_campaign_expected(p_campaign_id) AS expected)
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT cp.postal_code AS code, rcp.nom_principal AS nom, cp.in_target,
           CASE
             WHEN p_metric = 'cpm'
               THEN CASE WHEN cp.impressions > 0 THEN ROUND(cp.spend / cp.impressions * 1000, 2) END
             WHEN p_metric = 'objectif'
               THEN CASE WHEN cp.in_target AND cp.planned_share > 0 AND obj.expected > 0
                         THEN ROUND(cp.impressions / (cp.planned_share * obj.expected) * 100) END
             ELSE CASE WHEN cp.planned_share > 0 AND total.imps IS NOT NULL
                       THEN ROUND((cp.impressions / total.imps) / cp.planned_share * 100) END
           END AS value,
           ST_AsGeoJSON(rcp.geom_simplified)::json AS geometry
    FROM cp
    JOIN ref_codes_postaux rcp ON rcp.code_postal = cp.postal_code
    CROSS JOIN total CROSS JOIN obj
    WHERE rcp.geom_simplified && ST_MakeEnvelope(p_bbox_xmin, p_bbox_ymin, p_bbox_xmax, p_bbox_ymax, 4326)
  ) t;
$$;
REVOKE ALL ON FUNCTION public.get_campaign_suivi_map(uuid, text, float8, float8, float8, float8, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_suivi_map(uuid, text, float8, float8, float8, float8, text[]) TO service_role;
```

- [ ] **Step 2: Appliquer** `apply_migration` name `campaign_suivi_map_actors`.

- [ ] **Step 3: Vérifier la métrique objectif**

`execute_sql` :
```sql
SELECT json_array_length(public.get_campaign_suivi_map('dccc0000-0000-4000-8000-000000000002', 'objectif')) AS n,
       (SELECT count(*) FROM json_array_elements(public.get_campaign_suivi_map('dccc0000-0000-4000-8000-000000000002', 'objectif')) e
        WHERE (e->>'value') IS NULL) AS hors_cible_null;
```
Expected : `n > 0` (features CP) et `hors_cible_null > 0` (les CP hors cible ont `value = null` → grisés).

- [ ] **Step 4: Commit**

```bash
git add sql/113_campaign_actors.sql
git commit -m "feat(suivi): carte suivi filtrable par acteur + metrique objectif divergente"
```

---

### Task 4: `get_campaign_suivi_cps` — filtre acteur + `objective_alignment`

**Files:**
- Modify: `sql/113_campaign_actors.sql` (append)
- Apply: via MCP (`apply_migration` name `campaign_suivi_cps_actors`)

**Interfaces:**
- Consumes: `get_campaign_expected` (Task 2).
- Produces: `get_campaign_suivi_cps(uuid, p_dept text, p_actors text[] DEFAULT NULL) → jsonb` ; chaque CP gagne `objective_alignment`.

- [ ] **Step 1: Append la fonction**

```sql
-- 6) get_campaign_suivi_cps : + p_actors, + objective_alignment par CP.
CREATE OR REPLACE FUNCTION public.get_campaign_suivi_cps(
  p_campaign_id uuid, p_dept text, p_actors text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
  WITH cp AS (
    SELECT r.postal_code, BOOL_OR(r.in_target) AS in_target, MAX(r.planned_share) AS planned_share,
           COALESCE(SUM(r.impressions) FILTER (WHERE p_actors IS NULL OR r.actor = ANY(p_actors)), 0) AS impressions,
           COALESCE(SUM(r.spend)       FILTER (WHERE p_actors IS NULL OR r.actor = ANY(p_actors)), 0) AS spend,
           COALESCE(SUM(r.imps_7d)     FILTER (WHERE p_actors IS NULL OR r.actor = ANY(p_actors)), 0) AS imps_7d,
           COALESCE(SUM(r.imps_prev7d) FILTER (WHERE p_actors IS NULL OR r.actor = ANY(p_actors)), 0) AS imps_prev7d,
           r.dept
    FROM campaign_cp_rollup r WHERE r.campaign_id = p_campaign_id
    GROUP BY r.postal_code, r.dept
  ),
  total AS (SELECT NULLIF(SUM(impressions), 0)::numeric AS imps FROM cp),
  obj AS (SELECT public.get_campaign_expected(p_campaign_id) AS expected)
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.hold_index ASC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT cp.postal_code, cp.in_target, cp.impressions,
           CASE WHEN cp.planned_share > 0 AND total.imps IS NOT NULL
                THEN ROUND((cp.impressions / total.imps) / cp.planned_share * 100) END AS hold_index,
           CASE WHEN cp.in_target AND cp.planned_share > 0 AND obj.expected > 0
                THEN ROUND(cp.impressions / (cp.planned_share * obj.expected) * 100) END AS objective_alignment,
           CASE WHEN cp.impressions > 0 THEN ROUND(cp.spend / cp.impressions * 1000, 2) END AS cpm,
           ROUND(cp.spend, 2) AS spend,
           CASE WHEN cp.imps_prev7d > 0
                THEN ROUND((cp.imps_7d - cp.imps_prev7d)::numeric / cp.imps_prev7d * 100, 1) END AS delta7_pct
    FROM cp CROSS JOIN total CROSS JOIN obj
    WHERE cp.dept = p_dept
    LIMIT 500
  ) t;
$$;
REVOKE ALL ON FUNCTION public.get_campaign_suivi_cps(uuid, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_suivi_cps(uuid, text, text[]) TO service_role;
```

- [ ] **Step 2: Appliquer** `apply_migration` name `campaign_suivi_cps_actors`.

- [ ] **Step 3: Vérifier**

`execute_sql` (dept 13 = Marseille, sous-délivré) :
```sql
SELECT ((public.get_campaign_suivi_cps('dccc0000-0000-4000-8000-000000000002', '13') -> 0) ? 'objective_alignment') AS has_align,
       jsonb_array_length(public.get_campaign_suivi_cps('dccc0000-0000-4000-8000-000000000002', '13')) AS n;
```
Expected : `has_align = true`, `n > 0`.

- [ ] **Step 4: Commit**

```bash
git add sql/113_campaign_actors.sql
git commit -m "feat(suivi): drill CP filtrable par acteur + atteinte objectif par CP"
```

---

### Task 5: `get_campaign_actors` (nouveau RPC)

**Files:**
- Modify: `sql/113_campaign_actors.sql` (append)
- Apply: via MCP (`apply_migration` name `get_campaign_actors`)

**Interfaces:**
- Consumes: `get_campaign_expected` (Task 2), `campaign_daily_rollup` per-acteur.
- Produces: `get_campaign_actors(uuid) → jsonb` `{ objective_pct, actors: [{actor, kind, impressions, spend, cpm, share_pct, objective_attainment}] }`.

- [ ] **Step 1: Append la fonction**

```sql
-- 7) get_campaign_actors : liste des acteurs (multi-select + panneau). Kind
--    dérivé de geo_strategy.channels (dsps/socials → dsp/social, sinon régie).
CREATE OR REPLACE FUNCTION public.get_campaign_actors(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  v_dsps text[]; v_socials text[]; v_expected numeric; v_total bigint; v_actors jsonb; v_obj_pct numeric;
BEGIN
  SELECT ARRAY(SELECT jsonb_array_elements_text(COALESCE(geo_strategy->'channels'->'dsps', '[]'::jsonb))),
         ARRAY(SELECT jsonb_array_elements_text(COALESCE(geo_strategy->'channels'->'socials', '[]'::jsonb)))
  INTO v_dsps, v_socials FROM dsp_campaigns WHERE id = p_campaign_id;

  v_expected := public.get_campaign_expected(p_campaign_id);
  SELECT COALESCE(SUM(impressions), 0) INTO v_total
  FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.impressions DESC), '[]'::jsonb) INTO v_actors
  FROM (
    SELECT actor,
           CASE WHEN actor = ANY(v_dsps) THEN 'dsp'
                WHEN actor = ANY(v_socials) THEN 'social'
                ELSE 'régie' END AS kind,
           SUM(impressions) AS impressions,
           ROUND(SUM(spend), 2) AS spend,
           CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(spend) / SUM(impressions) * 1000, 2) END AS cpm,
           CASE WHEN v_total > 0 THEN ROUND(SUM(impressions)::numeric / v_total * 100, 1) END AS share_pct,
           CASE WHEN v_expected > 0 THEN ROUND(SUM(impressions)::numeric / v_expected * 100, 1) END AS objective_attainment
    FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id
    GROUP BY actor
  ) t;

  v_obj_pct := CASE WHEN v_expected > 0 THEN ROUND(v_total::numeric / v_expected * 100, 1) END;
  RETURN jsonb_build_object('objective_pct', v_obj_pct, 'actors', v_actors);
END; $$;
REVOKE ALL ON FUNCTION public.get_campaign_actors(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_actors(uuid) TO service_role;
```

- [ ] **Step 2: Appliquer** `apply_migration` name `get_campaign_actors`.

- [ ] **Step 3: Vérifier la forme (avant seed : 1 acteur `''`)**

`execute_sql` :
```sql
SELECT jsonb_array_length(public.get_campaign_actors('dccc0000-0000-4000-8000-000000000002') -> 'actors') AS n,
       (public.get_campaign_actors('dccc0000-0000-4000-8000-000000000002') -> 'actors' -> 0 ->> 'kind') AS kind0;
```
Expected : `n = 1`, `kind0 = 'régie'` (l'acteur `''` n'est ni dsp ni social). La liste multi-acteurs viendra après le seed (Task 6).

- [ ] **Step 4: Commit**

```bash
git add sql/113_campaign_actors.sql
git commit -m "feat(suivi): get_campaign_actors (liste acteurs + atteinte objectif)"
```

---

### Task 6: Seed démo — attribution acteur + 2 régies + assertion étendue

**Files:**
- Modify: `sql/112_demo_seed_coherent.sql`
- Apply: via MCP (`apply_migration` name `demo_seed_actors` — ré-exécute le bloc DO)

**Interfaces:**
- Consumes: rollups + RPC des tasks 1-5.
- Produces: la démo `dccc…002` a ≥ 4 acteurs (dv360, ttd, tiktok, 2 régies) ; totaux inchangés.

- [ ] **Step 1: Modifier l'INSERT ad server pour ventiler par acteur**

Dans `sql/112_demo_seed_coherent.sql`, ajouter dans le bloc `DECLARE` (après `v_leak_daily`) la table d'attribution :

```sql
  -- Attribution acteur (chemin complet vue par acteur) : parts sommant à 1.
  -- dsp/social = canaux déclarés ; 2 régies en direct (noms génériques).
  v_actors jsonb := jsonb_build_array(
    jsonb_build_object('actor', 'dv360',                 'w', 0.45),
    jsonb_build_object('actor', 'ttd',                   'w', 0.11),
    jsonb_build_object('actor', 'tiktok',                'w', 0.17),
    jsonb_build_object('actor', 'Régie presse régionale','w', 0.17),
    jsonb_build_object('actor', 'Régie TV connectée',    'w', 0.10));
  v_n_actors int; v_regie_ok bool;
```

Remplacer l'INSERT ad server (le bloc `INSERT INTO dsp_campaign_data … FROM gen CROSS JOIN generate_series…`) par une version qui ventile chaque `day_imps` par acteur (`CROSS JOIN` sur `v_actors`, `round(day_imps × w)`), en écrivant `actor` :

```sql
  INSERT INTO dsp_campaign_data (campaign_id, date, postal_code, country, media, actor, impressions, clicks, spend, dsp_source)
  WITH zones AS (
    SELECT z.postal_code, z.bid_multiplier AS bm, (z.bid_multiplier > 0) AS in_target,
           CASE WHEN LEFT(z.postal_code, 2) = ANY(v_under_depts) THEN v_under_factor ELSE 1.0 END AS factor
    FROM bidding_zone_configs z
    JOIN ref_codes_postaux rcp ON rcp.code_postal = z.postal_code
    WHERE z.strategy_id = v_strategy AND z.is_active AND rcp.geom_simplified IS NOT NULL
  ),
  gen AS (
    SELECT postal_code,
           round(v_target_imps * (bm*factor) / NULLIF(SUM(bm*factor) OVER (), 0) / 30.0)::int AS day_imps
    FROM zones WHERE in_target
    UNION ALL
    SELECT postal_code, v_leak_daily
    FROM (SELECT postal_code FROM zones WHERE NOT in_target ORDER BY md5(postal_code) LIMIT v_leak_cps) l
  ),
  act AS (SELECT value->>'actor' AS actor, (value->>'w')::numeric AS w FROM jsonb_array_elements(v_actors))
  SELECT v_campaign, d::date, gen.postal_code, 'France', 'Display', act.actor,
         round(gen.day_imps * act.w)::int,
         round(gen.day_imps * act.w * 0.002)::int,
         round(gen.day_imps * act.w * v_cpm / 1000.0, 2), 'ttd'
  FROM gen CROSS JOIN generate_series(v_flight_start, v_data_end, '1 day') d CROSS JOIN act;
```

- [ ] **Step 2: Étendre l'assertion post-seed**

Après le bloc d'assertion alertes existant (avant la fermeture `END $$;`), ajouter :

```sql
  -- Assertion vue par acteur : ≥ 4 acteurs dont ≥ 1 régie.
  SELECT jsonb_array_length(a -> 'actors'),
         EXISTS (SELECT 1 FROM jsonb_array_elements(a -> 'actors') x WHERE x->>'kind' = 'régie')
  INTO v_n_actors, v_regie_ok
  FROM (SELECT public.get_campaign_actors(v_campaign) AS a) q;
  IF v_n_actors < 4 OR NOT v_regie_ok THEN
    RAISE EXCEPTION 'Seed incohérent : attendu ≥ 4 acteurs dont ≥ 1 régie (obtenu % acteurs, régie=%).', v_n_actors, v_regie_ok;
  END IF;
```

- [ ] **Step 3: Appliquer le seed** `apply_migration` name `demo_seed_actors`, query = tout le bloc `DO $$ … $$;` mis à jour.

- [ ] **Step 4: Vérifier attribution + non-régression des totaux**

`execute_sql` :
```sql
SELECT jsonb_array_length(public.get_campaign_actors('dccc0000-0000-4000-8000-000000000002') -> 'actors') AS n_actors,
       (SELECT count(*) FROM jsonb_array_elements(public.get_campaign_actors('dccc0000-0000-4000-8000-000000000002') -> 'actors') x WHERE x->>'kind' = 'régie') AS n_regie,
       jsonb_array_length(public.get_campaign_suivi('dccc0000-0000-4000-8000-000000000002') -> 'alerts') AS n_alerts;
```
Expected : `n_actors = 5`, `n_regie = 2`, `n_alerts = 2` (récit préservé : pacing + zones_under, pas de leak). Le seed lui-même échoue si l'assertion ne tient pas.

- [ ] **Step 5: Commit**

```bash
git add sql/112_demo_seed_coherent.sql
git commit -m "feat(demo): attribution acteur (dv360/ttd/tiktok + 2 regies) au seed"
```

---

### Task 7: Helpers TS — `alignmentTone` + `actor-metrics.ts`

**Files:**
- Modify: `lib/campaigns/suivi-metrics.ts`
- Create: `lib/campaigns/actor-metrics.ts`
- Test: `tests/unit/campaigns/suivi-metrics.test.ts` (create), `tests/unit/campaigns/actor-metrics.test.ts` (create)

**Interfaces:**
- Produces: `alignmentTone(v: number | null): SuiviTone` ; types `SuiviDeptRow.objective_alignment`, `SuiviCpRow.objective_alignment`, `SuiviPayload.objective_zones` ; `ActorKind`, `ActorRow`, `ActorsPayload`.

- [ ] **Step 1: Écrire le test de `alignmentTone`**

Créer `tests/unit/campaigns/suivi-metrics.test.ts` :
```ts
import { describe, it, expect } from 'vitest';
import { alignmentTone } from '@/lib/campaigns/suivi-metrics';

describe('alignmentTone (divergent autour de 100)', () => {
  it('ok 90-110 · warn 70-90/110-130 · bad ailleurs · null warn', () => {
    expect(alignmentTone(100)).toBe('ok');
    expect(alignmentTone(90)).toBe('ok');
    expect(alignmentTone(110)).toBe('ok');
    expect(alignmentTone(80)).toBe('warn');
    expect(alignmentTone(120)).toBe('warn');
    expect(alignmentTone(50)).toBe('bad');
    expect(alignmentTone(140)).toBe('bad');
    expect(alignmentTone(null)).toBe('warn');
  });
});
```

- [ ] **Step 2: Lancer le test — échec attendu**

Run: `npm test -- suivi-metrics`
Expected: FAIL (`alignmentTone` is not exported).

- [ ] **Step 3: Ajouter `alignmentTone` + les champs de type dans `lib/campaigns/suivi-metrics.ts`**

Ajouter `objective_alignment: number | null;` dans `SuiviDeptRow` et `SuiviCpRow` ; ajouter `objective_zones: { under: number; over: number };` dans `SuiviPayload` (après `objective`). Puis, après `holdTone` :
```ts
/** Alignement vs objectif : divergent, symétrique autour de 100 (proche = bon). */
export function alignmentTone(v: number | null): SuiviTone {
  if (v == null) return 'warn';
  if (v >= 90 && v <= 110) return 'ok';
  if ((v >= 70 && v < 90) || (v > 110 && v <= 130)) return 'warn';
  return 'bad';
}
```

- [ ] **Step 4: Lancer le test — succès**

Run: `npm test -- suivi-metrics`
Expected: PASS.

- [ ] **Step 5: Écrire le test de `actor-metrics`**

Créer `tests/unit/campaigns/actor-metrics.test.ts` :
```ts
import { describe, it, expect } from 'vitest';
import { actorKindLabel, actorDisplayName } from '@/lib/campaigns/actor-metrics';

describe('actor-metrics', () => {
  it('label du kind en sentence case', () => {
    expect(actorKindLabel('dsp')).toBe('DSP');
    expect(actorKindLabel('social')).toBe('Social');
    expect(actorKindLabel('régie')).toBe('Régie');
  });
  it('nom affiché : fallback pour acteur vide', () => {
    expect(actorDisplayName('dv360')).toBe('dv360');
    expect(actorDisplayName('')).toBe('Non attribué');
  });
});
```

- [ ] **Step 6: Lancer — échec attendu**

Run: `npm test -- actor-metrics`
Expected: FAIL (module inexistant).

- [ ] **Step 7: Créer `lib/campaigns/actor-metrics.ts`**

```ts
/**
 * Vue par acteur — types du payload de get_campaign_actors (sql/113) et helpers
 * purs. Aucune dépendance React (testable Vitest). Formats réutilisés de
 * suivi-metrics (DRY).
 */
export { fmtInt, fmtCpm, fmtPct, toneColor } from './suivi-metrics';

export type ActorKind = 'dsp' | 'social' | 'régie';

export interface ActorRow {
  actor: string;
  kind: ActorKind;
  impressions: number;
  spend: number;
  cpm: number | null;
  share_pct: number | null;
  objective_attainment: number | null;
}

export interface ActorsPayload {
  objective_pct: number | null;
  actors: ActorRow[];
}

export function actorKindLabel(kind: ActorKind): string {
  if (kind === 'dsp') return 'DSP';
  if (kind === 'social') return 'Social';
  return 'Régie';
}

export function actorDisplayName(actor: string): string {
  return actor.trim() === '' ? 'Non attribué' : actor;
}
```

- [ ] **Step 8: Lancer — succès + type-check**

Run: `npm test -- actor-metrics` → PASS.
Run: `npx tsc --noEmit` → aucune erreur.

- [ ] **Step 9: Commit**

```bash
git add lib/campaigns/suivi-metrics.ts lib/campaigns/actor-metrics.ts tests/unit/campaigns/suivi-metrics.test.ts tests/unit/campaigns/actor-metrics.test.ts
git commit -m "feat(suivi): helpers alignmentTone + actor-metrics"
```

---

### Task 8: Routes API — `/actors` + `?actors=` sur `/suivi` et `/suivi/map`

**Files:**
- Create: `app/api/digital/[campaignId]/actors/route.ts`
- Modify: `app/api/digital/[campaignId]/suivi/route.ts`
- Modify: `app/api/digital/[campaignId]/suivi/map/route.ts`

**Interfaces:**
- Consumes: `get_campaign_actors`, `get_campaign_suivi(…, p_actors)`, `get_campaign_suivi_map(…, p_actors)`.
- Produces: `GET /actors → { objective_pct, actors }` ; `?actors=a,b` sur `/suivi` et `/suivi/map` ; `metric=objectif` accepté par `/suivi/map`.

- [ ] **Step 1: Créer la route `/actors`**

`app/api/digital/[campaignId]/actors/route.ts` :
```ts
/**
 * GET /api/digital/[campaignId]/actors — liste des acteurs (DSP/social/régie)
 * de la campagne avec livré/dépense/CPM/part/atteinte objectif. Alimente le
 * multi-select et le panneau « Par acteur » du Suivi. Lit les rollups (RPC).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { checkCampaignAccess } from '@/lib/campaigns/access';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;

  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  const { data, error } = await supabase.rpc('get_campaign_actors', { p_campaign_id: campaignId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? { objective_pct: null, actors: [] }, { headers: { 'Cache-Control': 'no-store' } });
}
```

- [ ] **Step 2: Ajouter `?actors=` à `/suivi/route.ts`**

Dans `app/api/digital/[campaignId]/suivi/route.ts`, après `const { campaignId } = await params;` ajouter le parsing, et passer `p_actors` aux deux appels RPC :
```ts
  const actorsRaw = request.nextUrl.searchParams.get('actors');
  const pActors = actorsRaw ? actorsRaw.split(',').map((a) => a.trim()).filter(Boolean) : null;
```
Puis remplacer les deux `supabase.rpc('get_campaign_suivi', { p_campaign_id: campaignId })` par
`supabase.rpc('get_campaign_suivi', { p_campaign_id: campaignId, p_actors: pActors })` (les 2 occurrences : appel initial + relecture après backfill).

- [ ] **Step 3: Ajouter `?actors=` + `metric=objectif` à `/suivi/map/route.ts`**

Dans `app/api/digital/[campaignId]/suivi/map/route.ts` :
- Élargir l'enum Zod : `metric: z.enum(['hold', 'cpm', 'objectif']).default('hold'),`.
- Après le parsing bbox, ajouter :
```ts
  const actorsRaw = sp.get('actors');
  const pActors = actorsRaw ? actorsRaw.split(',').map((a) => a.trim()).filter(Boolean) : null;
```
- Passer `p_actors: pActors` dans l'appel `supabase.rpc('get_campaign_suivi_map', { … })`.

- [ ] **Step 4: Type-check + vérif fonctionnelle**

Run: `npx tsc --noEmit` → aucune erreur.
Démarrer `npm run dev`, se connecter, puis dans la console navigateur (onglet authentifié) :
```js
await fetch('/api/digital/dccc0000-0000-4000-8000-000000000002/actors').then(r => r.json())
```
Expected : `{ objective_pct: <num>, actors: [ {actor:'dv360',kind:'dsp',…}, …, {kind:'régie'} × 2 ] }` (5 acteurs).

- [ ] **Step 5: Commit**

```bash
git add app/api/digital/[campaignId]/actors/route.ts app/api/digital/[campaignId]/suivi/route.ts app/api/digital/[campaignId]/suivi/map/route.ts
git commit -m "feat(suivi): route /actors + filtre acteurs sur /suivi et /suivi/map"
```

---

### Task 9: UI — `ActorFilter`, `ActorPanel`, câblage `CampaignSuivi`

**Files:**
- Create: `components/campaign/suivi/ActorFilter.tsx`
- Create: `components/campaign/suivi/ActorPanel.tsx`
- Modify: `components/campaign/CampaignSuivi.tsx`

**Interfaces:**
- Consumes: `/api/digital/[id]/actors`, `ActorsPayload`/`ActorRow` (Task 7), `?actors=` sur `/suivi` (Task 8).
- Produces: état `selectedActors: string[]` dans `CampaignSuivi`, propagé au fetch suivi + à l'event carte ; `showMap(metric)` centralisé.

- [ ] **Step 1: Créer `ActorFilter.tsx`**

```tsx
'use client';

/**
 * ActorFilter — multi-select des acteurs (DSP/social/régie) en tête du Suivi.
 * Défaut = tous cochés. Décocher recalcule tout le cockpit (le parent refetch).
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { actorDisplayName, actorKindLabel, type ActorRow } from '@/lib/campaigns/actor-metrics';

const fInter = "'Inter', system-ui, sans-serif";

export function ActorFilter({
  actors, selected, onChange,
}: {
  actors: ActorRow[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  if (actors.length <= 1) return null; // rien à filtrer

  const all = actors.map((a) => a.actor);
  const allSelected = selected.length === 0 || selected.length === all.length;
  const label = allSelected ? 'Tous les acteurs' : `${selected.length} acteur${selected.length > 1 ? 's' : ''}`;

  const toggle = (actor: string) => {
    const base = allSelected ? all : selected;
    const next = base.includes(actor) ? base.filter((a) => a !== actor) : [...base, actor];
    onChange(next.length === all.length ? [] : next); // [] = tous (pas de param)
  };

  return (
    <div style={{ position: 'relative', marginBottom: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)',
          borderRadius: 6, padding: '8px 12px', fontFamily: fInter, fontSize: 13,
          color: 'var(--text-primary)', cursor: 'pointer',
        }}
      >
        <span style={{ flex: 1, textAlign: 'left' }}>Acteurs : {label}</span>
        <ChevronDown size={14} color="var(--text-tertiary)" />
      </button>
      {open && (
        <div style={{
          position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 0, marginTop: 4,
          background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)',
          borderRadius: 6, padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {actors.map((a) => {
            const checked = allSelected || selected.includes(a.actor);
            return (
              <label
                key={a.actor}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                  borderRadius: 4, cursor: 'pointer', fontFamily: fInter, fontSize: 12,
                  color: 'var(--text-secondary)',
                }}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(a.actor)} />
                <span style={{ flex: 1, color: 'var(--text-primary)' }}>{actorDisplayName(a.actor)}</span>
                <span style={{
                  fontFamily: fInter, fontSize: 9, color: 'var(--text-tertiary)',
                  border: '0.5px solid var(--border-default)', borderRadius: 4, padding: '1px 5px',
                }}>
                  {actorKindLabel(a.kind)}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Créer `ActorPanel.tsx`**

```tsx
'use client';

/**
 * ActorPanel — panneau « Par acteur » du Suivi : une ligne par acteur
 * sélectionné (livré · dépense · CPM · part · atteinte objectif) + bar-chart de
 * répartition du volume. Données de get_campaign_actors (non filtrées ; le
 * panneau n'affiche que les acteurs cochés).
 */
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import {
  actorDisplayName, actorKindLabel, fmtCpm, fmtInt, fmtPct,
  type ActorRow,
} from '@/lib/campaigns/actor-metrics';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const cellStyle = { padding: '7px 10px', fontFamily: fMono, fontSize: 11.5, color: 'var(--text-secondary)', textAlign: 'right' as const, whiteSpace: 'nowrap' as const };
const headStyle = { padding: '7px 10px', fontFamily: fInter, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: 'var(--text-tertiary)', textAlign: 'right' as const };

export function ActorPanel({ actors, selected }: { actors: ActorRow[]; selected: string[] }) {
  if (actors.length <= 1) return null;
  const allSelected = selected.length === 0 || selected.length === actors.length;
  const rows = allSelected ? actors : actors.filter((a) => selected.includes(a.actor));
  if (rows.length === 0) return null;
  const chart = rows.map((a) => ({ name: actorDisplayName(a.actor), value: a.impressions }));

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 8px' }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>Par acteur</span>
      </div>

      <div style={{ overflowX: 'auto', border: '0.5px solid var(--border-subtle)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <th style={{ ...headStyle, textAlign: 'left' }}>Acteur</th>
              <th style={headStyle}>Livré</th>
              <th style={headStyle}>Dépense</th>
              <th style={headStyle}>CPM</th>
              <th style={headStyle}>Part</th>
              <th style={headStyle}>Atteinte objectif</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.actor} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ ...cellStyle, textAlign: 'left', color: 'var(--text-primary)' }}>
                  {actorDisplayName(a.actor)}
                  <span style={{ marginLeft: 8, fontFamily: fInter, fontSize: 9, color: 'var(--text-tertiary)', border: '0.5px solid var(--border-default)', borderRadius: 4, padding: '1px 5px' }}>
                    {actorKindLabel(a.kind)}
                  </span>
                </td>
                <td style={cellStyle}>{fmtInt(a.impressions)}</td>
                <td style={cellStyle}>{fmtInt(a.spend)} €</td>
                <td style={cellStyle}>{fmtCpm(a.cpm)}</td>
                <td style={cellStyle}>{fmtPct(a.share_pct)}</td>
                <td style={cellStyle}>{fmtPct(a.objective_attainment)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ height: 120, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <XAxis dataKey="name" tick={{ fontFamily: fInter, fontSize: 10, fill: 'var(--text-tertiary)' }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 6, fontFamily: fMono, fontSize: 11 }}
              formatter={(v) => [fmtInt(Number(v)), 'livré']}
            />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {chart.map((_, i) => <Cell key={i} fill="var(--brand-teal)" />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Câbler `CampaignSuivi.tsx` — état acteurs, fetch, refetch, dispatch**

Dans `components/campaign/CampaignSuivi.tsx` :

(a) Imports — ajouter :
```tsx
import { ActorFilter } from './suivi/ActorFilter';
import { ActorPanel } from './suivi/ActorPanel';
import type { ActorsPayload } from '@/lib/campaigns/actor-metrics';
```

(b) État — après les états `suivi` :
```tsx
  const [actorsPayload, setActorsPayload] = useState<ActorsPayload | null>(null);
  const [selectedActors, setSelectedActors] = useState<string[]>([]); // [] = tous
```

(c) Fetch acteurs (une fois par campagne) — nouveau `useEffect` après le fetch suivi :
```tsx
  const actorsFetchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!strategyId || strategyStatus === 'completed') return;
    if (actorsFetchedRef.current === campaignId) return;
    actorsFetchedRef.current = campaignId;
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch(`/api/digital/${campaignId}/actors`, { cache: 'no-store' });
        if (res.ok && !cancelled) setActorsPayload((await res.json()) as ActorsPayload);
      } catch { /* panneau masqué si absent */ }
    })();
    return () => { cancelled = true; };
  }, [campaignId, strategyId, strategyStatus]);
```

(d) Refetch suivi filtré — remplacer le `useEffect` de fetch `suivi` existant (keyé par `campaignId`) par une version keyée aussi par `selectedActors`, débounced 300 ms, cache par clé :
```tsx
  const suiviCacheRef = useRef(new Map<string, SuiviPayload>());
  useEffect(() => {
    if (!strategyId || strategyStatus === 'completed') return;
    const key = `${campaignId}|${[...selectedActors].sort().join(',')}`;
    const cached = suiviCacheRef.current.get(key);
    if (cached) { setSuivi(cached); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const q = selectedActors.length ? `?actors=${encodeURIComponent(selectedActors.join(','))}` : '';
        const res = await adminFetch(`/api/digital/${campaignId}/suivi${q}`, { cache: 'no-store' });
        if (!res.ok) { if (!cancelled) setSuiviError(true); return; }
        const d = (await res.json()) as SuiviPayload;
        if (!cancelled) { suiviCacheRef.current.set(key, d); setSuivi(d); }
      } catch { if (!cancelled) setSuiviError(true); }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [campaignId, strategyId, strategyStatus, selectedActors]);
```
Supprimer l'ancien `suiviFetchedRef` et son effet (remplacés). (Réinitialiser `suiviCacheRef` et `selectedActors` implicitement par changement de `campaignId` : ajouter `useEffect(() => { setSelectedActors([]); suiviCacheRef.current.clear(); }, [campaignId]);`.)

(e) Dispatch carte centralisé — ajouter un helper qui inclut les acteurs, et le passer aux sous-composants :
```tsx
  const showMap = useCallback((metric: 'hold' | 'cpm' | 'objectif') => {
    if (!mapAvailable) return;
    window.dispatchEvent(new CustomEvent('magelian:suivi-map', {
      detail: {
        campaignId, metric, forecastCpm: suivi?.cpm.forecast ?? null,
        actors: selectedActors.length ? selectedActors : undefined,
      },
    }));
    onShowedMap?.();
  }, [campaignId, mapAvailable, onShowedMap, suivi, selectedActors]);
```
Remplacer les `onShowMap={mapAvailable ? (metric) => { … } : undefined}` de `SuiviCockpit` et `ReconciliationPanel` par `onShowMap={mapAvailable ? showMap : undefined}`.

(f) Rendu — insérer le filtre au-dessus du cockpit et le panneau sous le cockpit, dans la branche `strategyId && suivi` :
```tsx
              {actorsPayload && (
                <ActorFilter actors={actorsPayload.actors} selected={selectedActors} onChange={setSelectedActors} />
              )}
              <SuiviCockpit payload={suivi} onShowMap={mapAvailable ? showMap : undefined} />
              {actorsPayload && (
                <ActorPanel actors={actorsPayload.actors} selected={selectedActors} />
              )}
              <ReconciliationPanel … onShowMap={mapAvailable ? showMap : undefined} … />
              <SuiviCharts payload={suivi} />
              <SuiviTable payload={suivi} campaignId={campaignId} actors={selectedActors} onShowMap={mapAvailable ? showMap : undefined} />
```
(`ReconciliationPanel` `onShowMap` type accepte `'measure'|'dspcpm'` ; `showMap` accepte `'hold'|'cpm'|'objectif'`. Élargir la signature de `showMap` à l'union complète `'hold'|'cpm'|'objectif'|'measure'|'dspcpm'` pour couvrir les deux — voir Task 10 pour la mise à jour du type d'event.)

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit`
Expected: aucune erreur (les props `actors`/`onShowMap` de `SuiviTable` sont ajoutées en Task 10 — si tsc échoue sur `SuiviTable`, exécuter Task 10 avant de valider ce build ; les deux tasks se co-valident).

- [ ] **Step 5: Commit**

```bash
git add components/campaign/suivi/ActorFilter.tsx components/campaign/suivi/ActorPanel.tsx components/campaign/CampaignSuivi.tsx
git commit -m "feat(suivi): multi-select acteurs + panneau par acteur + filtre global"
```

---

### Task 10: Carte objectif divergente + bandeau d'écarts (SuiviMapLayer, SuiviTable)

**Files:**
- Modify: `app/map/_components/SuiviMapLayer.tsx`
- Modify: `components/campaign/suivi/SuiviTable.tsx`

**Interfaces:**
- Consumes: `?actors=` + `metric=objectif` (Task 8), `objective_zones`/`objective_alignment` (Task 2/4), `alignmentTone` (Task 7), `showMap` (Task 9).
- Produces: métrique carte `objectif` (divergente 100) + acteurs dans l'event ; bandeau d'écarts + colonne atteinte + drill objectif dans `SuiviTable`.

- [ ] **Step 1: `SuiviMapLayer` — type, event, fetch acteurs, métrique objectif**

Dans `app/map/_components/SuiviMapLayer.tsx` :

(a) Élargir le type métrique et l'event :
```tsx
type SuiviMapMetric = 'hold' | 'cpm' | 'objectif' | 'measure' | 'dspcpm';

export interface SuiviMapEventDetail {
  campaignId: string;
  metric: SuiviMapMetric;
  forecastCpm: number | null;
  actors?: string[];
}
```

(b) Ajouter un fill divergent centré sur 100 (après `flatFill`) :
```tsx
/** Divergent centré sur 100 : < 70 bad, 70–90 warn, 90–110 ok, > 110 teal (grisé si absent). */
function divergingFill(c: Tone): maplibregl.ExpressionSpecification {
  return ['case', ['<', V, 0], TRANSPARENT, ['<', V, 70], c.bad, ['<', V, 90], c.warn, ['<=', V, 110], c.ok, c.teal];
}
```

(c) Ajouter l'entrée `objectif` dans `METRICS` (source `suivi`) :
```tsx
  objectif: {
    source: 'suivi', label: 'Atteinte objectif',
    format: (v) => `${v} % de l'objectif`,
    fill: (c) => divergingFill(c),
    legend: (c) => [[c.bad, '< 70 % (nettement sous)'], [c.warn, '70–90 % (sous)'], [c.ok, '90–110 % (sur l\'objectif)'], [c.teal, '> 110 % (au-dessus)']],
  },
```

(d) Propager les acteurs au fetch — dans le `useEffect` de chargement, construire l'URL avec les acteurs :
```tsx
        const actorsQ = active.actors?.length ? `&actors=${encodeURIComponent(active.actors.join(','))}` : '';
        const res = await adminFetch(
          `/api/digital/${active.campaignId}/${cfg.source}/map?metric=${active.metric}${actorsQ}`,
          { cache: 'no-store' },
        );
```
(Note : `reconcile/map` ignore `actors` — réconciliation secondaire non filtrée ; le paramètre superflu est sans effet.)

- [ ] **Step 2: `SuiviTable` — bandeau d'écarts + colonne atteinte + bouton carte objectif + acteurs au drill**

Dans `components/campaign/suivi/SuiviTable.tsx` :

(a) Imports — ajouter `alignmentTone` :
```tsx
import {
  fmtCpm, fmtInt, fmtPct, holdTone, alignmentTone, toneColor,
  type SuiviCpRow, type SuiviPayload,
} from '@/lib/campaigns/suivi-metrics';
```

(b) Signature — ajouter `actors` + `onShowMap` :
```tsx
export function SuiviTable({
  payload, campaignId, actors, onShowMap,
}: {
  payload: SuiviPayload;
  campaignId: string;
  actors: string[];
  onShowMap?: (metric: 'objectif') => void;
}) {
```

(c) Badge atteinte objectif (après `HoldBadge`) :
```tsx
function AlignBadge({ value }: { value: number | null }) {
  return (
    <span style={{
      fontFamily: fMono, fontSize: 11, padding: '1px 7px', borderRadius: 4,
      border: `0.5px solid ${toneColor(alignmentTone(value))}`, color: toneColor(alignmentTone(value)),
    }}>
      {value != null ? `${value} %` : '—'}
    </span>
  );
}
```

(d) Drill CP filtré par acteur — dans `toggleDept`, ajouter les acteurs à l'URL et à la clé de cache :
```tsx
    const actorsQ = actors.length ? `&actors=${encodeURIComponent(actors.join(','))}` : '';
    const cacheKey = `${dept}|${[...actors].sort().join(',')}`;
    // remplacer cpCacheRef.current.has(dept) / .set(dept, …) / .get(dept) par cacheKey
    ...
    const res = await adminFetch(`/api/digital/${campaignId}/suivi/cps?dept=${dept}${actorsQ}`, { cache: 'no-store' });
```
(Appliquer `cacheKey` partout où `dept` servait de clé au `cpCacheRef` : `has`, `set`, `get`, et la lecture `cpCacheRef.current.get(cacheKey)` dans le rendu.)

(e) Bandeau d'écarts — juste avant le `<div style={{ overflowX: 'auto' … }}>` du tableau :
```tsx
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 8px', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--danger)' }}>{payload.objective_zones.under}</strong> zones sous l&apos;objectif
          {' · '}
          <strong style={{ color: 'var(--brand-teal)' }}>{payload.objective_zones.over}</strong> au-dessus
        </span>
        {onShowMap && (
          <button
            type="button"
            onClick={() => onShowMap('objectif')}
            style={{
              marginLeft: 'auto', background: 'transparent', border: '0.5px solid var(--brand-teal)',
              color: 'var(--brand-teal)', borderRadius: 6, padding: '5px 12px',
              fontFamily: fInter, fontSize: 11, fontWeight: 500, cursor: 'pointer',
            }}
          >
            Voir l&apos;objectif sur la carte
          </button>
        )}
      </div>
```

(f) Colonne « Atteinte objectif » — ajouter un `<th style={headStyle}>Atteinte objectif</th>` après la colonne « Tenue du plan » dans le `<thead>`, et une cellule `<td style={cellStyle}><AlignBadge value={d.objective_alignment} /></td>` (ligne dept) et `<td style={cellStyle}><AlignBadge value={c.objective_alignment} /></td>` (ligne CP) après la cellule `HoldBadge`. Mettre à jour le `colSpan` de la ligne « Chargement des CP… » de `6` à `7`.

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit` → aucune erreur (résout aussi la co-dépendance de Task 9 Step 4).
Run: `npm run build` → build OK.

- [ ] **Step 4: Vérification navigateur (démo, page /map)**

`npm run dev`, ouvrir `/map?campaign=dccc0000-0000-4000-8000-000000000002&tab=suivi`, se connecter. Vérifier :
1. Multi-select « Acteurs : Tous les acteurs » présent ; 5 acteurs listés (dv360, ttd, tiktok, 2 régies).
2. Panneau « Par acteur » : 5 lignes, `Part` somme ~100 %, badges kind (DSP/Social/Régie).
3. Décocher tout sauf `tiktok` → tuile CPM du cockpit remonte ~9,20 € ; le panneau n'affiche que TikTok.
4. Bandeau d'écarts « X zones sous l'objectif · Y au-dessus » cohérent (X ≥ 1).
5. « Voir l'objectif sur la carte » → couche divergente : Marseille (13) + Lille (59) en rouge, reste pâle/teal, hors cible grisé.
6. Recocher tous → cockpit identique à l'état initial (non-régression).

- [ ] **Step 5: Commit**

```bash
git add app/map/_components/SuiviMapLayer.tsx components/campaign/suivi/SuiviTable.tsx
git commit -m "feat(suivi): carte objectif divergente + bandeau d'ecarts + colonne atteinte"
```

---

## Self-Review

**Spec coverage :**
- Modèle acteur (colonnes + fallback `''`) → Task 1. ✔
- `refresh_campaign_rollups` (actor) → Task 1. ✔
- `get_campaign_suivi` (p_actors + objective_alignment + objective_zones) → Task 2. ✔
- Helper `get_campaign_expected` (DRY objectif) → Task 2. ✔
- `get_campaign_suivi_map` (p_actors + metric objectif divergent) → Task 3 (SQL) + Task 10 (fill). ✔
- `get_campaign_suivi_cps` (p_actors + objective_alignment) → Task 4. ✔
- `get_campaign_actors` → Task 5. ✔
- Seed acteur + 2 régies + assertion étendue → Task 6. ✔
- `alignmentTone` + `actor-metrics` + types → Task 7. ✔
- Route `/actors` + `?actors=` sur suivi/map → Task 8. ✔
- `ActorFilter` + `ActorPanel` + câblage + refetch débounced/caché → Task 9. ✔
- Carte divergente + event acteurs + bandeau + colonne + drill → Task 10. ✔
- Non-régression `p_actors = NULL` → vérifiée Task 1/2. ✔
- Réconciliation inchangée (secondaire) → aucune task ne la touche. ✔

**Placeholder scan :** aucun TBD/TODO ; tout le code SQL/TS/TSX est complet.

**Type consistency :** `p_actors text[]` (dernier param) constant sur suivi/map/cps ; `ActorRow`/`ActorsPayload` (Task 7) consommés identiquement Task 8/9 ; `objective_alignment`/`objective_zones` définis Task 7 (types) et Task 2/4 (SQL) et lus Task 10 ; `showMap` union `'hold'|'cpm'|'objectif'|'measure'|'dspcpm'` cohérente avec `SuiviMapMetric` (Task 10) — **note :** en Task 9 (e), typer `showMap` avec l'union complète pour couvrir `ReconciliationPanel` (`measure`/`dspcpm`) et `SuiviTable` (`objectif`).

**Ordre & co-validation :** Task 9 et Task 10 se co-valident au type-check (SuiviTable gagne ses props en Task 10). Les deux doivent être committées avant un build vert — les exécuter en séquence (9 puis 10) sans valider le build entre les deux.
