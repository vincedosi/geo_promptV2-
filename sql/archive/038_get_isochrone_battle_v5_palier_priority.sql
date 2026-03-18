-- ═══════════════════════════════════════════════════════════════════════════
-- 038_get_isochrone_battle_v5_palier_priority.sql
--
-- Algorithme v5 : priorité palier ASC + Voronoï intra-palier
--
-- Règle métier :
--   Le PLUS PETIT palier (10min) est TOUJOURS prioritaire sur les grands
--   (30min, 60min...). Si un point est dans le 10min d'un CIRFA ET le 60min
--   d'un autre, le 10min gagne.
--
--   Pour les conflits ENTRE CIRFAs du MÊME palier, on utilise le Voronoï
--   (le CIRFA dont le centre est le plus proche gagne).
--
-- Algorithme :
--   1. Traiter les paliers dans l'ordre ASC (10 → 30 → 60 → ...)
--   2. Pour chaque palier :
--      a. Calculer le Voronoï des centres des CIRFAs de ce palier
--      b. Territoire = isochrone ∩ cellule_Voronoï - cumulative_global
--      c. Ajouter l'isochrone BRUT au cumulative_global (pour que les paliers
--         suivants ne puissent pas revendiquer cette zone)
--   3. cumulative_global est partagé entre TOUS les paliers
--
-- Résultat : zéro zone blanche, priorité palier respectée.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_isochrone_battle(jsonb);

CREATE OR REPLACE FUNCTION get_isochrone_battle(p_rings jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  result         jsonb    := '[]'::jsonb;
  palier_val     int;
  cumulative     geometry;  -- Toutes les zones déjà réclamées (TOUS paliers confondus)

  ring           jsonb;
  cirfa_id       text;
  nom            text;
  lat_val        float8;
  lng_val        float8;
  own_geom       geometry;
  territory      geometry;
  voronoi_cell   geometry;
  voronoi_coll   geometry;
  extent_buf     geometry;
  clean          geometry;

  props          jsonb;
BEGIN

  -- ── Traiter les paliers du plus petit au plus grand (priorité au plus court) ─
  FOR palier_val IN
    SELECT DISTINCT (r->>'palier')::int
    FROM jsonb_array_elements(p_rings) r
    ORDER BY 1 ASC   -- 10 min avant 30 min avant 60 min → priorité palier ASC
  LOOP

    -- ── 1. Extent élargi de tous les isochrones de CE palier ─────────────────
    SELECT ST_Buffer(
      ST_Extent(
        ST_SetSRID(ST_GeomFromGeoJSON((r->>'geojson')::text), 4326)
      )::geometry,
      2.0
    )
    INTO extent_buf
    FROM jsonb_array_elements(p_rings) r
    WHERE (r->>'palier')::int = palier_val;

    -- ── 2. Voronoï des centres CIRFA de CE palier ────────────────────────────
    --   Calcul une seule fois par palier, pour résoudre les conflits intra-palier
    SELECT ST_VoronoiPolygons(
      ST_Collect(ARRAY(
        SELECT ST_SetSRID(ST_MakePoint((r->>'lng')::float8, (r->>'lat')::float8), 4326)
        FROM jsonb_array_elements(p_rings) r
        WHERE (r->>'palier')::int = palier_val
      )),
      0.0,        -- tolérance
      extent_buf  -- extent : garantit que le Voronoï couvre toute la zone
    )
    INTO voronoi_coll;

    -- ── 3. Traitement de chaque CIRFA pour ce palier ─────────────────────────
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
        RAISE WARNING 'get_isochrone_battle v5: géométrie invalide % (%min)', cirfa_id, palier_val;
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

      -- ── Cellule Voronoï contenant le centre de ce CIRFA ───────────────────
      SELECT vp INTO voronoi_cell
      FROM (
        SELECT (ST_Dump(voronoi_coll)).geom AS vp
      ) v
      WHERE ST_Contains(vp, ST_SetSRID(ST_MakePoint(lng_val, lat_val), 4326))
      LIMIT 1;

      -- ── Territoire = (isochrone ∩ cellule_Voronoï) - zones_déjà_réclamées ─
      --   Étape 1 : découper par Voronoï (conflits intra-palier)
      --   Étape 2 : soustraire le cumulatif (priorité paliers plus petits)
      BEGIN
        IF voronoi_cell IS NULL THEN
          -- Pas de cellule Voronoï (centre hors extent) : utiliser l'isochrone brut
          territory := own_geom;
        ELSE
          territory := ST_Intersection(own_geom, voronoi_cell);
          territory := ST_MakeValid(ST_Buffer(territory, 0));
        END IF;

        -- Soustraire tout ce qui est déjà réclamé (paliers précédents + même palier déjà traité)
        IF cumulative IS NOT NULL AND NOT ST_IsEmpty(cumulative) THEN
          territory := ST_Difference(territory, cumulative);
          territory := ST_MakeValid(ST_Buffer(territory, 0));
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- Fallback robuste : isochrone brut minus cumulative
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
      --   Important : on réserve la zone COMPLÈTE de l'isochrone (pas le territoire
      --   découpé), afin que les paliers suivants ne puissent pas la revendiquer.
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

    END LOOP; -- fin boucle CIRFAs du palier
  END LOOP;   -- fin boucle paliers

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_isochrone_battle(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION get_isochrone_battle(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION get_isochrone_battle(jsonb) TO authenticated;
