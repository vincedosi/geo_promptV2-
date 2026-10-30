-- sql/299 — Suppression du Voronoï (décision de Vincent du 30/10/2026, Q-5 du plan « carte en parcours — analyse » :
-- « OK supprimer »). Le Voronoï n'a jamais été porté en Angular ; il ne se lançait plus que par le panneau Analyse
-- React (`GET /api/voronoi`) et la capture de calque (`POST /api/custom-geo/source/voronoi`), retirés dans le même
-- commit que cette migration.
--
-- Fonctions supprimées (les cinq signatures de l'application, aucune autre) :
--   get_voronoi_by_category(text)                                   — version historique, créée hors de sql/ (durcie sql/010)
--   get_voronoi_by_category(text, boolean, text, text, text)        — sql/164, devenue enveloppe en sql/246
--   get_voronoi_by_category_jsonb(text, boolean, text, text, text, integer)  — sql/246
--   get_voronoi_capture_geometry(text, boolean, text, text, text)   — capture de calque, créée hors de sql/
--   get_voronoi_routier_by_category(text, text, text, text, text, boolean, text, text, text) — créée hors de sql/, sans appelant
-- Les fonctions PostGIS `st_voronoipolygons`, `st_voronoilines` et `_st_voronoi` appartiennent à l'extension : elles
-- restent (`couverture_rayon_poi`, sql/272, appelle `ST_VoronoiPolygons`).
--
-- PREUVE AVANT SUPPRESSION (base locale, 30/10/2026) :
--   • `pg_depend` : aucun objet (vue, fonction, contrainte, défaut) ne dépend de ces cinq fonctions ;
--   • aucune vue ne les nomme (`pg_views.definition`) ;
--   • aucune autre fonction ne les appelle : `prosrc ilike '%voronoi%'` hors d'elles ne rend que
--     `couverture_rayon_poi` (ST_VoronoiPolygons de PostGIS) et `alignement_par_maille_geo` (un commentaire) ;
--   • le code (`app`, `lib`, `angular/src`, `scripts`) ne les appelle plus.
-- Le garde-fou ci-dessous REFAIT la première et la troisième vérification à l'exécution : si une dépendance apparaît
-- (une branche qui en recréerait une), la migration lève au lieu de supprimer en cascade.
--
-- DONNÉES : rien n'est supprimé. `analyses.type = 'voronoi'` reste admis (0 ligne en local le 30/10) :
-- `POST /api/analyses/[id]/rejouer` répond 410 `outil_supprime` ; les zones capturées d'un Voronoï
-- (`source_type = 'voronoi_cells'`, 0 en local) gardent leur forme figée et leur libellé.
--
-- Les migrations qui les nomment (010, 164, 246) restent : elles portent l'histoire de la base. Rejouer
-- 246 après 299 recréerait la jumelle sans appelant ; rejouer 299 la supprime de nouveau.
--
-- Rejouable : `drop function if exists`, sans `cascade`.

do $garde$
declare
  v_cibles  oid[];
  v_dep     text;
  v_appel   text;
begin
  select coalesce(array_agg(p.oid), '{}') into v_cibles
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('get_voronoi_by_category', 'get_voronoi_by_category_jsonb', 'get_voronoi_capture_geometry',
                       'get_voronoi_routier_by_category');

  -- Un objet hors de l'ensemble supprimé qui en dépend (vue, défaut, contrainte, fonction SQL à corps lié…).
  select string_agg(pg_describe_object(d.classid, d.objid, d.objsubid), ', ') into v_dep
    from pg_depend d
   where d.refclassid = 'pg_proc'::regclass and d.refobjid = any (v_cibles)
     and d.deptype in ('n', 'a')
     and not (d.classid = 'pg_proc'::regclass and d.objid = any (v_cibles));
  if v_dep is not null then
    raise exception 'sql/299 : suppression du Voronoi refusee, objets dependants : %', v_dep;
  end if;

  -- Une fonction PL/pgSQL hors de l'ensemble qui appelle l'une d'elles (pg_depend ne voit pas ces appels).
  select string_agg(p.oid::regprocedure::text, ', ') into v_appel
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and not (p.oid = any (v_cibles))
     and p.prosrc ~* 'get_voronoi_(by_category|capture_geometry|routier_by_category)';
  if v_appel is not null then
    raise exception 'sql/299 : suppression du Voronoi refusee, fonctions appelantes : %', v_appel;
  end if;
end
$garde$;

-- Les enveloppes d'abord, la jumelle ensuite (aucune dépendance déclarée entre elles, l'ordre est de lisibilité).
drop function if exists public.get_voronoi_by_category(text, boolean, text, text, text);
drop function if exists public.get_voronoi_by_category(text);
drop function if exists public.get_voronoi_capture_geometry(text, boolean, text, text, text);
drop function if exists public.get_voronoi_routier_by_category(text, text, text, text, text, boolean, text, text, text);
drop function if exists public.get_voronoi_by_category_jsonb(text, boolean, text, text, text, integer);

notify pgrst, 'reload schema';
