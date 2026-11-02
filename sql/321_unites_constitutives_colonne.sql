-- ============================================================================
-- sql/321_unites_constitutives_colonne.sql — B15, round 1 (I-2, ruling du contrôleur, 2026-11-02) : les unités
-- constitutives sortent du JSON `recette` et vont dans une COLONNE dédiée.
--
-- LE DÉFAUT (relecture de B15, I-2). sql/320 faisait poser `recette.unites_constitutives` par le trigger d'écriture,
-- sur TOUTE liste de CP écrite. La base locale est PARTAGÉE : d'autres branches (main, feat/carte-live, -plan,
-- -activation, -analyse, -jeu-de-zones) relisent `recette` en `.strict()` et ne connaissent pas la clé — une liste de
-- CP créée par elles devenait « recette invalide » pour leur propre duplication, extraction ou activation.
--
-- ⚠ MÊME DETTE LATENTE, NON CORRIGÉE ICI : `recette.part_retenue` (A3, sql/307) est posée de la même façon par le
-- trigger dans le JSON d'un `rayon_point` ; une branche dont le schéma ne la connaît pas la refuserait. Signalée au
-- compte rendu (décision du contrôleur : ne pas la corriger dans B15).
--
-- LE CORRECTIF.
--   1. Colonne `custom_geo_zones.unites_constitutives jsonb` (NULL : aucune liste connue → la zone n'est pas exacte
--      par composition). Le serveur la joint à la recette EN MÉMOIRE à la lecture (`recetteVue`,
--      lib/zones/recette-schema.ts) ; `exactitude` la lit ainsi, le JSON stocké reste celui que toute branche relit.
--   2. Le trigger `custom_geo_zones_before_write` (la fonction de sql/320, bloc A3 identique) :
--      - une clé `unites_constitutives` reçue DANS la recette (le serveur l'y met encore à la création, par
--        `creer_zone_recette`, inchangée) est DÉPLACÉE dans la colonne et retirée du JSON ;
--      - liste de CP : colonne dérivée de `codes` ; type autre que seuil sur territoires / capture / liste de CP, ou
--        recette NULL : colonne NULL ;
--      - forme réécrite SANS nouvelles unités (recalcul par `remplacer_geometrie_zone` d'une branche sans B15, écriture
--        directe) : colonne remise à NULL pour un seuil ou une capture — des codes périmés ne certifient jamais une forme
--        qui a changé. Comparaison binaire (`ST_AsBinary`) : l'égalité `=` de PostGIS ne compare que les boîtes ;
--      - maille CP : `groupes_partiels` recompté à chaque écriture (valeur du client écrasée), comme en sql/320.
--        ⚠ (M-2) recompté à l'ÉCRITURE seulement : après une reconstruction de `cp_groupe`, rejouer le rattrapage
--        `update public.custom_geo_zones set unites_constitutives = unites_constitutives where unites_constitutives is not null;`.
--   3. `remplacer_geometrie_zone_unites` (sql/320) : écrit la COLONNE (la forme d'abord, qui l'efface, puis les unités).
--   4. `dupliquer_zone` (sql/294, même signature, même retour) : copie aussi la colonne.
--   5. `codes_postaux_inconnus(p_codes text[]) → jsonb` : les codes absents de `ref_codes_postaux`, triés, sans
--      doublon (round 1, I-1 : une capture ou une liste qui en contient est refusée en 400, codes nommés).
--   6. Déplacement des valeurs posées par sql/320 (JSON → colonne), puis listes de CP sans colonne.
--
-- Base locale le 02/11, avant cette migration : 0 recette portant la clé (seules les zones d'essai, supprimées).
-- Rejouable (`if not exists`, `create or replace`, mises à jour filtrées), aucun DROP. Appliquer par `psql -1`.
-- ============================================================================

alter table public.custom_geo_zones add column if not exists unites_constitutives jsonb;

comment on column public.custom_geo_zones.unites_constitutives is
  'B15 (sql/321) : les unites entieres dont la zone est l''union, { maille: cp|iris, codes[], groupes_partiels? } ; '
  'posee par le serveur (seuil sur territoires, capture de score) ou derivee des codes (liste de CP) par le trigger '
  'custom_geo_zones_before_write, qui compte groupes_partiels au CP. Jamais dans le JSON recette. NULL : non exacte.';

create or replace function public.custom_geo_zones_before_write()
returns trigger
language plpgsql
-- Le réglage d'origine de la fonction, conservé (un `create or replace` sans lui l'effacerait).
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_part numeric;
  v_partiels integer;
  v_recues boolean := false;
begin
  if GeometryType(NEW.geometry) = 'POLYGON' then
    NEW.geometry := ST_Multi(NEW.geometry);
  end if;
  NEW.bbox := ST_Envelope(NEW.geometry);
  NEW.updated_at := now();

  -- A3 (sql/307) : la part du disque retenue sur le territoire, posée par la base, jamais par le client.
  if NEW.recette->>'type' = 'rayon_point'
     and jsonb_typeof(NEW.recette->'lon') = 'number' and jsonb_typeof(NEW.recette->'lat') = 'number'
     and jsonb_typeof(NEW.recette->'rayon_m') = 'number' and (NEW.recette->>'rayon_m')::numeric > 0 then
    v_part := ST_Area(NEW.geometry::geography) / nullif(ST_Area(ST_Buffer(
                ST_SetSRID(ST_MakePoint((NEW.recette->>'lon')::float8, (NEW.recette->>'lat')::float8), 4326)::geography,
                (NEW.recette->>'rayon_m')::float8)), 0);
    if v_part is not null then
      NEW.recette := NEW.recette || jsonb_build_object('part_retenue',
        case when v_part >= 1 - 1e-6 then 1 else least(round(v_part::numeric, 4), 0.9999) end);
    end if;
  end if;

  -- B15 (sql/321) : les unités constitutives vivent dans la COLONNE. Une clé reçue dans la recette y est déplacée.
  if jsonb_typeof(NEW.recette) = 'object' and NEW.recette ? 'unites_constitutives' then
    NEW.unites_constitutives := NEW.recette->'unites_constitutives';
    NEW.recette := NEW.recette - 'unites_constitutives';
    v_recues := true;
  end if;
  if NEW.recette->>'type' = 'codes_postaux' and jsonb_typeof(NEW.recette->'codes') = 'array' then
    NEW.unites_constitutives := jsonb_build_object('maille', 'cp', 'codes', NEW.recette->'codes');
  elsif NEW.recette is null or coalesce(NEW.recette->>'type', '') not in ('seuil_territoire', 'capture') then
    NEW.unites_constitutives := null;
  elsif TG_OP = 'UPDATE' and not v_recues
        and NEW.unites_constitutives is not distinct from OLD.unites_constitutives
        and ST_AsBinary(NEW.geometry) is distinct from ST_AsBinary(OLD.geometry) then
    -- La forme a changé sans nouvelles unités : celles d'avant ne la décrivent plus.
    NEW.unites_constitutives := null;
  end if;

  -- Au CP : les groupes indiscernables présents EN PARTIE (au moins un membre, pas tous) ; la plateforme les achète
  -- entiers, la zone n'est donc pas exacte. Une valeur envoyée par le client est écrasée.
  if NEW.unites_constitutives->>'maille' = 'cp' and jsonb_typeof(NEW.unites_constitutives->'codes') = 'array' then
    select count(*)::integer into v_partiels
      from (select g.code_canonique
              from public.cp_groupe g
              left join (select distinct x as c
                           from jsonb_array_elements_text(NEW.unites_constitutives->'codes') x) l
                on l.c = g.code_postal
             where g.n_membres > 1
             group by g.code_canonique
            having bool_or(l.c is not null) and bool_or(l.c is null)) s;
    NEW.unites_constitutives := NEW.unites_constitutives || jsonb_build_object('groupes_partiels', v_partiels);
  elsif jsonb_typeof(NEW.unites_constitutives) = 'object' then
    NEW.unites_constitutives := NEW.unites_constitutives - 'groupes_partiels';
  end if;
  return NEW;
end
$fn$;

comment on function public.custom_geo_zones_before_write() is
  'Avant ecriture de custom_geo_zones : MultiPolygon, bbox, updated_at ; recette.part_retenue d''un rayon_point (A3, '
  'sql/307) ; colonne unites_constitutives (B15, sql/321) : cle recue dans la recette deplacee dans la colonne, derivee '
  'des codes d''une liste de CP, NULL hors seuil sur territoires / capture / liste de CP ou si la forme change sans '
  'nouvelles unites, groupes_partiels compte au CP. La zone n''est exacte au CP que si groupes_partiels = 0.';

-- Le recalcul (A-2) avec les unités : la forme (qui efface la colonne, le trigger), puis la colonne, sous le même
-- verrou, dans la même transaction. `p_unites` NULL : aucune (le trigger redérive celles d'une liste de CP).
create or replace function public.remplacer_geometrie_zone_unites(
  p_zone_id uuid, p_org_id uuid, p_geometry_geojson text, p_unites jsonb
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v jsonb;
begin
  if p_unites is not null and jsonb_typeof(p_unites) <> 'object' then
    raise exception 'unites constitutives : un objet est attendu' using errcode = '22023';
  end if;
  v := public.remplacer_geometrie_zone(p_zone_id, p_org_id, p_geometry_geojson);
  if v->>'remplace' = 'true' then
    update public.custom_geo_zones set unites_constitutives = p_unites where id = p_zone_id and recette is not null;
  end if;
  return v;
end
$fn$;

comment on function public.remplacer_geometrie_zone_unites(uuid, uuid, text, jsonb) is
  'B15 (sql/320, sql/321) : remplacer_geometrie_zone, puis la colonne unites_constitutives = p_unites (NULL : aucune) '
  'dans la meme transaction. Rend la reponse de remplacer_geometrie_zone.';

revoke all on function public.remplacer_geometrie_zone_unites(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.remplacer_geometrie_zone_unites(uuid, uuid, text, jsonb) to service_role;

-- sql/294, à l'identique, plus la colonne des unités constitutives (une capture copiée reste exacte).
create or replace function public.dupliquer_zone(p_zone_id uuid, p_org_id uuid, p_nom text, p_cree_par uuid)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_id uuid;
  v_km2 numeric;
begin
  if p_nom is null or length(trim(p_nom)) = 0 or length(p_nom) > 200 then
    raise exception 'nom de zone hors bornes (1 a 200 caracteres)' using errcode = '22023';
  end if;

  insert into public.custom_geo_zones (name, description, org_id, created_by, source_type, source_metadata, geometry, recette,
                                       unites_constitutives)
  select trim(p_nom), z.description, z.org_id, p_cree_par, z.source_type,
         (z.source_metadata - 'origine' - 'geography_zone_id' - 'migre_le') || jsonb_build_object('duplique_de', z.id),
         z.geometry, z.recette, z.unites_constitutives
    from public.custom_geo_zones z
   where z.id = p_zone_id and z.org_id = p_org_id
  returning id, round((ST_Area(geometry::geography) / 1e6)::numeric, 2) into v_id, v_km2;

  if v_id is null then
    return jsonb_build_object('refus', 'zone_introuvable');
  end if;

  insert into public.custom_geo_zone_subzones (zone_id, name, source_ref, geometry, ordering, default_multiplier)
  select v_id, s.name, s.source_ref, s.geometry, s.ordering, s.default_multiplier
    from public.custom_geo_zone_subzones s
   where s.zone_id = p_zone_id;

  return jsonb_build_object('id', v_id, 'surface_km2', v_km2);
end
$fn$;

revoke all on function public.dupliquer_zone(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.dupliquer_zone(uuid, uuid, text, uuid) to service_role;

-- Round 1 (I-1) : les codes postaux inconnus du référentiel, triés, sans doublon ; `[]` si tous sont connus.
-- Borné par l'appelant (3 000 codes au plus, schéma de recette) ; une recherche par clé primaire par code.
-- Mesuré le 02/11 (EXPLAIN ANALYZE) : 3 000 codes, 8,4 ms, 6 017 buffers en cache (index ref_codes_postaux_pkey).
create or replace function public.codes_postaux_inconnus(p_codes text[])
returns jsonb
language sql
stable
set search_path to 'public', 'pg_catalog'
as $fn$
  select coalesce(jsonb_agg(c order by c), '[]'::jsonb)
    from (select distinct c from unnest(coalesce(p_codes, '{}'::text[])) c) s
   where not exists (select 1 from public.ref_codes_postaux r where r.code_postal = s.c);
$fn$;

revoke all on function public.codes_postaux_inconnus(text[]) from public, anon, authenticated;
grant execute on function public.codes_postaux_inconnus(text[]) to service_role;

-- Déplacement des valeurs posées par sql/320 dans le JSON (rejouable : la seconde passe ne trouve plus de ligne).
update public.custom_geo_zones
   set unites_constitutives = recette->'unites_constitutives', recette = recette - 'unites_constitutives'
 where recette ? 'unites_constitutives';

-- Les listes de CP sans colonne la reçoivent (le trigger la dérive). ⚠ `updated_at` change sur ces lignes.
update public.custom_geo_zones
   set recette = recette
 where recette->>'type' = 'codes_postaux'
   and unites_constitutives is null;
