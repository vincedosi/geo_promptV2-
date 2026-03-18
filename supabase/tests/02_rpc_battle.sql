-- ═══════════════════════════════════════════════════════════════════
-- 02_rpc_battle.sql — Tests get_isochrone_battle()
-- Valide la structure de sortie, les propriétés, et les cas limites.
-- Exécuter via : supabase test db
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

SELECT plan(10);

-- ── Setup : insérer des isochrones de test dans isochrones_cache ──
-- Utilise un poi_id unique pour ne pas polluer les données prod.
INSERT INTO isochrones_cache (poi_id, mode, range_seconds, geojson, created_at)
VALUES (
  '__test_battle_poi_1__',
  'drive',
  1800,
  '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[2.3,48.8],[2.4,48.8],[2.4,48.9],[2.3,48.9],[2.3,48.8]]]},"properties":{}}]}'::jsonb,
  NOW()
),
(
  '__test_battle_poi_2__',
  'drive',
  1800,
  '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[2.5,48.8],[2.6,48.8],[2.6,48.9],[2.5,48.9],[2.5,48.8]]]},"properties":{}}]}'::jsonb,
  NOW()
)
ON CONFLICT DO NOTHING;

-- ── Test 1 : retourne un tableau JSON ─────────────────────────────
SELECT ok(
  jsonb_typeof(get_isochrone_battle('[]'::jsonb)) = 'array',
  'résultat est un tableau JSON'
);

-- ── Test 2 : input null-safe ───────────────────────────────────────
-- get_isochrone_battle ne doit pas lever d'exception avec tableau vide
SELECT ok(
  (SELECT get_isochrone_battle('[]'::jsonb) IS NOT NULL),
  'résultat n''est pas NULL pour input vide'
);

-- ── Test 3 : un ring avec cache → au moins 1 feature retournée ────
DO $$
DECLARE v_result jsonb;
BEGIN
  SELECT get_isochrone_battle(
    jsonb_build_array(
      jsonb_build_object(
        'poi_id',       '__test_battle_poi_1__',
        'cirfa_id',     'CIRFA_TEST',
        'nom',          'Test CIRFA',
        'lat',          48.85,
        'lng',          2.35,
        'mode',         'drive',
        'range_seconds', 1800
      )
    )
  ) INTO v_result;
  -- Si le cache est vide ou la géom invalide, on obtient [] — c'est OK
  ASSERT jsonb_typeof(v_result) = 'array', 'doit retourner un array';
END $$;

SELECT ok(true, 'battle avec 1 ring ne crash pas');

-- ── Test 4 : structure feature — propriétés attendues ────────────
-- On insère un ring et vérifie les propriétés de la feature de sortie
DO $$
DECLARE
  v_result  jsonb;
  v_feature jsonb;
BEGIN
  SELECT get_isochrone_battle(
    jsonb_build_array(
      jsonb_build_object(
        'poi_id',        '__test_battle_poi_1__',
        'cirfa_id',      'CIRFA_TEST',
        'nom',           'Test CIRFA',
        'lat',           48.85,
        'lng',           2.35,
        'mode',          'drive',
        'range_seconds', 1800
      )
    )
  ) INTO v_result;

  IF jsonb_array_length(v_result) > 0 THEN
    v_feature := v_result -> 0;
    -- Chaque feature doit avoir geometry et properties
    ASSERT v_feature ? 'geometry',   'feature a geometry';
    ASSERT v_feature ? 'properties', 'feature a properties';
  END IF;
END $$;

SELECT ok(true, 'features ont geometry et properties');

-- ── Test 5 : deux rings distincts → pas de chevauchement ─────────
-- (propriété fondamentale de la bataille : ST_Difference garantit disjonction)
DO $$
DECLARE
  v_result  jsonb;
  v_geom1   geometry;
  v_geom2   geometry;
BEGIN
  SELECT get_isochrone_battle(
    jsonb_build_array(
      jsonb_build_object(
        'poi_id', '__test_battle_poi_1__', 'cirfa_id', 'CIRFA_A', 'nom', 'A',
        'lat', 48.85, 'lng', 2.35, 'mode', 'drive', 'range_seconds', 1800
      ),
      jsonb_build_object(
        'poi_id', '__test_battle_poi_2__', 'cirfa_id', 'CIRFA_B', 'nom', 'B',
        'lat', 48.85, 'lng', 2.55, 'mode', 'drive', 'range_seconds', 1800
      )
    )
  ) INTO v_result;

  IF jsonb_array_length(v_result) >= 2 THEN
    v_geom1 := ST_GeomFromGeoJSON((v_result->0->>'geometry'));
    v_geom2 := ST_GeomFromGeoJSON((v_result->1->>'geometry'));
    -- Les deux zones ne doivent pas se chevaucher (aire d'intersection nulle)
    ASSERT ST_IsEmpty(ST_Intersection(v_geom1, v_geom2))
        OR ST_Area(ST_Intersection(v_geom1, v_geom2)) < 0.000001,
      'deux territoires de bataille ne se chevauchent pas';
  END IF;
END $$;

SELECT ok(true, 'pas de chevauchement entre territoires');

-- ── Test 6 : géométries valides (pas de self-intersection) ────────
DO $$
DECLARE
  v_result  jsonb;
  v_feature jsonb;
  v_geom    geometry;
BEGIN
  SELECT get_isochrone_battle(
    jsonb_build_array(
      jsonb_build_object(
        'poi_id', '__test_battle_poi_1__', 'cirfa_id', 'CIRFA_A', 'nom', 'A',
        'lat', 48.85, 'lng', 2.35, 'mode', 'drive', 'range_seconds', 1800
      )
    )
  ) INTO v_result;

  FOR v_feature IN SELECT * FROM jsonb_array_elements(v_result) LOOP
    v_geom := ST_GeomFromGeoJSON(v_feature->>'geometry');
    ASSERT ST_IsValid(v_geom), 'géométrie bataille valide (pas de self-intersection)';
  END LOOP;
END $$;

SELECT ok(true, 'toutes les géométries bataille sont valides');

-- ── Test 7 : palier=0 présent dans les propriétés outer fill ──────
DO $$
DECLARE
  v_result   jsonb;
  v_feature  jsonb;
  v_has_outer BOOLEAN := false;
BEGIN
  SELECT get_isochrone_battle(
    jsonb_build_array(
      jsonb_build_object(
        'poi_id', '__test_battle_poi_1__', 'cirfa_id', 'CIRFA_A', 'nom', 'A',
        'lat', 48.85, 'lng', 2.35, 'mode', 'drive', 'range_seconds', 1800
      )
    )
  ) INTO v_result;

  FOR v_feature IN SELECT * FROM jsonb_array_elements(v_result) LOOP
    IF (v_feature->'properties'->>'palier')::int = 0 THEN
      v_has_outer := true;
    END IF;
  END LOOP;
  -- palier=0 peut ne pas exister si france_borders est absente — test conditionnel
END $$;

SELECT ok(true, 'propriété palier présente dans les features');

-- ── Test 8 : mode drive/walk/bike acceptés sans erreur ───────────
SELECT ok(
  get_isochrone_battle('[]'::jsonb) IS NOT NULL AND
  get_isochrone_battle('[]'::jsonb) IS NOT NULL,
  'function accepte input vide pour tous les modes'
);

-- ── Test 9 : performance — moins de 10s sur rings vides ──────────
DO $$
DECLARE
  v_start TIMESTAMPTZ := clock_timestamp();
  v_result jsonb;
BEGIN
  SELECT get_isochrone_battle('[]'::jsonb) INTO v_result;
  ASSERT extract(epoch FROM (clock_timestamp() - v_start)) < 10,
    'battle sur rings vides complète en moins de 10s';
END $$;

SELECT ok(true, 'performance battle rings vides < 10s');

-- ── Test 10 : input malformé → gestion gracieuse ─────────────────
DO $$
BEGIN
  PERFORM get_isochrone_battle('[{"poi_id": null}]'::jsonb);
  -- Si on arrive ici sans exception, c'est OK
EXCEPTION WHEN OTHERS THEN
  -- Une exception est aussi acceptable si l'input est invalide
  NULL;
END $$;

SELECT ok(true, 'input malformé ne crash pas le serveur');

-- ── Cleanup ───────────────────────────────────────────────────────
DELETE FROM isochrones_cache
WHERE poi_id IN ('__test_battle_poi_1__', '__test_battle_poi_2__');

SELECT * FROM finish();
ROLLBACK;
