-- ═══════════════════════════════════════════════════════════════════════════
-- 039_get_isochrone_battle_v6_simple_palier.sql
--
-- Algorithme v6 : priorité palier ASC PURE — sans Voronoï
--
-- Règle : le plus petit palier (10min) est TOUJOURS prioritaire.
--   Un zone appartient au CIRFA qui a le PLUS PETIT isochrone qui la couvre.
--
-- Algorithme :
--   1. Traiter les paliers dans l'ordre ASC (10 → 30 → 60 → ...)
--   2. cumulative = union de TOUS les isochrones déjà traités (tous paliers)
--   3. Pour chaque CIRFA du palier courant :
--      territory = isochrone - cumulative
--   4. Ajouter l'isochrone BRUT au cumulative
--
-- Pas de Voronoï → pas de lignes droites artificielles.
-- Les frontières suivent naturellement les contours des isochrones.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_isochrone_battle(jsonb);

CREATE OR REPLACE FUNCTION get_isochrone_battle(p_rings jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  result       jsonb    := '[]'::jsonb;
  palier_val   int;
  cumulative   geometry;  -- Zones déjà réclamées (TOUS paliers confondus)

  ring         jsonb;
  cirfa_id     text;
  nom          text;
  lat_val      float8;
  lng_val      float8;
  own_geom     geometry;
  territory    geometry;
  clean        geometry;
  props        jsonb;
BEGIN

  -- ── Paliers du plus petit au plus grand (10 → 30 → 60 → ...) ──────────────
  FOR palier_val IN
    SELECT DISTINCT (r->>'palier')::int
    FROM jsonb_array_elements(p_rings) r
    ORDER BY 1 ASC
  LOOP

    -- ── CIRFAs de ce palier ─────────────────────────────────────────────────
    FOR ring IN
      SELECT r
      FROM jsonb_array_elements(p_rings) r
      WHERE (r->>'palier')::int = palier_val
    LOOP
      cirfa_id := ring->>'cirfa_id';
      nom      := ring->>'nom';
      lat_val  := (ring->>'lat')::float8;
      lng_val  := (ring->>'lng')::float8;

      -- Charger et valider l'isochrone
      BEGIN
        own_geom := ST_SetSRID(ST_GeomFromGeoJSON((ring->>'geojson')::text), 4326);
        own_geom := ST_MakeValid(own_geom);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'get_isochrone_battle v6: géométrie invalide % (%min)', cirfa_id, palier_val;
        CONTINUE;
      END;
      IF own_geom IS NULL OR ST_IsEmpty(own_geom) THEN CONTINUE; END IF;

      -- ── Border : contour original de l'isochrone ──────────────────────────
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

      -- ── Territoire = isochrone - zones déjà réclamées ─────────────────────
      IF cumulative IS NULL OR ST_IsEmpty(cumulative) THEN
        territory := own_geom;
      ELSE
        BEGIN
          territory := ST_Difference(own_geom, cumulative);
          territory := ST_MakeValid(ST_Buffer(territory, 0));
        EXCEPTION WHEN OTHERS THEN
          territory := own_geom;
        END;
      END IF;

      -- ── Ajouter l'isochrone BRUT au cumulative ────────────────────────────
      --   On réserve la zone COMPLÈTE (pas seulement le territoire découpé)
      --   → les paliers suivants (30min, 60min) ne pourront pas la revendiquer
      IF cumulative IS NULL THEN
        cumulative := own_geom;
      ELSE
        cumulative := ST_Union(cumulative, own_geom);
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

    END LOOP; -- fin boucle CIRFAs
  END LOOP;   -- fin boucle paliers

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_isochrone_battle(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION get_isochrone_battle(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION get_isochrone_battle(jsonb) TO authenticated;
