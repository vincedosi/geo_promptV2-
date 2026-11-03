-- ============================================================================
-- sql/335_seuil_plafond_7000.sql — D30 round 1 (plan de corrections du découpage des zones, lot 4, 2026-11-03).
--
-- 1. `zone_seuil_territoire` : plafond relevé de 5 000 à 7 000 unités (défaut ET garde 22023), décision du
--    coordinateur après D30. Depuis sql/333 les communes entières comptent : six régions dépassaient 5 000 unités
--    (44 : 6 113, la plus riche). Mesuré : l'union de la région 44 entière prend 321 ms et pèse 45 Ko. Aucune région
--    n'atteint plus 7 000 ; le plafond reste une borne écrite, jamais une zone partielle.
--    Le refus porte désormais `retenues` (le nombre EXACT d'unités retenues) à côté de `plafond` (règle 5) : la
--    branche IRIS le connaissait déjà (périmètre lu en entier, sql/333), la branche CP perd son `limit` (borné par
--    construction). Le message (`messageTropDeTerritoires`, lib/zones/recette.ts) dit les deux et suit l'opérateur.
--    Constante `MAX_TERRITOIRES_SEUIL` = 7 000 (lib/zones/recette.ts et sa copie Angular, test qui lit ce fichier).
-- 2. `part_couples_enfants` désactivé au registre : colonne vide au 03/11, à réactiver quand la donnée est chargée.
--    `iris.part_couples_avec_enfants` est NULL sur les 49 448 lignes : l'indicateur ne pouvait que rendre des zones
--    vides (5 413 unités non évaluables sur 5 413 en région 84).
--
-- Même signature, même type de retour (jsonb) : `create or replace`, aucun DROP. Rejouable. Appliquer par `psql -1`.
-- ============================================================================

create or replace function public.zone_seuil_territoire(
  p_indicateur text, p_operateur text, p_seuil numeric, p_perimetre_type text, p_perimetre_code text,
  p_org_id uuid, p_max_territoires integer default 7000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  reg record;
  v_expr text;
  v_table text;
  v_extra text := '';
  v_filtre text;
  v_per geometry;
  v_refus text;
  v_codes text[];
  v_n integer;
  v_g geometry;
  v_communes integer;
  v_non_eval integer;
begin
  if p_operateur is null or p_operateur not in ('>=', '<=') then
    raise exception 'operateur non autorise : %', p_operateur using errcode = '22023';
  end if;
  if p_seuil is null then
    raise exception 'seuil absent' using errcode = '22023';
  end if;
  if p_max_territoires is null or p_max_territoires < 1 or p_max_territoires > 7000 then
    raise exception 'plafond hors bornes (1 a 7 000) : %', p_max_territoires using errcode = '22023';
  end if;

  select * into reg from public.cible_indicator_registry where indicator_code = p_indicateur and active;
  if not found then
    return jsonb_build_object('refus', 'indicateur_inconnu');
  end if;

  -- 100 000 km² : ne refuse en pratique que la France (la plus grande région fait 84 617 km²).
  select r.g, r.refus into v_per, v_refus
    from public.resoudre_perimetre(p_perimetre_type, p_perimetre_code, p_org_id, 100000,
                                   array['region', 'departement', 'commune', 'cp', 'zone']) r;
  if v_refus is not null then
    return jsonb_build_object('refus', v_refus);
  end if;

  if reg.data_source = 'iris_column' then
    v_expr := case when reg.normalize = 'pct_of_population'
                   then format('(t.%I::float / nullif(t.population, 0) * 100)', reg.data_column)
                   else format('t.%I', reg.data_column) end;
    v_filtre := case p_perimetre_type
      when 'region'      then 't.code_region = $4'
      when 'departement' then 't.code_dept = $4'
      -- pas de `code_commune = $4` : la commune de ① est un NOM (résolu par resoudre_perimetre) — on passe par la
      -- géométrie, ce qui couvre aussi Paris, Lyon et Marseille (arrondissements unis)
      else 't.geom && $1 and ST_Intersects(ST_PointOnSurface(t.geom), $1)'
    end;
    -- D30 : toutes les unités du périmètre, vrais IRIS ET communes entières (type Z). `retenu` est NULL quand la
    -- valeur l'est : une unité non évaluable n'est jamais retenue, et elle est comptée à part.
    execute format(
      'select array_agg(code) filter (where retenu),
              count(*) filter (where retenu and not vrai)::integer,
              count(*) filter (where v is null)::integer
         from (select t.code_iris as code, t.is_true_iris as vrai, %s as v, (%s %s $2) as retenu
                 from public.iris t where %s) s',
      v_expr, v_expr, p_operateur, v_filtre)
      into v_codes, v_communes, v_non_eval using v_per, p_seuil, p_max_territoires, p_perimetre_code;
    v_n := coalesce(cardinality(v_codes), 0);   -- code_iris est la clé primaire : déjà distincts
    if v_n > p_max_territoires then
      return jsonb_build_object('refus', 'trop_de_territoires', 'plafond', p_max_territoires, 'retenues', v_n);
    end if;
    if v_n > 0 then
      select ST_Multi(ST_Union(geom)) into v_g from public.iris where code_iris = any (v_codes);
    end if;
  else
    v_table := case reg.data_source
      when 'abstention' then 'dataset_abstention_2022'
      when 'pollen'     then 'pollen_map_daily'
      else 'atmo_map_daily' end;
    if reg.data_source in ('pollen', 'atmo') then
      v_extra := format(' and t.date_ech = (select max(date_ech) from public.%I)', v_table);
    end if;
    v_expr := format('t.%I', reg.data_column);
    -- D30 round 1 : plus de `limit` — le refus dit le nombre EXACT de codes retenus. Borné par construction : les CP
    -- d'un périmètre de 100 000 km² au plus (le `limit` ne coupait jamais : 763 CP au pire, région 84).
    execute format(
      'select array_agg(code) from (select distinct t.code_postal as code from public.%I t
         join public.ref_codes_postaux r on r.code_postal = t.code_postal
        where %s is not null and %s %s $2 %s
          and r.geom && $1 and ST_Intersects(ST_PointOnSurface(r.geom), $1)) s',
      v_table, v_expr, v_expr, p_operateur, v_extra)
      into v_codes using v_per, p_seuil;
    v_n := coalesce(cardinality(v_codes), 0);
    if v_n > p_max_territoires then
      return jsonb_build_object('refus', 'trop_de_territoires', 'plafond', p_max_territoires, 'retenues', v_n);
    end if;
    if v_n > 0 then
      select ST_Multi(ST_Union(geom)) into v_g from public.ref_codes_postaux where code_postal = any (v_codes);
    end if;
  end if;

  return jsonb_build_object(
    'vide', v_g is null or ST_IsEmpty(v_g),
    'compte', v_n,
    'maille', reg.scale,
    -- B15 (sql/320) : les unités constitutives, triées — la zone est leur union, exacte dans cette maille.
    'codes', coalesce((select jsonb_agg(c order by c) from unnest(v_codes) c), '[]'::jsonb),
    'geometry', case when v_g is null or ST_IsEmpty(v_g) then null else ST_AsGeoJSON(v_g, 6)::jsonb end,
    'surface_km2', case when v_g is null or ST_IsEmpty(v_g) then 0
                        else round((ST_Area(v_g::geography) / 1e6)::numeric, 2) end
  ) || case when reg.data_source = 'iris_column'
            -- D30 : maille IRIS seulement (au CP, un code sans valeur n'a pas de ligne : rien à compter).
            then jsonb_build_object('communes_entieres', coalesce(v_communes, 0), 'non_evaluables', coalesce(v_non_eval, 0))
            else '{}'::jsonb end;
end
$fn$;

revoke all on function public.zone_seuil_territoire(text, text, numeric, text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.zone_seuil_territoire(text, text, numeric, text, text, uuid, integer) to service_role;

-- Colonne vide au 03/11, à réactiver quand la donnée est chargée (`iris.part_couples_avec_enfants`, 0 / 49 448).
update public.cible_indicator_registry
   set active = false
 where indicator_code = 'part_couples_enfants'
   and active;
