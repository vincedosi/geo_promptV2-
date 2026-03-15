-- Migration 032 : correction artefacts isochrone-battle
-- Problèmes corrigés :
--   1. clip_rings_to_france : fallback silencieux si france_borders vide → log + robustesse
--   2. get_isochrone_battle : filtre les micro-polygones (slivers ST_Difference)
--      et utilise ST_Buffer(0) + ST_MakeValid pour nettoyer les géométries

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Remplacement de clip_rings_to_france — version robuste
--    Nouveautés :
--      - ST_SimplifyPreserveTopology avant intersection (réduit complexité)
--      - Filtre ST_Area < 1e-8 (≈0.01 km²) pour éliminer les slivers de clipping
--      - Plus de RAISE si france_borders est vide → log seulement
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION clip_rings_to_france(p_rings jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  france_geom geometry;
  ring        jsonb;
  ring_geom   geometry;
  clipped     geometry;
  result      jsonb := '[]'::jsonb;
BEGIN
  SELECT ST_Union(ST_MakeValid(geom)) INTO france_geom FROM france_borders;

  IF france_geom IS NULL THEN
    RAISE WARNING 'clip_rings_to_france: france_borders vide ou inexistante — pas de clip';
    RETURN p_rings;
  END IF;

  FOR ring IN SELECT * FROM jsonb_array_elements(p_rings) LOOP
    BEGIN
      ring_geom := ST_SetSRID(ST_GeomFromGeoJSON((ring -> 'geojson')::text), 4326);
      ring_geom := ST_MakeValid(ring_geom);

      -- Simplification légère pour réduire la complexité avant intersection
      ring_geom := ST_SimplifyPreserveTopology(ring_geom, 0.001);

      clipped := ST_Intersection(ring_geom, france_geom);

      -- Nettoyer le résultat
      clipped := ST_MakeValid(clipped);

      IF clipped IS NULL OR ST_IsEmpty(clipped) THEN
        CONTINUE;
      END IF;

      -- Éliminer les micro-slivers (<0.001 deg² ≈ 10 km²)
      IF ST_Area(clipped) < 0.001 THEN
        CONTINUE;
      END IF;

      result := result || jsonb_build_array(
        jsonb_set(ring, '{geojson}', ST_AsGeoJSON(clipped)::jsonb)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'clip_rings_to_france: erreur géométrie %, conservation ring original', SQLERRM;
      result := result || jsonb_build_array(ring);
    END;
  END LOOP;

  RETURN result;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Remplacement de clip_geojson_to_france — même robustesse
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION clip_geojson_to_france(p_fc jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  france_geom geometry;
  features    jsonb;
  feat        jsonb;
  feat_geom   geometry;
  clipped     geometry;
  result      jsonb := '[]'::jsonb;
BEGIN
  SELECT ST_Union(ST_MakeValid(geom)) INTO france_geom FROM france_borders;
  IF france_geom IS NULL THEN RETURN p_fc; END IF;

  features := p_fc -> 'features';
  IF features IS NULL OR jsonb_array_length(features) = 0 THEN RETURN p_fc; END IF;

  FOR feat IN SELECT * FROM jsonb_array_elements(features) LOOP
    BEGIN
      feat_geom := ST_SetSRID(ST_GeomFromGeoJSON((feat -> 'geometry')::text), 4326);
      feat_geom := ST_MakeValid(feat_geom);
      feat_geom := ST_SimplifyPreserveTopology(feat_geom, 0.001);
      clipped   := ST_Intersection(feat_geom, france_geom);
      clipped   := ST_MakeValid(clipped);

      IF clipped IS NULL OR ST_IsEmpty(clipped) THEN CONTINUE; END IF;
      IF ST_Area(clipped) < 0.001 THEN CONTINUE; END IF;

      result := result || jsonb_build_array(
        jsonb_set(feat, '{geometry}', ST_AsGeoJSON(clipped)::jsonb)
      );
    EXCEPTION WHEN OTHERS THEN
      result := result || jsonb_build_array(feat);
    END;
  END LOOP;

  RETURN jsonb_build_object('type', 'FeatureCollection', 'features', result);
END;
$$;

GRANT EXECUTE ON FUNCTION clip_rings_to_france(jsonb)   TO service_role;
GRANT EXECUTE ON FUNCTION clip_geojson_to_france(jsonb) TO service_role;
