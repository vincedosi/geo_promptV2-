-- ═══════════════════════════════════════════════════════════════════════════
-- 036_get_isochrone_battle_v3_priority.sql
--
-- Réécriture de get_isochrone_battle : algorithme par priorité (file d'attente).
--
-- Problème v2 : ST_Difference(A, tous_les_autres) pour CHAQUE CIRFA
--   → l'aire commune A∩B est retirée des DEUX → zones blanches.
--
-- Solution v3 : traitement séquentiel par ordre d'aire ASC
--   - Le plus petit isochrone (CIRFA en zone dense) est traité en premier
--     et garde son territoire intégral.
--   - Chaque CIRFA suivant soustrait uniquement les zones déjà allouées.
--   - Résultat : couverture totale sans trous, chaque km² appartient à 1 CIRFA.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_isochrone_battle(jsonb);

CREATE OR REPLACE FUNCTION get_isochrone_battle(p_rings jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  result      jsonb    := '[]'::jsonb;
  palier_val  int;
  cumulative  geometry;           -- Union des isochrones déjà alloués

  ring        jsonb;
  cirfa_id    text;
  nom         text;
  lat_val     float8;
  lng_val     float8;

  own_geom    geometry;
  territory   geometry;
  clean       geometry;
  props       jsonb;
  feat        jsonb;
BEGIN

  -- ── Traiter chaque palier indépendamment ───────────────────────────────────
  FOR palier_val IN
    SELECT DISTINCT (r->>'palier')::int
    FROM jsonb_array_elements(p_rings) r
    ORDER BY 1
  LOOP
    cumulative := NULL;

    -- ── Ordre de priorité : aire ASC ──────────────────────────────────────────
    -- Les plus petits isochrones (zones denses, souvent urbains) passent en
    -- premier et conservent leur territoire complet.
    -- Les plus grands (zones rurales) cèdent l'overlap aux précédents.
    FOR ring IN
      SELECT r
      FROM jsonb_array_elements(p_rings) r
      WHERE (r->>'palier')::int = palier_val
      ORDER BY ST_Area(
        ST_SetSRID(ST_GeomFromGeoJSON((r->>'geojson')::text), 4326)
      ) ASC
    LOOP
      cirfa_id := ring->>'cirfa_id';
      nom      := ring->>'nom';
      lat_val  := (ring->>'lat')::float8;
      lng_val  := (ring->>'lng')::float8;

      -- Charger et valider la géométrie
      BEGIN
        own_geom := ST_SetSRID(ST_GeomFromGeoJSON((ring->>'geojson')::text), 4326);
        own_geom := ST_MakeValid(own_geom);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'get_isochrone_battle v3: géométrie invalide % (%min)', cirfa_id, palier_val;
        CONTINUE;
      END;
      IF own_geom IS NULL OR ST_IsEmpty(own_geom) THEN CONTINUE; END IF;

      -- ── Border : contour original (pour l'affichage des limites) ────────────
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

      -- ── Territoire = isochrone propre - zones déjà allouées ─────────────────
      IF cumulative IS NULL THEN
        territory := own_geom;
      ELSE
        BEGIN
          territory := ST_Difference(own_geom, cumulative);
          territory := ST_Buffer(territory, 0);
          territory := ST_MakeValid(territory);
        EXCEPTION WHEN OTHERS THEN
          territory := own_geom;   -- fallback : isochrone brut
        END;
      END IF;

      -- ── Enregistrer own_geom dans cumulative (AVANT filtre taille) ───────────
      -- Important : on réserve la zone COMPLÈTE même si le territoire découpé
      -- est trop petit — sinon les CIRFAs suivants pourraient la recourir.
      IF cumulative IS NULL THEN
        cumulative := own_geom;
      ELSE
        cumulative := ST_Union(cumulative, own_geom);
      END IF;

      IF territory IS NULL OR ST_IsEmpty(territory) THEN CONTINUE; END IF;

      -- ── Filtre surface : éliminer slivers ────────────────────────────────────
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

      -- ── Ring : territoire final ───────────────────────────────────────────────
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
