-- =============================================================================
-- GENESIS — Fonction RPC : get_carreaux_bbox
-- Requête spatiale rapide (utilise l'index GIST sur geom)
-- À exécuter dans Supabase SQL Editor AVANT d'utiliser le chargement par viewport
-- =============================================================================

CREATE OR REPLACE FUNCTION get_carreaux_bbox(
  p_table  TEXT,
  p_west   FLOAT8,
  p_south  FLOAT8,
  p_east   FLOAT8,
  p_north  FLOAT8,
  p_limit  INT DEFAULT 10000
)
RETURNS TABLE(idcar TEXT, geom GEOMETRY, metadata JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Sécurité : valider le nom de table
  IF NOT (p_table ~ '^[a-z0-9_]+$') THEN
    RAISE EXCEPTION 'Nom de table invalide: %', p_table;
  END IF;

  -- Vérifier que la table existe dans data_sources (éviter les scans arbitraires)
  IF NOT EXISTS (
    SELECT 1 FROM data_sources
    WHERE type = 'carreaux'
      AND status = 'active'
      AND geo_config->>'table_name' = p_table
  ) THEN
    RAISE EXCEPTION 'Source carreaux "%" introuvable ou inactive', p_table;
  END IF;

  -- Requête spatiale avec l'index GIST
  RETURN QUERY EXECUTE format(
    'SELECT idcar, geom, metadata
     FROM %I
     WHERE ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))
     LIMIT $5',
    p_table
  ) USING p_west, p_south, p_east, p_north, p_limit;
END;
$$;

-- Accorder l'accès à la fonction pour authenticated + service_role
GRANT EXECUTE ON FUNCTION get_carreaux_bbox TO authenticated;
GRANT EXECUTE ON FUNCTION get_carreaux_bbox TO service_role;
