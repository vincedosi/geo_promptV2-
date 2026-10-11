-- 248 — Types de POI de l'assistant de clustering, comptés EN BASE (2026-10-11)
--
-- ── Le défaut ────────────────────────────────────────────────────────────────
--
-- `GET /api/poi-clusters/poi-types` lisait `poi_france` SANS pagination
-- (`select('categorie')`) et comptait côté Node. PostgREST coupe toute requête
-- de table à `db-max-rows` = 1 000 (supabase/config.toml), sans erreur : la
-- route comptait 1 000 lignes sur 390 029. L'étape 1 de l'assistant ne
-- proposait donc qu'« arret_transport 1 000 POIs » — un seul type, faux total
-- (constaté au navigateur, lot 4 Angular T20, React compris).
--
-- Elle lisait aussi tout `poi_clusters`, puis `poi_france` par lots de 500 ids
-- pour retrouver la catégorie des POI clusterisés : deux autres lectures
-- coupées à 1 000, et N allers-retours.
--
-- ── Le correctif ─────────────────────────────────────────────────────────────
--
-- Une seule agrégation en base, `RETURNS jsonb` (un scalaire, que PostgREST ne
-- coupe pas) : `[{ type, total, clustered }]`, trié par total décroissant.
--   total      = nombre de POI de la catégorie dans `poi_france`
--   clustered  = nombre de POI DISTINCTS de la catégorie présents dans
--                `poi_clusters`, tous modèles confondus — le sens exact du
--                calcul Node remplacé (un `Set` des `poi_id`).
-- La route ajoute `has_clusters` : la forme de réponse ne change pas.
--
-- Taille du résultat : une ligne par catégorie présente, bornée par la table de
-- référence `poi_categories` (FK `poi_france_categorie_fkey`, 9 lignes le
-- 2026-10-11, 5 catégories peuplées). `jsonb` quand même : la question « combien
-- de lignes au maximum ? » ne se pose plus.
--
-- ── Coût (EXPLAIN (ANALYZE, BUFFERS), base locale, 2026-10-11) ───────────────
--
-- Comptage : Parallel Index Only Scan sur `idx_poi_france_categorie`,
-- 390 029 lignes, 6 797 buffers (tous en cache), ≈ 36 ms. Aucun accès au tas
-- hors heap fetches de la carte de visibilité. Clusterisés : seq scan de
-- `poi_clusters` (95 lignes, 22 buffers) + index `poi_france_pkey` par POI.
-- Appelée à l'ouverture de l'assistant de clustering seulement (super_admin).
--
-- Droits : service_role seul (la route passe par `createAdminClient`).
-- Rejouable. Verrouillé par tests/integration/types-poi-clustering.test.ts.

begin;

create or replace function public.types_poi_clustering()
returns jsonb
language sql
stable
set search_path to 'public', 'pg_catalog'
as $function$
  with totaux as materialized (
    select p.categorie, count(*)::bigint as total
    from public.poi_france p
    group by p.categorie
  ),
  clusterises as materialized (
    select p.categorie, count(distinct c.poi_id)::bigint as clustered
    from public.poi_clusters c
    join public.poi_france p on p.id = c.poi_id
    group by p.categorie
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'type',      t.categorie,
        'total',     t.total,
        'clustered', coalesce(k.clustered, 0)
      )
      order by t.total desc, t.categorie
    ),
    '[]'::jsonb
  )
  from totaux t
  left join clusterises k on k.categorie = t.categorie;
$function$;

comment on function public.types_poi_clustering() is
  'Types de POI de l assistant de clustering : [{type, total, clustered}] trie par total decroissant. Agregation en base, RETURNS jsonb, donc jamais coupee a db-max-rows (sql/248). Appelee par GET /api/poi-clusters/poi-types.';

revoke all on function public.types_poi_clustering() from public, anon, authenticated;
grant execute on function public.types_poi_clustering() to service_role;

notify pgrst, 'reload schema';

commit;
