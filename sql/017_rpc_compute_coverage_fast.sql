-- ═══════════════════════════════════════════════════════════════════════════
-- 017_rpc_compute_coverage_fast.sql
--
-- Deux RPCs de couverture audience sans transit géométrie réseau.
-- Lisent les isochrones directement depuis isochrones_cache (colonnes typées),
-- filtrent sur categorie / mode / ville au lieu d'un LIKE sur cache_key.
-- Croisement carreaux_filosofi via geom_centroid (migration 016, index GiST).
-- ═══════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- Nettoyage versions antérieures
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS compute_coverage_fast(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS compute_coverage_by_level(TEXT, TEXT, TEXT);


-- ════════════════════════════════════════════════════════════════════════════
-- FONCTION 1 : compute_coverage_fast
--
-- Audience dédupliquée totale pour une battle.
-- Union de TOUTES les isochrones individuelles (tous paliers) d'une catégorie
-- stockées avec ville = '_battle_', puis croisement avec carreaux_filosofi.
--
-- Paramètres :
--   p_categorie  — valeur de la colonne categorie dans isochrones_cache
--   p_mode       — valeur de la colonne mode  (ex: 'driving-car')
--   p_column     — colonne Filosofi à sommer  (défaut: 'ind')
--
-- Retourne : BIGINT (audience dédupliquée)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION compute_coverage_fast(
  p_categorie  TEXT,
  p_mode       TEXT,
  p_column     TEXT DEFAULT 'ind'
)
RETURNS BIGINT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_union_geom  geometry;
  v_result      BIGINT;
BEGIN
  SET LOCAL statement_timeout = '2min';

  -- Union de toutes les isochrones — ST_Collect d'abord (pas de topo), puis ST_UnaryUnion
  -- ST_Simplify(0.002) ≈ 200m tolerance : réduit les vertex ORS x10-20, union x100 plus rapide
  SELECT ST_UnaryUnion(ST_Collect(
    ST_Simplify(
      ST_SetSRID(
        ST_GeomFromGeoJSON(
          (ic.geojson -> 'features' -> 0 -> 'geometry')::text
        ),
        4326
      ),
      0.002
    )
  ))
  INTO v_union_geom
  FROM isochrones_cache ic
  WHERE ic.categorie = p_categorie
    AND ic.mode      = p_mode
    AND ic.ville     = '_battle_'
    AND (ic.geojson -> 'features' -> 0 -> 'geometry') IS NOT NULL;

  IF v_union_geom IS NULL THEN
    RETURN 0;
  END IF;

  -- Audience dédupliquée
  -- ST_SetSRID(geom, 4326) && : utilise idx_carreaux_geom_4326 (index fonctionnel GiST)
  -- COALESCE : geom_centroid indexé si peuplé (migration 016), sinon centroïde à la volée
  SELECT COALESCE(SUM((cf.metadata->>p_column)::numeric), 0)::BIGINT
  INTO v_result
  FROM carreaux_filosofi cf
  WHERE ST_SetSRID(cf.geom, 4326) && v_union_geom
    AND ST_Intersects(
      COALESCE(cf.geom_centroid, ST_SetSRID(ST_Centroid(cf.geom), 4326)),
      v_union_geom
    );

  RETURN COALESCE(v_result, 0);
END;
$$;

COMMENT ON FUNCTION compute_coverage_fast(TEXT, TEXT, TEXT) IS
  'Couverture audience dédupliquée totale d''une battle — lit isochrones depuis cache, croise avec carreaux_filosofi via geom_centroid indexé';

GRANT EXECUTE ON FUNCTION compute_coverage_fast(TEXT, TEXT, TEXT) TO service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- FONCTION 2 : compute_coverage_by_level
--
-- Audience dédupliquée par palier (minutes) pour une battle.
-- Pour chaque valeur de `minutes` trouvée dans le cache, union des isochrones
-- du palier puis croisement avec carreaux_filosofi.
-- Renvoie une ligne (level INT, audience BIGINT) par palier, triée par level.
--
-- Paramètres :
--   p_categorie  — valeur de la colonne categorie dans isochrones_cache
--   p_mode       — valeur de la colonne mode  (ex: 'driving-car')
--   p_column     — colonne Filosofi à sommer  (défaut: 'ind')
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION compute_coverage_by_level(
  p_categorie  TEXT,
  p_mode       TEXT,
  p_column     TEXT DEFAULT 'ind'
)
RETURNS TABLE(level INT, audience BIGINT)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level       INT;
  v_union_geom  geometry;
  v_audience    BIGINT;
BEGIN
  SET LOCAL statement_timeout = '3min';

  -- Boucle sur chaque palier (minutes) présent dans le cache
  -- L'index GiST est utilisé séparément pour chaque union_geom
  FOR v_level, v_union_geom IN
    SELECT
      ic.minutes,
      ST_UnaryUnion(ST_Collect(
        ST_Simplify(
          ST_SetSRID(
            ST_GeomFromGeoJSON(
              (ic.geojson -> 'features' -> 0 -> 'geometry')::text
            ),
            4326
          ),
          0.002
        )
      ))
    FROM isochrones_cache ic
    WHERE ic.categorie = p_categorie
      AND ic.mode      = p_mode
      AND ic.ville     = '_battle_'
      AND (ic.geojson -> 'features' -> 0 -> 'geometry') IS NOT NULL
    GROUP BY ic.minutes
    ORDER BY ic.minutes
  LOOP
    SELECT COALESCE(SUM((cf.metadata->>p_column)::numeric), 0)::BIGINT
    INTO v_audience
    FROM carreaux_filosofi cf
    WHERE ST_SetSRID(cf.geom, 4326) && v_union_geom
      AND ST_Intersects(
        COALESCE(cf.geom_centroid, ST_SetSRID(ST_Centroid(cf.geom), 4326)),
        v_union_geom
      );

    level    := v_level;
    audience := COALESCE(v_audience, 0);
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION compute_coverage_by_level(TEXT, TEXT, TEXT) IS
  'Couverture audience dédupliquée par palier (minutes) d''une battle — boucle sur chaque niveau, GiST index sur geom_centroid';

GRANT EXECUTE ON FUNCTION compute_coverage_by_level(TEXT, TEXT, TEXT) TO service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- FONCTION 3 : compute_coverage_per_poi
--
-- Audience individuelle par isochrone (un cache_key = un POI × un palier).
-- Pas d'union entre POIs — chaque isochrone est traité indépendamment.
-- Utilisé pour le classement détaillé par CIRFA.
--
-- Paramètres :
--   p_categorie  — valeur de la colonne categorie dans isochrones_cache
--   p_mode       — valeur de la colonne mode  (ex: 'driving-car')
--   p_level      — palier en minutes (ex: 60)
--   p_column     — colonne Filosofi à sommer  (défaut: 'ind')
--
-- Retourne : TABLE(cache_key TEXT, audience BIGINT) triée par audience DESC
-- ════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS compute_coverage_per_poi(TEXT, TEXT, INT, TEXT);

CREATE OR REPLACE FUNCTION compute_coverage_per_poi(
  p_categorie  TEXT,
  p_mode       TEXT,
  p_level      INT,
  p_column     TEXT DEFAULT 'ind'
)
RETURNS TABLE(cache_key TEXT, audience BIGINT)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SET LOCAL statement_timeout = '5min';

  -- LATERAL : calcule la géométrie une seule fois par isochrone
  -- Nested loop spatial join : GiST idx_carreaux_geom_4326 (index fonctionnel)
  -- Filtre bbox seul (&&) — pas de ST_Intersects/ST_Centroid sur 2.3M × N isochrones
  -- ST_Simplify(0.01) ≈ 1km tolerance : 5× moins de vertices que 0.002, union x25 plus rapide
  -- Précision suffisante pour un classement relatif par POI
  RETURN QUERY
  SELECT
    ic.cache_key,
    COALESCE(SUM((cf.metadata->>p_column)::numeric), 0)::BIGINT AS audience
  FROM isochrones_cache ic
  CROSS JOIN LATERAL (
    SELECT ST_Simplify(
      ST_SetSRID(
        ST_GeomFromGeoJSON((ic.geojson -> 'features' -> 0 -> 'geometry')::text),
        4326
      ),
      0.01
    ) AS iso_geom
  ) iso
  JOIN carreaux_filosofi cf
    ON ST_SetSRID(cf.geom, 4326) && iso.iso_geom
  WHERE ic.categorie = p_categorie
    AND ic.mode      = p_mode
    AND ic.ville     = '_battle_'
    AND ic.minutes   = p_level
    AND (ic.geojson -> 'features' -> 0 -> 'geometry') IS NOT NULL
  GROUP BY ic.cache_key
  ORDER BY audience DESC;
END;
$$;

COMMENT ON FUNCTION compute_coverage_per_poi(TEXT, TEXT, INT, TEXT) IS
  'Audience par POI/palier (bbox seul) — nested loop GiST, ST_Simplify(0.01), sans ST_Intersects pour classement rapide';

GRANT EXECUTE ON FUNCTION compute_coverage_per_poi(TEXT, TEXT, INT, TEXT) TO service_role;
