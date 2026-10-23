-- sql/270 — le cache de couverture d'une zone : `couverture_zone_cache`, `couverture_zone_en_cache`, `couverture_zone`
-- (lot 4, T6 ; route `GET /api/zones/[id]/couverture`).
--
-- CE QU'IL FAIT. Un chiffrage `couverture_geometrie` (sql/269) par (zone, cible, découpage) est gardé tant que RIEN de
-- ce qui le produit n'a changé : un second affichage ne coûte qu'une lecture de clé primaire et ne consomme aucun jeton
-- de quota (A-16). Une ligne n'est servie que si les QUATRE conditions tiennent, jugées en SQL dans la même requête :
--   1. la zone est DE L'ESPACE demandé (`custom_geo_zones.org_id = p_org_id`) — correction R-1 de la relecture : sans
--      ce contrôle, l'id d'une zone connu d'un autre espace lirait son chiffrage en cache. Les RLS sont dormantes (la
--      route parle en service_role) : le contrôle est ICI, pas dans une policy ;
--   2. `zone_maj = custom_geo_zones.updated_at` — la forme n'a pas changé (le trigger `custom_geo_zones_before_write`
--      pose `updated_at` à chaque écriture : un renommage périme aussi, un recalcul de trop, jamais un chiffre faux) ;
--   3. `base_construite_le = max(construit_le)` du journal `carreau_couverture_bandes` — correction R-2 : reconstruire
--      la table étroite (une bande, ou tout) périme tout le cache sans le vider ;
--   4. `carreau_couverture_complete()` est NULL — une base qui n'est plus certifiée complète (sql/268) ne sert plus de
--      chiffre ; le calcul, lui, la refuse (`couverture_non_construite`). 27 lignes lues.
-- Une ÉGALITÉ, jamais un ordre : toute différence périme, dans les deux sens.
--
-- POURQUOI `zone_maj` EST LU AVANT LE CALCUL. `couverture_zone` lit `updated_at` dans une instruction, puis calcule
-- dans la suivante (nouvel instantané). Si la zone change entre les deux, le calcul voit la NOUVELLE forme mais la
-- ligne porte l'ANCIENNE date : elle ne sera jamais servie (égalité fausse) — un recalcul de trop. L'inverse (un
-- chiffre d'une ancienne forme sous une date neuve) est impossible : la date est toujours lue AVANT la forme.
-- `base_construite_le` est celle que rend `couverture_geometrie` : lue dans le MÊME instantané que les carreaux.
-- L'écriture ne remplace jamais une ligne plus récente (`where c.zone_maj <= excluded.zone_maj`) : un calcul lent
-- commencé sur l'ancienne forme n'écrase pas celui, fini avant lui, de la nouvelle.
--
-- UN REFUS NE S'ÉCRIT PAS : le cache ne contient que des chiffrages. Les deux fonctions rendent les mêmes clés que
-- `couverture_geometrie`, plus `cache` (true : servi du cache ; false : calculé à l'instant) et `zone_maj` (T8, I1) :
-- la version de la forme chiffrée, la clé même du cache — un recalcul en ③ garde l'id et change la forme, et l'écran
-- relit le contour quand (zone, `zone_maj`) change. Dans la fenêtre décrite plus haut, `zone_maj` désigne l'ANCIENNE
-- forme d'un chiffrage de la nouvelle : le contour est relu une fois de plus, jamais tracé faux.
--
-- Taille : une ligne par chiffrage demandé ; le plus gros (ARA par IRIS, 5 498 lignes) ≈ 400 Ko de jsonb, non compressé. La
-- suppression d'une zone emporte ses lignes (`on delete cascade`). Aucune purge : une ligne périmée est réécrite au
-- prochain chiffrage de la même clé.
--
-- Droits : service_role seul (table et fonctions). RLS activée sans policy. Rejouable (`if not exists`,
-- `create or replace`, aucun `drop`).

create table if not exists public.couverture_zone_cache (
  zone_id            uuid        not null references public.custom_geo_zones(id) on delete cascade,
  cible              text        not null,
  decoupage          text        not null check (decoupage in ('forme', 'cp', 'iris')),
  zone_maj           timestamptz not null,
  base_construite_le timestamptz not null,
  resultat           jsonb       not null,
  calcule_le         timestamptz not null default now(),
  primary key (zone_id, cible, decoupage)
);

comment on table public.couverture_zone_cache is
  'Cache des chiffrages couverture_geometrie par (zone, cible, decoupage). Valide si la zone est de l''espace, '
  'zone_maj = custom_geo_zones.updated_at, base_construite_le = max(carreau_couverture_bandes.construit_le) et la '
  'base certifiee complete. Refus jamais ecrits. sql/270 (lot 4, T6).';

alter table public.couverture_zone_cache enable row level security;
revoke all on table public.couverture_zone_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.couverture_zone_cache to service_role;

-- ── Lecture seule : le chiffrage en cache s'il est encore valide, sinon NULL ──────────────────────────────────────────
create or replace function public.couverture_zone_en_cache(
  p_zone_id uuid,
  p_org_id uuid,
  p_cible text,
  p_decoupage text
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
  select c.resultat || jsonb_build_object('cache', true, 'zone_maj', c.zone_maj)
    from public.couverture_zone_cache c
    join public.custom_geo_zones g on g.id = c.zone_id
   where c.zone_id = p_zone_id
     and c.cible = p_cible
     and c.decoupage = p_decoupage
     and g.org_id = p_org_id
     and c.zone_maj = g.updated_at
     and c.base_construite_le = (select max(b.construit_le) from public.carreau_couverture_bandes b)
     and public.carreau_couverture_complete() is null
$fn$;

comment on function public.couverture_zone_en_cache(uuid, uuid, text, text) is
  'Chiffrage de couverture en cache (|| {cache: true, zone_maj}) s''il est encore valide — zone de l''espace, forme et '
  'base inchangees, base certifiee complete — sinon NULL. Lecture seule. sql/270 (lot 4, T6, T8).';

revoke all on function public.couverture_zone_en_cache(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.couverture_zone_en_cache(uuid, uuid, text, text) to service_role;

-- ── Le cache, sinon le calcul ; écrit le cache pour un chiffrage (jamais pour un refus) ───────────────────────────────
create or replace function public.couverture_zone(
  p_zone_id uuid,
  p_org_id uuid,
  p_cible text,
  p_decoupage text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_res  jsonb;
  v_maj  timestamptz;
  v_base timestamptz;
begin
  -- Un autre appel a pu remplir le cache depuis la lecture de la route.
  v_res := public.couverture_zone_en_cache(p_zone_id, p_org_id, p_cible, p_decoupage);
  if v_res is not null then
    return v_res;
  end if;

  -- AVANT le calcul (voir l'en-tête) ; NULL pour une zone absente ou d'un autre espace — le calcul le refusera.
  select g.updated_at into v_maj from public.custom_geo_zones g where g.id = p_zone_id and g.org_id = p_org_id;

  v_res := public.couverture_geometrie(p_zone_id, p_org_id, p_cible, p_decoupage);
  if v_res ? 'refus' then
    return v_res;
  end if;

  v_base := (v_res->>'base_construite_le')::timestamptz;
  if v_maj is not null and v_base is not null then
    begin
      insert into public.couverture_zone_cache as c (zone_id, cible, decoupage, zone_maj, base_construite_le, resultat, calcule_le)
      values (p_zone_id, p_cible, p_decoupage, v_maj, v_base, v_res, now())
      on conflict (zone_id, cible, decoupage) do update
        set zone_maj = excluded.zone_maj,
            base_construite_le = excluded.base_construite_le,
            resultat = excluded.resultat,
            calcule_le = excluded.calcule_le
        where c.zone_maj <= excluded.zone_maj;
    exception when foreign_key_violation then
      -- La zone a été supprimée pendant le calcul : le chiffrage est rendu, rien n'est gardé.
      null;
    end;
  end if;

  return v_res || jsonb_build_object('cache', false, 'zone_maj', v_maj);
end
$fn$;

comment on function public.couverture_zone(uuid, uuid, text, text) is
  'Couverture d''une zone de l''espace : le cache s''il est valide (couverture_zone_en_cache), sinon '
  'couverture_geometrie, dont le chiffrage (jamais un refus) est ecrit au cache. Rend les cles de '
  'couverture_geometrie + cache (true/false) + zone_maj. sql/270 (lot 4, T6, T8).';

revoke all on function public.couverture_zone(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.couverture_zone(uuid, uuid, text, text) to service_role;
