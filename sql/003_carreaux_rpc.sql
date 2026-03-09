-- Fonction RPC pour récupérer les carreaux INSEE Filosofi dans une bbox
-- À exécuter dans Supabase Dashboard > SQL Editor

CREATE OR REPLACE FUNCTION get_carreaux(
  p_table    text,
  p_west     float8,
  p_south    float8,
  p_east     float8,
  p_north    float8,
  p_millesime text DEFAULT NULL
)
RETURNS TABLE(geometry json, metadata jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_millesime text;
BEGIN
  -- Validate table name (alphanumeric + underscore only)
  IF p_table !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table;
  END IF;

  -- Resolve millesime
  IF p_millesime IS NULL OR p_millesime = '' THEN
    EXECUTE format('SELECT MAX(millesime) FROM public.%I', p_table) INTO v_millesime;
  ELSE
    v_millesime := p_millesime;
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT ST_AsGeoJSON(geom)::json AS geometry, metadata
     FROM public.%I
     WHERE millesime = $1
       AND geom && ST_MakeEnvelope($2, $3, $4, $5, 4326)
     LIMIT 50000',
    p_table
  ) USING v_millesime, p_west, p_south, p_east, p_north;
END;
$$;

-- Accès depuis l'API (service role)
GRANT EXECUTE ON FUNCTION get_carreaux TO service_role;
