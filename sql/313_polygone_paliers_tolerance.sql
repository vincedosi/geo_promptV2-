-- sql/313 — A7, tour de correction 1 (relecture du 01/11, décisions du chef de projet) : la simplification du polygone
-- ne s'applique plus qu'AU BESOIN, au palier de tolérance le plus fin qui fait passer sous les bornes de la plateforme.
--
-- POURQUOI. sql/312 simplifiait toute forme envoyée en maille polygone à 50 m, qu'elle dépasse les bornes ou non :
-- 0,25 % de la population perdue sur la composite `919ca65d` alors qu'une tolérance plus fine suffisait, et CIRFA
-- Bretagne (2 792 sommets, loin de la borne) simplifiée elle aussi (relecture I-2). La borne de 2 000 morceaux du seed
-- TTD collait exactement au cas de test (I-1). Le résumé disait le polygone « exact » alors que la forme envoyée ne
-- l'était plus (M-1). La tolérance était lue deux fois, par la mesure et par l'écriture, et n'entrait pas dans
-- l'empreinte (M-2). `forme_simplifiee` était déclarée IMMUTABLE alors que `ST_Transform` lit `spatial_ref_sys` (M-3).
--
-- CE QUE POSE CETTE MIGRATION.
--   1. `reglages_conversion` : quatre paliers `simplification_polygone_palier_1` à `_4` = 5, 10, 25, 50 m (CHECK
--      ]0, 200[), lus dans l'ordre CROISSANT des valeurs. `simplification_polygone_m` (sql/312) n'est plus lu : sa
--      description le dit (pas de suppression : un rejeu de sql/312 la remettrait).
--   2. Ligne TTD polygone : la note dit que 20 000 sommets et 2 000 morceaux sont des VALEURS DE TEST, sans source, à
--      relever par dentsu (Q29). Posé une fois.
--   3. `forme_simplifiee` : STABLE (même corps).
--   4. `simplification_polygone_plateforme(p_zone_id, p_org_id, p_cible, p_plateforme)` → jsonb, LE corps de la mesure :
--      bornes lues dans la ligne (plateforme, polygone) de `plateformes_geo` ; forme DÉJÀ sous les deux bornes (ou
--      aucune borne connue) → AUCUNE simplification (`tolerance_m` 0, rien lu) ; sinon, le premier palier, du plus fin
--      au plus grossier, dont la forme simplifiée passe sous les bornes ; si aucun ne passe, la mesure au palier le plus
--      grossier, `sous_bornes` faux — la route refuse, chiffré. Les morceaux ne diminuent pas par simplification
--      (`ST_SimplifyPreserveTopology` garde chaque polygone) : un excès de morceaux est dit sans essayer les paliers.
--      La bande n'est lue qu'une fois, au palier retenu. Refus `zone_introuvable`, `cible_inconnue`,
--      `regle_introuvable` (pas de ligne polygone pour cette plateforme), `trop_de_carreaux`.
--   5. `simplification_polygone(p_zone_id, p_org_id, p_cible)` (sql/312) devient une enveloppe mince : la même mesure
--      SANS plateforme, donc sans borne — aucune simplification. Gardée pour ne pas casser un appelant (même signature).
--   6. `creer_extraction_jeu_zone` : la forme figée est simplifiée à la tolérance RETENUE par la mesure, lue UNE fois
--      dans le résumé de la plateforme polygone (`simplification.tolerance_m`), et cette tolérance entre dans
--      l'empreinte d'idempotence (rien d'ajouté sans simplification : les empreintes existantes sont inchangées).
--      Corps recopié de sql/312, lignes marquées « A7 tour 1 ». Même signature, mêmes droits.
--
-- Rejouable : `on conflict do nothing`, contrainte gardée par `do`, note posée une fois, `create or replace`, aucun
-- DROP. Appliquer par `psql -1`.

-- ── 1. Les paliers de tolérance ──────────────────────────────────────────────────────────────────────────────────────
insert into public.reglages_conversion (cle, valeur, description)
values ('simplification_polygone_palier_1', 5,
        'Extraction en maille polygone : palier de tolerance de simplification (m au sol). Une forme deja sous les '
        'bornes de la plateforme n''est pas simplifiee ; sinon, le palier le plus fin qui la fait passer sous les bornes. '
        'sql/313 (A7 tour 1).'),
       ('simplification_polygone_palier_2', 10, 'Palier de tolerance de simplification du polygone (m). sql/313 (A7 tour 1).'),
       ('simplification_polygone_palier_3', 25, 'Palier de tolerance de simplification du polygone (m). sql/313 (A7 tour 1).'),
       ('simplification_polygone_palier_4', 50, 'Palier de tolerance de simplification du polygone (m), le plus grossier. sql/313 (A7 tour 1).')
on conflict (cle) do nothing;

do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.reglages_conversion'::regclass and conname = 'reglages_conversion_paliers_bornes') then
    alter table public.reglages_conversion
      add constraint reglages_conversion_paliers_bornes
      check (cle not like 'simplification\_polygone\_palier\_%' or (valeur > 0 and valeur < 200));
  end if;
end
$do$;

update public.reglages_conversion
   set description = 'REMPLACE par les paliers simplification_polygone_palier_* (sql/313, A7 tour 1) : plus lu. '
                     'Garde pour qu''un rejeu de sql/312 ne le recree pas. sql/312 (A7).'
 where cle = 'simplification_polygone_m' and description not like 'REMPLACE%';

-- ── 2. Les bornes TTD : valeurs de test ──────────────────────────────────────────────────────────────────────────────
update public.plateformes_geo
   set note = coalesce(note || ' ', '')
              || 'Bornes du polygone (20 000 sommets, 2 000 morceaux) : valeurs de test, sans source, a relever par dentsu (Q29).'
 where plateforme = 'ttd' and maille = 'polygone' and coalesce(note, '') not like '%valeurs de test%';

-- ── 3. forme_simplifiee : STABLE ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.forme_simplifiee(p_geom geometry, p_tolerance_m numeric)
returns geometry
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_s geometry;
begin
  if p_geom is null then
    return null;
  end if;
  if p_tolerance_m is null or p_tolerance_m <= 0 then
    raise exception 'tolerance de simplification hors bornes : %', p_tolerance_m using errcode = '22023';
  end if;
  -- Web Mercator est conforme : une tolérance y est isotrope, à l'échelle 1/cos(latitude). La latitude d'un point DE
  -- la forme (`ST_PointOnSurface`) : à 50 m, l'écart d'échelle d'un bout à l'autre d'une région reste sous 15 %.
  v_s := ST_Transform(
           ST_SimplifyPreserveTopology(
             ST_Transform(p_geom, 3857),
             (p_tolerance_m / cos(radians(ST_Y(ST_PointOnSurface(p_geom)))))::double precision),
           ST_SRID(p_geom));
  -- Rien de retiré : la forme d'origine, à l'octet près (l'aller-retour de projection bougerait les coordonnées).
  if ST_NPoints(v_s) = ST_NPoints(p_geom) then
    return p_geom;
  end if;
  if not ST_IsValid(v_s) then
    v_s := ST_CollectionExtract(ST_MakeValid(v_s), 3);
  end if;
  return v_s;
end
$fn$;
comment on function public.forme_simplifiee(geometry, numeric) is
  'LA simplification d''une forme envoyee en maille polygone : Douglas-Peucker topologique en Web Mercator, tolerance '
  'en metres au sol (echelle 1/cos(latitude)). Rend la forme d''origine si aucun sommet n''est retire. STABLE '
  '(ST_Transform lit spatial_ref_sys). Lue par simplification_polygone_plateforme et creer_extraction_jeu_zone. '
  'sql/312, sql/313 (A7).';
revoke all on function public.forme_simplifiee(geometry, numeric) from public, anon, authenticated;
grant execute on function public.forme_simplifiee(geometry, numeric) to service_role;

-- ── 4. La mesure, au palier le plus fin qui passe ────────────────────────────────────────────────────────────────────
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
  v_essai    geometry;
  v_geom_m   geometry;
  v_simple_m geometry;
  v_tol      numeric := 0;
  v_palier   numeric;
  v_paliers  numeric[];
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

  v_n0 := ST_NPoints(v_geom);
  v_m0 := ST_NumGeometries(v_geom);
  v_simple := v_geom;
  v_sous := (v_smax is null or v_n0 <= v_smax) and (v_mmax is null or v_m0 <= v_mmax);

  -- Au-dessus d'une borne : le palier le plus fin qui fait passer sous les deux. Les morceaux ne diminuent pas (la
  -- simplification topologique garde chaque polygone) : un excès de morceaux ne s'essaie pas, il se dit au palier le
  -- plus grossier.
  if not v_sous then
    select array_agg(r.valeur order by r.valeur) into v_paliers
      from public.reglages_conversion r where r.cle like 'simplification\_polygone\_palier\_%';
    if v_paliers is null then
      raise exception 'aucun palier simplification_polygone_palier_* dans reglages_conversion' using errcode = 'P0002';
    end if;
    if v_mmax is not null and v_m0 > v_mmax then
      v_paliers := array[v_paliers[cardinality(v_paliers)]];
    end if;
    foreach v_palier in array v_paliers loop
      v_essai := public.forme_simplifiee(v_geom, v_palier);
      v_tol := v_palier;
      v_simple := v_essai;
      exit when (v_smax is null or ST_NPoints(v_essai) <= v_smax) and (v_mmax is null or ST_NumGeometries(v_essai) <= v_mmax);
    end loop;
    v_sous := (v_smax is null or ST_NPoints(v_simple) <= v_smax) and (v_mmax is null or ST_NumGeometries(v_simple) <= v_mmax);
  end if;

  -- La bande, lue une fois au palier retenu — et seulement si la forme envoyée passe (un refus n'a pas de perte à dire).
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
    'simplifiee', v_simple is distinct from v_geom,
    'sous_bornes', v_sous,
    'sommets_max', v_smax,
    'morceaux_max', v_mmax,
    'sommets_avant', v_n0,
    'morceaux_avant', v_m0,
    'sommets', ST_NPoints(v_simple),
    'morceaux', ST_NumGeometries(v_simple),
    'carreaux_bande', v_n_lus,
    'perdue', round(v_perdue),
    'gagnee', round(v_gagnee),
    'min_menages', v_min,
    'seuil_perte_affichee', public.reglage_conversion('perte_simplification_affichee')
  );
end
$fn$;
comment on function public.simplification_polygone_plateforme(uuid, uuid, text, text) is
  'Extraction en maille polygone : forme deja sous les bornes de la plateforme (plateformes_geo) -> aucune '
  'simplification ; sinon le palier le plus fin (reglages_conversion simplification_polygone_palier_*) qui passe sous '
  'les bornes, ou le plus grossier avec sous_bornes faux. Sommets / morceaux avant-apres, population perdue / gagnee '
  'sur la seule bande (carreaux_de_forme_menages, minimum de menages). sql/313 (A7 tour 1).';
revoke all on function public.simplification_polygone_plateforme(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.simplification_polygone_plateforme(uuid, uuid, text, text) to service_role;

-- ── 5. L'ancienne mesure : enveloppe mince, sans plateforme donc sans borne ──────────────────────────────────────────
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
  'Enveloppe de simplification_polygone_plateforme sans plateforme (aucune borne : aucune simplification). '
  'sql/312, enveloppe depuis sql/313 (A7 tour 1).';
revoke all on function public.simplification_polygone(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.simplification_polygone(uuid, uuid, text) to service_role;

-- ── 6. creer_extraction_jeu_zone : la tolérance retenue, lue une fois, dans l'empreinte ──────────────────────────────
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
                          where zone_set_id = p_zone_set_id and maille = 'cp')) then
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
           case when v_tol is not null then 'polygone_tolerance_m:' || v_tol::text end))
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
    -- A7 tour 1 (sql/313) : au polygone, la forme simplifiée à la tolérance RETENUE par la mesure (v_tol) — celle dont
    -- l'extraction a compté sommets et morceaux ; telle quelle sans simplification.
    (select case when v_tol is not null then public.forme_simplifiee(z.geometry, v_tol) else z.geometry end
       from public.custom_geo_zones z where z.id = v_jeu.custom_geo_zone_id),
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
    extraction_id, plateforme, maille, ordinal, code, nom, centre, rayon_m, pop_en_zone, pop_totale, part, retenu
  )
  select v_id, e ->> 'plateforme', e ->> 'maille',
         row_number() over (partition by e ->> 'plateforme', e ->> 'maille' order by n),
         nullif(e ->> 'code', ''), nullif(e ->> 'nom', ''),
         case when e ? 'lon' and e ? 'lat'
              then ST_SetSRID(ST_MakePoint((e ->> 'lon')::float8, (e ->> 'lat')::float8), 4326) end,
         (e ->> 'rayon_m')::int,
         (e ->> 'pop_en_zone')::numeric, (e ->> 'pop_totale')::numeric, (e ->> 'part')::numeric,
         coalesce((e ->> 'retenu')::boolean, false)
    from jsonb_array_elements(v_unites) with ordinality t(e, n);
  get diagnostics v_n_unites = row_count;

  return jsonb_build_object(
    'ok', true, 'deja_extraite', false,
    'id', v_id, 'version', v_version,
    'origine', coalesce(nullif(p_origine, ''), 'initiale'),
    'lignes_ecrites', v_n_cp, 'unites_ecrites', v_n_unites,
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
