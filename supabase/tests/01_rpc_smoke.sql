-- ═══════════════════════════════════════════════════════════════════
-- 01_rpc_smoke.sql — Tests de smoke : toutes les RPC critiques existent
-- Exécuter via : supabase test db
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

SELECT plan(12);

-- ── get_isochrone_battle ───────────────────────────────────────────
SELECT has_function(
  'public', 'get_isochrone_battle', ARRAY['jsonb'],
  'get_isochrone_battle(jsonb) existe'
);

SELECT function_returns(
  'public', 'get_isochrone_battle', ARRAY['jsonb'], 'jsonb',
  'get_isochrone_battle retourne jsonb'
);

-- Input vide → retourne tableau JSON vide (pas de crash)
SELECT ok(
  get_isochrone_battle('[]'::jsonb) = '[]'::jsonb,
  'get_isochrone_battle([]) retourne []'
);

-- ── calculate_coverage_per_group ──────────────────────────────────
SELECT has_function(
  'public', 'calculate_coverage_per_group', ARRAY['jsonb', 'text'],
  'calculate_coverage_per_group(jsonb, text) existe'
);

-- Input vide → retourne 0 lignes (pas de crash)
SELECT is(
  (SELECT count(*)::int FROM calculate_coverage_per_group('[]'::jsonb, 'ind')),
  0,
  'calculate_coverage_per_group([]) retourne 0 lignes'
);

-- Groupe sans géométrie valide → retourne 0 (groupe ignoré)
SELECT is(
  (SELECT count(*)::int FROM calculate_coverage_per_group(
    '[{"id": "test_vide", "features": []}]'::jsonb, 'ind'
  )),
  0,
  'calculate_coverage_per_group avec features vides retourne 0 lignes'
);

-- ── compute_coverage_fast ─────────────────────────────────────────
SELECT has_function(
  'public', 'compute_coverage_fast', ARRAY['text', 'text', 'text', 'integer'],
  'compute_coverage_fast(text, text, text, int) existe'
);

SELECT function_returns(
  'public', 'compute_coverage_fast', ARRAY['text', 'text', 'text', 'integer'], 'bigint',
  'compute_coverage_fast retourne bigint'
);

-- Catégorie inconnue → retourne 0 (pas de crash)
SELECT is(
  compute_coverage_fast('__categorie_inexistante__', 'drive', 'ind', NULL),
  0::bigint,
  'compute_coverage_fast avec catégorie inconnue retourne 0'
);

-- ── get_tile_mvt ──────────────────────────────────────────────────
SELECT has_function(
  'public', 'get_tile_mvt', ARRAY['integer', 'integer', 'integer'],
  'get_tile_mvt(int, int, int) existe'
);

-- ── get_table_sizes ───────────────────────────────────────────────
SELECT has_function(
  'public', 'get_table_sizes', ARRAY[]::text[],
  'get_table_sizes() existe'
);

-- get_table_sizes retourne au moins une ligne (au moins la table poi)
SELECT ok(
  (SELECT count(*) FROM get_table_sizes()) > 0,
  'get_table_sizes retourne au moins une ligne'
);

-- ── find_synergy_billboards ───────────────────────────────────────
SELECT has_function(
  'public', 'find_synergy_billboards',
  'find_synergy_billboards existe'
);

SELECT * FROM finish();
ROLLBACK;
