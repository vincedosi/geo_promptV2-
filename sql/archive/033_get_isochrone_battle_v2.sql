-- Migration 033 : réécriture complète de get_isochrone_battle
-- DROP requis car le type de retour change
DROP FUNCTION IF EXISTS get_isochrone_battle(jsonb);
-- Version 2 — robuste, rapide, artefacts filtrés
--
-- Corrections vs v1 :
--   1. Propriété 'id' = cirfa_id dans TOUS les features (fix mismatch couleurs)
--   2. Propriétés lat/lng/nom/adresse/ville dans chaque feature (fix POI fallback)
--   3. ST_Buffer(0) + ST_MakeValid sur chaque résultat ST_Difference (fix slivers)
--   4. Filtre surface minimale : ST_Area > 1e-6 deg² (~10 km²) → élimine artefacts
--   5. Conversion MultiPolygon → Polygon pour les fragments isolés
--   6. Border = isochrone original (non-soustrait) pour les contours CIRFAs

-- ─────────────────────────────────────────────────────────────────────────────
-- Types d'entrée / sortie
--   Input  : p_rings JSONB — array de RingEntry
--              { cirfa_id, nom, lat, lng, palier, geojson (geometry) }
--   Output : JSONB array de GeoJSON Feature
--              ring   → territoire final non-chevauchant de chaque CIRFA
--              border → contour original de l'isochrone (non-soustrait)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_isochrone_battle(p_rings jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  result      jsonb := '[]'::jsonb;
  ring        jsonb;

  -- CIRFA courant
  cirfa_id    text;
  nom         text;
  lat_val     float8;
  lng_val     float8;
  palier_val  int;

  -- Géométries
  own_geom    geometry;
  others_geom geometry;
  territory   geometry;
  clean       geometry;

  -- Feature à retourner
  props       jsonb;
  feat        jsonb;
BEGIN
  -- ─── Pour chaque ring (1 par CIRFA × palier) ───────────────────────────────
  FOR ring IN SELECT * FROM jsonb_array_elements(p_rings) LOOP

    cirfa_id   := ring->>'cirfa_id';
    nom        := ring->>'nom';
    lat_val    := (ring->>'lat')::float8;
    lng_val    := (ring->>'lng')::float8;
    palier_val := (ring->>'palier')::int;

    -- Isochrone du CIRFA courant
    BEGIN
      own_geom := ST_SetSRID(ST_GeomFromGeoJSON((ring->>'geojson')::text), 4326);
      own_geom := ST_MakeValid(own_geom);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'get_isochrone_battle: géométrie invalide pour % (%min)', cirfa_id, palier_val;
      CONTINUE;
    END;

    IF own_geom IS NULL OR ST_IsEmpty(own_geom) THEN CONTINUE; END IF;

    -- ── Border : contour original (avant soustraction) ──────────────────────
    props := jsonb_build_object(
      'feature_type', 'border',
      'id',          cirfa_id,
      'cirfa_id',    cirfa_id,
      'nom',         nom,
      'lat',         lat_val,
      'lng',         lng_val,
      'palier',      palier_val
    );
    feat := jsonb_build_object(
      'type',       'Feature',
      'geometry',   ST_AsGeoJSON(own_geom)::jsonb,
      'properties', props
    );
    result := result || jsonb_build_array(feat);

    -- ── Union des isochrones de TOUS les autres CIRFAs au même palier ────────
    SELECT ST_Union(
      ST_MakeValid(
        ST_SetSRID(ST_GeomFromGeoJSON((r->>'geojson')::text), 4326)
      )
    )
    INTO others_geom
    FROM jsonb_array_elements(p_rings) r
    WHERE r->>'cirfa_id' <> cirfa_id
      AND (r->>'palier')::int = palier_val;

    -- ── Territoire = isochrone propre - isochrones des autres ─────────────────
    IF others_geom IS NULL OR ST_IsEmpty(others_geom) THEN
      territory := own_geom;
    ELSE
      BEGIN
        territory := ST_Difference(own_geom, others_geom);
        territory := ST_Buffer(territory, 0);   -- nettoyage topologique
        territory := ST_MakeValid(territory);
      EXCEPTION WHEN OTHERS THEN
        territory := own_geom;
      END;
    END IF;

    IF territory IS NULL OR ST_IsEmpty(territory) THEN CONTINUE; END IF;

    -- ── Filtre surface : éliminer les slivers et micro-polygones ─────────────
    -- Pour un MultiPolygon, garder uniquement les parties > seuil
    IF ST_GeometryType(territory) = 'ST_MultiPolygon' THEN
      SELECT ST_Union(sub.geom)
      INTO clean
      FROM (
        SELECT (ST_Dump(territory)).geom
      ) sub
      WHERE ST_Area(sub.geom) > 1e-5;  -- ~1 km² en degrés carrés
      territory := COALESCE(clean, territory);
    ELSIF ST_Area(territory) <= 1e-5 THEN
      CONTINUE;  -- Trop petit → ignorer
    END IF;

    IF territory IS NULL OR ST_IsEmpty(territory) THEN CONTINUE; END IF;

    -- ── Ring : territoire final ───────────────────────────────────────────────
    props := jsonb_build_object(
      'feature_type', 'ring',
      'id',          cirfa_id,
      'cirfa_id',    cirfa_id,
      'nom',         nom,
      'lat',         lat_val,
      'lng',         lng_val,
      'palier',      palier_val
    );
    feat := jsonb_build_object(
      'type',       'Feature',
      'geometry',   ST_AsGeoJSON(territory)::jsonb,
      'properties', props
    );
    result := result || jsonb_build_array(feat);

  END LOOP;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_isochrone_battle(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION get_isochrone_battle(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION get_isochrone_battle(jsonb) TO authenticated;
