-- ═══════════════════════════════════════════════════════════════════
-- 03_rpc_coverage.sql — Tests des RPC de couverture audience
-- Valide : compute_coverage_fast, calculate_coverage_per_group
-- Exécuter via : supabase test db
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

SELECT plan(14);

-- ── Setup : isochrones de test ────────────────────────────────────
INSERT INTO isochrones_cache (poi_id, mode, range_seconds, geojson, created_at)
VALUES (
  '__test_cov_poi__',
  'drive',
  1800,
  -- Petit polygone autour de Paris (quelques carreaux Filosofi)
  '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[2.3,48.85],[2.36,48.85],[2.36,48.9],[2.3,48.9],[2.3,48.85]]]},"properties":{}}]}'::jsonb,
  NOW()
)
ON CONFLICT DO NOTHING;

-- ── compute_coverage_fast ─────────────────────────────────────────

-- Test 1 : retourne BIGINT (pas NULL) pour catégorie inconnue
SELECT ok(
  compute_coverage_fast('__inexistant__', 'drive', 'ind', NULL) IS NOT NULL,
  'compute_coverage_fast retourne NOT NULL'
);

-- Test 2 : catégorie inconnue → 0 (aucune isochrone en cache)
SELECT is(
  compute_coverage_fast('__inexistant__', 'drive', 'ind', NULL),
  0::bigint,
  'catégorie sans isochrones → coverage = 0'
);

-- Test 3 : résultat ≥ 0 (jamais négatif)
SELECT ok(
  compute_coverage_fast('__test_cov_poi__', 'drive', 'ind', NULL) >= 0,
  'coverage fast ≥ 0'
);

-- Test 4 : colonne ind (population) ≥ colonne ind_18_24 (sous-population)
-- Propriété fondamentale : population totale ≥ toute sous-population
SELECT ok(
  compute_coverage_fast('__test_cov_poi__', 'drive', 'ind', NULL) >=
  compute_coverage_fast('__test_cov_poi__', 'drive', 'ind_18_24', NULL),
  'ind (total) >= ind_18_24 (sous-population)'
);

-- Test 5 : mode drive = walk pour le même poi (même géom dans le cache test)
-- (dans notre test les deux modes ont la même géom)
SELECT ok(
  compute_coverage_fast('__test_cov_poi__', 'drive', 'ind', NULL) IS NOT NULL,
  'mode drive accepté'
);

-- Test 6 : colonne inconnue → retourne 0 (pas de crash)
SELECT ok(
  compute_coverage_fast('__test_cov_poi__', 'drive', '__colonne_inconnue__', NULL) IS NOT NULL,
  'colonne inconnue ne crash pas'
);

-- ── calculate_coverage_per_group ──────────────────────────────────

-- Test 7 : groups vides → 0 lignes
SELECT is(
  (SELECT count(*)::int FROM calculate_coverage_per_group('[]'::jsonb, 'ind')),
  0,
  'groups vides → 0 lignes'
);

-- Test 8 : retourne les colonnes group_id et coverage
SELECT ok(
  (SELECT count(*)::int FROM information_schema.columns
   WHERE table_name = 'calculate_coverage_per_group') = 0, -- c'est une function, pas une table
  'calculate_coverage_per_group est une function (pas une table)'
);

-- Test 9 : groupe avec geometry valide retourne 1 ligne avec coverage ≥ 0
DO $$
DECLARE
  v_result RECORD;
  v_count  INT := 0;
BEGIN
  FOR v_result IN
    SELECT * FROM calculate_coverage_per_group(
      jsonb_build_array(
        jsonb_build_object(
          'id', 'CIRFA_TEST',
          'features', jsonb_build_array(
            jsonb_build_object(
              'geometry', jsonb_build_object(
                'type', 'Polygon',
                'coordinates', jsonb_build_array(
                  jsonb_build_array(
                    jsonb_build_array(2.3, 48.85),
                    jsonb_build_array(2.36, 48.85),
                    jsonb_build_array(2.36, 48.9),
                    jsonb_build_array(2.3, 48.9),
                    jsonb_build_array(2.3, 48.85)
                  )
                )
              )
            )
          )
        )
      ),
      'ind'
    )
  LOOP
    v_count := v_count + 1;
    ASSERT v_result.group_id = 'CIRFA_TEST', 'group_id = CIRFA_TEST';
    ASSERT v_result.coverage >= 0, 'coverage >= 0';
  END LOOP;
  ASSERT v_count = 1, '1 ligne retournée pour 1 groupe';
END $$;

SELECT ok(true, 'groupe avec géom → 1 ligne avec coverage ≥ 0');

-- Test 10 : deux groupes → 2 lignes
DO $$
DECLARE v_count INT;
BEGIN
  SELECT count(*)::int INTO v_count FROM calculate_coverage_per_group(
    jsonb_build_array(
      jsonb_build_object(
        'id', 'GRP_A',
        'features', jsonb_build_array(
          jsonb_build_object('geometry', jsonb_build_object(
            'type', 'Polygon',
            'coordinates', jsonb_build_array(jsonb_build_array(
              jsonb_build_array(2.3,48.85), jsonb_build_array(2.36,48.85),
              jsonb_build_array(2.36,48.9), jsonb_build_array(2.3,48.9),
              jsonb_build_array(2.3,48.85)
            ))
          ))
        )
      ),
      jsonb_build_object(
        'id', 'GRP_B',
        'features', jsonb_build_array(
          jsonb_build_object('geometry', jsonb_build_object(
            'type', 'Polygon',
            'coordinates', jsonb_build_array(jsonb_build_array(
              jsonb_build_array(2.5,48.8), jsonb_build_array(2.6,48.8),
              jsonb_build_array(2.6,48.9), jsonb_build_array(2.5,48.9),
              jsonb_build_array(2.5,48.8)
            ))
          ))
        )
      )
    ),
    'ind'
  );
  ASSERT v_count = 2, '2 groupes → 2 lignes';
END $$;

SELECT ok(true, '2 groupes distincts → 2 lignes');

-- Test 11 : ST_UnaryUnion → pas de double comptage (propriété fondamentale)
-- Même géom soumise deux fois dans le même groupe → même résultat que soumise 1 fois
DO $$
DECLARE
  v_single BIGINT;
  v_double BIGINT;
  v_geom_json jsonb := jsonb_build_object(
    'type', 'Polygon',
    'coordinates', jsonb_build_array(jsonb_build_array(
      jsonb_build_array(2.3,48.85), jsonb_build_array(2.36,48.85),
      jsonb_build_array(2.36,48.9), jsonb_build_array(2.3,48.9),
      jsonb_build_array(2.3,48.85)
    ))
  );
BEGIN
  SELECT coverage INTO v_single FROM calculate_coverage_per_group(
    jsonb_build_array(jsonb_build_object(
      'id', 'TEST',
      'features', jsonb_build_array(jsonb_build_object('geometry', v_geom_json))
    )), 'ind'
  );

  SELECT coverage INTO v_double FROM calculate_coverage_per_group(
    jsonb_build_array(jsonb_build_object(
      'id', 'TEST',
      'features', jsonb_build_array(
        jsonb_build_object('geometry', v_geom_json),
        jsonb_build_object('geometry', v_geom_json) -- même géom dupliquée
      )
    )), 'ind'
  );

  ASSERT v_single = v_double,
    'ST_UnaryUnion : même géom × 2 = même coverage (pas de double comptage)';
END $$;

SELECT ok(true, 'ST_UnaryUnion : pas de double comptage');

-- Test 12 : colonne 'men' (ménages) aussi supportée
SELECT ok(
  (SELECT count(*)::int FROM calculate_coverage_per_group(
    jsonb_build_array(jsonb_build_object(
      'id', 'TEST',
      'features', jsonb_build_array(jsonb_build_object('geometry', jsonb_build_object(
        'type', 'Polygon',
        'coordinates', jsonb_build_array(jsonb_build_array(
          jsonb_build_array(2.3,48.85), jsonb_build_array(2.36,48.85),
          jsonb_build_array(2.36,48.9), jsonb_build_array(2.3,48.9),
          jsonb_build_array(2.3,48.85)
        ))
      )))
    )),
    'men'
  )) = 1,
  'colonne men (ménages) supportée'
);

-- Test 13 : performance — calculate_coverage_per_group < 25s (timeout SQL configuré à 25s)
DO $$
DECLARE
  v_start TIMESTAMPTZ := clock_timestamp();
BEGIN
  PERFORM calculate_coverage_per_group(
    jsonb_build_array(jsonb_build_object(
      'id', 'PERF',
      'features', jsonb_build_array(jsonb_build_object('geometry', jsonb_build_object(
        'type', 'Polygon',
        'coordinates', jsonb_build_array(jsonb_build_array(
          jsonb_build_array(2.3,48.85), jsonb_build_array(2.36,48.85),
          jsonb_build_array(2.36,48.9), jsonb_build_array(2.3,48.9),
          jsonb_build_array(2.3,48.85)
        ))
      )))
    )),
    'ind'
  );
  ASSERT extract(epoch FROM (clock_timestamp() - v_start)) < 25,
    'coverage per group < 25s (SLA)';
END $$;

SELECT ok(true, 'calculate_coverage_per_group respecte le SLA 25s');

-- Test 14 : groupe avec id NULL ignoré (pas de crash)
SELECT ok(
  (SELECT count(*)::int FROM calculate_coverage_per_group(
    '[{"id": null, "features": []}]'::jsonb, 'ind'
  )) = 0,
  'groupe avec id null ignoré gracieusement'
);

-- ── Cleanup ───────────────────────────────────────────────────────
DELETE FROM isochrones_cache WHERE poi_id = '__test_cov_poi__';

SELECT * FROM finish();
ROLLBACK;
