-- 252 — Rapatriement À L'IDENTIQUE de huit RPC vivantes sans source (2026-10-14)
--
-- Spec : docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md § 16.6.
-- Ces fonctions n'existaient que dans la base locale et son dump. Elles sont recopiées par pg_get_functiondef,
-- droits compris, SANS AUCUNE CORRECTION — y compris get_carreaux_capture_geometry (48 s par appel,
-- docs/audit/SCALE_MODEL.md:107), que le lot 3 remplace pour l'étape ③ par zone_seuil_carreaux (sql/255) sans la
-- toucher, React la gardant. Rejouable (create or replace), et rejouable sur une BASE VIDE : chaque fonction est
-- créée AVANT que ses droits soient réglés.
--
-- Droits recopiés EXACTEMENT, PUBLIC compris (get_carreaux_by_zoom l'a : {=X/postgres,…}) : revoke de tous les
-- rôles puis grant de la liste extraite par aclexplode (jointure externe — PUBLIC a l'oid 0).
--
-- Fonctions : get_carreaux_capture_geometry, get_carreaux_by_zoom, get_admin_filter_geometry,
-- get_iris_selection_geometry, resolve_custom_geo_zone_codes (uuid) et (uuid, uuid),
-- resolve_custom_geo_zone_codes_with_subzones, transform_geometries_for_save, compute_zone_audience_stats.
-- ⚠ get_carreaux_by_zoom a une version ANCIENNE dans supabase/migrations/008_carreaux_multiresolution.sql,
-- peut-être divergente : la version ci-dessous est la VIVANTE (14/10) et fait foi. Elle est RETURNS TABLE (déjà
-- couverte par tests/unit/db/troncature-postgrest.test.ts, qui balaie aussi supabase/migrations).

begin;

CREATE OR REPLACE FUNCTION public.compute_zone_audience_stats(p_zone_id uuid, p_caller_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_zone_geom geometry;
  v_org_id uuid;
  v_caller uuid;
  v_area_km2 numeric;
  v_stats jsonb;
BEGIN
  SELECT geometry, org_id INTO v_zone_geom, v_org_id
  FROM public.custom_geo_zones
  WHERE id = p_zone_id;

  IF v_zone_geom IS NULL THEN
    RAISE EXCEPTION 'Zone % not found', p_zone_id;
  END IF;

  v_caller := COALESCE(p_caller_user_id, auth.uid());
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = v_caller AND organization_id = v_org_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_caller AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'Access denied to zone %', p_zone_id;
  END IF;

  v_area_km2 := ST_Area(v_zone_geom::geography) / 1e6;

  -- Hard cap : zones > 5000 km² → skip (incident I/O Nano garanti sinon)
  IF v_area_km2 > 5000 THEN
    v_stats := jsonb_build_object(
      'computed_at', now(),
      'area_km2', round(v_area_km2::numeric, 2),
      'skipped', true,
      'reason', 'zone_too_large_max_5000_km2'
    );
    UPDATE public.custom_geo_zones
    SET audience_stats = v_stats, audience_computed_at = now()
    WHERE id = p_zone_id;
    RETURN v_stats;
  END IF;

  -- Agrégation sur carreaux 200m intersectant la zone
  WITH agg AS (
    SELECT
      COUNT(*) AS carreaux_count,
      COALESCE(SUM((c.metadata->>'ind')::float),     0) AS pop_total,
      COALESCE(SUM((c.metadata->>'ind_0_3')::float
                 + (c.metadata->>'ind_4_5')::float
                 + (c.metadata->>'ind_6_10')::float
                 + (c.metadata->>'ind_11_17')::float), 0) AS pop_0_17,
      COALESCE(SUM((c.metadata->>'ind_18_24')::float), 0) AS pop_18_24,
      COALESCE(SUM((c.metadata->>'ind_25_39')::float), 0) AS pop_25_39,
      COALESCE(SUM((c.metadata->>'ind_40_54')::float), 0) AS pop_40_54,
      COALESCE(SUM((c.metadata->>'ind_55_64')::float), 0) AS pop_55_64,
      COALESCE(SUM((c.metadata->>'ind_65_79')::float), 0) AS pop_65_79,
      COALESCE(SUM((c.metadata->>'ind_80p')::float),   0) AS pop_80p,
      COALESCE(SUM((c.metadata->>'men')::float),       0) AS men_total,
      COALESCE(SUM((c.metadata->>'men_1ind')::float),  0) AS men_1pers,
      COALESCE(SUM((c.metadata->>'men_5ind')::float),  0) AS men_5plus,
      COALESCE(SUM((c.metadata->>'men_prop')::float),  0) AS men_proprio,
      COALESCE(SUM((c.metadata->>'men_fmp')::float),   0) AS men_monoparental,
      COALESCE(SUM((c.metadata->>'men_pauv')::float),  0) AS men_pauvres,
      COALESCE(SUM((c.metadata->>'men_mais')::float),  0) AS men_maison,
      COALESCE(SUM((c.metadata->>'men_coll')::float),  0) AS men_collectif,
      COALESCE(SUM((c.metadata->>'men_surf')::float),  0) AS men_surf_total,
      COALESCE(SUM((c.metadata->>'log_soc')::float),   0) AS log_sociaux,
      COALESCE(SUM((c.metadata->>'log_av45')::float),  0) AS log_av45,
      COALESCE(SUM((c.metadata->>'log_45_70')::float), 0) AS log_45_70,
      COALESCE(SUM((c.metadata->>'log_70_90')::float), 0) AS log_70_90,
      COALESCE(SUM((c.metadata->>'log_ap90')::float),  0) AS log_ap90,
      COALESCE(SUM((c.metadata->>'ind_snv')::float),   0) AS ind_snv_total
    FROM public.carreaux_filosofi c
    WHERE c.geom && v_zone_geom
      AND c.resolution = '200m'
      AND ST_Intersects(c.geom, v_zone_geom)
  )
  SELECT jsonb_build_object(
    'computed_at',  now(),
    'area_km2',     round(v_area_km2::numeric, 2),
    'carreaux_count', a.carreaux_count,
    'population', jsonb_build_object(
      'total',        round(a.pop_total::numeric),
      'density_per_km2', CASE WHEN v_area_km2 > 0 THEN round((a.pop_total / v_area_km2)::numeric) ELSE 0 END,
      'by_age', jsonb_build_object(
        '0_17',    round(a.pop_0_17::numeric),
        '18_24',   round(a.pop_18_24::numeric),
        '25_39',   round(a.pop_25_39::numeric),
        '40_54',   round(a.pop_40_54::numeric),
        '55_64',   round(a.pop_55_64::numeric),
        '65_79',   round(a.pop_65_79::numeric),
        '80_plus', round(a.pop_80p::numeric)
      )
    ),
    'menages', jsonb_build_object(
      'total',          round(a.men_total::numeric),
      '1_personne',     round(a.men_1pers::numeric),
      '5_plus',         round(a.men_5plus::numeric),
      'proprietaires',  round(a.men_proprio::numeric),
      'monoparentales', round(a.men_monoparental::numeric),
      'pauvres',        round(a.men_pauvres::numeric)
    ),
    'logements', jsonb_build_object(
      'maisons',           round(a.men_maison::numeric),
      'collectifs',        round(a.men_collectif::numeric),
      'sociaux',           round(a.log_sociaux::numeric),
      'avant_1945',        round(a.log_av45::numeric),
      '1945_1970',         round(a.log_45_70::numeric),
      '1970_1990',         round(a.log_70_90::numeric),
      'apres_1990',        round(a.log_ap90::numeric),
      'surface_moyenne_m2', CASE WHEN a.men_total > 0 THEN round((a.men_surf_total / a.men_total)::numeric, 1) ELSE 0 END
    ),
    'revenu_median_par_uc',
      CASE WHEN a.pop_total > 0 THEN round((a.ind_snv_total / a.pop_total)::numeric, 0) ELSE 0 END
  ) INTO v_stats
  FROM agg a;

  UPDATE public.custom_geo_zones
  SET audience_stats = v_stats, audience_computed_at = now()
  WHERE id = p_zone_id;

  RETURN v_stats;
END $function$
;
revoke all on function public.compute_zone_audience_stats(p_zone_id uuid, p_caller_user_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.compute_zone_audience_stats(p_zone_id uuid, p_caller_user_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.get_admin_filter_geometry(p_scale text, p_codes text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_geom geometry;
  v_count int;
  v_table text;
  v_code_col text;
BEGIN
  IF p_codes IS NULL OR array_length(p_codes, 1) = 0 THEN
    RETURN jsonb_build_object('geometry', NULL, 'metadata', '{}'::jsonb);
  END IF;

  CASE p_scale
    WHEN 'region'      THEN v_table := 'ref_regions';       v_code_col := 'code_region';
    WHEN 'departement' THEN v_table := 'ref_departements';  v_code_col := 'code_dept';
    WHEN 'cp'          THEN v_table := 'ref_codes_postaux'; v_code_col := 'code_postal';
    ELSE RAISE EXCEPTION 'Unknown scale: %', p_scale;
  END CASE;

  EXECUTE format('SELECT ST_Union(geom), COUNT(*) FROM public.%I WHERE %I = ANY($1)', v_table, v_code_col)
  INTO v_geom, v_count
  USING p_codes;

  IF v_geom IS NULL OR ST_IsEmpty(v_geom) THEN
    RETURN jsonb_build_object('geometry', NULL, 'metadata', '{}'::jsonb);
  END IF;

  IF GeometryType(v_geom) = 'POLYGON' THEN v_geom := ST_Multi(v_geom); END IF;

  RETURN jsonb_build_object(
    'geometry', ST_AsGeoJSON(v_geom)::jsonb,
    'metadata', jsonb_build_object('scale', p_scale, 'codes', p_codes, 'count', v_count)
  );
END $function$
;
revoke all on function public.get_admin_filter_geometry(p_scale text, p_codes text[]) from public, anon, authenticated, service_role;
grant execute on function public.get_admin_filter_geometry(p_scale text, p_codes text[]) to authenticated;
grant execute on function public.get_admin_filter_geometry(p_scale text, p_codes text[]) to service_role;

CREATE OR REPLACE FUNCTION public.get_carreaux_by_zoom(zoom_level integer, bbox_west double precision, bbox_south double precision, bbox_east double precision, bbox_north double precision, indicateur text DEFAULT 'population_totale'::text, max_rows integer DEFAULT 5000)
 RETURNS TABLE(id text, geojson text, value double precision, population double precision, menages double precision)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_bbox     GEOMETRY;
  v_cellsize INT;
BEGIN
  v_bbox := ST_MakeEnvelope(bbox_west, bbox_south, bbox_east, bbox_north, 4326);

  -- ── Zoom ≥ 14 : carreaux 200m natifs ────────────────────────────────────────
  IF zoom_level >= 14 THEN
    RETURN QUERY
    SELECT
      c.idcar::TEXT,
      ST_AsGeoJSON(c.geom)::TEXT,
      COALESCE(CASE indicateur
        WHEN 'population_totale'       THEN (c.metadata->>'ind')::float
        WHEN 'population_inconnue'     THEN (c.metadata->>'ind_inc')::float
        WHEN 'ind_0_3'                 THEN (c.metadata->>'ind_0_3')::float
        WHEN 'ind_4_5'                 THEN (c.metadata->>'ind_4_5')::float
        WHEN 'ind_6_10'                THEN (c.metadata->>'ind_6_10')::float
        WHEN 'ind_11_17'               THEN (c.metadata->>'ind_11_17')::float
        WHEN 'ind_18_24'               THEN (c.metadata->>'ind_18_24')::float
        WHEN 'ind_25_39'               THEN (c.metadata->>'ind_25_39')::float
        WHEN 'ind_40_54'               THEN (c.metadata->>'ind_40_54')::float
        WHEN 'ind_55_64'               THEN (c.metadata->>'ind_55_64')::float
        WHEN 'ind_65_79'               THEN (c.metadata->>'ind_65_79')::float
        WHEN 'ind_80p'                 THEN (c.metadata->>'ind_80p')::float
        WHEN 'menages_total'           THEN (c.metadata->>'men')::float
        WHEN 'menages_pauvres'         THEN (c.metadata->>'men_pauv')::float
        WHEN 'menages_1_personne'      THEN (c.metadata->>'men_1ind')::float
        WHEN 'menages_5_plus'          THEN (c.metadata->>'men_5ind')::float
        WHEN 'menages_proprietaires'   THEN (c.metadata->>'men_prop')::float
        WHEN 'familles_monoparentales' THEN (c.metadata->>'men_fmp')::float
        WHEN 'menages_maison'          THEN (c.metadata->>'men_mais')::float
        WHEN 'menages_collectif'       THEN (c.metadata->>'men_coll')::float
        WHEN 'surface_moyenne'         THEN (c.metadata->>'men_surf')::float / NULLIF((c.metadata->>'men')::float, 0)
        WHEN 'revenu_median'           THEN (c.metadata->>'ind_snv')::float  / NULLIF((c.metadata->>'ind')::float, 0)
        WHEN 'logements_avant_1945'    THEN (c.metadata->>'log_av45')::float
        WHEN 'logements_1945_1970'     THEN (c.metadata->>'log_45_70')::float
        WHEN 'logements_1970_1990'     THEN (c.metadata->>'log_70_90')::float
        WHEN 'logements_apres_1990'    THEN (c.metadata->>'log_ap90')::float
        WHEN 'logements_sociaux'       THEN (c.metadata->>'log_soc')::float
        WHEN 'logements_inconnus'      THEN (c.metadata->>'log_inc')::float
        ELSE (c.metadata->>'ind')::float
      END, 0.0),
      COALESCE((c.metadata->>'ind')::float, 0.0),
      COALESCE((c.metadata->>'men')::float, 0.0)
    FROM carreaux_filosofi c
    WHERE c.geom && v_bbox AND c.resolution = '200m'
    LIMIT max_rows;
    RETURN;
  END IF;

  -- ── Zoom 8-13 : 2 km  |  zoom 7 : 5 km  |  zoom ≤ 6 : vide ─────────────────
  IF zoom_level < 7 THEN
    RETURN; -- France entière trop lente à agréger live
  END IF;

  v_cellsize := CASE
    WHEN zoom_level >= 8 THEN 2000
    ELSE 5000  -- zoom 7 : cellules 5km
  END;

  RETURN QUERY
  WITH raw AS (
    SELECT
      floor((regexp_match(c.idcar, 'N(\d+)E(\d+)'))[1]::bigint / v_cellsize) AS gy,
      floor((regexp_match(c.idcar, 'N(\d+)E(\d+)'))[2]::bigint / v_cellsize) AS gx,
      COALESCE((c.metadata->>'ind')::float,      0.0) AS pop,
      COALESCE((c.metadata->>'men')::float,      0.0) AS men,
      COALESCE((c.metadata->>'men_surf')::float, 0.0) AS men_surf,
      COALESCE((c.metadata->>'ind_snv')::float,  0.0) AS ind_snv,
      COALESCE(CASE indicateur
        WHEN 'population_totale'       THEN (c.metadata->>'ind')::float
        WHEN 'population_inconnue'     THEN (c.metadata->>'ind_inc')::float
        WHEN 'ind_0_3'                 THEN (c.metadata->>'ind_0_3')::float
        WHEN 'ind_4_5'                 THEN (c.metadata->>'ind_4_5')::float
        WHEN 'ind_6_10'                THEN (c.metadata->>'ind_6_10')::float
        WHEN 'ind_11_17'               THEN (c.metadata->>'ind_11_17')::float
        WHEN 'ind_18_24'               THEN (c.metadata->>'ind_18_24')::float
        WHEN 'ind_25_39'               THEN (c.metadata->>'ind_25_39')::float
        WHEN 'ind_40_54'               THEN (c.metadata->>'ind_40_54')::float
        WHEN 'ind_55_64'               THEN (c.metadata->>'ind_55_64')::float
        WHEN 'ind_65_79'               THEN (c.metadata->>'ind_65_79')::float
        WHEN 'ind_80p'                 THEN (c.metadata->>'ind_80p')::float
        WHEN 'menages_total'           THEN (c.metadata->>'men')::float
        WHEN 'menages_pauvres'         THEN (c.metadata->>'men_pauv')::float
        WHEN 'menages_1_personne'      THEN (c.metadata->>'men_1ind')::float
        WHEN 'menages_5_plus'          THEN (c.metadata->>'men_5ind')::float
        WHEN 'menages_proprietaires'   THEN (c.metadata->>'men_prop')::float
        WHEN 'familles_monoparentales' THEN (c.metadata->>'men_fmp')::float
        WHEN 'menages_maison'          THEN (c.metadata->>'men_mais')::float
        WHEN 'menages_collectif'       THEN (c.metadata->>'men_coll')::float
        WHEN 'surface_moyenne'         THEN 0.0
        WHEN 'revenu_median'           THEN 0.0
        WHEN 'logements_avant_1945'    THEN (c.metadata->>'log_av45')::float
        WHEN 'logements_1945_1970'     THEN (c.metadata->>'log_45_70')::float
        WHEN 'logements_1970_1990'     THEN (c.metadata->>'log_70_90')::float
        WHEN 'logements_apres_1990'    THEN (c.metadata->>'log_ap90')::float
        WHEN 'logements_sociaux'       THEN (c.metadata->>'log_soc')::float
        WHEN 'logements_inconnus'      THEN (c.metadata->>'log_inc')::float
        ELSE (c.metadata->>'ind')::float
      END, 0.0) AS ind_val
    FROM carreaux_filosofi c
    WHERE c.geom && v_bbox AND c.resolution = '200m'
  ),
  grouped AS (
    SELECT gy, gx,
      SUM(pop)      AS total_pop,
      SUM(men)      AS total_men,
      SUM(men_surf) AS total_surf,
      SUM(ind_snv)  AS total_snv,
      SUM(ind_val)  AS total_ind
    FROM raw GROUP BY gy, gx
  )
  SELECT
    (gy::text || '_' || gx::text)::TEXT,
    ST_AsGeoJSON(ST_Transform(
      ST_SetSRID(ST_MakeEnvelope(gx*v_cellsize, gy*v_cellsize, (gx+1)*v_cellsize, (gy+1)*v_cellsize), 3035),
      4326
    ))::TEXT,
    COALESCE(CASE indicateur
      WHEN 'surface_moyenne' THEN total_surf / NULLIF(total_men, 0)
      WHEN 'revenu_median'   THEN total_snv  / NULLIF(total_pop, 0)
      ELSE total_ind
    END, 0.0),
    COALESCE(total_pop, 0.0),
    COALESCE(total_men, 0.0)
  FROM grouped
  ORDER BY total_pop DESC
  LIMIT max_rows;
END;
$function$
;
revoke all on function public.get_carreaux_by_zoom(zoom_level integer, bbox_west double precision, bbox_south double precision, bbox_east double precision, bbox_north double precision, indicateur text, max_rows integer) from public, anon, authenticated, service_role;
grant execute on function public.get_carreaux_by_zoom(zoom_level integer, bbox_west double precision, bbox_south double precision, bbox_east double precision, bbox_north double precision, indicateur text, max_rows integer) to public;
grant execute on function public.get_carreaux_by_zoom(zoom_level integer, bbox_west double precision, bbox_south double precision, bbox_east double precision, bbox_north double precision, indicateur text, max_rows integer) to anon;
grant execute on function public.get_carreaux_by_zoom(zoom_level integer, bbox_west double precision, bbox_south double precision, bbox_east double precision, bbox_north double precision, indicateur text, max_rows integer) to authenticated;
grant execute on function public.get_carreaux_by_zoom(zoom_level integer, bbox_west double precision, bbox_south double precision, bbox_east double precision, bbox_north double precision, indicateur text, max_rows integer) to service_role;

CREATE OR REPLACE FUNCTION public.get_carreaux_capture_geometry(p_west double precision, p_south double precision, p_east double precision, p_north double precision, p_zoom_level integer DEFAULT 10, p_indicateur text DEFAULT 'population_totale'::text, p_max_rows integer DEFAULT 5000, p_value_min double precision DEFAULT NULL::double precision, p_value_max double precision DEFAULT NULL::double precision, p_admin_scope jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_geom geometry;
  v_count int;
  v_total_value double precision;
  v_admin_geom geometry;
  v_scale text;
  v_codes text[];
BEGIN
  -- Resolution geometrie cible si scope renseigne
  IF p_admin_scope IS NOT NULL AND p_admin_scope ? 'scale' AND p_admin_scope ? 'codes' THEN
    v_scale := p_admin_scope->>'scale';
    SELECT array_agg(value) INTO v_codes
    FROM jsonb_array_elements_text(p_admin_scope->'codes') AS value;

    IF v_codes IS NOT NULL AND array_length(v_codes, 1) > 0 THEN
      CASE v_scale
        WHEN 'region'      THEN SELECT ST_Union(geom) INTO v_admin_geom FROM ref_regions      WHERE code_region = ANY(v_codes);
        WHEN 'departement' THEN SELECT ST_Union(geom) INTO v_admin_geom FROM ref_departements WHERE code_dept   = ANY(v_codes);
        WHEN 'cp'          THEN SELECT ST_Union(geom) INTO v_admin_geom FROM ref_codes_postaux WHERE code_postal = ANY(v_codes);
        ELSE NULL;
      END CASE;
    END IF;
  END IF;

  IF v_admin_geom IS NOT NULL THEN
    -- Path scope : on prend la bbox enveloppante du scope, puis ST_Intersects pour clipper
    SELECT
      ST_Union(ST_SetSRID(ST_GeomFromGeoJSON(c.geojson), 4326)),
      COUNT(*),
      SUM(c.value)
    INTO v_geom, v_count, v_total_value
    FROM public.get_carreaux_by_zoom(
      p_zoom_level,
      ST_XMin(v_admin_geom), ST_YMin(v_admin_geom),
      ST_XMax(v_admin_geom), ST_YMax(v_admin_geom),
      p_indicateur, p_max_rows
    ) AS c
    WHERE ST_Intersects(ST_SetSRID(ST_GeomFromGeoJSON(c.geojson), 4326), v_admin_geom)
      AND (p_value_min IS NULL OR c.value >= p_value_min)
      AND (p_value_max IS NULL OR c.value <= p_value_max);
  ELSE
    -- Path bbox original
    SELECT
      ST_Union(ST_SetSRID(ST_GeomFromGeoJSON(c.geojson), 4326)),
      COUNT(*),
      SUM(c.value)
    INTO v_geom, v_count, v_total_value
    FROM public.get_carreaux_by_zoom(
      p_zoom_level, p_west, p_south, p_east, p_north, p_indicateur, p_max_rows
    ) AS c
    WHERE (p_value_min IS NULL OR c.value >= p_value_min)
      AND (p_value_max IS NULL OR c.value <= p_value_max);
  END IF;

  IF v_geom IS NULL OR ST_IsEmpty(v_geom) THEN
    RETURN jsonb_build_object('geometry', NULL, 'metadata', '{}'::jsonb);
  END IF;

  IF GeometryType(v_geom) = 'POLYGON' THEN v_geom := ST_Multi(v_geom); END IF;

  RETURN jsonb_build_object(
    'geometry', ST_AsGeoJSON(v_geom)::jsonb,
    'metadata', jsonb_build_object(
      'bbox', jsonb_build_array(p_west, p_south, p_east, p_north),
      'zoom_level', p_zoom_level,
      'indicateur', p_indicateur,
      'carreaux_count', v_count,
      'total_value', v_total_value,
      'value_min', p_value_min,
      'value_max', p_value_max,
      'admin_scope', p_admin_scope,
      'scope_applied', v_admin_geom IS NOT NULL
    )
  );
END $function$
;
revoke all on function public.get_carreaux_capture_geometry(p_west double precision, p_south double precision, p_east double precision, p_north double precision, p_zoom_level integer, p_indicateur text, p_max_rows integer, p_value_min double precision, p_value_max double precision, p_admin_scope jsonb) from public, anon, authenticated, service_role;
grant execute on function public.get_carreaux_capture_geometry(p_west double precision, p_south double precision, p_east double precision, p_north double precision, p_zoom_level integer, p_indicateur text, p_max_rows integer, p_value_min double precision, p_value_max double precision, p_admin_scope jsonb) to authenticated;
grant execute on function public.get_carreaux_capture_geometry(p_west double precision, p_south double precision, p_east double precision, p_north double precision, p_zoom_level integer, p_indicateur text, p_max_rows integer, p_value_min double precision, p_value_max double precision, p_admin_scope jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.get_iris_selection_geometry(p_iris_codes text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_geom geometry;
  v_count int;
BEGIN
  IF p_iris_codes IS NULL OR array_length(p_iris_codes, 1) = 0 THEN
    RETURN jsonb_build_object('geometry', NULL, 'metadata', '{}'::jsonb);
  END IF;

  SELECT ST_Union(geom), COUNT(*)
  INTO v_geom, v_count
  FROM iris
  WHERE code_iris = ANY(p_iris_codes);

  IF v_geom IS NULL OR ST_IsEmpty(v_geom) THEN
    RETURN jsonb_build_object('geometry', NULL, 'metadata', '{}'::jsonb);
  END IF;

  IF GeometryType(v_geom) = 'POLYGON' THEN v_geom := ST_Multi(v_geom); END IF;

  RETURN jsonb_build_object(
    'geometry', ST_AsGeoJSON(v_geom)::jsonb,
    'metadata', jsonb_build_object(
      'iris_codes', p_iris_codes,
      'iris_count', v_count
    )
  );
END $function$
;
revoke all on function public.get_iris_selection_geometry(p_iris_codes text[]) from public, anon, authenticated, service_role;
grant execute on function public.get_iris_selection_geometry(p_iris_codes text[]) to authenticated;
grant execute on function public.get_iris_selection_geometry(p_iris_codes text[]) to service_role;

CREATE OR REPLACE FUNCTION public.resolve_custom_geo_zone_codes(p_zone_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_zone_geom geometry;
  v_org_id    uuid;
  v_count_iris integer;
  v_count_cp integer;
  v_count_dept integer;
  v_count_region integer;
BEGIN
  SELECT geometry, org_id INTO v_zone_geom, v_org_id
  FROM public.custom_geo_zones WHERE id = p_zone_id;

  IF v_zone_geom IS NULL THEN
    RAISE EXCEPTION 'Zone % not found', p_zone_id;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = auth.uid() AND organization_id = v_org_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'Access denied to zone %', p_zone_id;
  END IF;

  DELETE FROM public.custom_geo_zone_codes WHERE zone_id = p_zone_id;

  -- IRIS
  INSERT INTO public.custom_geo_zone_codes (zone_id, code_type, code)
  SELECT DISTINCT p_zone_id, 'iris', i.code_iris
  FROM public.iris i
  WHERE i.geom IS NOT NULL AND ST_Intersects(i.geom, v_zone_geom);
  GET DIAGNOSTICS v_count_iris = ROW_COUNT;

  -- CP
  INSERT INTO public.custom_geo_zone_codes (zone_id, code_type, code)
  SELECT DISTINCT p_zone_id, 'cp', cp.code_postal
  FROM public.ref_codes_postaux cp
  WHERE cp.geom IS NOT NULL AND ST_Intersects(cp.geom, v_zone_geom);
  GET DIAGNOSTICS v_count_cp = ROW_COUNT;

  -- DEPT (déduits des IRIS, zéro spatial query)
  INSERT INTO public.custom_geo_zone_codes (zone_id, code_type, code)
  SELECT DISTINCT p_zone_id, 'dept', i.code_dept
  FROM public.iris i
  INNER JOIN public.custom_geo_zone_codes c
    ON c.zone_id = p_zone_id AND c.code_type = 'iris' AND c.code = i.code_iris
  WHERE i.code_dept IS NOT NULL;
  GET DIAGNOSTICS v_count_dept = ROW_COUNT;

  -- REGION (déduits des IRIS, zéro spatial query)
  INSERT INTO public.custom_geo_zone_codes (zone_id, code_type, code)
  SELECT DISTINCT p_zone_id, 'region', i.code_region
  FROM public.iris i
  INNER JOIN public.custom_geo_zone_codes c
    ON c.zone_id = p_zone_id AND c.code_type = 'iris' AND c.code = i.code_iris
  WHERE i.code_region IS NOT NULL;
  GET DIAGNOSTICS v_count_region = ROW_COUNT;

  UPDATE public.custom_geo_zones
  SET feature_count_iris = v_count_iris,
      feature_count_cp = v_count_cp,
      resolved_at = now()
  WHERE id = p_zone_id;

  RETURN jsonb_build_object(
    'zone_id', p_zone_id,
    'count_iris', v_count_iris,
    'count_cp', v_count_cp,
    'count_dept', v_count_dept,
    'count_region', v_count_region
  );
END $function$
;
revoke all on function public.resolve_custom_geo_zone_codes(p_zone_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.resolve_custom_geo_zone_codes(p_zone_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.resolve_custom_geo_zone_codes(p_zone_id uuid, p_caller_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_zone_geom geometry;
  v_org_id    uuid;
  v_count_iris integer;
  v_count_cp integer;
  v_count_dept integer;
  v_count_region integer;
  v_caller uuid;
BEGIN
  SELECT geometry, org_id INTO v_zone_geom, v_org_id
  FROM public.custom_geo_zones WHERE id = p_zone_id;

  IF v_zone_geom IS NULL THEN
    RAISE EXCEPTION 'Zone % not found', p_zone_id;
  END IF;

  v_caller := COALESCE(p_caller_user_id, auth.uid());
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = v_caller AND organization_id = v_org_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_caller AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'Access denied to zone %', p_zone_id;
  END IF;

  DELETE FROM public.custom_geo_zone_codes WHERE zone_id = p_zone_id;

  INSERT INTO public.custom_geo_zone_codes (zone_id, code_type, code)
  SELECT DISTINCT p_zone_id, 'iris', i.code_iris
  FROM public.iris i
  WHERE i.geom IS NOT NULL AND ST_Intersects(i.geom, v_zone_geom);
  GET DIAGNOSTICS v_count_iris = ROW_COUNT;

  INSERT INTO public.custom_geo_zone_codes (zone_id, code_type, code)
  SELECT DISTINCT p_zone_id, 'cp', cp.code_postal
  FROM public.ref_codes_postaux cp
  WHERE cp.geom IS NOT NULL AND ST_Intersects(cp.geom, v_zone_geom);
  GET DIAGNOSTICS v_count_cp = ROW_COUNT;

  INSERT INTO public.custom_geo_zone_codes (zone_id, code_type, code)
  SELECT DISTINCT p_zone_id, 'dept', i.code_dept
  FROM public.iris i
  INNER JOIN public.custom_geo_zone_codes c
    ON c.zone_id = p_zone_id AND c.code_type = 'iris' AND c.code = i.code_iris
  WHERE i.code_dept IS NOT NULL;
  GET DIAGNOSTICS v_count_dept = ROW_COUNT;

  INSERT INTO public.custom_geo_zone_codes (zone_id, code_type, code)
  SELECT DISTINCT p_zone_id, 'region', i.code_region
  FROM public.iris i
  INNER JOIN public.custom_geo_zone_codes c
    ON c.zone_id = p_zone_id AND c.code_type = 'iris' AND c.code = i.code_iris
  WHERE i.code_region IS NOT NULL;
  GET DIAGNOSTICS v_count_region = ROW_COUNT;

  UPDATE public.custom_geo_zones
  SET feature_count_iris = v_count_iris,
      feature_count_cp = v_count_cp,
      resolved_at = now()
  WHERE id = p_zone_id;

  RETURN jsonb_build_object(
    'zone_id', p_zone_id,
    'count_iris', v_count_iris,
    'count_cp', v_count_cp,
    'count_dept', v_count_dept,
    'count_region', v_count_region
  );
END $function$
;
revoke all on function public.resolve_custom_geo_zone_codes(p_zone_id uuid, p_caller_user_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.resolve_custom_geo_zone_codes(p_zone_id uuid, p_caller_user_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.resolve_custom_geo_zone_codes_with_subzones(p_zone_id uuid, p_caller_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_zone_geom geometry;
  v_org_id uuid;
  v_caller uuid;
  v_count_iris integer := 0;
  v_count_cp integer := 0;
  v_count_dept integer := 0;
  v_count_region integer := 0;
  v_subzone_count integer := 0;
BEGIN
  SELECT geometry, org_id INTO v_zone_geom, v_org_id
  FROM public.custom_geo_zones WHERE id = p_zone_id;

  IF v_zone_geom IS NULL THEN
    RAISE EXCEPTION 'Zone % not found', p_zone_id;
  END IF;

  v_caller := COALESCE(p_caller_user_id, auth.uid());
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = v_caller AND organization_id = v_org_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_caller AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'Access denied to zone %', p_zone_id;
  END IF;

  SELECT COUNT(*) INTO v_subzone_count
  FROM public.custom_geo_zone_subzones WHERE zone_id = p_zone_id;

  DELETE FROM public.custom_geo_zone_codes WHERE zone_id = p_zone_id;

  IF v_subzone_count = 0 THEN
    INSERT INTO public.custom_geo_zone_codes (zone_id, code_type, code, subzone_id)
    SELECT DISTINCT p_zone_id, 'iris', i.code_iris, NULL::uuid
    FROM public.iris i
    WHERE i.geom IS NOT NULL AND ST_Intersects(i.geom, v_zone_geom);
    GET DIAGNOSTICS v_count_iris = ROW_COUNT;

    INSERT INTO public.custom_geo_zone_codes (zone_id, code_type, code, subzone_id)
    SELECT DISTINCT p_zone_id, 'cp', cp.code_postal, NULL::uuid
    FROM public.ref_codes_postaux cp
    WHERE cp.geom IS NOT NULL AND ST_Intersects(cp.geom, v_zone_geom);
    GET DIAGNOSTICS v_count_cp = ROW_COUNT;
  ELSE
    INSERT INTO public.custom_geo_zone_codes (zone_id, code_type, code, subzone_id)
    SELECT DISTINCT ON (i.code_iris) p_zone_id, 'iris', i.code_iris, sz.id
    FROM public.iris i
    JOIN public.custom_geo_zone_subzones sz ON sz.zone_id = p_zone_id
      AND ST_Intersects(i.geom, sz.geometry)
    WHERE i.geom IS NOT NULL
    ORDER BY i.code_iris, sz.ordering ASC;
    GET DIAGNOSTICS v_count_iris = ROW_COUNT;

    INSERT INTO public.custom_geo_zone_codes (zone_id, code_type, code, subzone_id)
    SELECT DISTINCT ON (cp.code_postal) p_zone_id, 'cp', cp.code_postal, sz.id
    FROM public.ref_codes_postaux cp
    JOIN public.custom_geo_zone_subzones sz ON sz.zone_id = p_zone_id
      AND ST_Intersects(cp.geom, sz.geometry)
    WHERE cp.geom IS NOT NULL
    ORDER BY cp.code_postal, sz.ordering ASC;
    GET DIAGNOSTICS v_count_cp = ROW_COUNT;
  END IF;

  -- DEPT + REGION (pas de subzone_id)
  INSERT INTO public.custom_geo_zone_codes (zone_id, code_type, code, subzone_id)
  SELECT DISTINCT p_zone_id, 'dept', i.code_dept, NULL::uuid
  FROM public.iris i
  INNER JOIN public.custom_geo_zone_codes c
    ON c.zone_id = p_zone_id AND c.code_type = 'iris' AND c.code = i.code_iris
  WHERE i.code_dept IS NOT NULL;
  GET DIAGNOSTICS v_count_dept = ROW_COUNT;

  INSERT INTO public.custom_geo_zone_codes (zone_id, code_type, code, subzone_id)
  SELECT DISTINCT p_zone_id, 'region', i.code_region, NULL::uuid
  FROM public.iris i
  INNER JOIN public.custom_geo_zone_codes c
    ON c.zone_id = p_zone_id AND c.code_type = 'iris' AND c.code = i.code_iris
  WHERE i.code_region IS NOT NULL;
  GET DIAGNOSTICS v_count_region = ROW_COUNT;

  UPDATE public.custom_geo_zones
  SET feature_count_iris = v_count_iris,
      feature_count_cp = v_count_cp,
      resolved_at = now()
  WHERE id = p_zone_id;

  RETURN jsonb_build_object(
    'zone_id', p_zone_id,
    'count_iris', v_count_iris,
    'count_cp', v_count_cp,
    'count_dept', v_count_dept,
    'count_region', v_count_region,
    'subzone_count', v_subzone_count
  );
END $function$
;
revoke all on function public.resolve_custom_geo_zone_codes_with_subzones(p_zone_id uuid, p_caller_user_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.resolve_custom_geo_zone_codes_with_subzones(p_zone_id uuid, p_caller_user_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.transform_geometries_for_save(p_geometries jsonb, p_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_collection geometry;
  v_result geometry;
BEGIN
  IF p_geometries IS NULL OR jsonb_typeof(p_geometries) <> 'array' OR jsonb_array_length(p_geometries) = 0 THEN
    RAISE EXCEPTION 'p_geometries must be a non-empty JSON array';
  END IF;

  IF p_method NOT IN ('union', 'convex_hull', 'envelope', 'raw') THEN
    RAISE EXCEPTION 'Unknown transformation: %', p_method;
  END IF;

  SELECT ST_Collect(ST_SetSRID(ST_GeomFromGeoJSON(g.value::text), 4326))
  INTO v_collection
  FROM jsonb_array_elements(p_geometries) AS g;

  IF v_collection IS NULL OR ST_IsEmpty(v_collection) THEN
    RAISE EXCEPTION 'No valid geometries provided';
  END IF;

  v_result := CASE p_method
    WHEN 'union'       THEN ST_Union(v_collection)
    WHEN 'convex_hull' THEN ST_ConvexHull(v_collection)
    WHEN 'envelope'    THEN ST_Envelope(v_collection)
    WHEN 'raw'         THEN v_collection
  END;

  IF GeometryType(v_result) = 'POLYGON' THEN
    v_result := ST_Multi(v_result);
  ELSIF GeometryType(v_result) NOT IN ('MULTIPOLYGON', 'POLYGON') THEN
    v_result := ST_Multi(ST_Buffer(v_result, 0));
  END IF;

  RETURN ST_AsGeoJSON(v_result)::jsonb;
END
$function$
;
revoke all on function public.transform_geometries_for_save(p_geometries jsonb, p_method text) from public, anon, authenticated, service_role;
grant execute on function public.transform_geometries_for_save(p_geometries jsonb, p_method text) to authenticated;
grant execute on function public.transform_geometries_for_save(p_geometries jsonb, p_method text) to service_role;

commit;
