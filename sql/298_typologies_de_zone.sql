-- sql/298 — Les typologies DÉJÀ calculées des POI d'une zone, en lecture pour tous (④ finitions, T4 ; plan 2026-10-30,
-- arbitrage A-7, écart E3 ; Excel n° 34 « clustering à réintégrer dans ④, sur la zone choisie »).
--
-- `typologies_de_zone(p_zone, p_org, p_sources)` → `{ modeles, pois, tronque, motif }` | `{ refus: zone_introuvable }`.
--   • La zone est DE L'ESPACE (`org_id = p_org`, l'espace de la session) ; sinon `zone_introuvable`.
--   • Seuls les POI VISIBLES de l'espace : `data_source_id is null or = any(p_sources)` — la règle de sql/254, les
--     sources passées par la route (`getOrgSourceIds(…, { vueEspace: true })`). La source CIRFA est privée : un autre
--     espace n'en lit aucune typologie.
--   • Pour chaque (`duration_minutes`, `mode`), le DERNIER modèle (`max(clustering_models.version)`) : une ligne
--     `poi_clusters` d'une version plus ancienne n'est jamais rendue.
--   • `pois` : une ligne par POI et par (durée, mode), au plus 5 000 (`tronque`) ; `modeles` : par (durée, mode),
--     chaque typologie (cluster) avec son libellé, son nombre de POI DANS la zone, la population couverte sommée, et
--     le profil moyen du cluster (`cluster_avg_profile`, le même pour tous ses POI). Comptes et populations portent sur
--     TOUS les POI typés de la zone, pas sur la liste tronquée (bornés par `poi_clusters` lui-même).
--   • Aucune typologie dans la zone : `motif: 'aucun_poi_type'` (l'écran dit que l'équipe dentsu les calcule).
--   • Le CALCUL d'un modèle (`/api/poi-clusters/run`, script Python, ORS) reste réservé au super admin : rien ici
--     n'écrit.
--
-- Le parcours part de `poi_clusters` (190 lignes au 30/10 : 95 CIRFA × 2 versions), joint `poi_france` par clé
-- primaire, puis teste le point dans la zone : aucune lecture de POI non typé.
--
-- Mesuré le 30/10 (EXPLAIN (ANALYZE, BUFFERS) de l'appel, base locale, 2e passe ; « accès » = hit + read) :
--   zone CIRFA Bretagne (4 999 km², espace interne)   2,7 ms · 1 005 accès · 8 lignes (4 CIRFA × 2 modèles) · 5,7 Ko
--     (1re passe : 28 ms · 2 317 accès dont 202 lus)
--   zone composite 13 001 km²                          7,4 ms · 1 602 accès · 90 lignes (la forme de 23 000 sommets
--                                                      compte pour l'essentiel des accès)
--   relecture 1 (comptes par typologie sur TOUS les POI typés de la zone) : composite 79 ms · 1 946 accès en 1re passe ;
--   Bretagne 4,3 ms · 1 005 accès.
--   première version, SANS la barrière `typees` : composite 3,3 s · 342 354 hit + 83 273 lus — l'index GiST de
--   `poi_france` d'abord. D'où la CTE MATERIALIZED.
--
-- Droits : service_role. Rejouable (`create or replace`, aucun `drop`). `RETURNS jsonb` : PostgREST ne coupe rien.

create or replace function public.typologies_de_zone(p_zone uuid, p_org uuid, p_sources uuid[])
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  c_max     constant integer := 5000;
  v_geom    geometry;
  v_pois    jsonb;
  v_modeles jsonb;
  v_n       integer;
begin
  -- Absente OU d'un autre espace : la même réponse, on ne révèle pas qu'elle existe ailleurs.
  select g.geometry into v_geom from public.custom_geo_zones g where g.id = p_zone and g.org_id = p_org;
  if v_geom is null then
    return jsonb_build_object('refus', 'zone_introuvable');
  end if;

  -- Les POI TYPÉS d'abord (CTE MATERIALIZED, 190 lignes au 30/10), joints par clé primaire ; le test spatial ensuite.
  -- Sans cette barrière, le planificateur part de l'index GiST de `poi_france` et lit tous les POI de la zone, arrêts de
  -- transport et sites ICPE compris (mesuré sur la zone composite : 3,3 s, 425 000 accès).
  with typees as materialized (
    select pc.poi_id, p.nom, p.lat, p.lng, p.categorie, p.geom, p.data_source_id, pc.duration_minutes as duree, pc.mode,
           pc.model_version as version, pc.cluster_id, pc.cluster_label, pc.population_totale_couverte as population,
           pc.cluster_avg_profile as profil
      from public.poi_clusters pc
      join public.poi_france p on p.id = pc.poi_id
     where pc.model_version = (select max(m.version) from public.clustering_models m
                                where m.duration_minutes = pc.duration_minutes and m.mode = pc.mode)
  ), dedans as materialized (
    -- TOUS les POI typés de la zone (au plus le nombre de lignes de `poi_clusters` : 190 au 30/10) : les comptes et
    -- populations par typologie sont exacts même quand la liste `pois` est tronquée (relecture 1, groupe A).
    select t.poi_id, t.nom, t.lat, t.lng, t.categorie, t.duree, t.mode, t.version, t.cluster_id, t.cluster_label,
           t.population, t.profil
      from typees t
     where (t.data_source_id is null or t.data_source_id = any (coalesce(p_sources, '{}'::uuid[])))
       and t.geom && v_geom and ST_Intersects(t.geom, v_geom)
  ), gardes as (
    select * from dedans order by duree, mode, cluster_id, poi_id limit c_max
  ), parcluster as (
    select d.duree, d.mode, d.cluster_id, max(d.version) as version, max(d.cluster_label) as label,
           count(*) as n, round(sum(d.population)) as pop, (array_agg(d.profil))[1] as profil
      from dedans d
     group by d.duree, d.mode, d.cluster_id
  ), parmodele as (
    select c.duree, c.mode,
           jsonb_build_object('duree', c.duree, 'mode', c.mode, 'version', max(c.version),
             'typologies', jsonb_agg(jsonb_build_object('cluster_id', c.cluster_id, 'label', c.label,
                             'n_poi', c.n, 'population', c.pop, 'profil', c.profil) order by c.cluster_id)) as o
      from parcluster c
     group by c.duree, c.mode
  )
  select (select count(*) from dedans),
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'poi_id', g.poi_id, 'nom', g.nom, 'lat', g.lat, 'lng', g.lng, 'categorie', g.categorie,
                    'duree', g.duree, 'mode', g.mode, 'version', g.version, 'cluster_id', g.cluster_id,
                    'cluster_label', g.cluster_label, 'population', round(g.population))
                  order by g.duree, g.mode, g.cluster_id, g.poi_id), '[]'::jsonb) from gardes g),
         (select coalesce(jsonb_agg(m.o order by m.duree, m.mode), '[]'::jsonb) from parmodele m)
    into v_n, v_pois, v_modeles;

  return jsonb_build_object(
    'modeles', v_modeles,
    'pois', v_pois,
    'tronque', v_n > c_max,
    'motif', case when v_n = 0 then 'aucun_poi_type' end
  );
end
$fn$;

comment on function public.typologies_de_zone(uuid, uuid, uuid[]) is
  'Typologies deja calculees (poi_clusters, dernier modele par duree et mode) des POI visibles de l''espace '
  '(data_source_id null ou dans p_sources) situes dans une zone de l''espace. { modeles, pois (<= 5 000), tronque, '
  'motif aucun_poi_type } | { refus: zone_introuvable }. Lecture seule. sql/298 (finitions de l''analyse, T4).';

revoke all on function public.typologies_de_zone(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.typologies_de_zone(uuid, uuid, uuid[]) to service_role;

notify pgrst, 'reload schema';
