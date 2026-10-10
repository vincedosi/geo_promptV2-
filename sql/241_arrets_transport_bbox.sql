-- 241 — Arrêts de transport d'une vue, en UN passage (2026-10-10)
--
-- `/api/map/transport` lisait `poi_france` par PostgREST. Avec `db-max-rows`
-- = 1 000, le premier correctif (lecture paginée, commit 9cfbe30f) faisait une
-- requête par page de 1 000 — et CHACUNE refaisait le parcours de l'index de
-- catégorie (285 015 arrêts) puis triait. Mesuré le 2026-10-10 sur la vue de
-- Paris (48,6-49,0 / 2,0-2,6 ; 22 108 arrêts), EXPLAIN (ANALYZE, BUFFERS) :
-- six requêtes, ≈ 177 000 buffers. Ce passage unique, par l'index GIST
-- partiel `idx_poi_france_geom_cat` : ≈ 6 000 buffers.
--
-- Borne : `p_limite` (route : 5 000). On lit `p_limite + 1` lignes : la
-- dernière ne sert qu'à savoir s'il en restait, et `tronque` le DIT. Ordre par
-- `id` : le sous-ensemble rendu d'une vue trop large est stable.
--
-- `geom && enveloppe` pour l'index, `lat`/`lng` pour la sémantique exacte de
-- l'ancienne requête (les deux coïncident sur les 285 015 arrêts : vérifié).
--
-- Périmètre (même règle que `filtrerParSourcesVisibles(..., { referentiels:
-- true })`) : `p_sources` NULL = tout (super_admin) ; sinon les lignes sans
-- source (référentiels) plus celles des sources listées.
--
-- Retour `jsonb` : hors troncature PostgREST des fonctions tabulaires.
-- Réservée à service_role (la route passe par `createAdminClient`).
--
-- Rejouable. Verrouillé par tests/integration/arrets-transport-bbox.test.ts.

begin;

create or replace function public.lire_arrets_transport_bbox(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_types text[] default null,
  p_sources uuid[] default null,
  p_limite integer default 5000
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'extensions', 'pg_catalog'
as $fn$
declare
  resultat jsonb;
begin
  -- EXECUTE … USING : planifiée à CHAQUE appel avec les valeurs réelles. Une
  -- fonction `language sql` (essayée d'abord) reçoit un plan GÉNÉRIQUE : sur
  -- la bbox France il parcourait l'index GIST entier puis triait — 375 000
  -- buffers, contre ≈ 7 000 par la clé primaire avec un plan sur mesure.
  execute $q$
    with lus as materialized (
      select p.id, p.nom, p.lat, p.lng, p.sous_categorie
      from poi_france p
      where p.categorie = 'arret_transport'
        and p.geom && st_makeenvelope($1, $2, $3, $4, 4326)
        and p.lat >= $2 and p.lat <= $4
        and p.lng >= $1 and p.lng <= $3
        and ($5::text[] is null or p.sous_categorie = any($5))
        and ($6::uuid[] is null or p.data_source_id is null or p.data_source_id = any($6))
      order by p.id
      limit $7 + 1
    )
    select jsonb_build_object(
      'arrets', coalesce(
        (select jsonb_agg(to_jsonb(r) order by r.id)
         from (select * from lus order by id limit $7) r),
        '[]'::jsonb),
      'tronque', (select count(*) from lus) > $7
    )
  $q$
  into resultat
  using p_west, p_south, p_east, p_north, p_types, p_sources, p_limite;
  return resultat;
end;
$fn$;

revoke all on function public.lire_arrets_transport_bbox(double precision, double precision, double precision, double precision, text[], uuid[], integer) from public, anon, authenticated;
grant execute on function public.lire_arrets_transport_bbox(double precision, double precision, double precision, double precision, text[], uuid[], integer) to service_role;

notify pgrst, 'reload schema';

commit;
