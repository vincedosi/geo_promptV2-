-- sql/340 — D37 (décision de Vincent, 03/11, remplace les paliers de A7 tour 1) : la forme envoyée en maille polygone
-- est TOUJOURS simplifiée à 50 m, à l'extraction seulement, puis ses morceaux de moins d'un carreau sont retirés.
--
-- POURQUOI. sql/313 ne simplifiait qu'au besoin, au palier le plus fin (5, 10, 25, 50 m) qui faisait passer sous les
-- bornes de la plateforme. Or les seules bornes connues sont celles de TTD, et ce sont des VALEURS DE TEST (Q29) : la
-- forme envoyée dépendait donc d'un chiffre sans source. La règle devient fixe : 50 m pour toute forme (sous la
-- résolution du carreau, 200 m), et les morceaux de moins de 0,04 km² (un carreau) — trop petits pour porter un
-- carreau entier, coûteux en morceaux chez la plateforme — retirés et comptés dans la perte.
--
-- CE QUE POSE CETTE MIGRATION.
--   1. `reglages_conversion` : `simplification_polygone_m` (50, sql/312, CHECK ]0, 200[) est RELU, sa description le
--      dit ; les quatre paliers de sql/313 sont déclarés remplacés (plus lus, gardés : un rejeu de sql/313 les
--      recréerait) ; `polygone_morceau_min_km2` = 0,04 (CHECK ]0, 1[), posé une fois.
--   2. `forme_extraction_polygone(p_geom, p_tolerance_m, p_morceau_min_km2)` → geometry : LA forme envoyée —
--      `forme_simplifiee` puis retrait des morceaux dont la surface géodésique est sous le minimum. Rend la forme
--      d'origine à l'octet si rien ne change, NULL si tout serait retiré. Lue par la mesure ET par l'écriture : un seul
--      corps, dérive impossible.
--   3. `simplification_polygone_plateforme` : toujours 50 m puis morceaux retirés ; bornes lues dans le registre,
--      `sous_bornes` sur la forme FINALE (un retrait de morceaux peut faire passer sous la borne des morceaux) ; la bande
--      (différence symétrique, morceaux retirés compris) chiffre perdue et gagnée ; clés `morceaux_retires`,
--      `morceau_min_km2` ; refus `morceaux_tous_retires` (chiffré) si aucun morceau ne reste. Plus de palier.
--   4. `simplification_polygone` (enveloppe, sans plateforme) : même forme, sans borne — `sous_bornes` vrai.
--   5. `creer_extraction_jeu_zone` (corps de sql/319, lignes marquées « D37 ») : lit `tolerance_m` ET `morceau_min_km2`
--      dans le résumé de la plateforme polygone, fige `forme_extraction_polygone(zone, tolérance, minimum)` ; le
--      minimum entre dans l'empreinte à côté de la tolérance (rien d'ajouté sans lui : empreintes existantes inchangées).
--      Même signature, mêmes droits.
--
-- La zone enregistrée (`custom_geo_zones.geometry`) n'est jamais modifiée.
-- Rejouable : `on conflict do nothing`, contrainte gardée par `do`, descriptions réécrites à l'identique,
-- `create or replace`, aucun DROP. Appliquer par `psql -1`.

-- ── 1. Les réglages ──────────────────────────────────────────────────────────────────────────────────────────────────
update public.reglages_conversion
   set description = 'Extraction en maille polygone : tolerance de simplification (m au sol), appliquee a TOUTE forme, '
                     'a l''extraction seulement (la zone enregistree ne change pas). Relue depuis sql/340 (D37). sql/312 (A7).'
 where cle = 'simplification_polygone_m';

update public.reglages_conversion
   set description = 'REMPLACE par simplification_polygone_m (50 m fixe, sql/340, D37) : plus lu. '
                     'Garde pour qu''un rejeu de sql/313 ne le recree pas. sql/313 (A7 tour 1).'
 where cle like 'simplification\_polygone\_palier\_%' and description not like 'REMPLACE%';

insert into public.reglages_conversion (cle, valeur, description)
values ('polygone_morceau_min_km2', 0.04,
        'Extraction en maille polygone : surface minimale (km2, geodesique) d''un morceau de la forme simplifiee ; un '
        'morceau plus petit (moins d''un carreau de 200 m) est retire et sa population comptee dans la perte. sql/340 (D37).')
on conflict (cle) do nothing;

do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.reglages_conversion'::regclass and conname = 'reglages_conversion_morceau_min_borne') then
    alter table public.reglages_conversion
      add constraint reglages_conversion_morceau_min_borne
      check (cle <> 'polygone_morceau_min_km2' or (valeur > 0 and valeur < 1));
  end if;
end
$do$;

-- ── 2. La forme envoyée : simplifiée, petits morceaux retirés ────────────────────────────────────────────────────────
create or replace function public.forme_extraction_polygone(p_geom geometry, p_tolerance_m numeric, p_morceau_min_km2 numeric)
returns geometry
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_s      geometry;
  v_gardes geometry;
  v_n      integer;
  v_n_gardes integer;
begin
  if p_geom is null then
    return null;
  end if;
  if p_morceau_min_km2 is null or p_morceau_min_km2 <= 0 then
    raise exception 'surface minimale d''un morceau hors bornes : %', p_morceau_min_km2 using errcode = '22023';
  end if;
  v_s := public.forme_simplifiee(p_geom, p_tolerance_m);
  select ST_Collect(d.geom order by d.path) filter (where ST_Area(d.geom::geography) >= p_morceau_min_km2 * 1e6),
         count(*), count(*) filter (where ST_Area(d.geom::geography) >= p_morceau_min_km2 * 1e6)
    into v_gardes, v_n, v_n_gardes
    from ST_Dump(v_s) d;
  if v_n_gardes = v_n then
    return v_s;            -- aucun morceau retiré : la forme simplifiée (la zone à l'octet si rien n'a été simplifié)
  end if;
  if v_n_gardes = 0 then
    return null;           -- tout serait retiré : l'appelant refuse
  end if;
  return ST_SetSRID(ST_Multi(v_gardes), ST_SRID(p_geom));
end
$fn$;
comment on function public.forme_extraction_polygone(geometry, numeric, numeric) is
  'LA forme envoyee en maille polygone (D37) : forme_simplifiee a la tolerance, puis retrait des morceaux de surface '
  'geodesique sous le minimum (km2). Forme d''origine a l''octet si rien ne change, NULL si tout serait retire. Lue par '
  'simplification_polygone_plateforme et creer_extraction_jeu_zone. sql/340.';
revoke all on function public.forme_extraction_polygone(geometry, numeric, numeric) from public, anon, authenticated;
grant execute on function public.forme_extraction_polygone(geometry, numeric, numeric) to service_role;

-- ── 3. La mesure : 50 m toujours, morceaux retirés, bornes contrôlées sur la forme finale ────────────────────────────
create or replace function public.simplification_polygone_plateforme(
  p_zone_id uuid, p_org_id uuid, p_cible text, p_plateforme text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  -- Borne de SÉCURITÉ des carreaux lus dans la bande : celle de `couverture_geometrie` (400 000).
  c_max_carreaux constant integer := 400000;
  v_geom     geometry;
  v_simple   geometry;
  v_geom_m   geometry;
  v_simple_m geometry;
  v_tol      numeric;
  v_min_km2  numeric;
  v_smax     integer;
  v_mmax     integer;
  v_n0       integer;
  v_m0       integer;
  v_sous     boolean;
  v_rang     integer;
  v_rang_men integer;
  v_min      numeric;
  v_n_lus    bigint := 0;
  v_perdue   numeric := 0;
  v_gagnee   numeric := 0;
begin
  select g.geometry into v_geom from public.custom_geo_zones g where g.id = p_zone_id and g.org_id = p_org_id;
  if v_geom is null then
    return jsonb_build_object('refus', 'zone_introuvable');
  end if;
  select ce.rang_pop into v_rang from public.cibles_exposition ce
   where ce.code = p_cible and ce.actif and ce.rang_pop is not null;
  if v_rang is null then
    return jsonb_build_object('refus', 'cible_inconnue');
  end if;
  -- A5 : le minimum de ménages de la cible, la règle de `couverture_geometrie` (0 pour la population totale).
  v_min := public.min_menages_de_cible(p_cible);
  select ce.rang_pop into v_rang_men from public.cibles_exposition ce where ce.code = 'men' and ce.rang_pop is not null;
  if v_min > 0 and v_rang_men is null then
    raise exception 'cible men (menages) absente de cibles_exposition : le minimum ne peut pas se lire' using errcode = '55000';
  end if;

  -- Les bornes de la plateforme (NULL = aucune limite connue) ; sans plateforme : aucune borne.
  if p_plateforme is not null then
    select pg.polygone_sommets_max, pg.polygone_morceaux_max into v_smax, v_mmax
      from public.plateformes_geo pg where pg.plateforme = p_plateforme and pg.maille = 'polygone';
    if not found then
      return jsonb_build_object('refus', 'regle_introuvable');
    end if;
  end if;

  -- D37 : les deux réglages, lus UNE fois ici et rendus dans la mesure (l'écriture les relit dans le résumé).
  v_tol := public.reglage_conversion('simplification_polygone_m');
  v_min_km2 := public.reglage_conversion('polygone_morceau_min_km2');

  v_n0 := ST_NPoints(v_geom);
  v_m0 := ST_NumGeometries(v_geom);
  v_simple := public.forme_extraction_polygone(v_geom, v_tol, v_min_km2);
  if v_simple is null then
    return jsonb_build_object('refus', 'morceaux_tous_retires', 'morceaux_avant', v_m0, 'morceau_min_km2', v_min_km2);
  end if;
  v_sous := (v_smax is null or ST_NPoints(v_simple) <= v_smax) and (v_mmax is null or ST_NumGeometries(v_simple) <= v_mmax);

  -- La bande (morceaux retirés compris), lue seulement si la forme envoyée passe (un refus n'a pas de perte à dire).
  if v_sous and v_simple is distinct from v_geom then
    v_geom_m := ST_Transform(v_geom, 3857);
    v_simple_m := ST_Transform(v_simple, 3857);
    with b as materialized (
      select f.pop,
             ST_Intersects(f.centroide_3857, v_geom_m)   as dans_zone,
             ST_Intersects(f.centroide_3857, v_simple_m) as dans_simple
        from public.carreaux_de_forme_menages(ST_SymDifference(v_geom, v_simple), v_rang, coalesce(v_rang_men, v_rang)) f
       where v_min = 0 or f.men >= v_min
       limit c_max_carreaux + 1
    )
    select count(*),
           coalesce(sum(b.pop) filter (where b.dans_zone and not b.dans_simple), 0),
           coalesce(sum(b.pop) filter (where b.dans_simple and not b.dans_zone), 0)
      into v_n_lus, v_perdue, v_gagnee
      from b;
    if v_n_lus > c_max_carreaux then
      return jsonb_build_object('refus', 'trop_de_carreaux', 'plafond', c_max_carreaux);
    end if;
  end if;

  return jsonb_build_object(
    'tolerance_m', v_tol,
    'morceau_min_km2', v_min_km2,
    'simplifiee', v_simple is distinct from v_geom,
    'sous_bornes', v_sous,
    'sommets_max', v_smax,
    'morceaux_max', v_mmax,
    'sommets_avant', v_n0,
    'morceaux_avant', v_m0,
    'sommets', ST_NPoints(v_simple),
    'morceaux', ST_NumGeometries(v_simple),
    'morceaux_retires', v_m0 - ST_NumGeometries(v_simple),
    'carreaux_bande', v_n_lus,
    'perdue', round(v_perdue),
    'gagnee', round(v_gagnee),
    'min_menages', v_min,
    'seuil_perte_affichee', public.reglage_conversion('perte_simplification_affichee')
  );
end
$fn$;
comment on function public.simplification_polygone_plateforme(uuid, uuid, text, text) is
  'Extraction en maille polygone (D37) : forme envoyee = forme_extraction_polygone(zone, simplification_polygone_m, '
  'polygone_morceau_min_km2) — 50 m toujours, morceaux sous 0,04 km2 retires ; sommets / morceaux contre les bornes de '
  'plateformes_geo (sous_bornes) ; population perdue / gagnee sur la seule bande (carreaux_de_forme_menages, minimum de '
  'menages), morceaux retires compris. Refus morceaux_tous_retires. sql/313, sql/340.';
revoke all on function public.simplification_polygone_plateforme(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.simplification_polygone_plateforme(uuid, uuid, text, text) to service_role;

-- ── 4. L'ancienne mesure : enveloppe, sans plateforme donc sans borne ────────────────────────────────────────────────
create or replace function public.simplification_polygone(p_zone_id uuid, p_org_id uuid, p_cible text default 'ind')
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
  select public.simplification_polygone_plateforme(p_zone_id, p_org_id, p_cible, null)
$fn$;
comment on function public.simplification_polygone(uuid, uuid, text) is
  'Enveloppe de simplification_polygone_plateforme sans plateforme : meme forme envoyee (D37), aucune borne. '
  'sql/312, enveloppe depuis sql/313, sql/340.';
revoke all on function public.simplification_polygone(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.simplification_polygone(uuid, uuid, text) to service_role;

-- ── 5. creer_extraction_jeu_zone : tolérance ET morceau minimal, lus dans le résumé, dans l'empreinte ────────────────
CREATE OR REPLACE FUNCTION public.creer_extraction_jeu_zone(p_zone_set_id uuid, p_cp jsonb, p_unites jsonb, p_resume jsonb, p_origine text DEFAULT 'initiale'::text, p_commentaire text DEFAULT ''::text, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t0          timestamptz := clock_timestamp();
  v_jeu         public.zone_sets%rowtype;
  v_cp          jsonb := coalesce(p_cp, '[]'::jsonb);
  v_unites      jsonb := coalesce(p_unites, '[]'::jsonb);
  v_resumes     jsonb := case when jsonb_typeof(p_resume -> 'plateformes') = 'array'
                              then p_resume -> 'plateformes' else '[]'::jsonb end;
  v_plateformes jsonb;
  v_seuil       numeric;
  v_empreinte   text;
  v_existante   public.zone_set_extractions%rowtype;
  v_version     int;
  v_id          uuid;
  v_n_cp        int;
  v_n_unites    int;
  v_tol         numeric;  -- A7 tour 1 (sql/313) : la tolérance RETENUE par la mesure, lue une fois dans le résumé
  v_min_km2     numeric;  -- D37 (sql/340) : le morceau minimal de la mesure, lu une fois dans le résumé
  v_forme       geometry; -- D37 : la forme figée, calculée avant l'empreinte (refus si tout serait retiré)
  -- B12 (sql/317) : le plan de CHAQUE plateforme au CP, `[{plateforme, seuil, lignes: [...]}]` ; absent = aucun.
  v_plans       jsonb := case when jsonb_typeof(p_resume -> 'plans_plateformes') = 'array'
                              then p_resume -> 'plans_plateformes' else '[]'::jsonb end;
  v_n_plans     int := 0;
  -- B14 (sql/319) : une unité porte `bloc` quand sa maille dépasse la limite d'unités (découpage ARB-6) ; absent sinon.
begin
  select * into v_jeu from public.zone_sets where id = p_zone_set_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'jeu_introuvable');
  end if;
  if v_jeu.type <> 'zone' then
    return jsonb_build_object('ok', false, 'error', 'type_non_zone');
  end if;
  -- Deux tests et non un `or` : SQL ne garantit pas l'ordre d'évaluation, et jsonb_array_length lève sur un objet.
  if jsonb_typeof(v_cp) <> 'array' or jsonb_typeof(v_unites) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'plan_vide');
  end if;
  if jsonb_array_length(v_cp) + jsonb_array_length(v_unites) = 0 then
    return jsonb_build_object('ok', false, 'error', 'plan_vide');
  end if;

  if exists (select 1 from jsonb_array_elements(v_unites) e
              where not exists (select 1 from public.zone_set_plateformes zp
                                 where zp.zone_set_id = p_zone_set_id
                                   and zp.plateforme = e ->> 'plateforme' and zp.maille = e ->> 'maille'))
     or (jsonb_array_length(v_cp) > 0
         and not exists (select 1 from public.zone_set_plateformes
                          where zone_set_id = p_zone_set_id and maille = 'cp'))
     -- B12 : un plan par plateforme n'existe que pour une plateforme choisie AU CP, et ses lignes forment un tableau.
     -- Tour 1 (M-5) : une plateforme, un plan — un doublon serait absorbé en silence par `on conflict do nothing`.
     or (select count(*) <> count(distinct p ->> 'plateforme') from jsonb_array_elements(v_plans) p)
     or exists (select 1 from jsonb_array_elements(v_plans) p
                 where jsonb_typeof(p) <> 'object' or jsonb_typeof(p -> 'lignes') is distinct from 'array'
                    or not exists (select 1 from public.zone_set_plateformes zp
                                    where zp.zone_set_id = p_zone_set_id
                                      and zp.plateforme = p ->> 'plateforme' and zp.maille = 'cp')) then
    return jsonb_build_object('ok', false, 'error', 'unites_hors_choix');
  end if;

  -- Le CHOIX vient de la base, les CHIFFRES du résumé calculé par le serveur : le choix l'emporte sur une clé
  -- homonyme du résumé, un résumé ne réécrit pas ce qui a été enregistré.
  select coalesce(jsonb_agg(coalesce(r.resume, '{}'::jsonb)
                            || jsonb_build_object('plateforme', zp.plateforme, 'maille', zp.maille,
                                                  'seuil', zp.seuil, 'rayon_m', zp.rayon_m)
                            order by zp.plateforme), '[]'::jsonb)
    into v_plateformes
    from public.zone_set_plateformes zp
    left join lateral (select e as resume from jsonb_array_elements(v_resumes) e
                        where jsonb_typeof(e) = 'object' and e ->> 'plateforme' = zp.plateforme
                        limit 1) r on true
   where zp.zone_set_id = p_zone_set_id;

  -- `seuil_couverture_cp` dit le seuil du PLAN CP de cette extraction : le plus bas des plateformes au CP (le plan
  -- est leur sur-ensemble, décision du contrôleur, relecture T6) ; à défaut (aucune plateforme au CP), la valeur du
  -- jeu. Le seuil de chaque plateforme est dans `plateformes`, ses CP dans `zone_set_extraction_unites`.
  select min(seuil) into v_seuil from public.zone_set_plateformes
   where zone_set_id = p_zone_set_id and maille = 'cp';
  v_seuil := coalesce(v_seuil, v_jeu.seuil_couverture_cp);

  -- A7 tour 1 (sql/313) : la tolérance de simplification du polygone, celle que `simplification_polygone_plateforme` a
  -- retenue et que la route a mise dans le résumé de la plateforme (`simplification.tolerance_m`) — jamais relue dans
  -- `reglages_conversion` ici (un réglage changé entre la mesure et l'écriture ferait figer une autre forme). La plus
  -- grossière si plusieurs plateformes sont au polygone (une seule forme figée). Absente ou 0 : forme telle quelle.
  select max((e -> 'simplification' ->> 'tolerance_m')::numeric) into v_tol
    from jsonb_array_elements(v_resumes) e
   where jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'simplification') = 'object'
     and exists (select 1 from public.zone_set_plateformes zp
                  where zp.zone_set_id = p_zone_set_id and zp.plateforme = e ->> 'plateforme' and zp.maille = 'polygone');
  if v_tol is not null and v_tol <= 0 then
    v_tol := null;
  end if;
  -- D37 (sql/340) : le morceau minimal que la mesure a appliqué (`simplification.morceau_min_km2`), lu de la même façon
  -- (le plus grand si plusieurs plateformes au polygone) ; absent (résumé d'avant D37) ou sans tolérance : aucun retrait.
  select max((e -> 'simplification' ->> 'morceau_min_km2')::numeric) into v_min_km2
    from jsonb_array_elements(v_resumes) e
   where jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'simplification') = 'object'
     and exists (select 1 from public.zone_set_plateformes zp
                  where zp.zone_set_id = p_zone_set_id and zp.plateforme = e ->> 'plateforme' and zp.maille = 'polygone');
  if v_tol is null or (v_min_km2 is not null and v_min_km2 <= 0) then
    v_min_km2 := null;
  end if;
  -- D37 : la forme figée — celle dont la mesure a compté sommets et morceaux (`forme_extraction_polygone`, le même corps).
  select case when v_min_km2 is not null then public.forme_extraction_polygone(z.geometry, v_tol, v_min_km2)
              when v_tol is not null then public.forme_simplifiee(z.geometry, v_tol)
              else z.geometry end
    into v_forme
    from public.custom_geo_zones z where z.id = v_jeu.custom_geo_zone_id;
  if v_min_km2 is not null and v_forme is null then
    return jsonb_build_object('ok', false, 'error', 'morceaux_tous_retires');
  end if;

  select md5(concat_ws('|',
           v_jeu.mode_plan,
           (select string_agg(concat_ws(':', plateforme, maille, seuil::text, coalesce(rayon_m::text, '')), ','
                              order by plateforme)
              from public.zone_set_plateformes where zone_set_id = p_zone_set_id),
           (select coalesce(string_agg(k, ',' order by k collate "C"), '')
              from (select concat_ws(':', e ->> 'code_postal',
                                     round(coalesce((e ->> 'multiplicateur')::numeric, 0), 3)::text) as k
                      from jsonb_array_elements(v_cp) e) c),
           (select coalesce(string_agg(k, ',' order by k collate "C"), '')
              from (select concat_ws(':', e ->> 'plateforme', e ->> 'maille', coalesce(e ->> 'code', ''),
                                     coalesce(round((e ->> 'lon')::numeric, 6)::text, ''),
                                     coalesce(round((e ->> 'lat')::numeric, 6)::text, ''),
                                     coalesce(e ->> 'rayon_m', ''),
                                     coalesce((e ->> 'retenu')::boolean, false)::text,
                                     coalesce(round((e ->> 'part')::numeric, 3)::text, ''),
                                     coalesce(round((e ->> 'pop_en_zone')::numeric)::text, ''),
                                     coalesce(round((e ->> 'pop_totale')::numeric)::text, '')) as k
                      from jsonb_array_elements(v_unites) e) u),
           -- A7 tour 1 : la tolérance retenue entre dans l'empreinte (NULL sans simplification : `concat_ws` l'ignore,
           -- l'empreinte des extractions sans polygone simplifié est inchangée).
           case when v_tol is not null then 'polygone_tolerance_m:' || v_tol::text end,
           -- D37 : le morceau minimal à côté (NULL sans lui : empreintes d'avant D37 inchangées).
           case when v_min_km2 is not null then 'polygone_morceau_min_km2:' || v_min_km2::text end,
           -- B12 (sql/317) : les plans par plateforme `plateforme:code:multiplicateur`, triés. NULL sans plan par
           -- plateforme (`concat_ws` l'ignore : l'empreinte d'une extraction sans plateforme au CP est inchangée).
           -- ⚠ La plateforme est lue UNE fois par plan (CTE matérialisée) : `p ->> 'plateforme'` par LIGNE relisait l'objet
           -- entier du plan à chaque code — mesuré 72,6 s pour 6 000 codes, contre 0,1 s ainsi.
           (with plans as materialized (
              select p ->> 'plateforme' as plateforme, p -> 'lignes' as lignes from jsonb_array_elements(v_plans) p)
            select 'plans:' || string_agg(k, ',' order by k collate "C")
              from (select concat_ws(':', x.plateforme, l ->> 'code_postal',
                                     round(coalesce((l ->> 'multiplicateur')::numeric, 0), 3)::text) as k
                      from plans x, jsonb_array_elements(x.lignes) l) c
            having count(*) > 0),
           -- B14 (sql/319) : les blocs `plateforme:maille:code:bloc`, triés. NULL sans découpage (`concat_ws` l'ignore :
           -- l'empreinte d'une extraction sans bloc est inchangée). Une limite changée dans le registre change les blocs,
           -- donc l'empreinte : la ré-extraction fait une nouvelle version, pas un `deja_extraite` aux anciens blocs.
           (select 'blocs:' || string_agg(k, ',' order by k collate "C")
              from (select concat_ws(':', e ->> 'plateforme', e ->> 'maille', coalesce(e ->> 'code', ''), e ->> 'bloc') as k
                      from jsonb_array_elements(v_unites) e
                     where jsonb_typeof(e -> 'bloc') = 'number') b
            having count(*) > 0)))
    into v_empreinte;

  -- ⚠ Le verrou couvre la lecture d'idempotence ET l'attribution du numéro (leçon de sql/159, comme sql/231).
  perform pg_advisory_xact_lock(hashtext('zone_set_extraction'), hashtext(p_zone_set_id::text));

  select * into v_existante from public.zone_set_extractions
   where zone_set_id = p_zone_set_id and empreinte = v_empreinte;
  if found then
    return jsonb_build_object(
      'ok', true, 'deja_extraite', true,
      'id', v_existante.id, 'version', v_existante.version,
      'origine', v_existante.origine, 'created_at', v_existante.created_at,
      'n_cp', v_existante.n_cp, 'n_retenus', v_existante.n_retenus,
      'taux_utile', v_existante.taux_utile, 'part_plan_en_zone', v_existante.part_plan_en_zone,
      'plateformes', v_existante.plateformes,
      'duree_ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000));
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.zone_set_extractions where zone_set_id = p_zone_set_id;

  insert into public.zone_set_extractions (
    zone_set_id, version, origine, commentaire, seuil_couverture_cp, mode_plan,
    n_cp, n_retenus, taux_utile, part_plan_en_zone, population_exposee,
    empreinte, created_by, plateformes, forme, resume_plan
  ) values (
    p_zone_set_id, v_version,
    coalesce(nullif(p_origine, ''), 'initiale'), coalesce(p_commentaire, ''),
    v_seuil, v_jeu.mode_plan,
    coalesce((p_resume ->> 'n_cp')::int, jsonb_array_length(v_cp)),
    coalesce((p_resume ->> 'n_retenus')::int, 0),
    (p_resume ->> 'taux_utile')::numeric,
    (p_resume ->> 'part_plan_en_zone')::numeric,
    coalesce((p_resume ->> 'population_exposee')::numeric, 0),
    v_empreinte, p_created_by, v_plateformes,
    -- D37 (sql/340) : au polygone, la forme envoyée (50 m, petits morceaux retirés) calculée plus haut ; telle quelle
    -- sans simplification.
    v_forme,
    -- A8 (sql/306) : le bilan du plan CP (séquence E4 et ligne HORS_ZONE, A1) et la façon dont la part prévue a été
    -- formée. Avant sql/306 ce bilan était envoyé puis JETÉ : la ligne HORS_ZONE n'était figée nulle part.
    nullif(jsonb_strip_nulls(jsonb_build_object('multiplicateur', p_resume -> 'multiplicateur',
                                                'part_prevue', p_resume -> 'part_prevue')), '{}'::jsonb)
  )
  returning id into v_id;

  -- Les CP : mêmes colonnes et mêmes replis que sql/231 ; pas de grappe pour un jeu de zone.
  insert into public.zone_set_extraction_cp (
    extraction_id, code_postal, code_canonique, classe, pop_en_zone, pop_totale, part_en_zone, retenu, multiplicateur,
    part_prevue
  )
  select v_id, e ->> 'code_postal',
         coalesce(nullif(e ->> 'code_canonique', ''), e ->> 'code_postal'),
         coalesce(e ->> 'classe', 'hors'),
         (e ->> 'pop_en_zone')::numeric, (e ->> 'pop_totale')::numeric, (e ->> 'part_en_zone')::numeric,
         coalesce((e ->> 'retenu')::boolean, false),
         least(greatest(coalesce((e ->> 'multiplicateur')::numeric, 0), 0), 999.999),
         (e ->> 'part_prevue')::numeric  -- A8 : part prévue E5, NULL hors plan ou à volume inconnu
    from jsonb_array_elements(v_cp) e
  on conflict (extraction_id, code_postal) do nothing;
  get diagnostics v_n_cp = row_count;

  insert into public.zone_set_extraction_unites (
    extraction_id, plateforme, maille, ordinal, code, nom, centre, rayon_m, pop_en_zone, pop_totale, part, retenu, bloc
  )
  select v_id, e ->> 'plateforme', e ->> 'maille',
         row_number() over (partition by e ->> 'plateforme', e ->> 'maille' order by n),
         nullif(e ->> 'code', ''), nullif(e ->> 'nom', ''),
         case when e ? 'lon' and e ? 'lat'
              then ST_SetSRID(ST_MakePoint((e ->> 'lon')::float8, (e ->> 'lat')::float8), 4326) end,
         (e ->> 'rayon_m')::int,
         (e ->> 'pop_en_zone')::numeric, (e ->> 'pop_totale')::numeric, (e ->> 'part')::numeric,
         coalesce((e ->> 'retenu')::boolean, false),
         -- B14 (sql/319) : le bloc du découpage (unités retenues seulement, CHECK `zseu_bloc_retenu`) ; NULL sinon.
         case when jsonb_typeof(e -> 'bloc') = 'number' then (e ->> 'bloc')::smallint end
    from jsonb_array_elements(v_unites) with ordinality t(e, n);
  get diagnostics v_n_unites = row_count;

  -- B12 (sql/317) : le plan de chaque plateforme au CP, unités RETENUES développées en codes, mêmes replis que le plan
  -- commun. La part prévue y est celle de SON plan.
  insert into public.zone_set_extraction_cp_plateforme (
    extraction_id, plateforme, code_postal, code_canonique, classe, pop_en_zone, pop_totale, part_en_zone, retenu,
    multiplicateur, part_prevue
  )
  with plans as materialized (  -- la plateforme lue une fois par plan (voir l'empreinte)
    select p ->> 'plateforme' as plateforme, p -> 'lignes' as lignes from jsonb_array_elements(v_plans) p)
  select v_id, x.plateforme, l ->> 'code_postal',
         coalesce(nullif(l ->> 'code_canonique', ''), l ->> 'code_postal'),
         coalesce(l ->> 'classe', 'hors'),
         (l ->> 'pop_en_zone')::numeric, (l ->> 'pop_totale')::numeric, (l ->> 'part_en_zone')::numeric,
         coalesce((l ->> 'retenu')::boolean, false),
         least(greatest(coalesce((l ->> 'multiplicateur')::numeric, 0), 0), 999.999),
         (l ->> 'part_prevue')::numeric
    from plans x, jsonb_array_elements(x.lignes) l
  on conflict (extraction_id, plateforme, code_postal) do nothing;
  get diagnostics v_n_plans = row_count;

  return jsonb_build_object(
    'ok', true, 'deja_extraite', false,
    'id', v_id, 'version', v_version,
    'origine', coalesce(nullif(p_origine, ''), 'initiale'),
    'lignes_ecrites', v_n_cp, 'unites_ecrites', v_n_unites, 'lignes_plans_ecrites', v_n_plans,
    'n_cp', coalesce((p_resume ->> 'n_cp')::int, jsonb_array_length(v_cp)),
    'n_retenus', coalesce((p_resume ->> 'n_retenus')::int, 0),
    'taux_utile', (p_resume ->> 'taux_utile')::numeric,
    'part_plan_en_zone', (p_resume ->> 'part_plan_en_zone')::numeric,
    'plateformes', v_plateformes,
    'duree_ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000));
end $function$;

revoke all on function public.creer_extraction_jeu_zone(uuid, jsonb, jsonb, jsonb, text, text, uuid) from public, anon, authenticated;
grant execute on function public.creer_extraction_jeu_zone(uuid, jsonb, jsonb, jsonb, text, text, uuid) to service_role;

notify pgrst, 'reload schema';
