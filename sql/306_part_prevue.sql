-- sql/306 — A8 (plan de corrections du découpage des zones, 2026-10-31, lot 1, amendement E5) : la PART PRÉVUE du
-- suivi, découplée du multiplicateur d'enchère.
--
-- CONSTAT (code de 85b9d710).
--   `refresh_campaign_rollups` (sql/113:61, sql/107:96 avant elle) : planned_share = bid_multiplier ÷ Σ bid_multiplier,
--   PAR CODE. Avec ARB-1 (multiplicateur d'enchère, sans population, A1) ce n'est plus une part d'impressions ; et
--   depuis A2 un groupe de n codes indiscernables, développé au MÊME multiplicateur, pèse n fois (Toulouse 6, Saint-Denis
--   3) — sous-pression affichée en permanence sur chaque membre, toutes les autres parts dégonflées (relecture A2, I-1).
--   La ligne HORS_ZONE (A1, E3) était envoyée dans `p_resume.multiplicateur` à `creer_extraction_jeu_zone`, qui ne la
--   stockait NULLE PART.
--
-- CE QUE FAIT CETTE MIGRATION (rejouable, aucun DROP).
--   1. `zone_set_extraction_cp.part_prevue` : la part prévue E5 de chaque code, calculée à l'extraction
--      (`lib/zones/part-prevue.ts`) : part × volume × classe ÷ Σ, sommée par UNITÉ CP, HORS_ZONE comprise, répartie à
--      parts égales entre les codes d'un groupe. NULL hors plan, ou à volume inconnu.
--   2. `zone_set_extractions.resume_plan` : le bilan du plan CP (séquence E4, ligne HORS_ZONE avec volume et part
--      prévue, façon de former la part prévue). Lu par `hors_zone_extraction`, LE lecteur partagé de la ligne HORS_ZONE.
--   3. `bidding_zone_configs.part_prevue` : recopiée de l'extraction par `rattacher`.
--   4. `volumes_attendus_cp(text[])` : le volume attendu V1 (population totale, Q9 = A) des unités demandées et du
--      référentiel entier (d'où le volume de HORS_ZONE). Un passage sur `cp_population_totale` (6 009 lignes, 831
--      buffers, 3,5 ms mesurés le 31/10).
--   5. `creer_extraction_jeu_zone` : stocke `resume_plan` et `part_prevue` (même signature, même type de retour).
--   6. `refresh_campaign_rollups` : planned_share = part_prevue quand le plan en porte ; sinon m ÷ Σ m, INCHANGÉ (chemin
--      risque, plans ⑥ hors jeu de zone).
--
-- Les extractions et les plans déjà écrits n'ont pas de part prévue (immuables) : ils gardent m ÷ Σ m.

alter table public.zone_set_extraction_cp add column if not exists part_prevue numeric;
alter table public.zone_set_extractions   add column if not exists resume_plan jsonb;
alter table public.bidding_zone_configs   add column if not exists part_prevue numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'zse_cp_part_prevue_bornee') then
    alter table public.zone_set_extraction_cp
      add constraint zse_cp_part_prevue_bornee check (part_prevue is null or (part_prevue >= 0 and part_prevue <= 1));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bzc_part_prevue_bornee') then
    alter table public.bidding_zone_configs
      add constraint bzc_part_prevue_bornee check (part_prevue is null or (part_prevue >= 0 and part_prevue <= 1));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'zse_resume_plan_objet') then
    alter table public.zone_set_extractions
      add constraint zse_resume_plan_objet check (resume_plan is null or jsonb_typeof(resume_plan) = 'object');
  end if;
end $$;

comment on column public.zone_set_extraction_cp.part_prevue is
  'A8 (E5) : part prévue du code, entre 0 et 1 — part × volume attendu × classe ÷ Σ, sommée par unité CP (groupe), '
  'HORS_ZONE comprise, répartie à parts égales entre les codes du groupe. Indépendante du multiplicateur. NULL hors '
  'plan ou à volume inconnu. NULL sur toute extraction antérieure à sql/306.';
comment on column public.zone_set_extractions.resume_plan is
  'A8 : bilan du plan CP figé — {multiplicateur: séquence E4 + ligne hors_zone {code, mode, multiplicateur, part, '
  'classe, volume, part_prevue}, part_prevue: {volume_attendu, unite_de_somme, repartition_groupe, hors_zone, '
  'unites_sans_part}}. Lire la ligne HORS_ZONE par hors_zone_extraction(id), jamais en direct.';
comment on column public.bidding_zone_configs.part_prevue is
  'A8 : part prévue recopiée de zone_set_extraction_cp par rattacher. Présente → planned_share = part_prevue ; '
  'absente sur toute la stratégie → planned_share = bid_multiplier ÷ Σ (chemin risque, plans hors jeu de zone).';

-- 4. Le volume attendu V1 : la population totale (`populations->>'ind'`) de chaque unité CP demandée, et le total du
--    référentiel. jsonb : 6 009 codes au plus, jamais tronqué par PostgREST.
create or replace function public.volumes_attendus_cp(p_codes text[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'volume', 'population_totale',
           'total', coalesce(sum((cp.populations ->> 'ind')::numeric), 0),
           'codes', coalesce(jsonb_object_agg(cp.code_postal, (cp.populations ->> 'ind')::numeric)
                               filter (where cp.code_postal = any (coalesce(p_codes, '{}'::text[]))
                                         and cp.populations ? 'ind'), '{}'::jsonb))
    from public.cp_population_totale cp
$$;
comment on function public.volumes_attendus_cp(text[]) is
  'A8 (E5, Q9 = A) : volume attendu V1 = population totale. {volume, total (référentiel entier), codes {code: volume}}.';
revoke all on function public.volumes_attendus_cp(text[]) from public, anon, authenticated;
grant execute on function public.volumes_attendus_cp(text[]) to service_role;

-- 2. LE lecteur partagé de la ligne HORS_ZONE (E3, E8), pour l'extraction, le suivi et le noyau d'optimisation.
--    NULL : extraction inconnue, ou antérieure à sql/306 (rien n'a été figé), ou sans plan CP.
create or replace function public.hors_zone_extraction(p_extraction_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select x.resume_plan -> 'multiplicateur' -> 'hors_zone'
    from public.zone_set_extractions x
   where x.id = p_extraction_id
$$;
comment on function public.hors_zone_extraction(uuid) is
  'A8 : la ligne HORS_ZONE figée d''une extraction {code, mode, multiplicateur, part, classe, volume, part_prevue}, '
  'ou NULL. Lecteur unique (TS : lireHorsZone, lib/zones/part-prevue-serveur.ts).';
revoke all on function public.hors_zone_extraction(uuid) from public, anon, authenticated;
grant execute on function public.hors_zone_extraction(uuid) to service_role;

-- 5. creer_extraction_jeu_zone : copie de la définition en base (sql/278), trois ajouts marqués A8.
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
                      from jsonb_array_elements(v_unites) e) u)))
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
    (select z.geometry from public.custom_geo_zones z where z.id = v_jeu.custom_geo_zone_id),
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

-- 6. refresh_campaign_rollups : copie de la définition en base (sql/113), le seul changement est marqué A8.
CREATE OR REPLACE FUNCTION public.refresh_campaign_rollups(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_source text; v_as_of date; v_strategy_id uuid; v_out_mode text;
  v_daily int := 0; v_cp int := 0;
BEGIN
  SELECT dsp_source INTO v_source FROM dsp_campaigns WHERE id = p_campaign_id;
  IF v_source IS NULL THEN RETURN jsonb_build_object('error', 'campaign_not_found'); END IF;

  DELETE FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id;
  INSERT INTO campaign_daily_rollup (campaign_id, date, media, actor, impressions, clicks, spend)
  SELECT p_campaign_id, d.date, COALESCE(d.media, ''), COALESCE(d.actor, ''),
         SUM(CASE WHEN v_source = 'adform' THEN COALESCE(d.tracked_ads, 0)
                  ELSE COALESCE(NULLIF(d.impressions, 0), d.tracked_ads, 0) END),
         SUM(COALESCE(d.clicks, 0)), SUM(COALESCE(d.spend, 0))
  FROM dsp_campaign_data d
  WHERE d.campaign_id = p_campaign_id AND d.date IS NOT NULL
  GROUP BY d.date, COALESCE(d.media, ''), COALESCE(d.actor, '');
  GET DIAGNOSTICS v_daily = ROW_COUNT;

  SELECT MAX(date) INTO v_as_of FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id;

  SELECT s.id, s.out_zone_weights->>'mode' INTO v_strategy_id, v_out_mode
  FROM bidding_strategies s WHERE s.campaign_id = p_campaign_id ORDER BY s.created_at DESC LIMIT 1;

  DELETE FROM campaign_cp_rollup WHERE campaign_id = p_campaign_id;
  INSERT INTO campaign_cp_rollup
    (campaign_id, postal_code, actor, dept, impressions, clicks, spend,
     imps_7d, imps_prev7d, in_target, planned_share)
  WITH raw AS (
    SELECT d.postal_code, COALESCE(d.actor, '') AS actor, d.date,
           CASE WHEN v_source = 'adform' THEN COALESCE(d.tracked_ads, 0)
                ELSE COALESCE(NULLIF(d.impressions, 0), d.tracked_ads, 0) END AS imp,
           COALESCE(d.clicks, 0) AS clk, COALESCE(d.spend, 0) AS sp
    FROM dsp_campaign_data d
    WHERE d.campaign_id = p_campaign_id AND d.postal_code IS NOT NULL
  ),
  plan AS (
    SELECT z.postal_code,
           -- A8 (sql/306) : un plan qui porte sa PART PRÉVUE (jeu de zone, formule E5, sommée par unité CP, HORS_ZONE
           -- comprise) la donne telle quelle ; un plan sans part prévue (chemin risque, plans ⑥ hors jeu de zone)
           -- garde m ÷ Σ m, inchangé. Discriminant PAR STRATÉGIE : une ligne à part prévue NULL dans un plan qui en
           -- porte (unité à population inconnue, ARB-3) reste NULL, jamais m ÷ Σ m.
           CASE WHEN BOOL_OR(z.part_prevue IS NOT NULL) OVER () THEN z.part_prevue
                ELSE z.bid_multiplier / NULLIF(SUM(z.bid_multiplier) OVER (), 0) END AS planned_share,
           CASE WHEN v_out_mode = 'exclusion' THEN z.bid_multiplier > 0 ELSE z.bid_multiplier > 1 END AS in_target
    FROM bidding_zone_configs z WHERE z.strategy_id = v_strategy_id AND z.is_active
  )
  SELECT p_campaign_id, r.postal_code, r.actor, LEFT(r.postal_code, 2),
         SUM(r.imp), SUM(r.clk), SUM(r.sp),
         COALESCE(SUM(r.imp) FILTER (WHERE r.date > v_as_of - 7), 0),
         COALESCE(SUM(r.imp) FILTER (WHERE r.date <= v_as_of - 7 AND r.date > v_as_of - 14), 0),
         COALESCE(BOOL_OR(p.in_target), false), MAX(p.planned_share)
  FROM raw r LEFT JOIN plan p ON p.postal_code = r.postal_code
  GROUP BY r.postal_code, r.actor;
  GET DIAGNOSTICS v_cp = ROW_COUNT;

  RETURN jsonb_build_object('daily_rows', v_daily, 'cp_rows', v_cp, 'as_of', v_as_of);
END; $function$;

revoke all on function public.creer_extraction_jeu_zone(uuid, jsonb, jsonb, jsonb, text, text, uuid) from public, anon, authenticated;
grant execute on function public.creer_extraction_jeu_zone(uuid, jsonb, jsonb, jsonb, text, text, uuid) to service_role;
revoke all on function public.refresh_campaign_rollups(uuid) from public, anon, authenticated;
grant execute on function public.refresh_campaign_rollups(uuid) to service_role;

notify pgrst, 'reload schema';
