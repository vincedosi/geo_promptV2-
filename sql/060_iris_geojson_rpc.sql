-- Migration 060 — Fonctions RPC pour la couche IRIS choroplèthe
-- Couche : IRIS (Ilots Regroupés pour l'Information Statistique) IGN 2025
-- Usage  : GET /api/iris/geojson?bbox=...&colonne=pop_15_29&simplify=0.0005
--          GET /api/iris/stats?colonne=pop_15_29&bbox=... (optionnel)

-- ── 1. GeoJSON par bounding box ───────────────────────────────────────────────
-- Retourne un FeatureCollection d'IRIS avec valeur dynamique pour choroplèthe.
-- La colonne est validée côté API (whitelist) avant d'appeler cette fonction.
-- Gestion gracieuse : si la colonne n'existe pas encore en base → value = null.

CREATE OR REPLACE FUNCTION public.get_iris_geojson_by_bbox(
  p_west     float8,
  p_south    float8,
  p_east     float8,
  p_north    float8,
  p_colonne  text    DEFAULT NULL,
  p_simplify float8  DEFAULT 0.0005,
  p_max_rows int     DEFAULT 5000
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result      json;
  col_exists  boolean := false;
BEGIN
  -- Vérifier si la colonne demandée existe réellement dans iris
  IF p_colonne IS NOT NULL AND p_colonne != '' THEN
    SELECT EXISTS (
      SELECT 1
      FROM   information_schema.columns
      WHERE  table_schema = 'public'
        AND  table_name   = 'iris'
        AND  column_name  = p_colonne
    ) INTO col_exists;
  END IF;

  IF col_exists THEN
    -- Avec valeur démographique dynamique
    EXECUTE format(
      $sql$
        SELECT json_build_object(
          'type',     'FeatureCollection',
          'features', COALESCE(json_agg(f ORDER BY f->>'code_iris'), '[]'::json)
        )
        FROM (
          SELECT json_build_object(
            'type',       'Feature',
            'geometry',   ST_AsGeoJSON(ST_Simplify(geom, %L))::json,
            'properties', json_build_object(
              'code_iris',   code_iris,
              'nom_iris',    nom_iris,
              'nom_commune', nom_commune,
              'code_dept',   code_dept,
              'value',       (%I)::numeric
            )
          ) AS f
          FROM   public.iris
          WHERE  geom && ST_MakeEnvelope(%L, %L, %L, %L, 4326)
          LIMIT  %L
        ) sub
      $sql$,
      p_simplify,
      p_colonne,
      p_west, p_south, p_east, p_north,
      p_max_rows
    ) INTO result;
  ELSE
    -- Fallback : pas de valeur démographique (colonne absente ou non spécifiée)
    EXECUTE format(
      $sql$
        SELECT json_build_object(
          'type',     'FeatureCollection',
          'features', COALESCE(json_agg(f ORDER BY f->>'code_iris'), '[]'::json)
        )
        FROM (
          SELECT json_build_object(
            'type',       'Feature',
            'geometry',   ST_AsGeoJSON(ST_Simplify(geom, %L))::json,
            'properties', json_build_object(
              'code_iris',   code_iris,
              'nom_iris',    nom_iris,
              'nom_commune', nom_commune,
              'code_dept',   code_dept,
              'value',       null
            )
          ) AS f
          FROM   public.iris
          WHERE  geom && ST_MakeEnvelope(%L, %L, %L, %L, 4326)
          LIMIT  %L
        ) sub
      $sql$,
      p_simplify,
      p_west, p_south, p_east, p_north,
      p_max_rows
    ) INTO result;
  END IF;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_iris_geojson_by_bbox TO service_role;
COMMENT ON FUNCTION public.get_iris_geojson_by_bbox IS
  'Retourne un GeoJSON FeatureCollection IRIS pour une bbox. Colonne démographique dynamique avec fallback null si absente.';


-- ── 2. Stats percentiles pour la légende ─────────────────────────────────────
-- Retourne min/max/avg et percentiles p10..p90 pour calibrer l'échelle de couleurs.

CREATE OR REPLACE FUNCTION public.get_iris_stats_by_bbox(
  p_colonne  text,
  p_west     float8  DEFAULT -10.0,
  p_south    float8  DEFAULT 41.0,
  p_east     float8  DEFAULT 10.0,
  p_north    float8  DEFAULT 52.0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result     json;
  col_exists boolean;
BEGIN
  -- Vérifier l'existence de la colonne
  SELECT EXISTS (
    SELECT 1
    FROM   information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'iris'
      AND  column_name  = p_colonne
  ) INTO col_exists;

  IF NOT col_exists THEN
    RETURN json_build_object(
      'min', 0, 'max', 0, 'avg', 0,
      'p10', 0, 'p25', 0, 'p50', 0, 'p75', 0, 'p90', 0,
      'col_exists', false
    );
  END IF;

  EXECUTE format(
    $sql$
      SELECT json_build_object(
        'min',       MIN(%I),
        'max',       MAX(%I),
        'avg',       AVG(%I),
        'p10',       PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY %I),
        'p25',       PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY %I),
        'p50',       PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY %I),
        'p75',       PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY %I),
        'p90',       PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY %I),
        'col_exists', true
      )
      FROM public.iris
      WHERE geom && ST_MakeEnvelope(%L, %L, %L, %L, 4326)
        AND %I IS NOT NULL
    $sql$,
    p_colonne, p_colonne, p_colonne,
    p_colonne, p_colonne, p_colonne, p_colonne, p_colonne,
    p_west, p_south, p_east, p_north,
    p_colonne
  ) INTO result;

  RETURN COALESCE(result, json_build_object(
    'min', 0, 'max', 0, 'avg', 0,
    'p10', 0, 'p25', 0, 'p50', 0, 'p75', 0, 'p90', 0,
    'col_exists', false
  ));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_iris_stats_by_bbox TO service_role;
COMMENT ON FUNCTION public.get_iris_stats_by_bbox IS
  'Retourne les stats (min/max/percentiles) d une colonne IRIS pour la légende choroplèthe.';
