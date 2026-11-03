-- ============================================================================
-- sql/333_seuil_communes_entieres.sql — D30 : les communes non découpées en IRIS entrent dans « par seuil » comme
-- unités « commune entière » ; une unité sans valeur est « non évaluable » (plan de corrections du découpage des
-- zones, lot 4, 2026-11-03 ; suite de C19).
--
-- LE CONSTAT (C19, 03/11). `zone_seuil_territoire` (sql/256, redéfinie par sql/320) ne lisait que les vrais IRIS
-- (`where t.is_true_iris`) : les 33 044 IRIS communaux (type_iris 'Z', code en `0000`, une commune entière non
-- découpée) n'étaient jamais retenus — 27 316 564 habitants, 40,3 % de la population IRIS — alors que 12 des 16
-- indicateurs IRIS du registre y portent une valeur. L'écran le disait (« communes rurales non couvertes »).
--
-- LA DÉCISION (Vincent, 03/11, D30).
--   1. Une commune non découpée est UNE unité, « commune entière » : son IRIS communal (code en 0000) est retenu ou non
--      exactement comme un IRIS de quartier. Le filtre `is_true_iris` disparaît de la sélection.
--   2. Une unité dont la valeur est NULL (revenu médian, taux de pauvreté, part des couples avec enfants sur les
--      communes entières, mais aussi toute valeur absente, et toute part rapportée à une population nulle) est « non
--      évaluable » : jamais retenue, jamais comptée à 0 (`v is null` n'est ni >= ni <= au seuil), et COMPTÉE.
--   3. La réponse IRIS porte deux comptes de plus : `communes_entieres` (unités retenues de type Z) et
--      `non_evaluables` (unités du périmètre sans valeur). L'écran dit « n communes entières traitées comme un seul
--      IRIS » et le nombre d'unités non évaluables (`mentionCommunesEntieres`, `mentionNonEvaluables`,
--      lib/zones/recette.ts et sa copie Angular).
--
-- LE COÛT. Les index de valeur `idx_iris_cible_*` sont partiels (`where is_true_iris`) : sans ce filtre ils ne servent
-- plus, et une région n'a AUCUN index (`code_region` n'en portait pas) — le plan serait un parcours complet de `iris`
-- (11 280 blocs). D'où `idx_iris_code_region` (btree, 49 448 lignes) : la région se lit par lui, le département par
-- `iris_dept_idx`, la commune / le CP / la zone par `iris_geom_idx`. Le périmètre est lu EN ENTIER (il faut compter les
-- non évaluables) ; il est borné par construction (100 000 km² au plus ; la région la plus riche en unités, Grand Est
-- 44, en compte 6 113).
-- Mesuré le 03/11 (EXPLAIN (ANALYZE, BUFFERS), local, la requête de sélection, région 84) :
--   avant (vrais IRIS, index partiels de valeur) : taux_pauvrete ≥ 20 % → 472 IRIS, 3 766 buffers (233 ms à froid) ;
--     densite_pop ≥ 0 → 1 601 IRIS, 7 371 buffers (109 ms) — la région filtrée APRÈS l'index, sur toute la France
--   après (idx_iris_code_region) : tout indicateur → 5 413 unités lues, 3 457 buffers, 7-12 ms à chaud ;
--     région 44 : 6 113 unités, 3 774 buffers (859 lus), 245 ms à froid
--   appel entier à chaud, région 84 : taux_pauvrete ≥ 20 % → 472 IRIS, 0 commune entière, 3 959 non évaluables,
--     33-63 ms (72 ms avant), 65 Ko ; densite_pop ≥ 100 → 2 571 unités dont 1 041 communes entières (2 274 527 hab.),
--     12 non évaluables, 680 ms, 250 Ko (l'union de 1 041 contours communaux de plus) ; densite_pop ≥ 0 → refus en 9 ms.
--
-- LE PLAFOND. 5 000 unités au plus, inchangé : six régions le dépassent désormais pour un seuil qui retient presque
-- tout (44 : 6 113 unités, 76 : 5 451, 84 : 5 413, 11 : 5 277, 75 : 5 209, 32 : 5 009) — refus
-- `trop_de_territoires`, jamais une zone partielle. Avant D30, aucune (région 11 : 3 953 vrais IRIS).
--
-- Même signature, même type de retour (jsonb) : `create or replace`, aucun DROP. Rejouable. Appliquer par `psql -1`
-- (aucun begin / commit interne, D30 round 1). ⚠ Redéfinie par sql/335 (plafond 7 000, `retenues` dans le refus) :
-- rejouer celle-ci SANS rejouer sql/335 après remettrait le plafond de 5 000.
-- ============================================================================

create index if not exists idx_iris_code_region on public.iris (code_region);

create or replace function public.zone_seuil_territoire(
  p_indicateur text, p_operateur text, p_seuil numeric, p_perimetre_type text, p_perimetre_code text,
  p_org_id uuid, p_max_territoires integer default 5000
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
  if p_max_territoires is null or p_max_territoires < 1 or p_max_territoires > 5000 then
    raise exception 'plafond hors bornes (1 a 5 000) : %', p_max_territoires using errcode = '22023';
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
      return jsonb_build_object('refus', 'trop_de_territoires', 'plafond', p_max_territoires);
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
    -- distinct AVANT le limit (même select) : le compte comparé au plafond est un compte de codes, pas de lignes
    execute format(
      'select array_agg(code) from (select distinct t.code_postal as code from public.%I t
         join public.ref_codes_postaux r on r.code_postal = t.code_postal
        where %s is not null and %s %s $2 %s
          and r.geom && $1 and ST_Intersects(ST_PointOnSurface(r.geom), $1) limit $3) s',
      v_table, v_expr, v_expr, p_operateur, v_extra)
      into v_codes using v_per, p_seuil, p_max_territoires + 1;
    v_n := coalesce(cardinality(v_codes), 0);
    if v_n > p_max_territoires then
      return jsonb_build_object('refus', 'trop_de_territoires', 'plafond', p_max_territoires);
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

