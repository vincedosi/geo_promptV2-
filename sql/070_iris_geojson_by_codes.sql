-- RPC : retourne les géométries IRIS simplifiées pour une liste de code_iris
-- Utilisée par /api/correlation/residuals-geojson (carte des résidus)

CREATE OR REPLACE FUNCTION get_iris_geojson_by_codes(
  p_codes TEXT[],
  p_simplify_tolerance FLOAT DEFAULT 0.001
)
RETURNS JSON
LANGUAGE sql STABLE AS $$
  SELECT json_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE(json_agg(
      json_build_object(
        'type', 'Feature',
        'properties', json_build_object(
          'code_iris',   i.code_iris,
          'nom_iris',    i.nom_iris,
          'nom_commune', i.nom_commune,
          'code_dept',   i.code_dept
        ),
        'geometry', ST_AsGeoJSON(
          ST_Simplify(i.geom, p_simplify_tolerance)
        )::json
      )
    ), '[]'::json)
  )
  FROM iris i
  WHERE i.code_iris = ANY(p_codes)
    AND i.geom IS NOT NULL;
$$;
