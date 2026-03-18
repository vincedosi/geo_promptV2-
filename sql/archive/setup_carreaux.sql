-- =============================================================================
-- GEO.Prompt — Setup fonctions carreaux
-- À exécuter dans l'éditeur SQL Supabase (dashboard > SQL Editor)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Fonction RPC : create_carreaux_table(table_name TEXT)
--    Crée une table carreaux dynamique avec idcar + geom PostGIS + metadata JSONB
--    Appelée par le script Python carreaux_import.py
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_carreaux_table(table_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Valider le nom de table (sécurité : alphanum + underscore)
  IF NOT (table_name ~ '^[a-z0-9_]+$') THEN
    RAISE EXCEPTION 'Nom de table invalide: %', table_name;
  END IF;

  -- Créer la table si elle n'existe pas
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I (
      idcar    TEXT PRIMARY KEY,
      geom     GEOMETRY(Polygon, 4326) NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )', table_name);

  -- Index spatial GIST
  EXECUTE format('
    CREATE INDEX IF NOT EXISTS %I ON %I USING GIST(geom)',
    'idx_' || table_name || '_geom', table_name);

  -- Accès lecture pour service_role (déjà implicite) + anon/authenticated si besoin
  -- Note: RLS non activée sur ces tables dynamiques (service_role bypass)
  EXECUTE format('GRANT SELECT ON %I TO authenticated', table_name);

  RAISE NOTICE 'Table "%" créée/vérifiée avec succès', table_name;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Diagnostic : lister les tables carreaux existantes
--    (même si elles ne sont pas encore dans data_sources)
-- -----------------------------------------------------------------------------

SELECT
  t.table_name,
  ds.id AS data_source_id,
  ds.status,
  ds.valid_count,
  ds.geo_config->>'table_name' AS ds_table_name
FROM information_schema.tables t
LEFT JOIN data_sources ds
  ON ds.type = 'carreaux'
  AND ds.geo_config->>'table_name' = t.table_name
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND t.table_name LIKE 'carreaux%'
ORDER BY t.table_name;

-- -----------------------------------------------------------------------------
-- 3. Réparation : enregistrer une table carreaux manquante dans data_sources
--    Remplacer 'carreaux_xxx' par le vrai nom de la table
-- -----------------------------------------------------------------------------

-- ⚠️ ADAPTER le nom de table avant d'exécuter !
DO $$
DECLARE
  v_table_name TEXT := 'carreaux_200m_xxx';  -- ← REMPLACER ici
  v_count      BIGINT;
  v_exists     BOOLEAN;
BEGIN
  -- Vérifier si déjà enregistrée
  SELECT EXISTS(
    SELECT 1 FROM data_sources
    WHERE type = 'carreaux'
    AND geo_config->>'table_name' = v_table_name
    AND status = 'active'
  ) INTO v_exists;

  IF v_exists THEN
    RAISE NOTICE 'Table "%" déjà enregistrée dans data_sources', v_table_name;
    RETURN;
  END IF;

  -- Compter les lignes
  EXECUTE format('SELECT COUNT(*) FROM %I', v_table_name) INTO v_count;

  -- Insérer dans data_sources
  INSERT INTO data_sources (
    name, type, category, organization_id,
    original_filename, file_format,
    row_count, valid_count, error_count,
    mapping, geo_config, status
  ) VALUES (
    replace(v_table_name, '_', ' '),
    'carreaux',
    'carreaux',
    '00000000-0000-0000-0000-000000000001',
    v_table_name || '.table',
    'supabase_table',
    v_count, v_count, 0,
    '{}',
    jsonb_build_object('table_name', v_table_name),
    'active'
  );

  RAISE NOTICE 'Table "%" enregistrée dans data_sources (% lignes)', v_table_name, v_count;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Vérification finale
-- -----------------------------------------------------------------------------

SELECT id, name, type, status, valid_count, geo_config
FROM data_sources
WHERE type = 'carreaux'
ORDER BY import_date DESC;
