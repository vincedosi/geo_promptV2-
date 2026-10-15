-- 253 — Zones à recette (2026-10-14)
--
-- Spec : docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md § 16 (décisions du 14/10), arbitrages A-1, A-2.
-- À l'étape ③, toute sélection devient UNE zone de custom_geo_zones qui garde sa RECETTE (lib/zones/recette.ts),
-- pour être recalculée. Une zone d'avant le 14/10 a recette NULL : forme figée.
--
-- resoudre_perimetre : LA résolution du périmètre de l'étape ①, EN BASE (jamais une géométrie fournie par le client),
--   et la garde commune des recettes lourdes (sql/254-256) : national refusé, type non admis par la recette, inconnu,
--   commune ambiguë, surface > p_max_km2. Mesuré : ST_Area(geography) de la région ARA en < 60 ms.
--   ⚠ La COMMUNE de ① est un texte libre (le nom tapé, en minuscules : panneau-filtre-logique.ts:59, copie React
--   verrouillée). On la résout : code INSEE si p_code en a la forme ; sinon nom normalisé lower(unaccent()) — seq scan
--   de ref_communes, ~40 ms par passage (34 921 lignes ; deux passages pour Paris/Lyon/Marseille), assumé : une fois
--   par calcul ; 2 communes ou plus du même nom
--   (« Saint-Sauveur » : 11) → commune_ambigue ; aucune → les arrondissements « <nom> Ne Arrondissement » unis
--   (ref_communes ne porte ni 75056, ni 69123, ni 13055 : Paris 20, Lyon 9, Marseille 16 arrondissements).
--   Limites connues : « saint etienne » (espace au lieu du tiret) et une apostrophe typographique (« l’isle-adam »)
--   ne résolvent pas — perimetre_inconnu, dit à l'écran. 10,8 % des communes ont un homonyme (1 483 noms, 3 781
--   communes : Saint-Denis ×4, Montreuil ×3, Valence ×3, Saint-Pierre ×9) : le message propose le code INSEE.
-- zone_referencee : qui cite une zone (stratégie de bidding, jeu de zones miroir, composite React, combinaison, recette
--   qui la prend pour PÉRIMÈTRE). Appelée par la route de recalcul AVANT de lancer le calcul (une zone citée ne paie
--   pas un calcul lourd pour recevoir un 409), puis refaite sous verrou par remplacer_geometrie_zone.
--   « composite » couvre AUSSI l'intersection et la différence de « Mes zones » (React et Angular) : elles s'écrivent
--   par /api/custom-geo/save avec source_type 'intersection' / 'difference' mais le même source_metadata.member_zone_ids,
--   et le test `@>` ne regarde pas source_type.
--   Les UUID sont comparés en TEXTE jsonb : creer_zone_recette les range en minuscules (et lireRecette aussi, côté
--   route), sans quoi « 3F25… » échapperait à `@> jsonb_build_array(p_zone_id)` (revue T3).
--   Non vérifié, assumé : campaign_plan_snapshot.zone_id (texte, vide au 14/10) — l'instantané fige des CP, pas la forme.
--   Au lot 5, zone_sets généralisé aura une zone SOURCE : cette fonction devra la lire.
-- creer_zone_recette : refuse une recette qui cite une zone hors de l'espace p_org_id (zones d'une combinaison →
--   {refus: 'zone_introuvable'} ; périmètre « zone » → {refus: 'perimetre_inconnu'}, clés de MESSAGES_REFUS), PUIS
--   create_custom_geo_zone (sql/247 : validation, réparation, ST_Multi), PUIS la recette (UUID en minuscules) et
--   l'auteur, dans la MÊME transaction — une recette refusée par le CHECK n'écrit aucune zone.
-- remplacer_geometrie_zone : le recalcul (A-2). Verrou FOR UPDATE sur la ligne, zone_referencee refaite sous ce verrou.
--   ⚠ Fenêtre restante, assumée : le verrou porte sur la ligne de la zone RECALCULÉE, pas sur celles qui la citent. Un
--   creer_zone_recette concurrent (combinaison ou périmètre qui la cite) qui s'engage entre la vérification et l'UPDATE
--   n'est pas vu (lecture READ COMMITTED) : la nouvelle zone cite alors une forme qui vient de changer. Petite (deux
--   requêtes de ~1 ms), et sans achat en jeu : une stratégie (bidding_strategies) se rattache par une route distincte,
--   lente, après coup. La fermer demanderait un verrou consultatif par zone, pris aussi par creer_zone_recette.
--   Les codes (custom_geo_zone_codes), sous-zones et compteurs de l'ancienne forme sont effacés dans la même
--   transaction : la route les re-résout juste après (resolve_custom_geo_zone_codes).
-- Droits : service_role seul (les routes passent par createAdminClient). Rejouable. Aucun DROP.

begin;

alter table public.custom_geo_zones add column if not exists recette jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'custom_geo_zones_recette_forme') then
    alter table public.custom_geo_zones add constraint custom_geo_zones_recette_forme check (
      recette is null or (
        jsonb_typeof(recette) = 'object'
        and recette->>'v' = '1'
        and recette->>'type' in ('rayon_point', 'rayon_poi', 'seuil_carreaux', 'seuil_territoire', 'codes_postaux',
                                 'dessin', 'import', 'isochrone', 'combinaison', 'capture')
      )
    );
  end if;
end $$;

comment on column public.custom_geo_zones.recette is
  'Recette de la zone (lib/zones/recette.ts, v=1) : ce qui la recalcule. NULL = forme figee (zones d avant le 2026-10-14). sql/253.';

create index if not exists idx_custom_geo_zones_recette_zones
  on public.custom_geo_zones using gin ((recette->'zones')) where recette->>'type' = 'combinaison';

create or replace function public.resoudre_perimetre(
  p_type text, p_code text, p_org_id uuid, p_max_km2 numeric, p_types_admis text[],
  out g geometry, out refus text
)
language plpgsql
stable
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_nom text;
  v_n integer;
begin
  g := null;
  refus := null;
  if p_type = 'france' then
    refus := 'perimetre_national_refuse';
    return;
  end if;
  if p_type is null or not (p_type = any (coalesce(p_types_admis, '{}'::text[]))) then
    refus := 'perimetre_non_admis';
    return;
  end if;

  case p_type
    when 'region' then
      select ST_Multi(geom) into g from public.ref_regions where code_region = p_code;
    when 'departement' then
      select ST_Multi(geom) into g from public.ref_departements where code_dept = p_code;
    when 'cp' then
      select ST_Multi(geom) into g from public.ref_codes_postaux where code_postal = p_code limit 1;
    when 'commune' then
      -- ① met la saisie en minuscules : un code corse arrive « 2a004 » — comparé en majuscules.
      if upper(trim(p_code)) ~ '^[0-9][0-9AB][0-9]{3}$' then
        select ST_Multi(geom) into g from public.ref_communes where code_commune = upper(trim(p_code));
      else
        v_nom := lower(unaccent(trim(p_code)));
        select count(*), ST_Multi(ST_Union(geom)) into v_n, g
          from public.ref_communes where lower(unaccent(nom_commune)) = v_nom;
        if v_n > 1 then
          g := null;
          refus := 'commune_ambigue';
          return;
        end if;
        if v_n = 0 then
          -- Paris, Lyon, Marseille : ref_communes ne porte que leurs arrondissements.
          -- Préfixe comparé par `left()` et non par une regex construite sur la saisie : aucun échappement à écrire.
          -- Vérifié le 14/10 (SELECT) : marseille 16 / 235 km², paris 20 / 105 km², lyon 9 / 48 km².
          select ST_Multi(ST_Union(geom)) into g
            from public.ref_communes
           where left(lower(unaccent(nom_commune)), length(v_nom) + 1) = v_nom || ' '
             and lower(unaccent(nom_commune)) ~ '^[^0-9]+ [0-9]+(er|e) arrondissement$';
        end if;
      end if;
    when 'zone' then
      -- plpgsql et non sql : un cast ::uuid d'un code invalide lèverait, même derrière un CASE replié à la planification.
      -- lower() : un UUID en majuscules désigne la même zone (revue T3).
      if lower(trim(p_code)) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        select z.geometry into g from public.custom_geo_zones z
         where z.id = lower(trim(p_code))::uuid and z.org_id = p_org_id;
      end if;
    else
      g := null;
  end case;

  if g is null or ST_IsEmpty(g) then
    g := null;
    refus := 'perimetre_inconnu';
  elsif ST_Area(g::geography) / 1e6 > p_max_km2 then
    g := null;
    refus := 'perimetre_trop_grand';
  end if;
end
$fn$;

create or replace function public.zone_referencee(p_zone_id uuid)
returns text
language sql
stable
set search_path to 'public', 'pg_catalog'
as $fn$
  select case
    when exists (select 1 from public.bidding_strategies where zone_id = p_zone_id) then 'strategie'
    when exists (select 1 from public.zone_sets where custom_geo_zone_id = p_zone_id) then 'jeu_de_zones'
    when exists (select 1 from public.custom_geo_zones
                  where source_metadata @> jsonb_build_object('member_zone_ids', jsonb_build_array(p_zone_id))) then 'composite'
    when exists (select 1 from public.custom_geo_zones
                  where recette->>'type' = 'combinaison'
                    and recette->'zones' @> jsonb_build_array(p_zone_id)) then 'combinaison'
    when exists (select 1 from public.custom_geo_zones
                  where recette->'perimetre'->>'type' = 'zone'
                    and recette->'perimetre'->>'code' = p_zone_id::text) then 'perimetre'
  end
$fn$;

create or replace function public.creer_zone_recette(
  p_nom text, p_org_id uuid, p_cree_par uuid, p_recette jsonb, p_geometry_geojson text
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_id uuid;
  v_recette jsonb := p_recette;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  -- Les zones CITÉES : rangées en minuscules (zone_referencee compare en texte jsonb), et toutes de l'espace p_org_id.
  -- Un id mal formé ou d'un autre espace est « introuvable » : on ne dit pas qu'il existe ailleurs.
  if jsonb_typeof(v_recette->'zones') = 'array' then
    v_recette := jsonb_set(v_recette, '{zones}', coalesce(
      (select jsonb_agg(lower(x) order by n) from jsonb_array_elements_text(v_recette->'zones') with ordinality e(x, n)),
      '[]'::jsonb));
    if exists (
      select 1 from jsonb_array_elements_text(v_recette->'zones') e(x)
       where not exists (select 1 from public.custom_geo_zones z
                          where z.id = (case when x ~ v_uuid then x::uuid end) and z.org_id = p_org_id)
    ) then
      return jsonb_build_object('refus', 'zone_introuvable');
    end if;
  end if;
  if v_recette->'perimetre'->>'type' = 'zone' then
    -- coalesce : jsonb_set(…, NULL) rendrait NULL et effacerait la recette entière ; un code absent reste refusé.
    v_recette := jsonb_set(v_recette, '{perimetre,code}',
                           coalesce(to_jsonb(lower(trim(v_recette->'perimetre'->>'code'))), 'null'::jsonb));
    if not exists (
      select 1 from public.custom_geo_zones z
       where z.id = (case when v_recette->'perimetre'->>'code' ~ v_uuid then (v_recette->'perimetre'->>'code')::uuid end)
         and z.org_id = p_org_id
    ) then
      return jsonb_build_object('refus', 'perimetre_inconnu');
    end if;
  end if;

  v_id := public.create_custom_geo_zone(
    p_nom, null, p_org_id, 'recette_' || coalesce(v_recette->>'type', 'inconnue'), '{}'::jsonb, p_geometry_geojson
  );
  update public.custom_geo_zones set recette = v_recette, created_by = p_cree_par where id = v_id;
  return jsonb_build_object('id', v_id);
end
$fn$;

create or replace function public.remplacer_geometrie_zone(p_zone_id uuid, p_org_id uuid, p_geometry_geojson text)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_geom geometry;
  v_par text;
begin
  perform 1 from public.custom_geo_zones where id = p_zone_id and org_id = p_org_id for update;
  if not found then
    return jsonb_build_object('refus', 'zone_introuvable');
  end if;

  -- Refaite SOUS le verrou : la route l'a déjà vérifiée avant le calcul, mais une stratégie a pu se rattacher depuis.
  v_par := public.zone_referencee(p_zone_id);
  if v_par is not null then
    return jsonb_build_object('refus', 'zone_referencee', 'par', v_par);
  end if;

  v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_geometry_geojson), 4326);
  if GeometryType(v_geom) not in ('POLYGON', 'MULTIPOLYGON') then
    raise exception 'geometrie non surfacique (%)', GeometryType(v_geom) using errcode = '22023';
  end if;
  if not ST_IsValid(v_geom) then
    v_geom := ST_CollectionExtract(ST_MakeValid(v_geom), 3);
  end if;
  if v_geom is null or ST_IsEmpty(v_geom) then
    raise exception 'geometrie sans surface' using errcode = '22023';
  end if;

  -- Les codes et sous-zones de l'ANCIENNE forme ne la décrivent plus : effacés ici, re-résolus par la route juste après.
  -- Codes d'abord (leur subzone_id passerait sinon à NULL par ON DELETE SET NULL avant d'être supprimés).
  delete from public.custom_geo_zone_codes where zone_id = p_zone_id;
  delete from public.custom_geo_zone_subzones where zone_id = p_zone_id;
  update public.custom_geo_zones
     set geometry = ST_Multi(v_geom), resolved_at = null,
         feature_count_cp = 0, feature_count_iris = 0,
         audience_stats = '{}'::jsonb, audience_computed_at = null,
         items_audience_stats = null, items_audience_computed_at = null
   where id = p_zone_id;
  return jsonb_build_object('remplace', true);
end
$fn$;

revoke all on function public.resoudre_perimetre(text, text, uuid, numeric, text[]) from public, anon, authenticated;
revoke all on function public.zone_referencee(uuid) from public, anon, authenticated;
revoke all on function public.creer_zone_recette(text, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.remplacer_geometrie_zone(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.resoudre_perimetre(text, text, uuid, numeric, text[]) to service_role;
grant execute on function public.zone_referencee(uuid) to service_role;
grant execute on function public.creer_zone_recette(text, uuid, uuid, jsonb, text) to service_role;
grant execute on function public.remplacer_geometrie_zone(uuid, uuid, text) to service_role;

commit;
