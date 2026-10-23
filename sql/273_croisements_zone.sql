-- sql/273 — `croisements_zone` : les émetteurs radio et les comptages routiers présents dans une zone enregistrée de
-- l'espace (lot 4, T13 ; étape ④, bloc « Dans cette zone »). Une LECTURE : rien n'est écrit.
--
-- RADIO. Un émetteur est retenu quand son CERCLE de couverture touche la zone. Le rayon varie PAR LIGNE : seul, le
-- prédicat ne sert pas l'index GiST. D'où le pré-filtre `&&` sur l'emprise de la zone élargie du PLUS GRAND rayon (lu en
-- base, ≈ 54 km le 23/10), converti en degrés à la latitude la plus haute de l'emprise (là où un degré de longitude est
-- le plus court : l'élargissement ne manque jamais un cercle). Un émetteur sans rayon n'a pas de cercle : exclu, et
-- compté à part (`n_sans_rayon`, ceux dont le point est dans la zone) — jamais rangé en silence parmi les absents.
-- `plan_cache_mode = force_custom_plan` : après 5 appels sur une même connexion (PostgREST les garde), plpgsql passe
-- au plan GÉNÉRIQUE, aveugle à la zone — 1,3 s devenait 46 s au 6e appel (mesuré le 23/10). C'était le pic de 165 s.
-- Stations : `radios.nom` par `emetteur_radio_stations` (dédoublonnées, triées). `emetteurs_radio` n'a pas de colonne
-- `nom` : le site est `sta_nm_anfr` (numéro ANFR) ; `lieu` est la colonne `commune`, qui porte un lieu-dit ou une
-- adresse (« Pylône TDF »), jamais une commune. Ordre : le plus grand rayon d'abord.
-- ABSENTS, données sources fausses ou vides (23/10) : `frequence_mhz` (87,5 sur 11 599 FM / 11 602), `puissance_w`
-- (vide sur 12 704), `type_comptage` (une seule valeur sur 1 100).
--
-- TRAFIC. Les comptages dont le tronçon INTERSECTE la zone : les 1 100 comptages réels (`tmja_rrn_national` partout le
-- 22/10, plus aucun proxy OSM). `tmja_max` et `tmja_median` portent sur TOUS les comptages de la zone, pas sur la liste
-- bornée. Ordre : TMJA décroissant.
--
-- BORNES. Zone ≤ 100 000 km², le plafond de `couverture_geometrie` (sql/269) et le même refus `zone_trop_vaste`,
-- jugé AVANT toute lecture d'émetteur. Chaque liste rend au plus `p_limite` lignes (1 à 1 000, défaut 200) et
-- `tronque` ; les compteurs `n_*` sont les totaux, pour que l'écran dise « … et 37 autres ». jsonb : PostgREST
-- couperait une table à 1 000 lignes. Refus `zone_introuvable` (absente OU d'un autre espace : même réponse, règle de
-- `couverture_geometrie`). `zone_maj` : la version de la forme lue (`updated_at`) — l'écran périme la liste quand un
-- recalcul en ③ la change.
--
-- MESURES (EXPLAIN (ANALYZE, BUFFERS) de l'appel, base locale, 2e passe, 23/10, vague finale ; « accès » = hit + read) :
--   Bouches-du-Rhône (2 963 sommets)          474 émetteurs, 33 comptages     110 ms · 3 439 accès
--   ARA, contour BRUT (21 811 sommets)        2 437 émetteurs, 279 comptages  1,12 s · 9 356 accès
--   zone `919ca65d` (23 073 sommets, 565 p.)  7 751 émetteurs, 162 comptages  1,70 s · 3 317 accès
--   Du calcul géodésique, pas de l'I/O ; le cache d'arbre de la distance `geography` le garde ∝ candidats, et une
--   distance planaire en 3857 (sans ce cache) a été mesurée PLUS lente : 4,4 s sur `919ca65d`.
-- Droits : service_role. Rejouable (`create or replace`, aucun `drop`).

create or replace function public.croisements_zone(
  p_zone_id uuid,
  p_org_id uuid,
  p_limite integer default 200
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
set plan_cache_mode to 'force_custom_plan'
as $fn$
declare
  c_max_km2 constant numeric := 100000;
  v_geom    geometry;
  v_geog    geography;
  v_maj     timestamptz;
  v_surface numeric;
  v_marge   double precision;
  v_radio jsonb;
  v_trafic jsonb;
begin
  if p_limite is null or p_limite < 1 or p_limite > 1000 then
    raise exception 'limite hors bornes (1 a 1 000) : %', p_limite using errcode = '22023';
  end if;

  select g.geometry, g.updated_at into v_geom, v_maj
    from public.custom_geo_zones g where g.id = p_zone_id and g.org_id = p_org_id;
  if v_geom is null then
    return jsonb_build_object('refus', 'zone_introuvable');
  end if;

  v_geog := v_geom::geography;
  v_surface := ST_Area(v_geog) / 1e6;
  if v_surface > c_max_km2 then
    return jsonb_build_object('refus', 'zone_trop_vaste', 'surface_km2', round(v_surface, 1), 'plafond_km2', c_max_km2);
  end if;

  -- Le plus grand rayon, en degrés à la latitude la plus haute de l'emprise (cos borné : jamais une division par 0).
  select max(e.rayon_couverture_m) / (111320 * greatest(cos(radians(greatest(abs(ST_YMin(v_geom)), abs(ST_YMax(v_geom))))), 0.01))
    into v_marge from public.emetteurs_radio e;

  with retenus as materialized (
    select e.id, e.sta_nm_anfr, e.commune, e.rayon_couverture_m
      from public.emetteurs_radio e
     where e.rayon_couverture_m is not null
       and e.geom && ST_Expand(v_geom, coalesce(v_marge, 0))
       and ST_DWithin(e.geom::geography, v_geog, e.rayon_couverture_m)
  ),
  liste as materialized (
    select r.* from retenus r order by r.rayon_couverture_m desc, r.sta_nm_anfr limit p_limite
  ),
  -- Les noms des 1 175 radios en UNE lecture (80 pages), joints par hachage : sans cette CTE, le planificateur relit
  -- `radios` par sa clé pour chaque lien (13 524 sur les Bouches-du-Rhône, ≈ 48 stations par émetteur) — 43 389 accès
  -- au lieu de 2 897 mesurés.
  noms_radio as materialized (select id, nom from public.radios),
  stations as (
    select s.emetteur_id, jsonb_agg(distinct ra.nom order by ra.nom) as noms
      from liste l
      join public.emetteur_radio_stations s on s.emetteur_id = l.id
      join noms_radio ra on ra.id = s.radio_id
     group by s.emetteur_id
  )
  select jsonb_build_object(
           'n_emetteurs', (select count(*) from retenus),
           'n_sans_rayon', (select count(*) from public.emetteurs_radio e
                             where e.rayon_couverture_m is null and ST_Intersects(e.geom, v_geom)),
           'emetteurs', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'site', l.sta_nm_anfr, 'lieu', nullif(l.commune, ''), 'stations', coalesce(st.noms, '[]'::jsonb))
                      order by l.rayon_couverture_m desc, l.sta_nm_anfr)
               from liste l left join stations st on st.emetteur_id = l.id), '[]'::jsonb),
           'tronque', (select count(*) from retenus) > p_limite)
    into v_radio;

  with retenus as materialized (
    select c.route, c.tmja, c.annee_mesure
      from public.comptages_routiers c
     where ST_Intersects(c.geom, v_geom)
  )
  select jsonb_build_object(
           'n_comptages', (select count(*) from retenus),
           'tmja_max', (select max(tmja) from retenus),
           'tmja_median', (select round(percentile_cont(0.5) within group (order by tmja)) from retenus),
           'comptages', coalesce((
             select jsonb_agg(jsonb_build_object('route', l.route, 'tmja', l.tmja, 'annee_mesure', l.annee_mesure)
                              order by l.tmja desc nulls last, l.route)
               from (select * from retenus order by tmja desc nulls last, route limit p_limite) l), '[]'::jsonb),
           'tronque', (select count(*) from retenus) > p_limite)
    into v_trafic;

  return jsonb_build_object('zone_maj', v_maj, 'radio', v_radio, 'trafic', v_trafic);
end
$fn$;

comment on function public.croisements_zone(uuid, uuid, integer) is
  'Emetteurs radio dont le cercle de couverture touche une zone de l''espace (stations dedoublonnees) et comptages '
  'routiers qui l''intersectent (TMJA max et median sur tous). Listes bornees a p_limite (1..1000) + tronque, '
  'compteurs = totaux, zone_maj = version de la forme. Lecture seule, jsonb, <= 100 000 km2 ; refus zone_introuvable, '
  'zone_trop_vaste. sql/273 (lot 4, T13).';

revoke all on function public.croisements_zone(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.croisements_zone(uuid, uuid, integer) to service_role;
