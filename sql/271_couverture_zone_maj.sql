-- sql/271 — `couverture_zone_en_cache` et `couverture_zone` rendent aussi `zone_maj` (lot 4, T8, relecture I1).
--
-- POURQUOI. L'écran ④ peint le CONTOUR de la zone chiffrée, lu une fois par zone. Un recalcul en ③ garde l'id et change
-- la forme (`updated_at`) : les chiffres suivaient (le cache est indexé sur `updated_at`, sql/270), le contour non — la
-- carte traçait l'ANCIENNE forme autour des nouvelles parts. La réponse porte désormais la version de la forme
-- qu'elle chiffre (`zone_maj`, la clé même du cache) ; l'écran relit le contour quand (zone, zone_maj) change.
--
-- Seul changement : la clé `zone_maj` ajoutée au jsonb rendu (cache : `c.zone_maj` ; calcul : `updated_at` lu AVANT
-- le calcul). Aucune table touchée, aucun `drop` ; `create or replace` rejouable. Les lignes déjà en cache n'ont pas
-- à être réécrites : la clé est ajoutée à la lecture.

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
  'Chiffrage de couverture en cache (|| {cache: true}) s''il est encore valide — zone de l''espace, forme et base '
  'inchangees, base certifiee complete — sinon NULL. Lecture seule. sql/270, zone_maj sql/271 (lot 4, T6, T8).';

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
            calcule_le = excluded.calcule_le;
    exception when foreign_key_violation then
      -- La zone a été supprimée pendant le calcul : le chiffrage est rendu, rien n'est gardé.
      null;
    end;
  end if;

  -- `zone_maj` : la version de la forme chiffrée (lue AVANT le calcul, voir sql/270) — l'écran y indexe le contour.
  return v_res || jsonb_build_object('cache', false, 'zone_maj', v_maj);
end
$fn$;

comment on function public.couverture_zone(uuid, uuid, text, text) is
  'Couverture d''une zone de l''espace : le cache s''il est valide (couverture_zone_en_cache), sinon '
  'couverture_geometrie, dont le chiffrage (jamais un refus) est ecrit au cache. Rend les cles de '
  'couverture_geometrie + cache (true/false) + zone_maj. sql/270, zone_maj sql/271 (lot 4, T6, T8).';

revoke all on function public.couverture_zone(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.couverture_zone(uuid, uuid, text, text) to service_role;
