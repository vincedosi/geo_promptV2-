-- =============================================================================
-- CARROYAGE MULTI-RÉSOLUTION INSEE
-- Source : carreaux_filosofi (200m natifs, 2.3M lignes)
-- Colonnes : idcar, resolution, geom, ind, ind_18_24, ind_25_39, ind_40_54, ind_inc
--
-- Crée 3 vues matérialisées (grilles agrégées) + 1 RPC de sélection dynamique.
-- Les vues sont créées WITH NO DATA — exécuter les REFRESH ci-dessous.
-- =============================================================================

-- ── Vue 1 km (agrégation de ~25 carreaux 200m) ────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS carreaux_1km AS
WITH snap AS (
  SELECT
    floor(ST_X(ST_Transform(ST_Centroid(geom), 3035)) / 1000)::bigint AS gx,
    floor(ST_Y(ST_Transform(ST_Centroid(geom), 3035)) / 1000)::bigint AS gy,
    COALESCE(ind,       0) AS ind,
    COALESCE(ind_18_24, 0) AS ind_18_24,
    COALESCE(ind_25_39, 0) AS ind_25_39,
    COALESCE(ind_40_54, 0) AS ind_40_54,
    COALESCE(ind_inc,   0) AS ind_inc
  FROM carreaux_filosofi
  WHERE resolution = '200m'
)
SELECT
  CONCAT(gx, '_', gy)::TEXT AS grid_id,
  ST_Transform(
    ST_SetSRID(
      ST_MakeEnvelope(gx * 1000, gy * 1000, (gx + 1) * 1000, (gy + 1) * 1000),
      3035
    ), 4326
  ) AS geom,
  COUNT(*)::int       AS nb_carreaux,
  SUM(ind)::numeric   AS ind,
  SUM(ind_18_24)::numeric AS ind_18_24,
  SUM(ind_25_39)::numeric AS ind_25_39,
  SUM(ind_40_54)::numeric AS ind_40_54,
  SUM(ind_inc)::numeric   AS ind_inc
FROM snap
GROUP BY gx, gy
WITH NO DATA;

CREATE INDEX IF NOT EXISTS idx_carreaux_1km_geom  ON carreaux_1km  USING GIST (geom);

-- ── Vue 2 km (agrégation de ~100 carreaux 200m) ───────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS carreaux_2km AS
WITH snap AS (
  SELECT
    floor(ST_X(ST_Transform(ST_Centroid(geom), 3035)) / 2000)::bigint AS gx,
    floor(ST_Y(ST_Transform(ST_Centroid(geom), 3035)) / 2000)::bigint AS gy,
    COALESCE(ind,       0) AS ind,
    COALESCE(ind_18_24, 0) AS ind_18_24,
    COALESCE(ind_25_39, 0) AS ind_25_39,
    COALESCE(ind_40_54, 0) AS ind_40_54,
    COALESCE(ind_inc,   0) AS ind_inc
  FROM carreaux_filosofi
  WHERE resolution = '200m'
)
SELECT
  CONCAT(gx, '_', gy)::TEXT AS grid_id,
  ST_Transform(
    ST_SetSRID(
      ST_MakeEnvelope(gx * 2000, gy * 2000, (gx + 1) * 2000, (gy + 1) * 2000),
      3035
    ), 4326
  ) AS geom,
  COUNT(*)::int       AS nb_carreaux,
  SUM(ind)::numeric   AS ind,
  SUM(ind_18_24)::numeric AS ind_18_24,
  SUM(ind_25_39)::numeric AS ind_25_39,
  SUM(ind_40_54)::numeric AS ind_40_54,
  SUM(ind_inc)::numeric   AS ind_inc
FROM snap
GROUP BY gx, gy
WITH NO DATA;

CREATE INDEX IF NOT EXISTS idx_carreaux_2km_geom  ON carreaux_2km  USING GIST (geom);

-- ── Vue 20 km (agrégation de ~10 000 carreaux 200m) ──────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS carreaux_20km AS
WITH snap AS (
  SELECT
    floor(ST_X(ST_Transform(ST_Centroid(geom), 3035)) / 20000)::bigint AS gx,
    floor(ST_Y(ST_Transform(ST_Centroid(geom), 3035)) / 20000)::bigint AS gy,
    COALESCE(ind,       0) AS ind,
    COALESCE(ind_18_24, 0) AS ind_18_24,
    COALESCE(ind_25_39, 0) AS ind_25_39,
    COALESCE(ind_40_54, 0) AS ind_40_54,
    COALESCE(ind_inc,   0) AS ind_inc
  FROM carreaux_filosofi
  WHERE resolution = '200m'
)
SELECT
  CONCAT(gx, '_', gy)::TEXT AS grid_id,
  ST_Transform(
    ST_SetSRID(
      ST_MakeEnvelope(gx * 20000, gy * 20000, (gx + 1) * 20000, (gy + 1) * 20000),
      3035
    ), 4326
  ) AS geom,
  COUNT(*)::int       AS nb_carreaux,
  SUM(ind)::numeric   AS ind,
  SUM(ind_18_24)::numeric AS ind_18_24,
  SUM(ind_25_39)::numeric AS ind_25_39,
  SUM(ind_40_54)::numeric AS ind_40_54,
  SUM(ind_inc)::numeric   AS ind_inc
FROM snap
GROUP BY gx, gy
WITH NO DATA;

CREATE INDEX IF NOT EXISTS idx_carreaux_20km_geom ON carreaux_20km USING GIST (geom);

-- ── RPC : sélection dynamique par zoom + bbox ─────────────────────────────────
DROP FUNCTION IF EXISTS get_carreaux_by_zoom(INT, FLOAT, FLOAT, FLOAT, FLOAT, TEXT, INT);

CREATE OR REPLACE FUNCTION get_carreaux_by_zoom(
  p_zoom      INT,
  p_west      FLOAT,
  p_south     FLOAT,
  p_east      FLOAT,
  p_north     FLOAT,
  p_indicator TEXT DEFAULT 'nb_carreaux',
  p_limit     INT  DEFAULT 5000
)
RETURNS TABLE (
  id           TEXT,
  geojson      TEXT,
  value        FLOAT,
  nb_individus FLOAT,
  nb_carreaux  INT
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_bbox GEOMETRY;
BEGIN
  v_bbox := ST_MakeEnvelope(p_west, p_south, p_east, p_north, 4326);

  -- Zoom ≥ 14 : 200m natifs
  IF p_zoom >= 14 THEN
    RETURN QUERY SELECT
      c.idcar,
      ST_AsGeoJSON(c.geom)::TEXT,
      CASE p_indicator
        WHEN 'ind'       THEN COALESCE(c.ind,       0)::FLOAT
        WHEN 'ind_18_24' THEN COALESCE(c.ind_18_24, 0)::FLOAT
        WHEN 'ind_25_39' THEN COALESCE(c.ind_25_39, 0)::FLOAT
        WHEN 'ind_40_54' THEN COALESCE(c.ind_40_54, 0)::FLOAT
        WHEN 'ind_inc'   THEN COALESCE(c.ind_inc,   0)::FLOAT
        ELSE 1::FLOAT
      END,
      COALESCE(c.ind, 0)::FLOAT,
      1
    FROM carreaux_filosofi c
    WHERE c.geom && v_bbox AND c.resolution = '200m'
    LIMIT p_limit;
    RETURN;
  END IF;

  -- Zoom 11-13 : 1 km
  IF p_zoom >= 11 THEN
    RETURN QUERY SELECT
      c.grid_id,
      ST_AsGeoJSON(c.geom)::TEXT,
      CASE p_indicator
        WHEN 'ind'       THEN c.ind::FLOAT
        WHEN 'ind_18_24' THEN c.ind_18_24::FLOAT
        WHEN 'ind_25_39' THEN c.ind_25_39::FLOAT
        WHEN 'ind_40_54' THEN c.ind_40_54::FLOAT
        WHEN 'ind_inc'   THEN c.ind_inc::FLOAT
        ELSE c.nb_carreaux::FLOAT
      END,
      c.ind::FLOAT,
      c.nb_carreaux
    FROM carreaux_1km c
    WHERE c.geom && v_bbox
    LIMIT p_limit;
    RETURN;
  END IF;

  -- Zoom 8-10 : 2 km
  IF p_zoom >= 8 THEN
    RETURN QUERY SELECT
      c.grid_id,
      ST_AsGeoJSON(c.geom)::TEXT,
      CASE p_indicator
        WHEN 'ind'       THEN c.ind::FLOAT
        WHEN 'ind_18_24' THEN c.ind_18_24::FLOAT
        WHEN 'ind_25_39' THEN c.ind_25_39::FLOAT
        WHEN 'ind_40_54' THEN c.ind_40_54::FLOAT
        WHEN 'ind_inc'   THEN c.ind_inc::FLOAT
        ELSE c.nb_carreaux::FLOAT
      END,
      c.ind::FLOAT,
      c.nb_carreaux
    FROM carreaux_2km c
    WHERE c.geom && v_bbox
    LIMIT p_limit;
    RETURN;
  END IF;

  -- Zoom ≤ 7 : 20 km
  RETURN QUERY SELECT
    c.grid_id,
    ST_AsGeoJSON(c.geom)::TEXT,
    CASE p_indicator
      WHEN 'ind'       THEN c.ind::FLOAT
      WHEN 'ind_18_24' THEN c.ind_18_24::FLOAT
      WHEN 'ind_25_39' THEN c.ind_25_39::FLOAT
      WHEN 'ind_40_54' THEN c.ind_40_54::FLOAT
      WHEN 'ind_inc'   THEN c.ind_inc::FLOAT
      ELSE c.nb_carreaux::FLOAT
    END,
    c.ind::FLOAT,
    c.nb_carreaux
  FROM carreaux_20km c
  WHERE c.geom && v_bbox
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_carreaux_by_zoom TO authenticated, service_role;
GRANT SELECT ON carreaux_1km, carreaux_2km, carreaux_20km TO authenticated, service_role;

-- =============================================================================
-- REFRESH DES VUES (à exécuter dans Supabase Dashboard SQL Editor)
-- Dans cet ordre (20km d'abord = plus rapide, pour valider avant les grandes)
-- =============================================================================
-- REFRESH MATERIALIZED VIEW carreaux_20km;  -- ~30 secondes
-- REFRESH MATERIALIZED VIEW carreaux_2km;   -- ~2 minutes
-- REFRESH MATERIALIZED VIEW carreaux_1km;   -- ~5 minutes
