-- =============================================================================
-- GENESIS — Vue carreaux_filosofi → table existante (ex: carreaux_200m_met)
-- Crée un alias compatible avec calculate_target_coverage + get_carreaux_bbox
-- sans réimporter les données.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Étape 1 : Identifier la vraie table (exécuter d'abord pour vérifier)
-- -----------------------------------------------------------------------------

SELECT
  t.table_name,
  ds.name             AS ds_name,
  ds.geo_config->>'table_name' AS ds_table,
  ds.valid_count
FROM information_schema.tables t
LEFT JOIN data_sources ds
  ON ds.type = 'carreaux'
  AND ds.geo_config->>'table_name' = t.table_name
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND t.table_name LIKE 'carreaux%'
ORDER BY t.table_name;

-- -----------------------------------------------------------------------------
-- Étape 2 : Créer la vue
-- Remplacer 'carreaux_200m_met' par le vrai nom si différent.
-- La vue ajoute les colonnes resolution + millesime manquantes dans l'ancienne table.
-- -----------------------------------------------------------------------------

DROP VIEW IF EXISTS carreaux_filosofi;

CREATE VIEW carreaux_filosofi AS
SELECT
  idcar,
  '200m'::text  AS resolution,
  '2021'::text  AS millesime,
  geom,
  metadata,
  created_at
FROM carreaux_200m_met;   -- ← adapter si le nom est différent

-- Permissions
GRANT SELECT ON carreaux_filosofi TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Étape 3 : Créer/remplacer calculate_target_coverage
-- Version compatible VIEW (pas de filtre resolution/millesime si la vue les fixe)
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS calculate_target_coverage(text, text, text);
DROP FUNCTION IF EXISTS calculate_target_coverage(text, text, text, text, text);

CREATE OR REPLACE FUNCTION calculate_target_coverage(
  isochrone_geojson TEXT,
  target_column     TEXT,
  target_table      TEXT    DEFAULT 'carreaux_filosofi',
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
  IF NOT (target_column ~ '^[a-z][a-z0-9_]{0,50}$') THEN
    RAISE EXCEPTION 'Nom de colonne invalide: %', target_column;
  END IF;

  -- Vérifier que l'indicateur existe dans la vue/table
  IF NOT EXISTS (
    SELECT 1 FROM carreaux_filosofi
    WHERE metadata ? target_column
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Indicateur "%" introuvable dans carreaux_filosofi.', target_column;
  END IF;

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
  WHERE geom IS NOT NULL
    AND (metadata ->> target_column) IS NOT NULL
    AND ST_Intersects(geom, ST_GeomFromGeoJSON(isochrone_geojson));

  RETURN COALESCE(result, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_target_coverage(text, text, text, text, text)
  TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Vérification : la vue retourne bien des données avec l'indicateur cible
-- -----------------------------------------------------------------------------

SELECT
  COUNT(*)                                              AS total_carreaux,
  COUNT(*) FILTER (WHERE metadata ? 'ind_18_24')        AS avec_ind_18_24,
  COUNT(*) FILTER (WHERE metadata ? 'ind')              AS avec_ind_population,
  COUNT(*) FILTER (WHERE metadata ? 'rev_median')       AS avec_rev_median
FROM carreaux_filosofi;
