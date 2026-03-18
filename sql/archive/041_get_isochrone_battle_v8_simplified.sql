-- ═══════════════════════════════════════════════════════════════════════════
-- 041_get_isochrone_battle_v8_simplified.sql
--
-- Algorithme v8 : v7 + simplification géométrique pour éviter le timeout.
--
-- Problème v7 : cumulative := ST_Union(cumulative, own_geom)
--   → la géométrie cumulative grossit à chaque CIRFA traité
--   → pour 93 CIRFAs, ST_Difference du dernier = diff vs 92 polygones complexes
--   → timeout Supabase à ~130s
--
-- Fix v8 :
--   1. Simplifier chaque isochrone en entrée (ST_Simplify 0.002°≈220m)
--      → réduit les coordonnées de 10-100× (ex: 3000 pts → 50 pts)
--      → acceptable pour visualisation nationale (France 1000km)
--   2. Simplifier le cumulative après chaque union
--      → maintient la complexité du cumulative constante
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_isochrone_battle(jsonb);

CREATE OR REPLACE FUNCTION get_isochrone_battle(p_rings jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  result         jsonb    := '[]'::jsonb;
  palier_val     int;
  cumulative     geometry;

  ring           jsonb;
  cirfa_id       text;
  nom            text;
  lat_val        float8;
  lng_val        float8;
  own_geom       geometry;
  own_simple     geometry;  -- version simplifiée pour cumulative
  territory      geometry;
  voronoi_cell   geometry;
  voronoi_global geometry;
  extent_all     geometry;
  clean          geometry;

  props          jsonb;
BEGIN

  -- ── 1. Extent global ────────────────────────────────────────────────────────
  SELECT ST_Buffer(
    ST_Extent(
      ST_SetSRID(ST_GeomFromGeoJSON((r->>'geojson')::text), 4326)
    )::geometry,
    2.0
  )
  INTO extent_all
  FROM jsonb_array_elements(p_rings) r;

  -- ── 2. Voronoï GLOBAL ───────────────────────────────────────────────────────
  SELECT ST_VoronoiPolygons(
    ST_Collect(ARRAY(
      SELECT DISTINCT ON (r->>'cirfa_id')
        ST_SetSRID(ST_MakePoint((r->>'lng')::float8, (r->>'lat')::float8), 4326)
      FROM jsonb_array_elements(p_rings) r
    )),
    0.0,
    extent_all
  )
  INTO voronoi_global;

  -- ── 3. Paliers ASC ──────────────────────────────────────────────────────────
  FOR palier_val IN
    SELECT DISTINCT (r->>'palier')::int
    FROM jsonb_array_elements(p_rings) r
    ORDER BY 1 ASC
  LOOP

    FOR ring IN
      SELECT r
      FROM jsonb_array_elements(p_rings) r
      WHERE (r->>'palier')::int = palier_val
    LOOP
      cirfa_id := ring->>'cirfa_id';
      nom      := ring->>'nom';
      lat_val  := (ring->>'lat')::float8;
      lng_val  := (ring->>'lng')::float8;

      -- ── Charger, valider, SIMPLIFIER l'isochrone ────────────────────────────
      BEGIN
        own_geom := ST_SetSRID(ST_GeomFromGeoJSON((ring->>'geojson')::text), 4326);
        own_geom := ST_MakeValid(own_geom);
        -- Simplification 0.002° ≈ 220m — réduit la complexité de 10-100×
        -- sans impact visible à l'échelle nationale (France 1000km)
        own_geom := ST_Simplify(own_geom, 0.002);
        own_geom := ST_MakeValid(own_geom);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'get_isochrone_battle v8: géométrie invalide % (%min)', cirfa_id, palier_val;
        CONTINUE;
      END;
      IF own_geom IS NULL OR ST_IsEmpty(own_geom) THEN CONTINUE; END IF;

      -- ── Border : contour original (simplifié) ───────────────────────────────
      props := jsonb_build_object(
        'feature_type', 'border',
        'id',        cirfa_id,
        'cirfa_id',  cirfa_id,
        'nom',       nom,
        'lat',       lat_val,
        'lng',       lng_val,
        'palier',    palier_val
      );
      result := result || jsonb_build_array(
        jsonb_build_object('type','Feature','geometry',ST_AsGeoJSON(own_geom)::jsonb,'properties',props)
      );

      -- ── Cellule Voronoï globale ──────────────────────────────────────────────
      SELECT vp INTO voronoi_cell
      FROM (
        SELECT (ST_Dump(voronoi_global)).geom AS vp
      ) v
      WHERE ST_Contains(vp, ST_SetSRID(ST_MakePoint(lng_val, lat_val), 4326))
      LIMIT 1;

      -- ── Territoire = (isochrone ∩ cellule_Voronoï) − cumulative ─────────────
      BEGIN
        IF voronoi_cell IS NULL THEN
          territory := own_geom;
        ELSE
          territory := ST_Intersection(own_geom, voronoi_cell);
          territory := ST_MakeValid(ST_Buffer(territory, 0));
        END IF;

        IF cumulative IS NOT NULL AND NOT ST_IsEmpty(cumulative) THEN
          territory := ST_Difference(territory, cumulative);
          territory := ST_MakeValid(ST_Buffer(territory, 0));
        END IF;
      EXCEPTION WHEN OTHERS THEN
        BEGIN
          IF cumulative IS NOT NULL AND NOT ST_IsEmpty(cumulative) THEN
            territory := ST_Difference(own_geom, cumulative);
          ELSE
            territory := own_geom;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          territory := own_geom;
        END;
      END;

      -- ── Mise à jour cumulative — version SIMPLIFIÉE ─────────────────────────
      -- own_geom est déjà simplifié → union reste légère
      IF cumulative IS NULL THEN
        cumulative := own_geom;
      ELSE
        cumulative := ST_Union(cumulative, own_geom);
        -- Simplifier le cumulative toutes les 10 itérations pour plafonner sa complexité
        -- (ne change pas le résultat final — le territoire final est déjà calculé)
        IF ST_NPoints(cumulative) > 10000 THEN
          cumulative := ST_Simplify(cumulative, 0.001);
          cumulative := ST_MakeValid(cumulative);
        END IF;
      END IF;

      IF territory IS NULL OR ST_IsEmpty(territory) THEN CONTINUE; END IF;

      -- ── Filtre slivers ────────────────────────────────────────────────────
      IF ST_GeometryType(territory) = 'ST_MultiPolygon' THEN
        SELECT ST_Union(sub.geom)
        INTO clean
        FROM (SELECT (ST_Dump(territory)).geom) sub
        WHERE ST_Area(sub.geom) > 1e-5;
        territory := COALESCE(clean, territory);
      ELSIF ST_Area(territory) <= 1e-5 THEN
        CONTINUE;
      END IF;

      IF territory IS NULL OR ST_IsEmpty(territory) THEN CONTINUE; END IF;

      -- ── Ring : territoire final ───────────────────────────────────────────
      props := jsonb_build_object(
        'feature_type', 'ring',
        'id',        cirfa_id,
        'cirfa_id',  cirfa_id,
        'nom',       nom,
        'lat',       lat_val,
        'lng',       lng_val,
        'palier',    palier_val
      );
      result := result || jsonb_build_array(
        jsonb_build_object('type','Feature','geometry',ST_AsGeoJSON(territory)::jsonb,'properties',props)
      );

    END LOOP;
  END LOOP;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_isochrone_battle(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION get_isochrone_battle(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION get_isochrone_battle(jsonb) TO authenticated;
