-- ============================================================
-- 109 — Drill CP par département + choroplèthe CP du cockpit de suivi
-- ============================================================
-- Appliquée le 2026-07-17 via MCP Supabase (migration `suivi_cps_map`).
-- Lecture exclusive des rollups (107). Géométries : ref_codes_postaux.geom_simplified.

CREATE OR REPLACE FUNCTION public.get_campaign_suivi_cps(p_campaign_id uuid, p_dept text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH total AS (
    SELECT NULLIF(SUM(impressions), 0)::numeric AS imps
    FROM campaign_cp_rollup WHERE campaign_id = p_campaign_id
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.hold_index ASC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT r.postal_code, r.in_target, r.impressions,
           CASE WHEN r.planned_share > 0 AND total.imps IS NOT NULL
                THEN ROUND((r.impressions / total.imps) / r.planned_share * 100)
           END AS hold_index,
           CASE WHEN r.impressions > 0 THEN ROUND(r.spend / r.impressions * 1000, 2) END AS cpm,
           ROUND(r.spend, 2) AS spend,
           CASE WHEN r.imps_prev7d > 0
                THEN ROUND((r.imps_7d - r.imps_prev7d)::numeric / r.imps_prev7d * 100, 1)
           END AS delta7_pct
    FROM campaign_cp_rollup r, total
    WHERE r.campaign_id = p_campaign_id AND r.dept = p_dept
    LIMIT 500
  ) t;
$$;
REVOKE ALL ON FUNCTION public.get_campaign_suivi_cps(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_suivi_cps(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_campaign_suivi_map(
  p_campaign_id uuid,
  p_metric text DEFAULT 'hold',
  p_bbox_xmin float8 DEFAULT -5.5, p_bbox_ymin float8 DEFAULT 41.2,
  p_bbox_xmax float8 DEFAULT 9.8, p_bbox_ymax float8 DEFAULT 51.2)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH total AS (
    SELECT NULLIF(SUM(impressions), 0)::numeric AS imps
    FROM campaign_cp_rollup WHERE campaign_id = p_campaign_id
  )
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT r.postal_code AS code, rcp.nom_principal AS nom, r.in_target,
           CASE WHEN p_metric = 'cpm'
                THEN CASE WHEN r.impressions > 0 THEN ROUND(r.spend / r.impressions * 1000, 2) END
                ELSE CASE WHEN r.planned_share > 0 AND total.imps IS NOT NULL
                          THEN ROUND((r.impressions / total.imps) / r.planned_share * 100)
                     END
           END AS value,
           ST_AsGeoJSON(rcp.geom_simplified)::json AS geometry
    FROM campaign_cp_rollup r
    JOIN ref_codes_postaux rcp ON rcp.code_postal = r.postal_code
    CROSS JOIN total
    WHERE r.campaign_id = p_campaign_id
      AND rcp.geom_simplified && ST_MakeEnvelope(p_bbox_xmin, p_bbox_ymin, p_bbox_xmax, p_bbox_ymax, 4326)
  ) t;
$$;
REVOKE ALL ON FUNCTION public.get_campaign_suivi_map(uuid, text, float8, float8, float8, float8) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_suivi_map(uuid, text, float8, float8, float8, float8) TO service_role;
