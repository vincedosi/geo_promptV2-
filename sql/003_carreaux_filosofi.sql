-- =============================================================================
-- GENESIS — Carreaux Filosofi unifiés
-- Script à exécuter UNE FOIS dans Supabase SQL Editor
-- Remplace : setup_carreaux.sql + 002_get_carreaux_bbox.sql + calculate_target_coverage.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table unifiée carreaux_filosofi
--    Une seule table pour toutes les résolutions (200m, 1km) et millésimes.
--    Les indicateurs sont stockés dans metadata JSONB.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS carreaux_filosofi (
  id         BIGSERIAL PRIMARY KEY,
  idcar      TEXT        NOT NULL,
  resolution TEXT        NOT NULL DEFAULT '200m',   -- '200m' | '1km'
  millesime  TEXT        NOT NULL DEFAULT '2021',   -- '2021', '2017', ...
  geom       GEOMETRY(Polygon, 4326) NOT NULL,
  metadata   JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(idcar, resolution, millesime)
);

-- Index spatial GIST (bbox queries)
CREATE INDEX IF NOT EXISTS idx_carreaux_filosofi_geom
  ON carreaux_filosofi USING GIST(geom);

-- Index composé pour filtres resolution/millesime
CREATE INDEX IF NOT EXISTS idx_carreaux_filosofi_res_mil
  ON carreaux_filosofi(resolution, millesime);

-- Permissions
GRANT SELECT ON carreaux_filosofi TO authenticated;
GRANT ALL    ON carreaux_filosofi TO service_role;
GRANT USAGE, SELECT ON SEQUENCE carreaux_filosofi_id_seq TO service_role;

-- -----------------------------------------------------------------------------
-- 2. RPC : get_carreaux_bbox
--    Requête spatiale rapide par viewport.
--    Accepte resolution + millesime pour filtrer dans la table unifiée.
-- -----------------------------------------------------------------------------

-- Supprimer toutes les versions existantes (signatures différentes)
DROP FUNCTION IF EXISTS get_carreaux_bbox(text, float8, float8, float8, float8, int);
DROP FUNCTION IF EXISTS get_carreaux_bbox(text, float8, float8, float8, float8, int, text, text);

CREATE OR REPLACE FUNCTION get_carreaux_bbox(
  p_table      TEXT,                          -- ignoré, toujours carreaux_filosofi
  p_west       FLOAT8,
  p_south      FLOAT8,
  p_east       FLOAT8,
  p_north      FLOAT8,
  p_limit      INT     DEFAULT 10000,
  p_resolution TEXT    DEFAULT '200m',
  p_millesime  TEXT    DEFAULT '2021'
)
RETURNS TABLE(idcar TEXT, geom GEOMETRY, metadata JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sécurité : valider resolution et millesime (format simple)
  IF NOT (p_resolution ~ '^[0-9]+[a-z]+$') THEN
    RAISE EXCEPTION 'Résolution invalide: %', p_resolution;
  END IF;
  IF NOT (p_millesime ~ '^[0-9]{4}$') THEN
    RAISE EXCEPTION 'Millésime invalide: %', p_millesime;
  END IF;

  RETURN QUERY
    SELECT c.idcar, c.geom, c.metadata
    FROM   carreaux_filosofi c
    WHERE  c.resolution = p_resolution
      AND  c.millesime  = p_millesime
      AND  ST_Intersects(c.geom, ST_MakeEnvelope(p_west, p_south, p_east, p_north, 4326))
    LIMIT  p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_carreaux_bbox TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. RPC : calculate_target_coverage
--    Calcule la couverture démographique dans une zone isochrone.
--    Lit les indicateurs depuis metadata JSONB (ex: metadata->>'ind_18_24').
--    Formule : SUM(valeur * proportion_surface_carreau_dans_zone)
-- -----------------------------------------------------------------------------

-- Supprimer les anciennes signatures avant de créer la nouvelle
DROP FUNCTION IF EXISTS calculate_target_coverage(text, text, text);
DROP FUNCTION IF EXISTS calculate_target_coverage(text, text, text, text, text);

CREATE OR REPLACE FUNCTION calculate_target_coverage(
  isochrone_geojson TEXT,
  target_column     TEXT,
  target_table      TEXT    DEFAULT 'carreaux_filosofi',  -- ignoré, toujours carreaux_filosofi
  p_resolution      TEXT    DEFAULT '200m',
  p_millesime       TEXT    DEFAULT '2021'
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result numeric;
BEGIN
  -- Validation de la clé JSONB (anti-injection)
  IF NOT (target_column ~ '^[a-z][a-z0-9_]{0,50}$') THEN
    RAISE EXCEPTION 'Nom de colonne invalide: %', target_column;
  END IF;
  IF NOT (p_resolution ~ '^[0-9]+[a-z]+$') THEN
    RAISE EXCEPTION 'Résolution invalide: %', p_resolution;
  END IF;
  IF NOT (p_millesime ~ '^[0-9]{4}$') THEN
    RAISE EXCEPTION 'Millésime invalide: %', p_millesime;
  END IF;

  -- Vérifier qu'au moins un carreau a cette clé dans metadata
  IF NOT EXISTS (
    SELECT 1 FROM carreaux_filosofi
    WHERE resolution = p_resolution
      AND millesime  = p_millesime
      AND metadata ? target_column
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Indicateur "%" introuvable dans carreaux_filosofi (%/%).',
      target_column, p_resolution, p_millesime;
  END IF;

  -- Calcul prorata spatial :
  -- Chaque carreau intersecté est pondéré par sa surface dans l'isochrone.
  SELECT COALESCE(
    ROUND(
      SUM(
        (metadata ->> target_column)::numeric
        * (
            ST_Area(ST_Intersection(geom, ST_GeomFromGeoJSON(isochrone_geojson)))
            / NULLIF(ST_Area(geom), 0)
          )
      )
    )::numeric,
    0
  )
  INTO result
  FROM carreaux_filosofi
  WHERE resolution = p_resolution
    AND millesime  = p_millesime
    AND geom IS NOT NULL
    AND (metadata ->> target_column) IS NOT NULL
    AND ST_Intersects(geom, ST_GeomFromGeoJSON(isochrone_geojson));

  RETURN COALESCE(result, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_target_coverage(text, text, text, text, text) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. RPC : create_carreaux_table (rétrocompat — pointe toujours carreaux_filosofi)
--    Le script Python l'appelle avant l'import.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_carreaux_table(table_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Ignoré : la table est désormais toujours carreaux_filosofi (créée ci-dessus)
  RAISE NOTICE 'create_carreaux_table appelé (table cible : carreaux_filosofi)';
END;
$$;

GRANT EXECUTE ON FUNCTION create_carreaux_table TO service_role;

-- -----------------------------------------------------------------------------
-- 5. Nettoyage data_sources : supprimer le fantôme "demographie"
--    et enregistrer carreaux_filosofi correctement.
-- -----------------------------------------------------------------------------

-- Supprimer l'ancienne entrée fantôme
DELETE FROM data_sources
WHERE type = 'carreaux'
  AND geo_config->>'table_name' = 'demographie';

-- Enregistrer carreaux_filosofi (200m / 2021) si pas encore présent
INSERT INTO data_sources (
  name, description, type, category,
  organization_id,
  original_filename, file_format,
  row_count, valid_count, error_count,
  mapping, geo_config, status
)
SELECT
  'Filosofi 2021 — Carreaux 200m',
  'Données socio-démographiques INSEE Filosofi 2021 (résolution 200m × 200m, France métropolitaine)',
  'carreaux', 'carreaux',
  '00000000-0000-0000-0000-000000000001',
  'Filosofi2021_carreaux_200m.zip', 'zip',
  0, 0, 0,
  '{}',
  jsonb_build_object(
    'table_name', 'carreaux_filosofi',
    'resolution', '200m',
    'millesime',  '2021'
  ),
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM data_sources
  WHERE type = 'carreaux'
    AND geo_config->>'table_name' = 'carreaux_filosofi'
    AND geo_config->>'resolution' = '200m'
    AND geo_config->>'millesime'  = '2021'
);

-- -----------------------------------------------------------------------------
-- 6. Vérification finale
-- -----------------------------------------------------------------------------

SELECT id, name, status, valid_count, geo_config
FROM data_sources
WHERE type = 'carreaux'
ORDER BY import_date DESC NULLS LAST;
