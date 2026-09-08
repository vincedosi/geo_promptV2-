-- =============================================================================
-- ⛔ NE PAS EXECUTER — SCRIPT PERIME ET DESTRUCTEUR (constat 2026-09-08)
--
-- Ce script fait `DROP TABLE ref_codes_postaux CASCADE` puis recree une table
-- dont la STRUCTURE NE CORRESPOND PLUS a celle en production :
--
--   ce script cree      : code_postal, code_dept, nom, geom, nb_iris + colonnes iris
--   la table reelle est : code_postal, nom_principal, nb_communes, code_dept,
--                         geom, geom_simplified, centroid, surface_km2, pop_total
--
-- L'executer casserait toutes les RPC qui lisent `nom_principal`,
-- `geom_simplified`, `centroid`, `surface_km2` ou `pop_total` : suivi de
-- campagne, reconciliation, derive, meteo, zones custom.
--
-- POUR REGENERER LE REFERENTIEL, utiliser la fonction officielle :
--     SELECT build_ref_codes_postaux();
-- Elle lit `laposte_hexasmal` si peuplee, sinon `postal_code_commune`, et
-- refuse de tronquer si la reconstruction serait vide (migrations 119 + 120).
--
-- Conserve uniquement comme trace de l'ancienne structure agregee depuis iris.
-- =============================================================================

-- regenerate_ref_codes_postaux.sql (ANCIEN — voir avertissement ci-dessus)
--
-- Régénère la table ref_codes_postaux depuis les colonnes numériques de iris.
-- À relancer si on ajoute des colonnes à la table iris.
--
-- Logique d'agrégation :
--   SUM : population, pop_*, nb_* (comptages)
--   AVG pondéré par population : rev_*, taux_*, part_*, indice_*, densite_*
--   SKIP : centroid_lat, centroid_lng
--
-- Usage : exécuter via Supabase MCP execute_sql ou Dashboard SQL Editor
-- =============================================================================

DO $$
DECLARE
  col RECORD;
  create_cols TEXT := '';
  insert_cols TEXT := '';
  select_cols TEXT := '';
  skip_cols TEXT[] := ARRAY['centroid_lat', 'centroid_lng'];
  is_sum BOOLEAN;
BEGIN
  FOR col IN
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'iris' AND table_schema = 'public'
      AND data_type IN ('integer','bigint','numeric','real','double precision')
      AND column_name NOT IN ('code_iris','code_commune','code_dept','code_region','gid')
    ORDER BY ordinal_position
  LOOP
    IF col.column_name = ANY(skip_cols) THEN CONTINUE; END IF;

    is_sum := col.column_name = 'population'
      OR col.column_name LIKE 'pop\_%'
      OR col.column_name LIKE 'nb\_%';

    IF col.data_type = 'integer' OR col.data_type = 'bigint' THEN
      create_cols := create_cols || ', ' || quote_ident(col.column_name) || ' INTEGER';
    ELSE
      create_cols := create_cols || ', ' || quote_ident(col.column_name) || ' DOUBLE PRECISION';
    END IF;

    insert_cols := insert_cols || ', ' || quote_ident(col.column_name);

    IF is_sum THEN
      select_cols := select_cols || ', SUM(i.' || quote_ident(col.column_name) || ')';
    ELSE
      select_cols := select_cols
        || ', CASE WHEN SUM(i.population) > 0 THEN ROUND((SUM(i.'
        || quote_ident(col.column_name)
        || '::numeric * COALESCE(i.population, 0)) / SUM(i.population))::numeric, 4)::double precision ELSE NULL END';
    END IF;
  END LOOP;

  DROP TABLE IF EXISTS ref_codes_postaux CASCADE;

  EXECUTE 'CREATE TABLE ref_codes_postaux (
    code_postal TEXT PRIMARY KEY,
    code_dept TEXT NOT NULL,
    nom TEXT,
    geom GEOMETRY,
    nb_iris INTEGER'
    || create_cols || ')';

  EXECUTE 'INSERT INTO ref_codes_postaux (code_postal, code_dept, nom, geom, nb_iris' || insert_cols || ')
    SELECT
      pc.code_postal,
      CASE WHEN pc.code_postal LIKE ''97%'' THEN SUBSTRING(pc.code_postal, 1, 3)
           WHEN pc.code_postal LIKE ''20%'' THEN
             CASE WHEN pc.code_postal <= ''20190'' THEN ''2A'' ELSE ''2B'' END
           ELSE SUBSTRING(pc.code_postal, 1, 2) END as code_dept,
      MAX(pc.nom_commune) as nom,
      ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(i.geom)), 3)) as geom,
      COUNT(DISTINCT i.code_iris)::integer as nb_iris'
      || select_cols || '
    FROM postal_code_commune pc
    JOIN iris i ON i.code_commune = pc.code_commune
    WHERE i.geom IS NOT NULL AND i.population > 0
    GROUP BY pc.code_postal';

  RAISE NOTICE 'ref_codes_postaux regenerated with % columns', (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = 'ref_codes_postaux' AND table_schema = 'public'
  );
END;
$$;

CREATE INDEX IF NOT EXISTS idx_ref_cp_geom ON ref_codes_postaux USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_ref_cp_dept ON ref_codes_postaux(code_dept);
GRANT SELECT ON ref_codes_postaux TO authenticated, anon;
