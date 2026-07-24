-- ============================================================
-- 117 — Carte de dérive : get_campaign_derive_map (maille + score + insets DROM)
-- ============================================================
-- Appliquée le 2026-07-24 via MCP Supabase.
--
-- Agrège campaign_cp_rollup (grain CP × acteur) jusqu'à la maille choisie
-- (region | departement | cp) via les tables ref_* — le rattachement dépt passe
-- par ref_codes_postaux.code_dept (vrais codes DROM 971-976, PLUS de faux « 97 »
-- issu de LEFT(cp,2)). Score identique à get_campaign_suivi_map :
--   hold (dérive relative) = (imps_maille/total)/part_planifiée × 100 ;
--   objectif (atteinte)    = imps_maille/(part_planifiée × expected_global) × 100.
-- Les DROM (dépt ^97 / régions 01-06) sont reprojetés en insets près de l'hexagone
-- (ST_Translate(ST_Scale(geom,s,s), tx,ty), offsets précalculés depuis les
-- centroïdes réels) → une seule FeatureCollection composée, DROM cliquables.
-- SECURITY DEFINER, service_role only. Prérequis : rollups (107/113), ref_* peuplées.

CREATE OR REPLACE FUNCTION public.get_campaign_derive_map(
  p_campaign_id uuid, p_mesh text DEFAULT 'departement', p_metric text DEFAULT 'hold',
  p_actors text[] DEFAULT NULL,
  p_bbox_xmin float8 DEFAULT -12, p_bbox_ymin float8 DEFAULT 40,
  p_bbox_xmax float8 DEFAULT 10, p_bbox_ymax float8 DEFAULT 52)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  v_expected numeric := public.get_campaign_expected(p_campaign_id);
  v_total    numeric;
  v_result   json;
BEGIN
  SELECT COALESCE(SUM(impressions), 0) INTO v_total
  FROM campaign_cp_rollup
  WHERE campaign_id = p_campaign_id AND (p_actors IS NULL OR actor = ANY(p_actors));

  WITH cp AS (
    SELECT r.postal_code, rcp.code_dept, d.code_region,
           BOOL_OR(r.in_target) AS in_target,
           MAX(r.planned_share) AS planned_share,
           COALESCE(SUM(r.impressions) FILTER (WHERE p_actors IS NULL OR r.actor = ANY(p_actors)), 0) AS imps
    FROM campaign_cp_rollup r
    JOIN ref_codes_postaux rcp ON rcp.code_postal = r.postal_code
    LEFT JOIN ref_departements d ON d.code_dept = rcp.code_dept
    WHERE r.campaign_id = p_campaign_id
    GROUP BY r.postal_code, rcp.code_dept, d.code_region
  ),
  mesh AS (
    SELECT x.code,
           BOOL_OR(x.in_target) AS in_target,
           SUM(x.planned_share) AS planned_share, SUM(x.imps) AS imps
    FROM (
      SELECT CASE p_mesh
               WHEN 'cp' THEN cp.postal_code
               WHEN 'region' THEN cp.code_region
               ELSE cp.code_dept END AS code,
             cp.in_target, cp.planned_share, cp.imps
      FROM cp
    ) x
    WHERE x.code IS NOT NULL
    GROUP BY x.code
  ),
  geo AS (
    SELECT m.code,
           CASE p_mesh
             WHEN 'cp' THEN (SELECT nom_principal FROM ref_codes_postaux WHERE code_postal = m.code)
             WHEN 'region' THEN (SELECT nom_region FROM ref_regions WHERE code_region = m.code)
             ELSE (SELECT nom_dept FROM ref_departements WHERE code_dept = m.code) END AS nom,
           m.in_target,
           CASE
             WHEN p_metric = 'objectif' THEN
               CASE WHEN m.in_target AND m.planned_share > 0 AND v_expected > 0
                    THEN ROUND(m.imps / (m.planned_share * v_expected) * 100) END
             ELSE
               CASE WHEN m.planned_share > 0 AND v_total > 0
                    THEN ROUND((m.imps / v_total) / m.planned_share * 100) END
           END AS value,
           CASE p_mesh
             WHEN 'cp' THEN (SELECT geom_simplified FROM ref_codes_postaux WHERE code_postal = m.code)
             WHEN 'region' THEN (SELECT geom FROM ref_regions WHERE code_region = m.code)
             ELSE (SELECT geom FROM ref_departements WHERE code_dept = m.code)
           END AS g,
           (p_mesh <> 'region' AND left(m.code, 2) = '97') AS is_drom_dept,
           (p_mesh = 'region' AND m.code IN ('01','02','03','04','06')) AS is_drom_region
    FROM mesh m
  ),
  reproj AS (
    SELECT g.code, g.nom, g.in_target, g.value,
      CASE
        WHEN g.is_drom_dept OR g.is_drom_region THEN
          (SELECT ST_Translate(ST_Scale(g.g, s, s), tx, ty)
           FROM (VALUES
             ('971','01', 1.2::float8, 64.8::float8, 30.56::float8),
             ('972','02', 1.3, 70.3, 29.19),
             ('973','03', 0.35, 9.62, 44.94),
             ('974','04', 1.3, -81.15, 71.73),
             ('976','06', 2.5, -121.75, 74.6)
           ) v(dept, region, s, tx, ty)
           WHERE (p_mesh = 'region' AND v.region = g.code) OR (p_mesh <> 'region' AND v.dept = g.code)
           LIMIT 1)
        ELSE g.g
      END AS g
    FROM geo g
  )
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_result
  FROM (
    SELECT code, nom, in_target, value, ST_AsGeoJSON(g)::json AS geometry
    FROM reproj
    WHERE g IS NOT NULL
      AND g && ST_MakeEnvelope(p_bbox_xmin, p_bbox_ymin, p_bbox_xmax, p_bbox_ymax, 4326)
  ) t;

  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.get_campaign_derive_map(uuid, text, text, text[], float8, float8, float8, float8) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_derive_map(uuid, text, text, text[], float8, float8, float8, float8) TO service_role;
