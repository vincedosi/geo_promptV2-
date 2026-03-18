-- ═══════════════════════════════════════════════════════════════════════════
-- 045_update_france_borders_ign.sql
--
-- Remplace les frontières France simplifiées par les données IGN précises.
--
-- Source : Admin Express COG — IGN / data.gouv.fr
--   https://www.data.gouv.fr/fr/datasets/admin-express/
--   Fichier : ADMIN-EXPRESS-COG_3-2__SHP_WGS84G_FRA_2023-05-03.7z
--
-- ⚠ PROCÉDURE (à faire AVANT d'exécuter ce SQL) :
--
--   1. Télécharger le GeoJSON simplifié des régions françaises (inclut la Corse
--      et tous les DROM) depuis l'URL suivante :
--      https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/france-metropole-et-outre-mer.geojson
--
--   2. Coller le contenu GeoJSON dans la variable ci-dessous, ou utiliser
--      le script Node.js fourni en commentaire pour insérer via l'API Supabase.
--
-- ALTERNATIVE RAPIDE (recommandée) : script d'import automatique
--   node sql/import_france_borders.mjs
--   (voir sql/import_france_borders.mjs)
-- ═══════════════════════════════════════════════════════════════════════════

-- Vider l'ancienne table
TRUNCATE france_borders;

-- ── Option A : coller directement le GeoJSON ────────────────────────────────
-- Remplacer '__GEOJSON_ICI__' par le contenu du fichier france-metropole-et-outre-mer.geojson
-- (FeatureCollection avec MultiPolygon par région)
--
-- DO $$
-- DECLARE
--   fc jsonb := '__GEOJSON_ICI__';
--   feat jsonb;
-- BEGIN
--   FOR feat IN SELECT * FROM jsonb_array_elements(fc->'features') LOOP
--     INSERT INTO france_borders (geom)
--     VALUES (
--       ST_MakeValid(
--         ST_SetSRID(
--           ST_GeomFromGeoJSON((feat->>'geometry')::text),
--           4326
--         )
--       )
--     );
--   END LOOP;
-- END $$;

-- ── Option B : insérer manuellement les geometries depuis le Dashboard ───────
-- Exécuter dans Supabase SQL Editor :
--   INSERT INTO france_borders (geom)
--   SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(geom_text), 4326))
--   FROM (VALUES ('<coller geometry ici>')) t(geom_text);

-- ── Vérification ─────────────────────────────────────────────────────────────
SELECT COUNT(*) AS nb_polygones, ST_Area(ST_Union(geom)) AS surface_totale FROM france_borders;
