-- ═══════════════════════════════════════════════════════════════════════════
-- 013_calculation_jobs.sql
-- Moteur de Couverture d'Audience Asynchrone — Genesis V2
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. ENUM status
DO $$ BEGIN
  CREATE TYPE job_status AS ENUM ('pending', 'processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Table des jobs
CREATE TABLE IF NOT EXISTS calculation_jobs (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  target_column       TEXT         NOT NULL DEFAULT 'ind',
  poi_count           INT          NOT NULL DEFAULT 0,
  isochrone_duration  INT          NOT NULL DEFAULT 30,   -- minutes
  mode                TEXT         NOT NULL DEFAULT 'drive',
  status              job_status   NOT NULL DEFAULT 'pending',
  progress            INT          NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  result              NUMERIC,
  error_message       TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 3. Trigger updated_at automatique
CREATE OR REPLACE FUNCTION fn_update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_calculation_jobs_updated_at ON calculation_jobs;
CREATE TRIGGER trg_calculation_jobs_updated_at
  BEFORE UPDATE ON calculation_jobs
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- 4. Row Level Security
ALTER TABLE calculation_jobs ENABLE ROW LEVEL SECURITY;

-- Service role (worker Inngest) : accès total
CREATE POLICY "service_role_all" ON calculation_jobs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Utilisateurs authentifiés : voient leurs propres jobs
CREATE POLICY "auth_select_own" ON calculation_jobs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Utilisateurs authentifiés : créent leurs propres jobs
CREATE POLICY "auth_insert_own" ON calculation_jobs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 5. Activer Realtime sur la table
ALTER PUBLICATION supabase_realtime ADD TABLE calculation_jobs;

-- 6. RPC PostGIS : couverture dédupliquée
-- Prend un tableau de géométries GeoJSON (polygon strings),
-- les union-ise, et somme la colonne cible dans carreaux_filosofi.
-- Supprimer toutes les versions existantes de la fonction (signatures multiples)
DROP FUNCTION IF EXISTS calculate_network_coverage(TEXT[], TEXT);
DROP FUNCTION IF EXISTS calculate_network_coverage(GEOMETRY[], TEXT);
DROP FUNCTION IF EXISTS calculate_network_coverage(TEXT);
DROP FUNCTION IF EXISTS calculate_network_coverage();

CREATE OR REPLACE FUNCTION calculate_network_coverage(
  p_geometries      TEXT[],
  p_column          TEXT DEFAULT 'ind'
)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_union   GEOMETRY;
  v_result  NUMERIC;
  v_sql     TEXT;
BEGIN
  -- Union de tous les isochrones → zone totale dédupliquée
  SELECT ST_Union(ST_GeomFromGeoJSON(g))
  INTO v_union
  FROM unnest(p_geometries) AS g
  WHERE g IS NOT NULL AND g <> '';

  IF v_union IS NULL THEN
    RETURN 0;
  END IF;

  -- Transformer en SRID 4326 si besoin
  IF ST_SRID(v_union) = 0 THEN
    v_union := ST_SetSRID(v_union, 4326);
  END IF;

  -- Somme de la population dans la zone (carreaux_filosofi)
  v_sql := format(
    'SELECT COALESCE(SUM(%I::NUMERIC), 0)
     FROM carreaux_filosofi
     WHERE ST_Within(geom, $1)',
    p_column
  );
  EXECUTE v_sql INTO v_result USING v_union;

  RETURN COALESCE(v_result, 0);
END;
$$;

COMMENT ON TABLE  calculation_jobs IS 'Jobs de calcul de couverture audience — Genesis V2';
COMMENT ON FUNCTION calculate_network_coverage IS
  'Union des isochrones ORS → somme dédupliquée de la colonne Filosofi cible';
