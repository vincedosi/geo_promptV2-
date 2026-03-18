-- Migration 034 — Peupler les tables pré-agrégées carreaux_2km et carreaux_5km
-- ⚠ LONGUE DURÉE (~5-10 min) — Exécuter dans le SQL Editor du Dashboard Supabase
--   (pas via l'API REST qui a un timeout de 30s)
--
-- Ces tables remplacent l'agrégation live (2-3s/requête) par des requêtes spatiales indexées (<100ms)
-- Prérequis : tables créées par la migration 034c

-- ── 1. Peupler carreaux_5km (zoom 7) — ~17k cellules ─────────────────────────
TRUNCATE carreaux_5km;
INSERT INTO carreaux_5km
SELECT
  'N' || cell_n::text || 'E' || cell_e::text AS id,
  ST_Transform(ST_MakeEnvelope(
    cell_e::float, cell_n::float,
    (cell_e + 5000)::float, (cell_n + 5000)::float, 3035
  ), 4326) AS geom,
  COALESCE(SUM((metadata->>'ind')::numeric),       0),
  COALESCE(SUM((metadata->>'men')::numeric),       0),
  COALESCE(SUM((metadata->>'ind_0_3')::numeric),   0),
  COALESCE(SUM((metadata->>'ind_4_5')::numeric),   0),
  COALESCE(SUM((metadata->>'ind_6_10')::numeric),  0),
  COALESCE(SUM((metadata->>'ind_11_17')::numeric), 0),
  COALESCE(SUM((metadata->>'ind_18_24')::numeric), 0),
  COALESCE(SUM((metadata->>'ind_25_39')::numeric), 0),
  COALESCE(SUM((metadata->>'ind_40_54')::numeric), 0),
  COALESCE(SUM((metadata->>'ind_55_64')::numeric), 0),
  COALESCE(SUM((metadata->>'ind_65_79')::numeric), 0),
  COALESCE(SUM((metadata->>'ind_80p')::numeric),   0),
  COALESCE(SUM((metadata->>'ind_inc')::numeric),   0),
  COALESCE(SUM((metadata->>'ind_snv')::numeric),   0),
  COALESCE(SUM((metadata->>'men_pauv')::numeric),  0),
  COALESCE(SUM((metadata->>'men_1ind')::numeric),  0),
  COALESCE(SUM((metadata->>'men_5ind')::numeric),  0),
  COALESCE(SUM((metadata->>'men_prop')::numeric),  0),
  COALESCE(SUM((metadata->>'men_fmp')::numeric),   0),
  COALESCE(SUM((metadata->>'men_mais')::numeric),  0),
  COALESCE(SUM((metadata->>'men_coll')::numeric),  0),
  COALESCE(SUM((metadata->>'men_surf')::numeric),  0),
  COALESCE(SUM((metadata->>'log_av45')::numeric),  0),
  COALESCE(SUM((metadata->>'log_45_70')::numeric), 0),
  COALESCE(SUM((metadata->>'log_70_90')::numeric), 0),
  COALESCE(SUM((metadata->>'log_ap90')::numeric),  0),
  COALESCE(SUM((metadata->>'log_soc')::numeric),   0),
  COALESCE(SUM((metadata->>'log_inc')::numeric),   0)
FROM (
  SELECT
    (floor((regexp_match(idcar, 'N(\d+)E'))[1]::float / 5000) * 5000)::int AS cell_n,
    (floor((regexp_match(idcar, 'E(\d+)$'))[1]::float / 5000) * 5000)::int AS cell_e,
    metadata
  FROM carreaux_filosofi
  WHERE metadata IS NOT NULL AND idcar ~ 'N\d+E\d+$'
) sub
GROUP BY cell_n, cell_e;

-- ── 2. Peupler carreaux_2km (zoom 8-13) — ~75k cellules ──────────────────────
TRUNCATE carreaux_2km;
INSERT INTO carreaux_2km
SELECT
  'N' || cell_n::text || 'E' || cell_e::text AS id,
  ST_Transform(ST_MakeEnvelope(
    cell_e::float, cell_n::float,
    (cell_e + 2000)::float, (cell_n + 2000)::float, 3035
  ), 4326) AS geom,
  COALESCE(SUM((metadata->>'ind')::numeric),       0),
  COALESCE(SUM((metadata->>'men')::numeric),       0),
  COALESCE(SUM((metadata->>'ind_0_3')::numeric),   0),
  COALESCE(SUM((metadata->>'ind_4_5')::numeric),   0),
  COALESCE(SUM((metadata->>'ind_6_10')::numeric),  0),
  COALESCE(SUM((metadata->>'ind_11_17')::numeric), 0),
  COALESCE(SUM((metadata->>'ind_18_24')::numeric), 0),
  COALESCE(SUM((metadata->>'ind_25_39')::numeric), 0),
  COALESCE(SUM((metadata->>'ind_40_54')::numeric), 0),
  COALESCE(SUM((metadata->>'ind_55_64')::numeric), 0),
  COALESCE(SUM((metadata->>'ind_65_79')::numeric), 0),
  COALESCE(SUM((metadata->>'ind_80p')::numeric),   0),
  COALESCE(SUM((metadata->>'ind_inc')::numeric),   0),
  COALESCE(SUM((metadata->>'ind_snv')::numeric),   0),
  COALESCE(SUM((metadata->>'men_pauv')::numeric),  0),
  COALESCE(SUM((metadata->>'men_1ind')::numeric),  0),
  COALESCE(SUM((metadata->>'men_5ind')::numeric),  0),
  COALESCE(SUM((metadata->>'men_prop')::numeric),  0),
  COALESCE(SUM((metadata->>'men_fmp')::numeric),   0),
  COALESCE(SUM((metadata->>'men_mais')::numeric),  0),
  COALESCE(SUM((metadata->>'men_coll')::numeric),  0),
  COALESCE(SUM((metadata->>'men_surf')::numeric),  0),
  COALESCE(SUM((metadata->>'log_av45')::numeric),  0),
  COALESCE(SUM((metadata->>'log_45_70')::numeric), 0),
  COALESCE(SUM((metadata->>'log_70_90')::numeric), 0),
  COALESCE(SUM((metadata->>'log_ap90')::numeric),  0),
  COALESCE(SUM((metadata->>'log_soc')::numeric),   0),
  COALESCE(SUM((metadata->>'log_inc')::numeric),   0)
FROM (
  SELECT
    (floor((regexp_match(idcar, 'N(\d+)E'))[1]::float / 2000) * 2000)::int AS cell_n,
    (floor((regexp_match(idcar, 'E(\d+)$'))[1]::float / 2000) * 2000)::int AS cell_e,
    metadata
  FROM carreaux_filosofi
  WHERE metadata IS NOT NULL AND idcar ~ 'N\d+E\d+$'
) sub
GROUP BY cell_n, cell_e;

-- Vérification
SELECT 'carreaux_5km' AS table_name, COUNT(*) AS nb_cellules FROM carreaux_5km
UNION ALL
SELECT 'carreaux_2km', COUNT(*) FROM carreaux_2km;
