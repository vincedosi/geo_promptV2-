-- 056_filosofi_national_averages.sql
-- Moyennes nationales Filosofi (référence radar clustering)
-- Calcul : python scripts/clustering_poi_filosofi.py --mode compute-france-averages

CREATE TABLE IF NOT EXISTS filosofi_national_averages (
  id           serial      PRIMARY KEY,
  feature_name text        NOT NULL UNIQUE,
  avg_value    numeric,
  std_value    numeric,
  min_value    numeric,
  max_value    numeric,
  n_carreaux   integer,
  computed_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE filosofi_national_averages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin only" ON filosofi_national_averages
  FOR ALL USING (auth.role() = 'service_role');
