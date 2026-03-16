-- ═══════════════════════════════════════════════════════════════════════════
-- 040_get_isochrone_battle_v7_voronoi_mask.sql
--
-- Algorithme v7 : Voronoï global + priorité palier ASC
--
-- Principe :
--   1. Un seul Voronoï GLOBAL calculé sur TOUS les centres CIRFA (tous paliers)
--      → chaque cellule = zone "plus proche de ce CIRFA que de tout autre"
--   2. Paliers traités dans l'ordre ASC (10min → 30min → 60min → ...)
--      → les petits paliers sont toujours prioritaires sur les grands
--   3. Pour chaque CIRFA :
--        territory = ST_Intersection(isochrone, voronoi_global_cell) − cumulative
--      → la cellule Voronoï empêche Saint-Brieuc de dépasser la ligne
--         équidistante vers Rennes, même s'il est traité en premier
--      → le cumulative empêche le 60min de réclamer ce que le 10min a déjà pris
--   4. L'isochrone BRUT est ajouté au cumulative après chaque CIRFA
--
-- Différence v5 vs v7 :
--   v5 : Voronoï recalculé PAR palier (seulement les centres du palier courant)
--        → cellules géantes si un seul CIRFA dans la région → lignes droites visibles
--   v7 : Voronoï GLOBAL (tous les centres ensemble, une seule fois)
--        → cellules naturellement délimitées par tous les voisins
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_isochrone_battle(jsonb);

CREATE OR REPLACE FUNCTION get_isochrone_battle(p_rings jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  result         jsonb    := '[]'::jsonb;
  palier_val     int;
  cumulative     geometry;  -- Zones déjà réclamées (TOUS paliers confondus)

  ring           jsonb;
  cirfa_id       text;
  nom            text;
  lat_val        float8;
  lng_val        float8;
  own_geom       geometry;
  territory      geometry;
  voronoi_cell   geometry;
  voronoi_global geometry;  -- Voronoï calculé une seule fois sur TOUS les centres
  extent_all     geometry;  -- Extent global élargi
  clean          geometry;

  props          jsonb;
BEGIN

  -- ── 1. Extent global de TOUS les isochrones ────────────────────────────────
  SELECT ST_Buffer(
    ST_Extent(
      ST_SetSRID(ST_GeomFromGeoJSON((r->>'geojson')::text), 4326)
    )::geometry,
    2.0   -- buffer 2° ≈ 200km : garantit que le Voronoï couvre toute la zone
  )
  INTO extent_all
  FROM jsonb_array_elements(p_rings) r;

  -- ── 2. Voronoï GLOBAL : UN seul calcul pour tous les centres CIRFA ─────────
  --   On déduplique les centres (même CIRFA peut apparaître à plusieurs paliers)
  SELECT ST_VoronoiPolygons(
    ST_Collect(ARRAY(
      SELECT DISTINCT ON (r->>'cirfa_id')
        ST_SetSRID(ST_MakePoint((r->>'lng')::float8, (r->>'lat')::float8), 4326)
      FROM jsonb_array_elements(p_rings) r
    )),
    0.0,       -- tolérance
    extent_all -- extent global
  )
  INTO voronoi_global;

  -- ── 3. Paliers ASC (10 → 30 → 60 → ...) ──────────────────────────────────
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

      -- Charger et valider l'isochrone
      BEGIN
        own_geom := ST_SetSRID(ST_GeomFromGeoJSON((ring->>'geojson')::text), 4326);
        own_geom := ST_MakeValid(own_geom);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'get_isochrone_battle v7: géométrie invalide % (%min)', cirfa_id, palier_val;
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

      -- ── Cellule Voronoï globale contenant le centre de ce CIRFA ───────────
      SELECT vp INTO voronoi_cell
      FROM (
        SELECT (ST_Dump(voronoi_global)).geom AS vp
      ) v
      WHERE ST_Contains(vp, ST_SetSRID(ST_MakePoint(lng_val, lat_val), 4326))
      LIMIT 1;

      -- ── Territoire = (isochrone ∩ cellule_Voronoï) − cumulative ───────────
      BEGIN
        IF voronoi_cell IS NULL THEN
          -- Fallback : pas de cellule (centre hors extent) → isochrone brut
          territory := own_geom;
        ELSE
          -- Intersection avec la cellule Voronoï = "zone plus proche de moi"
          territory := ST_Intersection(own_geom, voronoi_cell);
          territory := ST_MakeValid(ST_Buffer(territory, 0));
        END IF;

        -- Soustraire les zones déjà réclamées par les paliers plus petits
        IF cumulative IS NOT NULL AND NOT ST_IsEmpty(cumulative) THEN
          territory := ST_Difference(territory, cumulative);
          territory := ST_MakeValid(ST_Buffer(territory, 0));
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- Fallback robuste
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

      -- ── Ajouter l'isochrone BRUT au cumulative ────────────────────────────
      --   Zone COMPLÈTE réservée → les paliers suivants (30min, 60min)
      --   ne pourront pas revendiquer ce territoire
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
