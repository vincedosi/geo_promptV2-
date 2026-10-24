-- sql/279 — `contours_communes` : les contours des communes d'une liste, simplifiés, pour peindre la maille commune de
-- l'étape ⑤ (TikTok) sur la carte (lot 5, T8 ; plan A-14, mesure M4).
--
-- POURQUOI UNE RPC ET NON UNE LECTURE DE TABLE. `ref_communes.geom` est le contour complet ; simplifiée à 0,001° (≈ 100 m, sous la finesse d'un affichage à l'échelle d'une région) et écrite en GeoJSON à
-- 5 décimales (≈ 1 m), elle tombe à ≈ 0,6 Ko (M4 : ≈ 400 communes, 242 Ko). La simplification se fait en base, une
-- seule fois par contour, et rien de plus lourd ne traverse le réseau.
--
-- jsonb ET BORNÉE (PostgREST coupe à 1 000 lignes, CLAUDE.md) : une liste de 3 000 communes rendue en `setof` serait
-- tronquée en silence. Elle lit `p_max + 1` lignes et refuse au-delà (`trop_de_communes`) — un refus dit, jamais une
-- liste coupée. Plafond par défaut 3 000 : une borne de COÛT (≈ 1,8 Mo au plafond, M4), pas la règle d'une
-- plateforme — celle-ci vit dans `plateformes_geo`.
--
-- Un code absent de `ref_communes` n'est pas rendu (92 codes communaux du carroyage n'y sont pas, mesuré le 24/10) :
-- l'appelant compare et le dit. ⚠ Une commune sans géométrie (`geom` NULL) n'est pas rendue non plus.
--
-- Droits : service_role. Rejouable (`create or replace`, aucun `drop`).

create or replace function public.contours_communes(p_codes text[], p_max integer default 3000)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_n      integer;
  v_lignes jsonb;
begin
  if p_max is null or p_max < 1 then
    raise exception 'plafond de communes invalide : %', p_max using errcode = '22023';
  end if;

  -- `limit p_max + 1` AVANT la simplification : un dépassement se constate sans calculer un seul contour.
  select count(*) into v_n
    from (select 1 from public.ref_communes rc
           where rc.code_commune = any(coalesce(p_codes, '{}')) and rc.geom is not null
           limit p_max + 1) t;
  if v_n > p_max then
    return jsonb_build_object('refus', 'trop_de_communes', 'plafond', p_max);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'code', rc.code_commune,
           'nom', rc.nom_commune,
           'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(rc.geom, 0.001), 5)::jsonb)
         order by rc.code_commune), '[]'::jsonb)
    into v_lignes
    from public.ref_communes rc
   where rc.code_commune = any(coalesce(p_codes, '{}')) and rc.geom is not null;

  return v_lignes;
end
$fn$;

comment on function public.contours_communes(text[], integer) is
  'Contours des communes d''une liste (ref_communes), simplifies a 0,001 et ecrits en GeoJSON a 5 decimales : '
  '[{code, nom, geometry}] trie par code ; refus {refus: trop_de_communes, plafond} au-dela de p_max (lit p_max + 1). '
  'Un code absent ou sans geometrie n''est pas rendu. sql/279 (lot 5, T8).';

revoke all on function public.contours_communes(text[], integer) from public, anon, authenticated;
grant execute on function public.contours_communes(text[], integer) to service_role;
