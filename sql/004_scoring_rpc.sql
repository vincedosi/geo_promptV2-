-- Fonction RPC pour récupérer les centroïdes + valeurs démographiques des carreaux
-- Utilisée par scorer_panneaux_ooh et classer_panneaux_audience (sans postgresLib)
-- À exécuter dans Supabase Dashboard > SQL Editor

CREATE OR REPLACE FUNCTION get_carreaux_for_scoring(
  p_table    text,
  p_col      text,
  p_west     float8,
  p_south    float8,
  p_east     float8,
  p_north    float8,
  p_millesime text DEFAULT NULL
)
RETURNS TABLE(cx float8, cy float8, val_cible numeric)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_millesime text;
BEGIN
  -- Validate table name
  IF p_table !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table;
  END IF;
  -- Validate column name
  IF p_col !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid column name: %', p_col;
  END IF;

  -- Resolve millesime
  IF p_millesime IS NULL OR p_millesime = '' THEN
    EXECUTE format('SELECT MAX(millesime) FROM public.%I', p_table) INTO v_millesime;
  ELSE
    v_millesime := p_millesime;
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT ST_X(ST_Centroid(geom))::float8 AS cx,
            ST_Y(ST_Centroid(geom))::float8 AS cy,
            (metadata->>$1)::numeric        AS val_cible
     FROM public.%I
     WHERE millesime = $2
       AND geom && ST_MakeEnvelope($3, $4, $5, $6, 4326)
     LIMIT 50000',
    p_table
  ) USING p_col, v_millesime, p_west, p_south, p_east, p_north;
END;
$$;

-- Accès depuis l'API (service role)
GRANT EXECUTE ON FUNCTION get_carreaux_for_scoring TO service_role;
