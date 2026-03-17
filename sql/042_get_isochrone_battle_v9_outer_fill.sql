-- ═══════════════════════════════════════════════════════════════════════════
-- 042_get_isochrone_battle_v9_outer_fill.sql
--
-- Algorithme v9 : v8 + remplissage Voronoï résiduel pour couvrir toute la France.
--
-- Fix v9 :
--   1. Correction du cumulative : utilise `territory` (Voronoï-clippé)
--   2. Outer fill clippé à la France métropolitaine (bbox -5.5/41.3 → 9.6/51.1)
--      → évite les grandes zones géométriques s'étendant en Espagne/Allemagne.
--   3. palier=0 → opacité réduite côté client, toggle masquer/afficher.
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
  territory      geometry;
  voronoi_cell   geometry;
  voronoi_global geometry;
  extent_all     geometry;
  clean          geometry;

  -- Variables pour la boucle de remplissage (outer fill)
  outer_cirfa_id text;
  outer_nom      text;
  outer_lat      float8;
  outer_lng      float8;
  france_metro   geometry;  -- bbox France métropolitaine pour clipper l'outer fill

  props          jsonb;
BEGIN

  -- ── 0. Bbox France métropolitaine — clip pour l'outer fill ──────────────────
  -- Évite que les cellules Voronoï s'étendent en Espagne, Allemagne, UK, etc.
  france_metro := ST_MakeEnvelope(-5.5, 41.3, 9.6, 51.1, 4326);

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
        own_geom := ST_Simplify(own_geom, 0.002);
        own_geom := ST_MakeValid(own_geom);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'get_isochrone_battle v9: géométrie invalide % (%min)', cirfa_id, palier_val;
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

      -- ── Mise à jour cumulative avec le TERRITORY (Voronoï-clippé) ───────────
      -- v9 : utilise territory au lieu de own_geom → cumulative ne contient que
      --      les zones effectivement attribuées à un CIRFA → outer fill précis.
      IF territory IS NOT NULL AND NOT ST_IsEmpty(territory) THEN
        IF cumulative IS NULL THEN
          cumulative := territory;
        ELSE
          cumulative := ST_Union(cumulative, territory);
          IF ST_NPoints(cumulative) > 10000 THEN
            cumulative := ST_Simplify(cumulative, 0.001);
            cumulative := ST_MakeValid(cumulative);
          END IF;
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

  -- ── 4. Outer fill : remplissage Voronoï résiduel ────────────────────────────
  -- Pour chaque CIRFA, émettre la partie de sa cellule Voronoï non encore
  -- couverte par ses anneaux (zones hors portée des isochrones).
  -- palier=0 → opacité réduite côté client pour distinguer du vrai coverage.
  --
  -- Les territoires outer fill sont disjoints par définition des cellules Voronoï
  -- → pas besoin de mettre à jour cumulative dans cette boucle.

  IF cumulative IS NOT NULL AND NOT ST_IsEmpty(cumulative) THEN
    cumulative := ST_Simplify(cumulative, 0.003);
    cumulative := ST_MakeValid(cumulative);
  END IF;

  FOR outer_cirfa_id IN
    SELECT DISTINCT (r->>'cirfa_id')::text
    FROM jsonb_array_elements(p_rings) r
    ORDER BY 1
  LOOP
    -- Infos du CIRFA
    SELECT
      (r->>'nom')::text,
      (r->>'lat')::float8,
      (r->>'lng')::float8
    INTO outer_nom, outer_lat, outer_lng
    FROM jsonb_array_elements(p_rings) r
    WHERE (r->>'cirfa_id')::text = outer_cirfa_id
    LIMIT 1;

    -- Cellule Voronoï du CIRFA
    SELECT vp INTO voronoi_cell
    FROM (SELECT (ST_Dump(voronoi_global)).geom AS vp) v
    WHERE ST_Contains(vp, ST_SetSRID(ST_MakePoint(outer_lng, outer_lat), 4326))
    LIMIT 1;

    IF voronoi_cell IS NULL THEN CONTINUE; END IF;

    -- Territoire résiduel = (Voronoï ∩ France métro) − tout ce qui est déjà attribué
    -- Le clip à france_metro évite les grandes zones géométriques hors frontières
    BEGIN
      IF cumulative IS NOT NULL AND NOT ST_IsEmpty(cumulative) THEN
        territory := ST_Difference(
          ST_Intersection(voronoi_cell, france_metro),
          cumulative
        );
      ELSE
        territory := ST_Intersection(voronoi_cell, france_metro);
      END IF;
      territory := ST_MakeValid(ST_Buffer(territory, 0));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'get_isochrone_battle v9: outer fill error for %', outer_cirfa_id;
      CONTINUE;
    END;

    IF territory IS NULL OR ST_IsEmpty(territory) THEN CONTINUE; END IF;

    -- Filtre slivers (seuil plus élevé pour outer fill)
    IF ST_GeometryType(territory) = 'ST_MultiPolygon' THEN
      SELECT ST_Union(sub.geom)
      INTO clean
      FROM (SELECT (ST_Dump(territory)).geom) sub
      WHERE ST_Area(sub.geom) > 1e-4;
      territory := COALESCE(clean, territory);
    ELSIF ST_Area(territory) <= 1e-4 THEN
      CONTINUE;
    END IF;

    IF territory IS NULL OR ST_IsEmpty(territory) THEN CONTINUE; END IF;

    -- Émettre le territoire résiduel (palier=0 = zone externe hors isochrones)
    props := jsonb_build_object(
      'feature_type', 'ring',
      'id',       outer_cirfa_id,
      'cirfa_id', outer_cirfa_id,
      'nom',      outer_nom,
      'lat',      outer_lat,
      'lng',      outer_lng,
      'palier',   0
    );
    result := result || jsonb_build_array(
      jsonb_build_object('type','Feature','geometry',ST_AsGeoJSON(territory)::jsonb,'properties',props)
    );

  END LOOP;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_isochrone_battle(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION get_isochrone_battle(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION get_isochrone_battle(jsonb) TO authenticated;
