-- ============================================================
-- 118 — Carte de dérive : get_campaign_derive_ranked + get_campaign_derive_headline
-- ============================================================
-- Appliquées le 2026-07-24 via MCP Supabase.
--
-- ranked : zones qui dérivent à la maille (region|departement|cp), triées score
--   croissant NULLS LAST (pire d'abord). CP borné à p_limit (anti-12k Nano) ;
--   region/dept plafonnés à 200. Même agrégation CP→maille que sql/117 (les deux
--   RPC ne peuvent pas partager de CTE — choix assumé du plan).
-- headline : score national global (relatif ⇒ 100 par construction ; absolu ⇒
--   total_imps/expected × 100) — chiffre de tête du niveau National.
-- SECURITY DEFINER, service_role only. Prérequis : rollups (107/113), ref_*.

CREATE OR REPLACE FUNCTION public.get_campaign_derive_ranked(
  p_campaign_id uuid, p_mesh text DEFAULT 'departement', p_metric text DEFAULT 'hold',
  p_actors text[] DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  v_expected numeric := public.get_campaign_expected(p_campaign_id);
  v_total numeric; v_out jsonb;
BEGIN
  SELECT COALESCE(SUM(impressions),0) INTO v_total FROM campaign_cp_rollup
  WHERE campaign_id = p_campaign_id AND (p_actors IS NULL OR actor = ANY(p_actors));

  WITH cp AS (
    SELECT r.postal_code, rcp.code_dept, d.code_region,
           BOOL_OR(r.in_target) AS in_target, MAX(r.planned_share) AS planned_share,
           COALESCE(SUM(r.impressions) FILTER (WHERE p_actors IS NULL OR r.actor = ANY(p_actors)),0) AS imps
    FROM campaign_cp_rollup r
    JOIN ref_codes_postaux rcp ON rcp.code_postal = r.postal_code
    LEFT JOIN ref_departements d ON d.code_dept = rcp.code_dept
    WHERE r.campaign_id = p_campaign_id
    GROUP BY r.postal_code, rcp.code_dept, d.code_region
  ),
  mesh AS (
    SELECT x.code, BOOL_OR(x.in_target) AS in_target, SUM(x.planned_share) AS planned_share, SUM(x.imps) AS imps
    FROM (
      SELECT CASE p_mesh WHEN 'cp' THEN cp.postal_code WHEN 'region' THEN cp.code_region ELSE cp.code_dept END AS code,
             cp.in_target, cp.planned_share, cp.imps
      FROM cp
    ) x
    WHERE x.code IS NOT NULL
    GROUP BY x.code
  ),
  scored AS (
    SELECT code, in_target, imps,
      CASE WHEN p_metric='objectif'
           THEN CASE WHEN in_target AND planned_share>0 AND v_expected>0 THEN ROUND(imps/(planned_share*v_expected)*100) END
           ELSE CASE WHEN planned_share>0 AND v_total>0 THEN ROUND((imps/v_total)/planned_share*100) END END AS value
    FROM mesh
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.value ASC NULLS LAST), '[]'::jsonb) INTO v_out
  FROM (
    SELECT s.code,
           CASE p_mesh WHEN 'cp' THEN (SELECT nom_principal FROM ref_codes_postaux WHERE code_postal=s.code)
                       WHEN 'region' THEN (SELECT nom_region FROM ref_regions WHERE code_region=s.code)
                       ELSE (SELECT nom_dept FROM ref_departements WHERE code_dept=s.code) END AS nom,
           s.in_target, s.value, s.imps AS impressions
    FROM scored s
    ORDER BY s.value ASC NULLS LAST
    LIMIT CASE WHEN p_mesh='cp' THEN LEAST(p_limit, 500) ELSE 200 END
  ) t;
  RETURN v_out;
END; $$;
REVOKE ALL ON FUNCTION public.get_campaign_derive_ranked(uuid,text,text,text[],int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_derive_ranked(uuid,text,text,text[],int) TO service_role;

CREATE OR REPLACE FUNCTION public.get_campaign_derive_headline(
  p_campaign_id uuid, p_metric text DEFAULT 'hold', p_actors text[] DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_expected numeric := public.get_campaign_expected(p_campaign_id); v_total numeric;
BEGIN
  SELECT COALESCE(SUM(impressions),0) INTO v_total FROM campaign_cp_rollup
  WHERE campaign_id = p_campaign_id AND (p_actors IS NULL OR actor = ANY(p_actors));
  IF p_metric='objectif' THEN
    RETURN CASE WHEN v_expected>0 THEN ROUND(v_total/v_expected*100) END;
  ELSE
    RETURN 100;  -- relatif : le national tient sa part par définition
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.get_campaign_derive_headline(uuid,text,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_derive_headline(uuid,text,text[]) TO service_role;
