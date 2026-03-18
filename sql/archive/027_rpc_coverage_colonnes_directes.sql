-- ═══════════════════════════════════════════════════════════════════════════
-- 027_rpc_coverage_colonnes_directes.sql
--
-- Met à jour les fonctions de couverture pour utiliser les colonnes directes
-- (ind, ind_18_24, etc.) au lieu de (metadata->>'col')::numeric.
-- Requiert migration 026 (colonnes générées STORED).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── compute_coverage_fast ────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS compute_coverage_fast(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS compute_coverage_fast(TEXT, TEXT, TEXT, INT);

CREATE OR REPLACE FUNCTION compute_coverage_fast(
  p_categorie  TEXT,
  p_mode       TEXT,
  p_column     TEXT DEFAULT 'ind',
  p_level      INT  DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_union_geom  geometry;
  v_result      BIGINT;
  v_col         TEXT;
BEGIN
  SET LOCAL statement_timeout = '4min';

  -- Whitelist — sécurité + mapping vers colonnes directes
  v_col := CASE p_column
    WHEN 'ind'       THEN 'ind'
    WHEN 'ind_18_24' THEN 'ind_18_24'
    WHEN 'ind_25_39' THEN 'ind_25_39'
    WHEN 'ind_40_54' THEN 'ind_40_54'
    WHEN 'ind_inc'   THEN 'ind_inc'
    ELSE 'ind'
  END;

  SELECT ST_UnaryUnion(ST_Collect(
    ST_MakeValid(
      ST_Simplify(
        ST_SetSRID(
          ST_GeomFromGeoJSON((ic.geojson -> 'features' -> 0 -> 'geometry')::text),
          4326
        ),
        0.01
      )
    )
  ))
  INTO v_union_geom
  FROM isochrones_cache ic
  WHERE ic.categorie = p_categorie
    AND ic.mode      = p_mode
    AND ic.ville     = '_battle_'
    AND (p_level IS NULL OR ic.minutes = p_level)
    AND (ic.geojson -> 'features' -> 0 -> 'geometry') IS NOT NULL;

  IF v_union_geom IS NULL THEN
    RETURN 0;
  END IF;

  -- Colonne directe (INTEGER) au lieu de (metadata->>'col')::numeric
  EXECUTE format(
    'SELECT COALESCE(SUM(%I), 0)::BIGINT FROM carreaux_filosofi WHERE ST_SetSRID(geom, 4326) && $1',
    v_col
  ) INTO v_result USING v_union_geom;

  RETURN COALESCE(v_result, 0);
END;
$$;

COMMENT ON FUNCTION compute_coverage_fast(TEXT, TEXT, TEXT, INT) IS
  'Couverture audience — colonnes directes INTEGER (pas JSONB), ST_Simplify+MakeValid, bbox';

GRANT EXECUTE ON FUNCTION compute_coverage_fast(TEXT, TEXT, TEXT, INT) TO service_role;


-- ── compute_coverage_per_poi_batch ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_coverage_per_poi_batch(
  p_cache_keys  TEXT[],
  p_column      TEXT DEFAULT 'ind'
)
RETURNS TABLE(cache_key TEXT, audience BIGINT)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key      TEXT;
  v_geom     geometry;
  v_audience BIGINT;
  v_col      TEXT;
BEGIN
  SET LOCAL statement_timeout = '90s';

  v_col := CASE p_column
    WHEN 'ind'       THEN 'ind'
    WHEN 'ind_18_24' THEN 'ind_18_24'
    WHEN 'ind_25_39' THEN 'ind_25_39'
    WHEN 'ind_40_54' THEN 'ind_40_54'
    WHEN 'ind_inc'   THEN 'ind_inc'
    ELSE 'ind'
  END;

  FOREACH v_key IN ARRAY p_cache_keys LOOP
    SELECT ST_MakeValid(
      ST_Simplify(
        ST_SetSRID(
          ST_GeomFromGeoJSON((ic.geojson -> 'features' -> 0 -> 'geometry')::text),
          4326
        ),
        0.01
      )
    )
    INTO v_geom
    FROM isochrones_cache ic
    WHERE ic.cache_key = v_key
      AND (ic.geojson -> 'features' -> 0 -> 'geometry') IS NOT NULL
    LIMIT 1;

    IF v_geom IS NOT NULL THEN
      -- Colonne directe INTEGER → pas de parsing JSONB, ~5-10× plus rapide
      EXECUTE format(
        'SELECT COALESCE(SUM(%I), 0)::BIGINT FROM carreaux_filosofi WHERE ST_SetSRID(geom, 4326) && $1',
        v_col
      ) INTO v_audience USING v_geom;

      cache_key := v_key;
      audience  := v_audience;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION compute_coverage_per_poi_batch(TEXT[], TEXT) IS
  'Audience par batch POIs — colonnes directes INTEGER, boucle PL/pgSQL, GiST garanti';

GRANT EXECUTE ON FUNCTION compute_coverage_per_poi_batch(TEXT[], TEXT) TO service_role;
