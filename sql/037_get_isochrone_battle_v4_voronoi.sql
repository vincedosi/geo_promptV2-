-- ═══════════════════════════════════════════════════════════════════════════
-- 037_get_isochrone_battle_v4_voronoi.sql
--
-- Algorithme Voronoï — la seule solution sans zones blanches.
--
-- Principe :
--   Pour chaque point géographique dans la zone couverte, il appartient au
--   CIRFA dont le centre est le plus proche (si ce point est dans son isochrone).
--
--   territoire_CIRFA = isochrone_CIRFA  ∩  cellule_Voronoï_du_centre_CIRFA
--
-- Avantages vs v2/v3 :
--   - Zéro zone blanche (toute la surface couverte est assignée à 1 CIRFA)
--   - Frontières naturelles = equidistance des centres (logique de recrutement)
--   - Pas de dépendance à l'ordre de traitement
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_isochrone_battle(jsonb);

CREATE OR REPLACE FUNCTION get_isochrone_battle(p_rings jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  result       jsonb    := '[]'::jsonb;
  palier_val   int;

  ring         jsonb;
  cirfa_id     text;
  nom          text;
  lat_val      float8;
  lng_val      float8;
  own_geom     geometry;
  territory    geometry;
  voronoi_cell geometry;
  voronoi_coll geometry;   -- Voronoï pré-calculé pour le palier courant
  extent_buf   geometry;   -- Extent élargi pour le calcul Voronoï

  props        jsonb;
BEGIN

  -- ── Traiter chaque palier indépendamment ───────────────────────────────────
  FOR palier_val IN
    SELECT DISTINCT (r->>'palier')::int
    FROM jsonb_array_elements(p_rings) r
    ORDER BY 1
  LOOP

    -- ── 1. Extent élargi de tous les isochrones du palier (buffer 2° = ~200km) ─
    SELECT ST_Buffer(
      ST_Extent(
        ST_SetSRID(ST_GeomFromGeoJSON((r->>'geojson')::text), 4326)
      )::geometry,
      2.0
    )
    INTO extent_buf
    FROM jsonb_array_elements(p_rings) r
    WHERE (r->>'palier')::int = palier_val;

    -- ── 2. Voronoï des centres CIRFA (calculé une seule fois par palier) ───────
    SELECT ST_VoronoiPolygons(
      ST_Collect(ARRAY(
        SELECT ST_SetSRID(ST_MakePoint((r->>'lng')::float8, (r->>'lat')::float8), 4326)
        FROM jsonb_array_elements(p_rings) r
        WHERE (r->>'palier')::int = palier_val
      )),
      0.0,       -- tolérance
      extent_buf -- extent : garantit que le Voronoï couvre toute la zone
    )
    INTO voronoi_coll;

    -- ── 3. Territoire de chaque CIRFA = isochrone ∩ cellule Voronoï ─────────
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
        RAISE WARNING 'get_isochrone_battle v4: géométrie invalide % (%min)', cirfa_id, palier_val;
        CONTINUE;
      END;
      IF own_geom IS NULL OR ST_IsEmpty(own_geom) THEN CONTINUE; END IF;

      -- ── Border : contour original ─────────────────────────────────────────
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

      -- ── Cellule Voronoï contenant le centre de ce CIRFA ───────────────────
      SELECT vp INTO voronoi_cell
      FROM (
        SELECT (ST_Dump(voronoi_coll)).geom AS vp
      ) v
      WHERE ST_Contains(vp, ST_SetSRID(ST_MakePoint(lng_val, lat_val), 4326))
      LIMIT 1;

      -- ── Territoire = intersection isochrone × cellule Voronoï ─────────────
      IF voronoi_cell IS NULL THEN
        -- Fallback : pas de cellule trouvée (centre hors extent) → isochrone brut
        territory := own_geom;
      ELSE
        BEGIN
          territory := ST_Intersection(own_geom, voronoi_cell);
          territory := ST_Buffer(territory, 0);
          territory := ST_MakeValid(territory);
        EXCEPTION WHEN OTHERS THEN
          territory := own_geom;
        END;
      END IF;

      IF territory IS NULL OR ST_IsEmpty(territory) THEN CONTINUE; END IF;

      -- Filtre slivers
      IF ST_Area(territory) <= 1e-5 THEN CONTINUE; END IF;

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
