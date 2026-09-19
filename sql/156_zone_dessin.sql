-- ============================================================================
-- sql/156_zone_dessin.sql — valider un tracé libre (Tâche 18, 2026-09-13)
--
-- Un tracé à main levée croise fréquemment son propre chemin. Le polygone
-- produit est alors INVALIDE, et aucune opération PostGIS ultérieure ne
-- l'accepterait : `ST_Intersection`, `ST_Area`, la résolution des codes
-- postaux lèveraient toutes. Prendre la géométrie du client telle quelle
-- reviendrait donc à enregistrer une zone qui casserait plus tard, ailleurs,
-- et pour une raison illisible.
--
-- `ST_MakeValid` découpe ce « nœud papillon » en polygones valides.
-- Mesure du 2026-09-13 : un carré de 163,23 km² dont on croise deux sommets
-- devient deux triangles de 81,62 km² — exactement la moitié, ce qui est le
-- bon résultat géométrique.
--
-- Ce qui n'est PAS récupérable ressort vide, et la route répond 409 :
--   - moins de trois sommets distincts ;
--   - tracé entièrement hors territoire (mesuré : un carré au large dans
--     l'Atlantique rend `vide: true`).
--
-- ── Deux faits rendus pour être AFFICHÉS ──────────────────────────────────
--
--   `corrige`      le tracé a dû être réparé : la zone enregistrée n'est pas
--                  exactement celle qui a été dessinée, et l'utilisateur doit
--                  le lire plutôt que le découvrir sur la carte.
--   `part_retenue` le clip sur `france_borders` a retiré une part du tracé.
--
-- Même partage des rôles que `zone_intersection` et `zone_rayon` : cette
-- fonction fait de la géométrie, l'autorisation est la charge de la route.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.zone_dessin(p_geojson jsonb)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH brut AS (
    SELECT ST_SetSRID(ST_GeomFromGeoJSON(p_geojson::text), 4326) AS g
  ), valide AS (
    SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(g), 3)) AS g,
           ST_IsValid(g) AS etait_valide
    FROM brut
  ), clippe AS (
    SELECT ST_Multi(ST_CollectionExtract(
             ST_Intersection(v.g, (SELECT ST_MakeValid(geom) FROM public.france_borders LIMIT 1)), 3
           )) AS g,
           v.g AS avant_clip,
           v.etait_valide
    FROM valide v
  )
  SELECT jsonb_build_object(
    'vide', (g IS NULL OR ST_IsEmpty(g)),
    'geometry', CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL ELSE ST_AsGeoJSON(g)::jsonb END,
    'surface_km2', CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN 0
                        ELSE round((ST_Area(g::geography) / 1e6)::numeric, 2) END,
    'corrige', NOT coalesce(etait_valide, false),
    'part_retenue', CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN 0
                         ELSE round((ST_Area(g::geography)
                                     / nullif(ST_Area(avant_clip::geography), 0))::numeric, 3) END
  ) FROM clippe;
$fn$;

COMMENT ON FUNCTION public.zone_dessin(jsonb) IS
  'Trace libre valide et clippe sur france_borders (Tache 18, sql/156). ST_MakeValid rattrape les auto-intersections d un trace a main levee ; ce qui n est pas recuperable ressort vide et la route repond 409 plutot que d enregistrer une zone sans surface. Rend corrige=true quand le trace a du etre repare, et part_retenue quand le clip a retire une partie du trace — les deux doivent se voir, pas se decouvrir.';

REVOKE ALL ON FUNCTION public.zone_dessin(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zone_dessin(jsonb) TO service_role;
