-- Chantier A3.1 — 3 RPCs v2 paramétrées par metric_field (core ou JSONB).
-- Pattern : valider field via dsp_metrics_registry, construire imp_expr selon is_core,
-- l'injecter dans EXECUTE format(...) à la place de SUM(dcd.%I) v1.
-- Smoke-test : v1(metric='impressions') ≡ v2(metric_field='tracked_ads') sur Adform (3/3).

CREATE OR REPLACE FUNCTION public.get_digital_geography_map_v2(
  p_campaign_id uuid,
  p_scale text DEFAULT 'cp'::text,
  p_pop_field text DEFAULT 'population'::text,
  p_media text[] DEFAULT NULL::text[],
  p_bbox_xmin double precision DEFAULT '-5.5'::numeric,
  p_bbox_ymin double precision DEFAULT 41.0,
  p_bbox_xmax double precision DEFAULT 10.0,
  p_bbox_ymax double precision DEFAULT 51.5,
  p_metric_field text DEFAULT 'tracked_ads'
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE
  sum_fields TEXT[] := ARRAY['population','pop_0_14','pop_15_29','pop_30_44',
                             'pop_45_59','pop_60_74','pop_75_plus','nb_menages',
                             'nb_diplome_aucun','nb_diplome_bac','nb_diplome_sup',
                             'nb_csp_cadre','nb_csp_employe','nb_csp_ouvrier',
                             'nb_emplois','nb_emplois_commune'];
  safe_field TEXT; pop_agg_iris TEXT; pop_agg_cp TEXT;
  v_is_core BOOLEAN; imp_expr TEXT; media_clause TEXT := ''; result JSON;
BEGIN
  SELECT is_core INTO v_is_core FROM dsp_metrics_registry
  WHERE field = p_metric_field AND is_enabled = true;
  IF v_is_core IS NULL THEN
    RAISE EXCEPTION 'Unknown or disabled metric: %', p_metric_field USING ERRCODE = '22023';
  END IF;
  IF v_is_core THEN
    imp_expr := format('dcd.%I', p_metric_field);
  ELSE
    imp_expr := format('((dcd.metrics->>%L)::numeric)', p_metric_field);
  END IF;

  IF p_pop_field IS NULL OR p_pop_field = '' THEN safe_field := 'population';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'iris' AND column_name = p_pop_field
      AND data_type IN ('integer','bigint','numeric','real','double precision')
  ) THEN safe_field := p_pop_field;
  ELSE safe_field := 'population'; END IF;

  IF safe_field = ANY(sum_fields) THEN
    pop_agg_iris := 'SUM(' || quote_ident(safe_field) || ')';
    pop_agg_cp   := 'SUM(valf)';
  ELSE
    pop_agg_iris := 'CASE WHEN SUM(population) > 0 '
                 || 'THEN ROUND((SUM(' || quote_ident(safe_field) || '::numeric * COALESCE(population,0)) '
                 || ' / SUM(population))::numeric, 2) ELSE NULL END';
    pop_agg_cp   := 'CASE WHEN SUM(popw) > 0 '
                 || 'THEN ROUND((SUM(valf::numeric * COALESCE(popw,0)) / SUM(popw))::numeric, 2) ELSE NULL END';
  END IF;

  IF p_media IS NOT NULL AND array_length(p_media, 1) > 0 THEN
    media_clause := ' AND dcd.media = ANY($6) ';
  END IF;

  IF p_scale = 'region' THEN
    EXECUTE format($q$
      WITH imp AS (
        SELECT rr.code_region AS c, SUM(%s)::numeric AS v
        FROM dsp_campaign_data dcd
        JOIN ref_codes_postaux rcp ON rcp.code_postal = dcd.postal_code
        JOIN ref_departements rd  ON rd.code_dept    = rcp.code_dept
        JOIN ref_regions rr       ON rr.code_region  = rd.code_region
        WHERE dcd.campaign_id = $1 %s
        GROUP BY 1
      ),
      pop AS (SELECT code_region AS c, %s AS v FROM iris GROUP BY 1),
      geo AS (
        SELECT rr.code_region AS c, rr.nom_region AS n, ST_AsGeoJSON(rr.geom)::json AS g
        FROM ref_regions rr
        WHERE rr.geom && ST_MakeEnvelope($2, $3, $4, $5, 4326)
      )
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
        SELECT g.c AS code, g.n AS nom, COALESCE(imp.v, 0)::bigint AS total_impressions,
               pop.v AS pop_value,
               CASE WHEN COALESCE(pop.v, 0) > 0 THEN ROUND(imp.v::numeric / pop.v * 1000, 2) ELSE NULL END AS ratio,
               g.g AS geometry
        FROM geo g LEFT JOIN imp ON imp.c = g.c LEFT JOIN pop ON pop.c = g.c
      ) t
    $q$, imp_expr, media_clause, pop_agg_iris)
    INTO result USING p_campaign_id, p_bbox_xmin, p_bbox_ymin, p_bbox_xmax, p_bbox_ymax, p_media;

  ELSIF p_scale = 'departement' THEN
    EXECUTE format($q$
      WITH imp AS (
        SELECT rcp.code_dept AS c, SUM(%s)::numeric AS v
        FROM dsp_campaign_data dcd
        JOIN ref_codes_postaux rcp ON rcp.code_postal = dcd.postal_code
        WHERE dcd.campaign_id = $1 %s
        GROUP BY 1
      ),
      pop AS (SELECT code_dept AS c, %s AS v FROM iris GROUP BY 1),
      geo AS (
        SELECT rd.code_dept AS c, COALESCE(rd.nom_dept, rd.code_dept) AS n,
               ST_AsGeoJSON(rd.geom)::json AS g
        FROM ref_departements rd
        WHERE rd.geom && ST_MakeEnvelope($2, $3, $4, $5, 4326)
      )
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
        SELECT g.c AS code, g.n AS nom, COALESCE(imp.v, 0)::bigint AS total_impressions,
               pop.v AS pop_value,
               CASE WHEN COALESCE(pop.v, 0) > 0 THEN ROUND(imp.v::numeric / pop.v * 1000, 2) ELSE NULL END AS ratio,
               g.g AS geometry
        FROM geo g LEFT JOIN imp ON imp.c = g.c LEFT JOIN pop ON pop.c = g.c
      ) t
    $q$, imp_expr, media_clause, pop_agg_iris)
    INTO result USING p_campaign_id, p_bbox_xmin, p_bbox_ymin, p_bbox_xmax, p_bbox_ymax, p_media;

  ELSE
    EXECUTE format($q$
      WITH imp AS (
        SELECT dcd.postal_code AS c, SUM(%s)::numeric AS v
        FROM dsp_campaign_data dcd
        WHERE dcd.campaign_id = $1 %s
        GROUP BY 1
      ),
      iris_cp AS (
        SELECT iris.code_iris, MIN(pc.code_postal) AS cp,
               iris.population::numeric AS popw, iris.%I::numeric AS valf
        FROM iris JOIN postal_code_commune pc ON pc.code_commune = iris.code_commune
        GROUP BY iris.code_iris, iris.population, iris.%I
      ),
      pop AS (SELECT cp AS c, %s AS v FROM iris_cp GROUP BY 1),
      geo AS (
        SELECT rcp.code_postal AS c, rcp.nom_principal AS n,
               ST_AsGeoJSON(rcp.geom_simplified)::json AS g
        FROM ref_codes_postaux rcp
        WHERE rcp.geom_simplified && ST_MakeEnvelope($2, $3, $4, $5, 4326)
      )
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
        SELECT g.c AS code, g.n AS nom, COALESCE(imp.v, 0)::bigint AS total_impressions,
               pop.v AS pop_value,
               CASE WHEN COALESCE(pop.v, 0) > 0 THEN ROUND(imp.v::numeric / pop.v * 1000, 2) ELSE NULL END AS ratio,
               g.g AS geometry
        FROM geo g LEFT JOIN imp ON imp.c = g.c LEFT JOIN pop ON pop.c = g.c
      ) t
    $q$, imp_expr, media_clause, safe_field, safe_field, pop_agg_cp)
    INTO result USING p_campaign_id, p_bbox_xmin, p_bbox_ymin, p_bbox_xmax, p_bbox_ymax, p_media;
  END IF;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_digital_geography_map_v2(uuid, text, text, text[], double precision, double precision, double precision, double precision, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_digital_geography_map_v2(uuid, text, text, text[], double precision, double precision, double precision, double precision, text) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.get_digital_media_heatmap_v2(
  p_campaign_id uuid,
  p_aggregation text DEFAULT 'region'::text,
  p_indicator text DEFAULT 'population'::text,
  p_metric_field text DEFAULT 'tracked_ads'
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE
  sum_fields TEXT[] := ARRAY['population','pop_0_14','pop_15_29','pop_30_44','pop_45_59','pop_60_74','pop_75_plus','nb_menages','nb_diplome_aucun','nb_diplome_bac','nb_diplome_sup','nb_csp_cadre','nb_csp_employe','nb_csp_ouvrier','nb_emplois','nb_emplois_commune'];
  sf TEXT; pa TEXT; result JSON; v_is_core BOOLEAN; imp_expr TEXT;
BEGIN
  SELECT is_core INTO v_is_core FROM dsp_metrics_registry
  WHERE field = p_metric_field AND is_enabled = true;
  IF v_is_core IS NULL THEN
    RAISE EXCEPTION 'Unknown or disabled metric: %', p_metric_field USING ERRCODE = '22023';
  END IF;
  IF v_is_core THEN imp_expr := format('dcd.%I', p_metric_field);
  ELSE imp_expr := format('((dcd.metrics->>%L)::numeric)', p_metric_field); END IF;

  sf := CASE WHEN p_indicator IS NOT NULL AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='iris' AND column_name=p_indicator) THEN p_indicator ELSE 'population' END;
  pa := CASE WHEN sf=ANY(sum_fields) THEN 'SUM(i.'||quote_ident(sf)||')' ELSE 'CASE WHEN SUM(i.population)>0 THEN ROUND((SUM(i.'||quote_ident(sf)||'::numeric*i.population)/SUM(i.population))::numeric,2) END' END;

  IF p_aggregation='region' THEN
    EXECUTE format($q$
      WITH imp AS (
        SELECT dcd.media, rd.code_region as zc, SUM(%s)::numeric as imp
        FROM dsp_campaign_data dcd JOIN ref_codes_postaux rcp ON dcd.postal_code=rcp.code_postal
        JOIN ref_departements rd ON rcp.code_dept=rd.code_dept
        WHERE dcd.campaign_id=$1 AND dcd.media IS NOT NULL AND dcd.media!='' GROUP BY dcd.media,rd.code_region
      ),
      pop AS (SELECT code_region zc,%s pv FROM iris i GROUP BY code_region),
      mt AS (SELECT media,SUM(imp)ti FROM imp GROUP BY media),
      pt AS (SELECT SUM(pv)tp FROM pop),
      zones AS (SELECT DISTINCT rr.code_region c,rr.nom_region n FROM ref_regions rr JOIN imp ON imp.zc=rr.code_region ORDER BY rr.nom_region)
      SELECT json_build_object(
        'medias',(SELECT COALESCE(json_agg(DISTINCT media ORDER BY media),'[]') FROM imp),
        'zones',(SELECT COALESCE(json_agg(json_build_object('code',c,'nom',n)),'[]') FROM zones),
        'cells',(SELECT COALESCE(json_agg(row_to_json(t)),'[]') FROM (
          SELECT imp.media,imp.zc as zone_code,rr.nom_region as zone_nom,imp.imp as impressions,
            COALESCE(pop.pv,0)pop_cible,
            ROUND(imp.imp/NULLIF(mt.ti,0)*100,2)pct_imp_media,
            ROUND(COALESCE(pop.pv,0)/NULLIF((SELECT tp FROM pt),0)*100,2)pct_pop,
            ROUND(imp.imp/NULLIF(mt.ti,0)*100-COALESCE(pop.pv,0)/NULLIF((SELECT tp FROM pt),0)*100,2)ecart
          FROM imp LEFT JOIN pop USING(zc) JOIN mt USING(media) JOIN ref_regions rr ON imp.zc=rr.code_region
        )t)
      )
    $q$, imp_expr, pa) INTO result USING p_campaign_id;
  ELSE
    EXECUTE format($q$
      WITH imp AS (
        SELECT dcd.media, rcp.code_dept as zc, SUM(%s)::numeric as imp
        FROM dsp_campaign_data dcd JOIN ref_codes_postaux rcp ON dcd.postal_code=rcp.code_postal
        WHERE dcd.campaign_id=$1 AND dcd.media IS NOT NULL AND dcd.media!='' GROUP BY dcd.media,rcp.code_dept
      ),
      pop AS (SELECT code_dept zc,%s pv FROM iris i GROUP BY code_dept),
      mt AS (SELECT media,SUM(imp)ti FROM imp GROUP BY media),
      pt AS (SELECT SUM(pv)tp FROM pop),
      zones AS (SELECT DISTINCT rd.code_dept c,COALESCE(rd.nom_dept,rd.code_dept)n FROM ref_departements rd JOIN imp ON imp.zc=rd.code_dept ORDER BY n)
      SELECT json_build_object(
        'medias',(SELECT COALESCE(json_agg(DISTINCT media ORDER BY media),'[]') FROM imp),
        'zones',(SELECT COALESCE(json_agg(json_build_object('code',c,'nom',n)),'[]') FROM zones),
        'cells',(SELECT COALESCE(json_agg(row_to_json(t)),'[]') FROM (
          SELECT imp.media,imp.zc as zone_code,COALESCE(rd.nom_dept,rd.code_dept)zone_nom,imp.imp as impressions,
            COALESCE(pop.pv,0)pop_cible,
            ROUND(imp.imp/NULLIF(mt.ti,0)*100,2)pct_imp_media,
            ROUND(COALESCE(pop.pv,0)/NULLIF((SELECT tp FROM pt),0)*100,2)pct_pop,
            ROUND(imp.imp/NULLIF(mt.ti,0)*100-COALESCE(pop.pv,0)/NULLIF((SELECT tp FROM pt),0)*100,2)ecart
          FROM imp LEFT JOIN pop USING(zc) JOIN mt USING(media) LEFT JOIN ref_departements rd ON imp.zc=rd.code_dept
        )t)
      )
    $q$, imp_expr, pa) INTO result USING p_campaign_id;
  END IF;
  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_digital_media_heatmap_v2(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_digital_media_heatmap_v2(uuid, text, text, text) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.get_digital_analysis_breakdown_v2(
  p_campaign_id uuid,
  p_aggregation text DEFAULT 'region'::text,
  p_indicator text DEFAULT 'population'::text,
  p_media text[] DEFAULT NULL::text[],
  p_limit integer DEFAULT 100,
  p_pop_min numeric DEFAULT 0,
  p_metric_field text DEFAULT 'tracked_ads',
  p_parent_type text DEFAULT NULL::text,
  p_parent_code text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE
  sf TEXT; pa TEXT; mc TEXT := ''; parent_i TEXT := ''; parent_p TEXT := '';
  result JSON; v_agg TEXT; v_is_core BOOLEAN; imp_expr TEXT;
  sum_fields TEXT[] := ARRAY['population','pop_0_14','pop_15_29','pop_30_44','pop_45_59','pop_60_74','pop_75_plus','nb_menages','nb_diplome_aucun','nb_diplome_bac','nb_diplome_sup','nb_csp_cadre','nb_csp_employe','nb_csp_ouvrier','nb_emplois','nb_emplois_commune'];
BEGIN
  v_agg := CASE WHEN p_aggregation IN ('dept','departement') THEN 'dept' WHEN p_aggregation='region' THEN 'region' ELSE 'cp' END;

  SELECT is_core INTO v_is_core FROM dsp_metrics_registry
  WHERE field = p_metric_field AND is_enabled = true;
  IF v_is_core IS NULL THEN
    RAISE EXCEPTION 'Unknown or disabled metric: %', p_metric_field USING ERRCODE = '22023';
  END IF;
  IF v_is_core THEN imp_expr := format('dcd.%I', p_metric_field);
  ELSE imp_expr := format('((dcd.metrics->>%L)::numeric)', p_metric_field); END IF;

  sf := CASE WHEN p_indicator IS NOT NULL AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='iris' AND column_name=p_indicator) THEN p_indicator ELSE 'population' END;
  pa := CASE WHEN sf=ANY(sum_fields) THEN 'SUM('||quote_ident(sf)||')' ELSE 'CASE WHEN SUM(population)>0 THEN ROUND((SUM('||quote_ident(sf)||'::numeric*population)/SUM(population))::numeric,2) END' END;

  IF p_media IS NOT NULL AND array_length(p_media,1)>0 THEN mc := ' AND dcd.media=ANY($5)'; END IF;

  IF v_agg='dept' AND p_parent_type='region' AND p_parent_code IS NOT NULL THEN
    parent_i := ' AND rd.code_region = $7 '; parent_p := ' AND code_region = $7 ';
  ELSIF v_agg='cp' AND p_parent_type='dept' AND p_parent_code IS NOT NULL THEN
    parent_i := ' AND r.code_dept = $7 '; parent_p := ' AND iris.code_dept = $7 ';
  END IF;

  IF v_agg='region' THEN
    EXECUTE format($q$
      WITH i AS (
        SELECT rr.code_region c, rr.nom_region n, SUM(%s)::numeric v
        FROM dsp_campaign_data dcd
        JOIN ref_codes_postaux r ON r.code_postal=dcd.postal_code
        JOIN ref_departements rd ON r.code_dept=rd.code_dept
        JOIN ref_regions rr ON rd.code_region=rr.code_region
        WHERE dcd.campaign_id=$1 %s GROUP BY 1,2
      ),
      p AS (SELECT code_region c, %s v FROM iris GROUP BY 1),
      j AS (SELECT i.c, i.n, i.v imp, p.v pop FROM i LEFT JOIN p USING(c)),
      t AS (SELECT SUM(imp) ti, SUM(pop) tp FROM j)
      SELECT COALESCE(json_agg(row_to_json(r)), '[]') FROM (
        SELECT c code, n nom, imp impressions, pop pop_value,
          ROUND(imp/NULLIF((SELECT ti FROM t),0)*100,2) pct_imp,
          ROUND(pop/NULLIF((SELECT tp FROM t),0)*100,2) pct_pop,
          ROUND(imp/NULLIF((SELECT ti FROM t),0)*100 - pop/NULLIF((SELECT tp FROM t),0)*100,2) ecart
        FROM j ORDER BY ABS(imp/NULLIF((SELECT ti FROM t),0) - pop/NULLIF((SELECT tp FROM t),0)) DESC LIMIT $4
      ) r
    $q$, imp_expr, mc, pa)
    INTO result USING p_campaign_id, p_indicator, p_aggregation, p_limit, p_media, p_pop_min, p_parent_code;

  ELSIF v_agg='dept' THEN
    EXECUTE format($q$
      WITH i AS (
        SELECT r.code_dept c, COALESCE(rd.nom_dept, r.code_dept) n, SUM(%s)::numeric v
        FROM dsp_campaign_data dcd
        JOIN ref_codes_postaux r ON r.code_postal=dcd.postal_code
        LEFT JOIN ref_departements rd ON r.code_dept=rd.code_dept
        WHERE dcd.campaign_id=$1 %s %s GROUP BY 1,2
      ),
      p AS (SELECT code_dept c, %s v FROM iris WHERE TRUE %s GROUP BY 1),
      j AS (SELECT i.c, i.n, i.v imp, p.v pop FROM i LEFT JOIN p USING(c)),
      t AS (SELECT SUM(imp) ti, SUM(pop) tp FROM j)
      SELECT COALESCE(json_agg(row_to_json(r)), '[]') FROM (
        SELECT c code, n nom, imp impressions, pop pop_value,
          ROUND(imp/NULLIF((SELECT ti FROM t),0)*100,2) pct_imp,
          ROUND(pop/NULLIF((SELECT tp FROM t),0)*100,2) pct_pop,
          ROUND(imp/NULLIF((SELECT ti FROM t),0)*100 - pop/NULLIF((SELECT tp FROM t),0)*100,2) ecart
        FROM j ORDER BY ABS(imp/NULLIF((SELECT ti FROM t),0) - pop/NULLIF((SELECT tp FROM t),0)) DESC LIMIT $4
      ) r
    $q$, imp_expr, mc, parent_i, pa, parent_p)
    INTO result USING p_campaign_id, p_indicator, p_aggregation, p_limit, p_media, p_pop_min, p_parent_code;

  ELSE
    EXECUTE format($q$
      WITH i AS (
        SELECT dcd.postal_code c, r.nom_principal n, SUM(%s)::numeric v
        FROM dsp_campaign_data dcd
        JOIN ref_codes_postaux r ON r.code_postal=dcd.postal_code
        WHERE dcd.campaign_id=$1 %s %s GROUP BY 1,2
      ),
      iris_cp AS (
        SELECT code_iris, MIN(pc.code_postal) cp, %I ind, population
        FROM iris JOIN postal_code_commune pc ON pc.code_commune=iris.code_commune
        WHERE TRUE %s GROUP BY 1,3,4
      ),
      p AS (SELECT cp c, SUM(ind) v FROM iris_cp GROUP BY 1),
      j AS (SELECT i.c, i.n, i.v imp, p.v pop FROM i LEFT JOIN p USING(c)),
      t AS (SELECT SUM(imp) ti, SUM(pop) tp FROM j)
      SELECT COALESCE(json_agg(row_to_json(r)), '[]') FROM (
        SELECT c code, n nom, imp impressions, pop pop_value,
          ROUND(imp/NULLIF((SELECT ti FROM t),0)*100,4) pct_imp,
          ROUND(pop/NULLIF((SELECT tp FROM t),0)*100,4) pct_pop,
          ROUND(imp/NULLIF((SELECT ti FROM t),0)*100 - pop/NULLIF((SELECT tp FROM t),0)*100,4) ecart
        FROM j WHERE COALESCE(pop,0)>=$6
        ORDER BY ABS(imp/NULLIF((SELECT ti FROM t),0) - pop/NULLIF((SELECT tp FROM t),0)) DESC LIMIT $4
      ) r
    $q$, imp_expr, mc, parent_i, sf, parent_p)
    INTO result USING p_campaign_id, p_indicator, p_aggregation, p_limit, p_media, p_pop_min, p_parent_code;
  END IF;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_digital_analysis_breakdown_v2(uuid, text, text, text[], integer, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_digital_analysis_breakdown_v2(uuid, text, text, text[], integer, numeric, text, text, text) TO authenticated, service_role;
