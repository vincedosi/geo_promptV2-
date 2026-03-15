-- Migration 031 : clip isochrones ORS aux frontières françaises
-- Deux fonctions PostGIS pour éviter que les isochrones débordent
-- en mer ou dans les pays frontaliers.
--
-- Utilise la table france_borders (14 polygones : métropole + Corse + DROM).
-- Les deux fonctions sont STABLE (pas d'effet de bord, résultat déterministe).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. clip_geojson_to_france(p_fc jsonb) → jsonb
--    Coupe une FeatureCollection GeoJSON aux frontières françaises.
--    Utilisé par lib/isochrones/fetcher.ts (isochrones copilote/chat).
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
  SELECT ST_Union(geom) INTO france_geom FROM france_borders;
  IF france_geom IS NULL THEN RETURN p_fc; END IF;

  features := p_fc -> 'features';
  IF features IS NULL OR jsonb_array_length(features) = 0 THEN RETURN p_fc; END IF;

  FOR feat IN SELECT * FROM jsonb_array_elements(features) LOOP
    BEGIN
      feat_geom := ST_SetSRID(ST_GeomFromGeoJSON((feat -> 'geometry')::text), 4326);
      feat_geom := ST_MakeValid(feat_geom);
      clipped   := ST_Intersection(feat_geom, france_geom);

      IF clipped IS NULL OR ST_IsEmpty(clipped) THEN
        CONTINUE; -- hors France → drop
      END IF;

      result := result || jsonb_build_array(
        jsonb_set(feat, '{geometry}', ST_AsGeoJSON(clipped)::jsonb)
      );
    EXCEPTION WHEN OTHERS THEN
      -- En cas d'erreur géométrique, conserver le polygone original
      result := result || jsonb_build_array(feat);
    END;
  END LOOP;

  RETURN jsonb_build_object('type', 'FeatureCollection', 'features', result);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. clip_rings_to_france(p_rings jsonb) → jsonb
--    Coupe un tableau de RingEntry [{cirfa_id, nom, lat, lng, palier, geojson}]
--    aux frontières françaises.
--    Utilisé par /api/isochrone-battle avant l'appel à get_isochrone_battle.
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
  SELECT ST_Union(geom) INTO france_geom FROM france_borders;
  IF france_geom IS NULL THEN RETURN p_rings; END IF;

  FOR ring IN SELECT * FROM jsonb_array_elements(p_rings) LOOP
    BEGIN
      ring_geom := ST_SetSRID(ST_GeomFromGeoJSON((ring -> 'geojson')::text), 4326);
      ring_geom := ST_MakeValid(ring_geom);
      clipped   := ST_Intersection(ring_geom, france_geom);

      IF clipped IS NULL OR ST_IsEmpty(clipped) THEN
        CONTINUE; -- hors France → drop
      END IF;

      result := result || jsonb_build_array(
        jsonb_set(ring, '{geojson}', ST_AsGeoJSON(clipped)::jsonb)
      );
    EXCEPTION WHEN OTHERS THEN
      -- En cas d'erreur géométrique, conserver le ring original
      result := result || jsonb_build_array(ring);
    END;
  END LOOP;

  RETURN result;
END;
$$;

-- Accès service_role (bypass RLS)
GRANT EXECUTE ON FUNCTION clip_geojson_to_france(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION clip_rings_to_france(jsonb)   TO service_role;
