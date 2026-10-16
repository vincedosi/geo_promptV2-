-- 256 — Zone : IRIS ou codes postaux au-dessus (ou au-dessous) d'un seuil d'indicateur, dans le périmètre (2026-10-15)
--
-- Spec : carte-en-parcours § 16.3 ; arbitrage A-4 (national refusé, périmètre ≤ 100 000 km², plafond 5 000 territoires).
-- La valeur est dérivée du registre cible_indicator_registry EXACTEMENT comme get_indicator_threshold_selection
-- (sql/100:79) — recopiée et non appelée : celle-ci n'a pas de périmètre et rend jusqu'à 10 000 codes à l'échelle
-- nationale. Toute évolution de la dérivation se fait DANS LES DEUX.
-- Périmètre : IRIS filtrés par leurs codes (region/departement) quand c'est possible, sinon (commune, cp, zone) par
-- ST_PointOnSurface dans la géométrie ; CP toujours par ST_PointOnSurface de leur contour (ref_codes_postaux).
-- La liste des périmètres admis est EXACTEMENT PERIMETRES_ADMIS.seuil_territoire (lib/zones/recette.ts, test qui lit
-- ce fichier).
-- SQL dynamique : noms de table et de colonne TOUJOURS venus du registre (%I), opérateur validé, valeurs en USING.
-- Plafond : on lit p_max_territoires + 1 codes DISTINCTS ; au-delà, refus AVANT toute union (jamais une zone partielle).
-- Seuls les vrais IRIS (is_true_iris) : les 33 044 autres n'ont aucune valeur d'indicateur (mesuré le 2026-10-15).
-- Pollen et atmo : la DERNIÈRE date seulement, comme sql/100.
--
-- Mesuré le 2026-10-14 (plan) : taux_pauvrete ≥ 20 % sur la région 84 → 472 IRIS, 0,55 s, 3 766 buffers (lecture).
-- Remesuré le 2026-10-15 sur CETTE fonction (auto_explain, instructions imbriquées comprises, cache chaud, appel
-- entier jusqu'au GeoJSON) :
--   région 84, taux_pauvrete ≥ 20 %            →   472 IRIS,  81 ms,  5 800 buffers, 59 Ko
--   région 11, taux_pauvrete ≥ 0 (pire IRIS)   → 3 953 IRIS, 198 ms, 12 000 buffers, 108 Ko (la plus grosse région
--                                                 en IRIS : le plafond de 5 000 n'est pas atteignable par région)
--   commune « paris » ≥ 0 (géométrie)          →   864 IRIS, 187 ms,  7 700 buffers
--   département 13, abstention ≥ 25 %          →    52 CP,    51 ms,  1 900 buffers
--   région 84, abstention ≥ 0 (pire CP)        →   763 CP,   521 ms,  4 700 buffers, 125 Ko
--   région 84, pollen ≥ 1 / atmo ≥ 1           →    60 CP,    75 ms,  1 750 buffers
--   région 76, taux_pauvrete ≥ 99 % (vide)     →     0,       46 ms,  1 400 buffers
--   plafond 5 dépassé → refus, 46 ms, 1 400 buffers (aucune union) ; France → refus, 21 ms, 290 buffers
-- Rend jsonb. Droits : service_role. Rejouable.

begin;

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
    execute format(
      'select array_agg(code) from (select t.code_iris as code from public.iris t
        where t.is_true_iris and %s is not null and %s %s $2 and %s limit $3) s',
      v_expr, v_expr, p_operateur, v_filtre)
      into v_codes using v_per, p_seuil, p_max_territoires + 1, p_perimetre_code;
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
    'geometry', case when v_g is null or ST_IsEmpty(v_g) then null else ST_AsGeoJSON(v_g, 6)::jsonb end,
    'surface_km2', case when v_g is null or ST_IsEmpty(v_g) then 0
                        else round((ST_Area(v_g::geography) / 1e6)::numeric, 2) end
  );
end
$fn$;

revoke all on function public.zone_seuil_territoire(text, text, numeric, text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.zone_seuil_territoire(text, text, numeric, text, text, uuid, integer) to service_role;

commit;
