-- =============================================================================
-- OPTIMISATION: Nouvelle fonction MVT avec filtrage par zoom et limites adaptatives
-- =============================================================================

-- Supprimer l'ancienne fonction si elle existe
DROP FUNCTION IF EXISTS get_tile_mvt_optimized(INTEGER, INTEGER, INTEGER, INTEGER);

-- Nouvelle fonction optimisée avec:
-- - Filtrage par niveau de zoom (resolution可根据 zoom选择)
-- - Limite adaptative
-- - Meilleure utilise de l'index spatial
CREATE OR REPLACE FUNCTION get_tile_mvt_optimized(
  p_zoom INTEGER, 
  p_x INTEGER, 
  p_y INTEGER,
  p_limit INTEGER DEFAULT 1000
)
RETURNS TABLE(mvt BYTEA)
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
  v_bounds BOX2D;
  v_mvt BYTEA;
  v_resolutions TEXT[];
BEGIN
  -- Determiner les resolutions a afficher selon le zoom
  -- z < 10: pas de carreaux (geree cote API)
  -- z = 10-11: carreaux 1km uniquement
  -- z = 12-14: carreaux 200m
  IF p_zoom <= 11 THEN
    v_resolutions := ARRAY['1km', '1km'];
  ELSE
    v_resolutions := ARRAY['200m', '1km'];
  END IF;
  
  v_bounds := ST_TileEnvelope(p_zoom, p_x, p_y);
  
  -- Requete optimisée avec index spatial
  -- Utilise && pour l'intersection geometrique rapide
  SELECT INTO v_mvt ST_AsMVT(
    ST_AsMVTGeom(geom, v_bounds, 4096, 0, true),
    'carreaux', 4096, 'geom'
  )
  FROM carreaux_filosofi
  WHERE geom && v_bounds
    AND resolution = ANY(v_resolutions)
  ORDER BY 
    CASE resolution 
      WHEN '200m' THEN 1 
      WHEN '1km' THEN 2 
    END
  LIMIT p_limit;
  
  RETURN QUERY SELECT v_mvt;
END;
$$;

-- Creer un index spatial si pas deja present (pour les performances)
-- Cet index accelere les requetes && (intersection)
CREATE INDEX IF NOT EXISTS idx_carreaux_filosofi_geom 
ON carreaux_filosofi USING GIST (geom);

-- Ajouter un index sur resolution pour accelerer le filtrage
CREATE INDEX IF NOT EXISTS idx_carreaux_filosofi_resolution 
ON carreaux_filosofi (resolution);

-- Index compose pour les requetes frequemment utilisees
CREATE INDEX IF NOT EXISTS idx_carreaux_filosofi_geom_resolution 
ON carreaux_filosofi USING GIST (geom) INCLUDE (resolution);

GRANT EXECUTE ON FUNCTION get_tile_mvt_optimized TO authenticated, service_role;

-- Commentaire pour documenter
COMMENT ON FUNCTION get_tile_mvt_optimized IS 
'Fonction MVT optimisée pour les carreaux Filosofi.
Parametres:
- p_zoom: Niveau de zoom (determine la resolution des carreaux)
- p_x: Coordonnee X de la tuile
- p_y: Coordonnee Y de la tuile
- p_limit: Nombre maximum de carreaux (default 1000)
';
