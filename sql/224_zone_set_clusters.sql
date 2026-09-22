-- sql/224 — Les GRAPPES d'un jeu de zones (Phase 1 du chantier zones -> CP).
--
-- ── POURQUOI CETTE TABLE ────────────────────────────────────────────────────
--
-- Un jeu de zones ne connaît aujourd'hui que des CLASSES (haut 0-1 km, bas
-- 500 m-1 km...) : sept aplats exclusifs répartis sur toute la France. On peut
-- lire « 2,4 M d'habitants dans la bande haut 2-5 km » mais pas « la vallée de
-- la chimie expose 340 000 personnes » — alors que c'est la seule phrase qu'un
-- media planner prononce.
--
-- Une grappe est un BASSIN : les sites dont les zones se touchent forment un
-- seul objet géographique. La vallée de la chimie est une grappe, pas
-- quarante sites.
--
-- ── LA RÈGLE DE REGROUPEMENT, ET POURQUOI ELLE PORTE SUR LE DERNIER ANNEAU ──
--
-- Deux sites sont dans la même grappe si leurs zones se touchent. « Leur
-- zone », c'est l'anneau EXTÉRIEUR du profil pour leur niveau — le plus grand
-- rayon, celui qui décide de l'étendue réelle. Grouper sur un anneau intérieur
-- ferait éclater en trois grappes ce que l'utilisateur voit comme un bassin
-- continu sur la carte.
--
-- ⚠ `ST_ClusterIntersecting` groupe des géométries qui S'INTERSECTENT, pas des
-- points proches : c'est exactement la question posée, et ça évite d'inventer
-- un seuil de distance arbitraire qu'il faudrait ensuite justifier.
--
-- ── LE PRÉDICAT DES SITES EST CELUI DE sql/220, PAS UNE COPIE ───────────────
--
-- Même catégorie, même exclusion des sites « En fin d'exploitation », même
-- filtre sur la nature DOMINANTE. Recopier ce prédicat en donnerait deux
-- versions qui divergeraient au premier correctif — et la carte montrerait
-- alors des grappes bâties sur des sites que le plan ne compte pas. C'est la
-- leçon de `sites_exposition` (sql/190).

create table if not exists public.zone_set_clusters (
  id           uuid primary key default gen_random_uuid(),
  zone_set_id  uuid not null references public.zone_sets(id) on delete cascade,
  -- Numéro stable dans le jeu, pour que l'interface puisse parler de
  -- « grappe 3 » avant même qu'un nom soit choisi.
  rang         int  not null,
  -- Nom AUTOMATIQUE à la construction, ÉDITABLE ensuite : « Étang de Berre »
  -- ne se devine pas depuis une commune, et un opérateur qui renomme une
  -- grappe ne doit pas voir son nom écrasé au prochain calcul.
  nom          text not null,
  nom_auto     boolean not null default true,
  -- 'haut' dès qu'un site du seuil haut est dans la grappe : c'est la priorité
  -- déjà appliquée partout dans ce module (classe_carreau_risque, sql/204).
  niveau_dominant text not null check (niveau_dominant in ('haut','bas')),
  n_sites      int  not null,
  pop_exposee  bigint,
  geom         geometry(MultiPolygon, 4326),
  geom_3857    geometry(MultiPolygon, 3857),
  created_at   timestamptz not null default now(),
  unique (zone_set_id, rang)
);

comment on table public.zone_set_clusters is
  'Grappes (bassins) d''un jeu de zones : les sites dont les zones se touchent, '
  'regroupes par ST_ClusterIntersecting sur leur anneau EXTERIEUR. Repond a '
  '« la vallee de la chimie expose combien », question a laquelle les classes '
  'ne repondent pas. sql/224.';

comment on column public.zone_set_clusters.nom_auto is
  'false des qu''un humain a renomme la grappe : la reconstruction preserve '
  'alors son nom. Un nom choisi ne se fait pas ecraser par un calcul.';

create index if not exists idx_zsc_zone_set on public.zone_set_clusters (zone_set_id);
create index if not exists idx_zsc_geom_3857 on public.zone_set_clusters using gist (geom_3857);

alter table public.zone_set_clusters enable row level security;

revoke all on public.zone_set_clusters from public, anon, authenticated;
grant select, insert, update, delete on public.zone_set_clusters to service_role;


-- ── La construction ─────────────────────────────────────────────────────────

create or replace function public.construire_zone_set_clusters(
  p_zone_set_id uuid
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_t0        timestamptz := clock_timestamp();
  v_profil    jsonb;
  v_natures   text[];
  v_gravites  text[];
  v_lie       boolean;
  v_haut      int[];
  v_bas       int[];
  v_ords      int[];
  v_filtre    boolean;
  v_noms      jsonb;
  v_n         int;
  v_pop       bigint;
begin
  -- Une construction, pas une lecture d'écran.
  set local statement_timeout = '10min';
  set local work_mem = '64MB';

  select zs.profil, zs.natures, zs.gravites
    into v_profil, v_natures, v_gravites
    from public.zone_sets zs where zs.id = p_zone_set_id;

  if v_profil is null then
    return jsonb_build_object('error', 'jeu_introuvable', 'ok', false);
  end if;

  -- Mêmes clés de profil que sql/220 : `haut`, `bas`, `lie`.
  v_lie := coalesce((v_profil->>'lie')::boolean, false);
  select coalesce(array_agg(x::int order by x::int), '{}')
    into v_haut from jsonb_array_elements_text(coalesce(v_profil->'haut','[]'::jsonb)) x;
  if v_lie then
    v_bas := v_haut;
  else
    select coalesce(array_agg(x::int order by x::int), '{}')
      into v_bas from jsonb_array_elements_text(coalesce(v_profil->'bas','[]'::jsonb)) x;
  end if;

  -- Filtre de nature : MÊME résolution que sql/218-220. Un libellé inconnu est
  -- REFUSÉ et jamais replié sur le seau « non précisée ».
  if v_natures is not null and array_length(v_natures, 1) is not null then
    if array_length(public.natures_inconnues(v_natures), 1) is not null then
      return jsonb_build_object(
        'error', 'natures_inconnues', 'ok', false,
        'natures', public.natures_inconnues(v_natures));
    end if;
    select array_agg(public.ordinal_nature(n)) into v_ords from unnest(v_natures) n;
  end if;
  v_filtre := v_ords is not null and array_length(v_ords, 1) is not null;

  -- On reconstruit : les grappes d'un jeu sont entièrement dérivées de son
  -- profil. Les noms saisis à la main sont récupérés juste après.
  select coalesce(jsonb_object_agg(rang::text, nom), '{}'::jsonb)
    into v_noms from public.zone_set_clusters
   where zone_set_id = p_zone_set_id and nom_auto = false;

  delete from public.zone_set_clusters where zone_set_id = p_zone_set_id;

  with sites as (
    -- Le prédicat de sql/220, à l'identique. Le rayon retenu est l'anneau
    -- EXTÉRIEUR du niveau : c'est lui qui décide si deux zones se touchent.
    select p.id, p.nom, p.ville, p.lng, p.lat,
           case when p.sous_categorie = 'seveso_haut' then 'haut' else 'bas' end as niveau,
           case when p.sous_categorie = 'seveso_haut'
                then v_haut[array_length(v_haut, 1)]
                else v_bas[array_length(v_bas, 1)] end as rayon_m
      from public.poi_france p
     where p.categorie = 'risque_industriel'
       and p.sous_categorie = any(
             coalesce(nullif(v_gravites, '{}'), array['seveso_haut','seveso_bas']))
       and coalesce(p.metadata->>'etat_activite', '') is distinct from 'En fin d''exploitation'
       and p.lng is not null and p.lat is not null
       and (not v_filtre
            or public.ordinal_nature(
                 coalesce(nullif(p.metadata->>'libelle_nature',''), 'Nature non précisée')
               ) = any(v_ords))
  ),
  disques as (
    -- ⚠ `ST_Buffer` sur **geography** : le rayon est en mètres. En 4326,
    -- « 5 km » vaudrait 5 km en latitude et ~3,5 km en longitude à Marseille.
    -- Même raison que sql/155, sql/175 et sql/220.
    select s.*,
           ST_Transform(
             ST_Buffer(ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography,
                       s.rayon_m)::geometry, 3857) as g
      from sites s
     where s.rayon_m is not null and s.rayon_m > 0
  ),
  eclate as (
    -- `ST_ClusterIntersecting` est un AGRÉGAT : il rend un tableau de
    -- géométries, une par grappe. `unnest` les remet en lignes.
    --
    -- ⚠ Chaque élément est une `GeometryCollection` — la COLLECTION des disques
    -- membres, pas leur union. `ST_UnaryUnion` les fond en un seul polygone :
    -- sans lui, l'insertion échoue (« Geometry type GeometryCollection does not
    -- match column type MultiPolygon ») et, si la colonne l'acceptait, la carte
    -- afficherait quarante disques superposés au lieu d'un bassin.
    select ST_Multi(ST_UnaryUnion(brut)) as geom_3857,
           row_number() over (order by ST_Area(brut) desc) as rang
      from (select unnest(ST_ClusterIntersecting(g)) as brut from disques) u
  )
  insert into public.zone_set_clusters
    (zone_set_id, rang, nom, nom_auto, niveau_dominant, n_sites, geom, geom_3857)
  select
    p_zone_set_id,
    e.rang,
    coalesce(
      v_noms->>e.rang::text,
      -- Nom automatique : la commune du site le plus « central » de la grappe,
      -- c'est-a-dire celle qui revient le plus souvent. Un bassin porte le nom
      -- de la commune qui en concentre les installations.
      (select d.ville from disques d
        where ST_Intersects(d.g, e.geom_3857)
        group by d.ville order by count(*) desc, d.ville limit 1),
      'Grappe ' || e.rang
    ),
    v_noms ? e.rang::text is not true,
    -- 'haut' dès qu'un site du seuil haut est dedans : même priorité que
    -- partout ailleurs dans ce module.
    case when exists (select 1 from disques d
                       where d.niveau = 'haut' and ST_Intersects(d.g, e.geom_3857))
         then 'haut' else 'bas' end,
    (select count(*) from disques d where ST_Intersects(d.g, e.geom_3857)),
    ST_Multi(ST_Transform(e.geom_3857, 4326)),
    e.geom_3857
  from eclate e;

  select count(*) into v_n from public.zone_set_clusters where zone_set_id = p_zone_set_id;

  -- ── La population exposée, grappe par grappe ──────────────────────────────
  --
  -- ⚠ LA RETENUE VIENT DE `classe_carreau_risque` (sql/204), PAS D'UN TEST
  -- GÉOMÉTRIQUE — et l'écart n'est pas théorique. Mesuré le 2026-09-22 sur le
  -- profil par défaut, contre les 14 103 578 habitants qu'affiche l'écran :
  --
  --     test sur le POLYGONE du carreau   224 988 carreaux   14 636 073 hab  (+3,8 %)
  --     test sur son CENTROÏDE            214 628 carreaux   14 047 617 hab  (-0,4 %)
  --     règle de distance (celle-ci)      215 732 carreaux   = ce qu'affiche l'écran
  --
  -- Le polygone sur-compte parce qu'un carreau qui effleure la grappe est
  -- compté entier. Le centroïde sous-compte parce que `ST_Buffer` approxime le
  -- cercle par un polygone à 32 côtés, légèrement plus PETIT : des carreaux à
  -- exactement 5 km tombent dehors alors que leur distance les retient. Et ni
  -- l'un ni l'autre ne voit les périmètres PPRT, qui retiennent sans anneau.
  --
  -- Réutiliser la règle unique, c'est garantir que la somme des grappes égale
  -- le total de l'écran. Un tableau qui ne s'additionne pas fait douter le
  -- lecteur, pas le logiciel.
  --
  -- La géométrie ne sert donc qu'à répondre « QUELLE grappe », par le
  -- centroïde ; `<->` rattache à la plus proche les quelques carreaux retenus
  -- par leur distance mais tombés hors des polygones.
  with retenus as (
    select d.carreau_id,
           (c.metadata->>'ind')::numeric as pop,
           ST_Centroid(c.geom_3857) as p
      from public.carreau_risque_distance d
      join public.carreaux_filosofi c on c.id = d.carreau_id
     -- ⚠ La règle rend `'hors'` pour un carreau non retenu, JAMAIS null.
     -- Tester `is not null` retenait les 883 451 carreaux et annonçait
     -- 41 083 838 habitants — le total national, mesuré le 2026-09-22.
     -- Avec ce prédicat : 215 646 carreaux, exactement ce qu'affiche l'écran.
     where public.classe_carreau_risque(
             d.d_haut_m, d.d_bas_m, d.pprt_niveau,
             v_haut, v_bas,
             coalesce((v_profil->>'inclurePPRT')::boolean, true)
           ) <> 'hors'
  ),
  rattaches as (
    select r.pop,
           (select k.id from public.zone_set_clusters k
             where k.zone_set_id = p_zone_set_id
             order by k.geom_3857 <-> r.p
             limit 1) as cluster_id
      from retenus r
  )
  update public.zone_set_clusters zsc
     set pop_exposee = sub.pop
    from (select cluster_id, sum(pop)::bigint as pop
            from rattaches where cluster_id is not null
           group by cluster_id) sub
   where zsc.id = sub.cluster_id;

  select sum(pop_exposee) into v_pop
    from public.zone_set_clusters where zone_set_id = p_zone_set_id;

  return jsonb_build_object(
    'ok', true,
    'zone_set_id', p_zone_set_id,
    'n_clusters', v_n,
    'pop_exposee_totale', v_pop,
    'duree_ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000));
end;
$fn$;

comment on function public.construire_zone_set_clusters is
  'Construit les grappes d''un jeu de zones par ST_ClusterIntersecting sur '
  'l''anneau EXTERIEUR de chaque site. Prédicat de sites identique a sql/220. '
  'Preserve les noms saisis a la main (nom_auto=false). sql/224.';

revoke all on function public.construire_zone_set_clusters(uuid)
  from public, anon, authenticated;
grant execute on function public.construire_zone_set_clusters(uuid) to service_role;
