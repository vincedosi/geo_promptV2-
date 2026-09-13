-- ============================================================================
-- sql/151_zones_booleen.sql — intersection et soustraction de zones (Tâche 14)
--
-- 2026-09-13. Le plan réservait `sql/147` à cette tâche ; 146 à 150 ont été
-- pris entre-temps par les tâches 12, 13 et la page de qualité des données.
--
-- L'UNION existait déjà côté route (`/api/custom-geo/source/composite`) et n'a
-- pas de fonction SQL dédiée : elle se fait par `get_composite_zone_geometry`.
-- Ces deux-ci complètent la famille.
--
-- ── Trois décisions, chacune pour une raison ──────────────────────────────
--
-- 1. `ST_MakeValid` AVANT toute opération. Une géométrie capturée depuis des
--    carreaux ou des isochrones peut être invalide (auto-intersection au
--    recollement des mailles), et `ST_Intersection` LÈVE sur une entrée
--    invalide. Les 7 zones actuelles sont toutes valides — ce n'est pas une
--    raison de retirer le filet, c'est la capture qui fabrique les prochaines.
--
-- 2. `vide: true` plutôt que NULL ou une géométrie vide rendue telle quelle.
--    La route répond alors 409. Sans cela, une zone à ZÉRO code postal serait
--    enregistrée en silence puis poussée vers un DSP : une campagne qui ne
--    diffuse nulle part, sans qu'aucune erreur ne l'ait jamais dit.
--    Les sous-requêtes sont SCALAIRES (et non une jointure croisée de CTE)
--    précisément pour que le cas « uuid inexistant » rende une ligne avec
--    `vide: true`, au lieu de zéro ligne donc un retour NULL de la RPC.
--    Vérifié : intersection avec un uuid absent → `vide: true`, pas d'erreur.
--
-- 3. AUCUN filtre d'organisation ici. Ce sont des fonctions de géométrie ; le
--    contrôle d'accès est la charge des routes, qui appellent `checkZoneAccess`
--    par lots de 3 (plafond de requêtes Supabase simultanées, CLAUDE.md).
--    C'est le même partage des rôles que `codes_postaux_du_perimetre`
--    (sql/146) — dont l'absence de contrôle côté route AVAIT créé un IDOR,
--    trouvé en relecture le même jour. D'où cette ligne : la règle n'est pas
--    évidente, elle doit être écrite.
--
-- Mesure du 2026-09-13 sur zones réelles : intersection CIRFA Bretagne × « Part
-- des 15-29 ans ≥ 30 % » = 50,9 km² ; différence « 15-29 ans » moins « Revenu
-- médian ≥ 27 500 € » = 1 765,81 km².
--
-- Géométries : MULTIPOLYGON en SRID 4326. `ST_CollectionExtract(..., 3)` ne
-- garde que les polygones : une intersection peut produire des points ou des
-- lignes (contact par un bord), qui n'ont aucun sens comme zone d'achat média.
-- Les surfaces sont calculées en `geography` — en 4326, `ST_Area` sur la
-- géométrie rendrait des degrés carrés.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.zone_intersection(p_zone_ids uuid[])
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH inter AS (
    SELECT ST_Multi(ST_CollectionExtract(ST_Intersection(
      (SELECT ST_MakeValid(geometry) FROM public.custom_geo_zones WHERE id = p_zone_ids[1]),
      (SELECT ST_MakeValid(ST_Union(geometry)) FROM public.custom_geo_zones WHERE id = ANY(p_zone_ids[2:]))
    ), 3)) AS g
  )
  SELECT jsonb_build_object(
    'vide', (g IS NULL OR ST_IsEmpty(g)),
    'geometry', CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL ELSE ST_AsGeoJSON(g)::jsonb END,
    'surface_km2', CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN 0
                        ELSE round((ST_Area(g::geography) / 1e6)::numeric, 2) END
  ) FROM inter;
$fn$;

COMMENT ON FUNCTION public.zone_intersection(uuid[]) IS
  'Intersection de zones custom : la premiere avec l union de toutes les autres (Tache 14, sql/151). ST_MakeValid avant toute operation — une geometrie capturee depuis des carreaux ou des isochrones peut etre invalide, et ST_Intersection leve sur une entree invalide. Rend vide=true plutot que NULL quand rien ne se recoupe : la route repond alors 409 au lieu de creer une zone a zero code postal, qui partirait ensuite au DSP. Aucun filtre d organisation ici — c est une fonction de geometrie, le controle d acces est la charge de la route (checkZoneAccess).';

CREATE OR REPLACE FUNCTION public.zone_difference(p_base uuid, p_retires uuid[])
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH diff AS (
    SELECT ST_Multi(ST_CollectionExtract(ST_Difference(
      (SELECT ST_MakeValid(geometry) FROM public.custom_geo_zones WHERE id = p_base),
      (SELECT ST_MakeValid(ST_Union(geometry)) FROM public.custom_geo_zones WHERE id = ANY(p_retires))
    ), 3)) AS g
  )
  SELECT jsonb_build_object(
    'vide', (g IS NULL OR ST_IsEmpty(g)),
    'geometry', CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL ELSE ST_AsGeoJSON(g)::jsonb END,
    'surface_km2', CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN 0
                        ELSE round((ST_Area(g::geography) / 1e6)::numeric, 2) END
  ) FROM diff;
$fn$;

COMMENT ON FUNCTION public.zone_difference(uuid, uuid[]) IS
  'Soustraction : une zone de base moins l union des zones retirees (Tache 14, sql/151). Memes garanties que zone_intersection — ST_MakeValid, vide=true explicite, aucun filtre d organisation (charge de la route).';

REVOKE ALL ON FUNCTION public.zone_intersection(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zone_difference(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zone_intersection(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.zone_difference(uuid, uuid[]) TO service_role;
