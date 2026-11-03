-- ============================================================================
-- sql/338_pavage_cercles_cache.sql — D33 : le cache des pavages en cercles (`paver_cercles`) — plan de corrections du
-- découpage des zones, lot 4, décision de Vincent du 03/11/2026 (« simulations de maille gardées, mises en cache »).
--
-- LE CONSTAT. Les simulations qui décident de la maille par défaut en ⑤ (B9, B16) lisent la couverture par territoire
-- (CP, IRIS, commune, département, forme) — déjà en cache par (zone, version, cible, découpage), sql/270 — et un
-- pavage en cercles au rayon par défaut, qui ne l'était PAS : chaque ouverture de ⑤ après un rechargement repavait
-- (0,3 à 1,9 s mesurés le 03/11 sur un rayon de 5 km et sur la composite) et prenait un jeton du quota.
--
-- CE QUE FAIT CETTE MIGRATION. `pavage_cercles_cache`, `pavage_cercles_en_cache` et `paver_cercles_cache`, patron
-- exact de sql/270. Un pavage est gardé par (zone, cible, rayon, seuil, minimum par cercle, plafond de cercles) : la
-- PLATEFORME n'entre pas dans la clé, seules ses limites (qui changent le résultat) y entrent — deux plateformes aux
-- mêmes limites partagent la ligne. Le SEUIL y entre : un pavage ne se rejoue pas en mémoire à un autre seuil (la perte
-- est celle de l'UNION des disques retenus, qui se compte sur les carreaux), à la différence d'une couverture par
-- territoire. Une ligne n'est servie que si TOUTES les conditions tiennent, jugées en SQL :
--   1. la zone est DE L'ESPACE demandé (RLS dormantes : le contrôle est ICI) ;
--   2. `zone_maj = custom_geo_zones.updated_at` — la forme n'a pas changé ;
--   3. `base_construite_le = base_couverture_e7_le()` — ni bande de `carreau_couverture` ni lot E7 reconstruit ;
--   4. `carreau_couverture_complete()` est NULL — base certifiée complète ;
--   5. `fonction_md5` = md5 de la définition COURANTE de `paver_cercles` — une migration qui la remplace périme tout
--      le cache sans le vider (sql/270 n'en a pas besoin : `couverture_geometrie` y est lue sous la même garde de base,
--      mais un pavage a changé six fois de corps, sql/276 → sql/330).
-- Une ÉGALITÉ partout, jamais un ordre. La date de la zone et celle de la base sont lues AVANT le calcul (même
-- raisonnement que sql/270 : au pire un recalcul de trop, jamais un chiffre d'une ancienne forme sous une date neuve).
--
-- REFUS : seuls les refus GÉOMÉTRIQUES s'écrivent — `zone_trop_vaste` et `trop_de_candidates`, qui ne dépendent que
-- de la forme et du rayon (`p_max_candidates` n'est jamais passé : son défaut). C'est le cas de la composite au rayon
-- par défaut (21,5 km) : 0,8 à 1,9 s par refus, refaits à chaque ouverture de ⑤ sans ce cache (mesuré le 03/11).
-- Les autres ne s'écrivent PAS : `trop_de_cercles` déclenche côté route la recherche d'un rayon proposé (B10), qui
-- doit rester celle du moment ; `zone_introuvable`, `cible_inconnue`, `couverture_non_construite` tiennent à l'état
-- de la base ou de la demande, pas à la forme.
--
-- Taille : une ligne par pavage demandé, ≤ quelques centaines de cercles (≈ 30 Ko au plus mesuré). Cascade à la
-- suppression de la zone. Aucune purge : une ligne périmée est réécrite au prochain pavage de la même clé.
-- Droits : service_role seul. RLS activée sans policy. Rejouable (`if not exists`, `create or replace`), aucun DROP.
-- Pas de begin/commit : appliquer par `psql -1`.
-- ============================================================================

create table if not exists public.pavage_cercles_cache (
  zone_id            uuid        not null references public.custom_geo_zones(id) on delete cascade,
  cible              text        not null,
  rayon_m            integer     not null,
  seuil              numeric     not null,
  -- 0 : aucun minimum, aucun plafond (le défaut de `paver_cercles` ; elle refuse un plafond < 1).
  pop_min            integer     not null,
  max_cercles        integer     not null,
  zone_maj           timestamptz not null,
  base_construite_le timestamptz not null,
  fonction_md5       text        not null,
  resultat           jsonb       not null,
  calcule_le         timestamptz not null default now(),
  primary key (zone_id, cible, rayon_m, seuil, pop_min, max_cercles)
);

comment on table public.pavage_cercles_cache is
  'Cache des pavages paver_cercles par (zone, cible, rayon, seuil, pop_min, max_cercles ; 0 = sans). Valide si la '
  'zone est de l''espace, zone_maj = updated_at, base_construite_le = base_couverture_e7_le(), base certifiee et '
  'fonction_md5 = md5 de paver_cercles. Seuls les refus geometriques (zone_trop_vaste, trop_de_candidates) sont '
  'ecrits. sql/338 (D33).';

alter table public.pavage_cercles_cache enable row level security;
revoke all on table public.pavage_cercles_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.pavage_cercles_cache to service_role;

-- La définition courante de `paver_cercles` (une seule signature), pour la condition 5.
create or replace function public.paver_cercles_md5()
returns text
language sql
stable
set search_path to 'public', 'pg_catalog'
as $fn$
  select md5(pg_get_functiondef('public.paver_cercles(uuid, uuid, text, integer, numeric, integer, integer, integer)'::regprocedure))
$fn$;

comment on function public.paver_cercles_md5() is
  'md5 de la definition courante de paver_cercles : une migration qui la remplace perime pavage_cercles_cache. sql/338 (D33).';

revoke all on function public.paver_cercles_md5() from public, anon, authenticated;
grant execute on function public.paver_cercles_md5() to service_role;

-- ── Lecture seule : le pavage en cache s'il est encore valide, sinon NULL ───────────────────────────────────────────
create or replace function public.pavage_cercles_en_cache(
  p_zone_id uuid,
  p_org_id uuid,
  p_cible text,
  p_rayon_m integer,
  p_seuil numeric,
  p_pop_min integer default 0,
  p_max_cercles integer default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
  select c.resultat || jsonb_build_object('cache', true, 'zone_maj', c.zone_maj)
    from public.pavage_cercles_cache c
    join public.custom_geo_zones g on g.id = c.zone_id
   where c.zone_id = p_zone_id
     and c.cible = p_cible
     and c.rayon_m = p_rayon_m
     and c.seuil = p_seuil
     and c.pop_min = coalesce(p_pop_min, 0)
     and c.max_cercles = coalesce(p_max_cercles, 0)
     and g.org_id = p_org_id
     and c.zone_maj = g.updated_at
     and c.base_construite_le = public.base_couverture_e7_le()
     and public.carreau_couverture_complete() is null
     and c.fonction_md5 = public.paver_cercles_md5()
$fn$;

comment on function public.pavage_cercles_en_cache(uuid, uuid, text, integer, numeric, integer, integer) is
  'Pavage en cercles en cache (|| {cache: true, zone_maj}) s''il est encore valide — zone de l''espace, forme, base '
  'et definition de paver_cercles inchangees, base certifiee — sinon NULL. Lecture seule. sql/338 (D33).';

revoke all on function public.pavage_cercles_en_cache(uuid, uuid, text, integer, numeric, integer, integer) from public, anon, authenticated;
grant execute on function public.pavage_cercles_en_cache(uuid, uuid, text, integer, numeric, integer, integer) to service_role;

-- ── Le cache, sinon `paver_cercles` ; écrit le cache pour un pavage ou un refus géométrique ────────────────────────
create or replace function public.paver_cercles_cache(
  p_zone_id uuid,
  p_org_id uuid,
  p_cible text,
  p_rayon_m integer,
  p_seuil numeric,
  p_pop_min integer default 0,
  p_max_cercles integer default null
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
  v_md5  text;
begin
  -- Un autre appel a pu remplir le cache depuis la lecture de la route.
  v_res := public.pavage_cercles_en_cache(p_zone_id, p_org_id, p_cible, p_rayon_m, p_seuil, p_pop_min, p_max_cercles);
  if v_res is not null then
    return v_res;
  end if;

  -- AVANT le calcul (voir l'en-tête) ; NULL pour une zone absente ou d'un autre espace — le pavage le refusera.
  select g.updated_at into v_maj from public.custom_geo_zones g where g.id = p_zone_id and g.org_id = p_org_id;
  v_base := public.base_couverture_e7_le();
  v_md5 := public.paver_cercles_md5();

  v_res := public.paver_cercles(p_zone_id, p_org_id, p_cible, p_rayon_m, p_seuil, coalesce(p_pop_min, 0), p_max_cercles);
  if v_res ? 'refus' and v_res->>'refus' not in ('zone_trop_vaste', 'trop_de_candidates') then
    return v_res;
  end if;

  if v_maj is not null and v_base is not null then
    begin
      insert into public.pavage_cercles_cache as c
        (zone_id, cible, rayon_m, seuil, pop_min, max_cercles, zone_maj, base_construite_le, fonction_md5, resultat, calcule_le)
      values (p_zone_id, p_cible, p_rayon_m, p_seuil, coalesce(p_pop_min, 0), coalesce(p_max_cercles, 0), v_maj, v_base, v_md5, v_res, now())
      on conflict (zone_id, cible, rayon_m, seuil, pop_min, max_cercles) do update
        set zone_maj = excluded.zone_maj,
            base_construite_le = excluded.base_construite_le,
            fonction_md5 = excluded.fonction_md5,
            resultat = excluded.resultat,
            calcule_le = excluded.calcule_le
        where c.zone_maj <= excluded.zone_maj;
    exception when foreign_key_violation then
      -- La zone a été supprimée pendant le calcul : le pavage est rendu, rien n'est gardé.
      null;
    end;
  end if;

  return v_res || jsonb_build_object('cache', false, 'zone_maj', v_maj);
end
$fn$;

comment on function public.paver_cercles_cache(uuid, uuid, text, integer, numeric, integer, integer) is
  'Pavage en cercles d''une zone de l''espace : le cache s''il est valide (pavage_cercles_en_cache), sinon '
  'paver_cercles, dont le pavage (ou un refus geometrique) est ecrit au cache. Rend les cles de paver_cercles + cache + '
  'zone_maj. sql/338 (D33).';

revoke all on function public.paver_cercles_cache(uuid, uuid, text, integer, numeric, integer, integer) from public, anon, authenticated;
grant execute on function public.paver_cercles_cache(uuid, uuid, text, integer, numeric, integer, integer) to service_role;
