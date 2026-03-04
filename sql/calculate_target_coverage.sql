-- calculate_target_coverage
-- Calcule la couverture d'une cible démographique dans une zone isochrone.
-- Formule : SUM(colonne * proportion_surface_carreau_dans_zone)
--
-- Paramètres :
--   isochrone_geojson : géométrie isochrone au format GeoJSON (texte)
--   target_column     : colonne à agréger (ex: ind_18_24, ind, rev_median)
--   target_table      : table carreaux source (défaut: carreaux_filosofi)
--
-- Exemple :
--   SELECT calculate_target_coverage(
--     '{"type":"Polygon","coordinates":[[...]]}',
--     'ind_18_24'
--   );

CREATE OR REPLACE FUNCTION calculate_target_coverage(
  isochrone_geojson text,
  target_column     text,
  target_table      text DEFAULT 'carreaux_filosofi'
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result numeric;
BEGIN
  -- Validation table (anti-injection)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = target_table
  ) THEN
    RAISE EXCEPTION 'Table "%"  introuvable dans le schéma public', target_table;
  END IF;

  -- Validation colonne (anti-injection)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = target_table
      AND column_name  = target_column
  ) THEN
    RAISE EXCEPTION 'Colonne "%" introuvable dans la table "%"', target_column, target_table;
  END IF;

  -- Calcul prorata spatial :
  -- Chaque carreau intersecté est pondéré par sa surface dans l'isochrone.
  EXECUTE format(
    $q$
      SELECT COALESCE(
        ROUND(
          SUM(
            %I::numeric
            * (
                ST_Area(ST_Intersection(geom, ST_GeomFromGeoJSON(%L)))
                / NULLIF(ST_Area(geom), 0)
              )
          )
        )::numeric,
        0
      )
      FROM %I
      WHERE geom IS NOT NULL
        AND ST_Intersects(geom, ST_GeomFromGeoJSON(%L))
    $q$,
    target_column,
    isochrone_geojson,
    target_table,
    isochrone_geojson
  ) INTO result;

  RETURN COALESCE(result, 0);
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION calculate_target_coverage(text, text, text) TO anon, authenticated, service_role;
