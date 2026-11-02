-- sql/317 — B12 : un plan CP PAR PLATEFORME, au seuil de la plateforme, figé avec l'extraction.
--
-- LE CONSTAT : `creer_extraction_jeu_zone` ne figeait qu'UN plan CP (`zone_set_extraction_cp`), calculé au seuil le plus
-- BAS des plateformes au CP (décision du contrôleur, sql/278). DV360 à 20 % et TTD à 10 % : le plan de DV360 contenait
-- les CP retenus à 10 %, qu'il n'achète pas, et sa normalisation (moyenne des parts retenues) en dépendait.
--
-- CE QUE POSE CETTE MIGRATION :
--   1. `zone_set_extraction_cp_plateforme` : une ligne par (extraction, plateforme, code postal) RETENU dans le plan de
--      cette plateforme (unités retenues à SON seuil, développées en codes, multiplicateur à la plage de SES mécanismes,
--      part prévue de SON plan). Immuable comme les autres filles (`zse_refuser_update`), RLS sans policy, `service_role`.
--   2. `creer_extraction_jeu_zone`, même signature, même type de retour : lit `p_resume.plans_plateformes`
--      (`[{plateforme, seuil, lignes}]`, calculé par `plansParPlateforme`, lib/zones/plan-jeu-zone.ts), refuse
--      (`unites_hors_choix`) un plan d'une plateforme non choisie au CP, l'ajoute à l'empreinte (`plans:…`, rien sans
--      plan par plateforme) et l'écrit ; rend `lignes_plans_ecrites`. Le bilan de chaque plan voyage dans le résumé de la
--      plateforme (`plateformes[].plan_cp`), déjà figé tel quel dans `zone_set_extractions.plateformes`.
--
-- RÉTROCOMPATIBILITÉ : le plan COMMUN de `zone_set_extraction_cp` est écrit comme avant (seuil le plus bas) : ⑥ Plan
-- campagne, le rattachement, l'export et la simulation le lisent toujours. Les extractions antérieures n'ont aucune ligne
-- dans la nouvelle table. L'empreinte d'une extraction avec une plateforme au CP change : la ré-extraire crée une nouvelle
-- version (le contenu figé n'est plus le même), pas un `deja_extraite`.
--
-- Rejouable (`if not exists`, `create or replace`), aucun DROP. `psql -1`.

create table if not exists public.zone_set_extraction_cp_plateforme (
  extraction_id  uuid not null references public.zone_set_extractions(id) on delete cascade,
  plateforme     text not null,
  code_postal    text not null,
  code_canonique text not null,
  classe         text not null,
  pop_en_zone    numeric,
  pop_totale     numeric,
  part_en_zone   numeric,
  retenu         boolean not null default false,
  multiplicateur numeric(6,3) not null default 0,
  part_prevue    numeric,
  constraint zse_cpp_pkey primary key (extraction_id, plateforme, code_postal),
  constraint zse_cpp_part_prevue_bornee check (part_prevue is null or (part_prevue >= 0 and part_prevue <= 1))
);

comment on table public.zone_set_extraction_cp_plateforme is
  'B12 (sql/317) : le plan CP de CHAQUE plateforme au CP d''une extraction de jeu de zone, a SON seuil et a la plage de '
  'SES mecanismes (plateformes_poids) ; unites retenues seulement, developpees en codes ; populations sur le canonique, '
  'NULL sur un membre. Le plan COMMUN (seuil le plus bas) reste dans zone_set_extraction_cp, lu par (6)/(7). Immuable.';

create or replace trigger trg_zse_cpp_immuable
  before update on public.zone_set_extraction_cp_plateforme
  for each row execute function public.zse_refuser_update();

alter table public.zone_set_extraction_cp_plateforme enable row level security;
revoke all on table public.zone_set_extraction_cp_plateforme from public, anon, authenticated;
grant select, insert, delete on table public.zone_set_extraction_cp_plateforme to service_role;

-- ── creer_extraction_jeu_zone : les plans par plateforme, dans l'empreinte et écrits ──────────────────────────────────
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
  -- B12 (sql/317) : le plan de CHAQUE plateforme au CP, `[{plateforme, seuil, lignes: [...]}]` ; absent = aucun.
  v_plans       jsonb := case when jsonb_typeof(p_resume -> 'plans_plateformes') = 'array'
                              then p_resume -> 'plans_plateformes' else '[]'::jsonb end;
  v_n_plans     int := 0;
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
