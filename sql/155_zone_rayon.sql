-- ============================================================================
-- sql/155_zone_rayon.sql — le rayon comme outil de zone (Tâche 17, 2026-09-13)
--
-- À NE PAS CONFONDRE avec `rayon_poi` / `poisRayon`, qui est un rayon de
-- RECHERCHE de POI et reste où il est. Celui-ci fabrique une géométrie de zone.
--
-- ── Trois décisions, chacune vérifiée ─────────────────────────────────────
--
-- 1. `ST_Buffer` sur `geography`, JAMAIS sur la géométrie. En 4326, un buffer
--    prend son rayon en DEGRÉS : le cercle devient une ellipse de plus en plus
--    fausse vers le nord, et un « rayon de 20 km » n'en fait pas 20. En
--    geography, le rayon est en mètres et suit la sphère.
--    Mesure de contrôle : Paris, rayon 10 km → 312,38 km² (π × 10² = 314,16 ;
--    l'écart est l'approximation polygonale du cercle, 0,6 %).
--
-- 2. Clip sur `france_borders`, comme les isochrones. Vérifié AVANT de
--    l'appliquer : cette table s'étend de −61,8° à 55,8° de longitude et de
--    −21,4° à 51,1° de latitude — elle couvre donc les DROM, malgré son
--    libellé « France metro » dans ARCHITECTURE.md. Un clip aurait sinon
--    effacé toute zone ultramarine.
--    Mesure : Saint-Denis de la Réunion, 15 km → 308 km², non vide.
--
-- 3. `part_retenue` est rendue, et ce n'est pas décoratif. Un rayon posé sur la
--    côte perd une grande part de sa surface dans la mer :
--      Marseille, 20 km  → 60,5 % retenus (755 km² au lieu de 1 257)
--      Saint-Denis, 15 km → 43,9 %
--    Sans ce chiffre AFFICHÉ AVANT l'enregistrement, le média planner croit
--    acheter un disque entier et en achète les trois cinquièmes.
--
-- `vide: true` quand le clip emporte tout (centre en pleine mer) : la route
-- répond alors 409 au lieu d'enregistrer une zone sans surface, qui partirait
-- ensuite vers un DSP. Mesure : (−8,0 ; 46,0), Atlantique → vide.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.zone_rayon(
  p_lon numeric,
  p_lat numeric,
  p_rayon_m integer
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH cercle AS (
    SELECT ST_Buffer(
             ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
             p_rayon_m
           )::geometry AS g
  ), clippe AS (
    SELECT ST_Multi(ST_CollectionExtract(
             ST_Intersection(c.g, (SELECT ST_MakeValid(geom) FROM public.france_borders LIMIT 1)), 3
           )) AS g,
           c.g AS brut
    FROM cercle c
  )
  SELECT jsonb_build_object(
    'vide', (g IS NULL OR ST_IsEmpty(g)),
    'geometry', CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL ELSE ST_AsGeoJSON(g)::jsonb END,
    'surface_km2', CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN 0
                        ELSE round((ST_Area(g::geography) / 1e6)::numeric, 2) END,
    'part_retenue', CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN 0
                         ELSE round((ST_Area(g::geography) / nullif(ST_Area(brut::geography), 0))::numeric, 3) END
  ) FROM clippe;
$fn$;

COMMENT ON FUNCTION public.zone_rayon(numeric, numeric, integer) IS
  'Cercle de rayon donne autour d un point, clippe sur france_borders (Tache 17, sql/155). ST_Buffer sur geography et non sur la geometrie : en degres, un buffer donnerait une ellipse de plus en plus fausse vers le nord et un rayon « 20 km » qui n en ferait pas 20. Rend part_retenue : un rayon pose sur la cote perd la moitie de sa surface dans la mer, et cela doit se voir AVANT l enregistrement. france_borders couvre les DROM (-61,8 a 55,8 de longitude), le clip ne les perd donc pas.';

REVOKE ALL ON FUNCTION public.zone_rayon(numeric, numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zone_rayon(numeric, numeric, integer) TO service_role;
