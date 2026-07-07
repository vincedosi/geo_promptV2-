-- 100 — Zones cibles : registre d'indicateurs ciblables + RPC seuil + RPC composite.
-- Appliquée via MCP Supabase le 2026-07-07 (spec 2026-07-07-zones-cibles-design.md).
--
-- Pré-checks effectués avant application (voir task-1-report.md) :
--   - Table zones custom réelle = `custom_geo_zones` (id, geometry, org_id) — conforme au brief, aucune adaptation requise.
--   - Toutes les colonnes iris seedées existent (part_pop_moins_18, pop_15_29, pop_30_44, pop_45_59,
--     part_pop_65_plus, rev_median, taux_chomage, taux_pauvrete, taux_proprio, part_logements_sociaux,
--     part_familles_monoparentales, part_couples_avec_enfants, densite_pop, indice_jeunesse,
--     taux_diplome_sup, part_actifs_transport_commun, population, is_true_iris, code_iris).
--   - dataset_abstention_2022(code_postal, taux_abstention), pollen_map_daily(code_postal, indice_global, date_ech),
--     atmo_map_daily(code_postal, indice_global, date_ech) confirmées.

-- ── 1. Registre (catalogue dynamique — jamais de liste hardcodée côté code) ──
create table if not exists public.cible_indicator_registry (
  indicator_code text primary key,
  label text not null,
  famille text not null check (famille in ('audience','comportement','contexte')),
  unit text not null,
  slider_min numeric not null,
  slider_max numeric not null,
  slider_step numeric not null default 1,
  default_operator text not null default '>=' check (default_operator in ('>=','<=')),
  data_source text not null check (data_source in ('iris_column','abstention','pollen','atmo')),
  data_column text not null,
  normalize text not null default 'none' check (normalize in ('none','pct_of_population')),
  scale text not null check (scale in ('iris','cp')),
  dynamic boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.cible_indicator_registry enable row level security;
create policy "cible_registry_read_auth" on public.cible_indicator_registry
  for select to authenticated using (true);

-- ── 2. Seed (fiches curées — data, pas du code) ─────────────────────────────
insert into public.cible_indicator_registry
  (indicator_code, label, famille, unit, slider_min, slider_max, slider_step, default_operator, data_source, data_column, normalize, scale, dynamic)
values
  ('part_pop_moins_18',    'Part des moins de 18 ans',        'audience', '%', 0, 60, 0.5, '>=', 'iris_column', 'part_pop_moins_18', 'none', 'iris', false),
  ('part_15_29',           'Part des 15-29 ans',              'audience', '%', 0, 60, 0.5, '>=', 'iris_column', 'pop_15_29', 'pct_of_population', 'iris', false),
  ('part_30_44',           'Part des 30-44 ans',              'audience', '%', 0, 60, 0.5, '>=', 'iris_column', 'pop_30_44', 'pct_of_population', 'iris', false),
  ('part_45_59',           'Part des 45-59 ans',              'audience', '%', 0, 60, 0.5, '>=', 'iris_column', 'pop_45_59', 'pct_of_population', 'iris', false),
  ('part_pop_65_plus',     'Part des 65 ans et plus',         'audience', '%', 0, 60, 0.5, '>=', 'iris_column', 'part_pop_65_plus', 'none', 'iris', false),
  ('rev_median',           'Revenu médian',                   'audience', '€', 10000, 45000, 500, '>=', 'iris_column', 'rev_median', 'none', 'iris', false),
  ('taux_chomage',         'Taux de chômage',                 'audience', '%', 0, 40, 0.5, '>=', 'iris_column', 'taux_chomage', 'none', 'iris', false),
  ('taux_pauvrete',        'Taux de pauvreté',                'audience', '%', 0, 50, 0.5, '>=', 'iris_column', 'taux_pauvrete', 'none', 'iris', false),
  ('taux_proprio',         'Taux de propriétaires',           'audience', '%', 0, 100, 1, '>=', 'iris_column', 'taux_proprio', 'none', 'iris', false),
  ('part_logements_sociaux','Part de logements sociaux',      'audience', '%', 0, 80, 1, '>=', 'iris_column', 'part_logements_sociaux', 'none', 'iris', false),
  ('part_familles_mono',   'Part de familles monoparentales', 'audience', '%', 0, 40, 0.5, '>=', 'iris_column', 'part_familles_monoparentales', 'none', 'iris', false),
  ('part_couples_enfants', 'Part de couples avec enfants',    'audience', '%', 0, 60, 0.5, '>=', 'iris_column', 'part_couples_avec_enfants', 'none', 'iris', false),
  ('densite_pop',          'Densité de population',           'audience', 'hab/km²', 0, 25000, 100, '>=', 'iris_column', 'densite_pop', 'none', 'iris', false),
  ('indice_jeunesse',      'Indice de jeunesse',              'audience', 'indice', 0, 5, 0.1, '>=', 'iris_column', 'indice_jeunesse', 'none', 'iris', false),
  ('taux_diplome_sup',     'Taux de diplômés du supérieur',   'audience', '%', 0, 80, 1, '>=', 'iris_column', 'taux_diplome_sup', 'none', 'iris', false),
  ('part_transport_commun','Part actifs en transport commun', 'audience', '%', 0, 70, 1, '>=', 'iris_column', 'part_actifs_transport_commun', 'none', 'iris', false),
  ('abstention_pres_2022', 'Taux d''abstention (prés. 2022)', 'comportement', '%', 10, 60, 0.5, '>=', 'abstention', 'taux_abstention', 'none', 'cp', false),
  ('pollen_indice',        'Indice pollen (jour)',            'contexte', 'niveau', 0, 6, 1, '>=', 'pollen', 'indice_global', 'none', 'cp', true),
  ('atmo_indice',          'Indice qualité de l''air (jour)', 'contexte', 'niveau', 0, 6, 1, '>=', 'atmo', 'indice_global', 'none', 'cp', true)
on conflict (indicator_code) do nothing;

-- ── 3. Index partiels (preview = count indexé, pas de seq scan iris 51k) ────
create index if not exists idx_iris_cible_part_moins_18 on public.iris (part_pop_moins_18) where is_true_iris;
create index if not exists idx_iris_cible_pop_15_29 on public.iris (pop_15_29) where is_true_iris;
create index if not exists idx_iris_cible_pop_30_44 on public.iris (pop_30_44) where is_true_iris;
create index if not exists idx_iris_cible_pop_45_59 on public.iris (pop_45_59) where is_true_iris;
create index if not exists idx_iris_cible_part_65 on public.iris (part_pop_65_plus) where is_true_iris;
create index if not exists idx_iris_cible_rev_median on public.iris (rev_median) where is_true_iris;
create index if not exists idx_iris_cible_taux_chomage on public.iris (taux_chomage) where is_true_iris;
create index if not exists idx_iris_cible_taux_pauvrete on public.iris (taux_pauvrete) where is_true_iris;
create index if not exists idx_iris_cible_taux_proprio on public.iris (taux_proprio) where is_true_iris;
create index if not exists idx_iris_cible_logsoc on public.iris (part_logements_sociaux) where is_true_iris;
create index if not exists idx_iris_cible_fam_mono on public.iris (part_familles_monoparentales) where is_true_iris;
create index if not exists idx_iris_cible_couples_enf on public.iris (part_couples_avec_enfants) where is_true_iris;
create index if not exists idx_iris_cible_densite on public.iris (densite_pop) where is_true_iris;
create index if not exists idx_iris_cible_ind_jeunesse on public.iris (indice_jeunesse) where is_true_iris;
create index if not exists idx_iris_cible_diplome_sup on public.iris (taux_diplome_sup) where is_true_iris;
create index if not exists idx_iris_cible_transp_commun on public.iris (part_actifs_transport_commun) where is_true_iris;

-- ── 4. RPC seuil : preview (count) ou sélection (codes bornés) ──────────────
create or replace function public.get_indicator_threshold_selection(
  p_indicator_code text,
  p_operator text,
  p_threshold numeric,
  p_preview boolean default true
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  reg record;
  v_expr text;
  v_table text;
  v_code_col text;
  v_where_extra text := '';
  v_order text;
  result jsonb;
begin
  if p_operator not in ('>=','<=') then
    raise exception 'operateur non autorise %', p_operator;
  end if;
  select * into reg from cible_indicator_registry
   where indicator_code = p_indicator_code and active;
  if not found then
    raise exception 'indicateur inconnu ou inactif %', p_indicator_code;
  end if;

  -- Expression de la valeur, TOUJOURS derivee du registre (jamais du client).
  if reg.data_source = 'iris_column' then
    v_table := 'iris'; v_code_col := 'code_iris';
    v_where_extra := ' and is_true_iris';
    if reg.normalize = 'pct_of_population' then
      v_expr := format('(%I::float / nullif(population,0) * 100)', reg.data_column);
    else
      v_expr := format('%I', reg.data_column);
    end if;
  elsif reg.data_source = 'abstention' then
    v_table := 'dataset_abstention_2022'; v_code_col := 'code_postal';
    v_expr := format('%I', reg.data_column);
  elsif reg.data_source = 'pollen' then
    v_table := 'pollen_map_daily'; v_code_col := 'code_postal';
    v_expr := format('%I', reg.data_column);
    v_where_extra := ' and date_ech = (select max(date_ech) from pollen_map_daily)';
  else -- atmo
    v_table := 'atmo_map_daily'; v_code_col := 'code_postal';
    v_expr := format('%I', reg.data_column);
    v_where_extra := ' and date_ech = (select max(date_ech) from atmo_map_daily)';
  end if;

  if p_preview then
    if reg.data_source = 'iris_column' then
      execute format(
        'select jsonb_build_object(''count'', count(*), ''population'', coalesce(sum(population),0)::bigint, ''scale'', %L)
           from %I where %s %s %s is not null and %s',
        reg.scale, v_table, v_expr, p_operator, v_expr,
        format('%s %s %L::numeric %s', v_expr, p_operator, p_threshold, v_where_extra)
      ) into result;
    else
      execute format(
        'select jsonb_build_object(''count'', count(*), ''population'', null, ''scale'', %L)
           from %I where %s is not null and %s %s %L::numeric %s',
        reg.scale, v_table, v_expr, v_expr, p_operator, p_threshold, v_where_extra
      ) into result;
    end if;
    return result;
  end if;

  v_order := case when p_operator = '>=' then 'desc' else 'asc' end;
  execute format(
    'with sel as (
       select %s as code, %s as val from %I
        where %s is not null and %s %s %L::numeric %s
        order by val %s limit 10001
     )
     select jsonb_build_object(
       ''codes'', (select coalesce(jsonb_agg(code), ''[]''::jsonb) from (select code from sel limit 10000) t),
       ''count'', (select least(count(*), 10000) from sel),
       ''truncated'', (select count(*) > 10000 from sel),
       ''scale'', %L)',
    v_code_col, v_expr, v_table, v_expr, v_expr, p_operator, p_threshold, v_where_extra, v_order, reg.scale
  ) into result;
  return result;
end $$;

revoke all on function public.get_indicator_threshold_selection(text, text, numeric, boolean) from public, anon, authenticated;
grant execute on function public.get_indicator_threshold_selection(text, text, numeric, boolean) to service_role;

-- ── 5. RPC composite : union des geometries de zones membres ────────────────
create or replace function public.get_composite_zone_geometry(p_zone_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  n int;
  geom geometry;
begin
  n := coalesce(array_length(p_zone_ids, 1), 0);
  if n < 2 or n > 20 then
    raise exception 'composite: 2 a 20 zones membres requises (recu %)', n;
  end if;
  select ST_Multi(ST_Union(geometry)) into geom
    from custom_geo_zones where id = any(p_zone_ids);
  if geom is null then
    raise exception 'composite: aucune geometrie trouvee';
  end if;
  return jsonb_build_object('geometry', ST_AsGeoJSON(geom)::jsonb);
end $$;

revoke all on function public.get_composite_zone_geometry(uuid[]) from public, anon, authenticated;
grant execute on function public.get_composite_zone_geometry(uuid[]) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Vérification réelle (Step 3) — exécutée via MCP execute_sql le 2026-07-07 :
--
-- select public.get_indicator_threshold_selection('part_pop_moins_18', '>=', 25, true);
--   → {"count": 1148, "scale": "iris", "population": 2639226}
--
-- select public.get_indicator_threshold_selection('abstention_pres_2022', '>=', 30, true);
--   → {"count": 771, "scale": "cp", "population": null}
--
-- select public.get_indicator_threshold_selection('pollen_indice', '>=', 3, true);
--   → {"count": 5883, "scale": "cp", "population": null}
--
-- select jsonb_array_length(public.get_indicator_threshold_selection('part_pop_moins_18', '>=', 25, false)->'codes');
--   → 1148 (<= 10000, cohérent avec le preview count)
--
-- EXPLAIN ANALYZE select count(*) from iris where part_pop_moins_18 >= 25 and is_true_iris;
--   → Aggregate  (cost=15.81..15.82 rows=1 width=8) (actual time=0.280..0.280 rows=1 loops=1)
--       ->  Index Only Scan using idx_iris_cible_part_moins_18 on iris
--             (cost=0.29..14.28 rows=611 width=0) (actual time=0.051..0.211 rows=1148 loops=1)
--           Index Cond: (part_pop_moins_18 >= '25'::numeric)
--           Heap Fetches: 0
--     Planning Time: 1.453 ms
--     Execution Time: 0.374 ms
--   Index Only Scan confirmé. Pas de Seq Scan.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 100b (appliquée via MCP le 2026-07-07) — index d'expression pour les 3
-- indicateurs normalisés pct_of_population : l'index sur colonne brute ne sert
-- pas, le WHERE de la RPC porte sur l'expression. Mesuré : preview part_15_29
-- >= 22 : 6338 ms (Index Scan idx_iris_is_true + Filter) → 435 ms cache froid
-- (Bitmap Index Scan idx_iris_cible_expr_15_29).
create index if not exists idx_iris_cible_expr_15_29 on public.iris ((pop_15_29::float / nullif(population,0) * 100)) where is_true_iris;
create index if not exists idx_iris_cible_expr_30_44 on public.iris ((pop_30_44::float / nullif(population,0) * 100)) where is_true_iris;
create index if not exists idx_iris_cible_expr_45_59 on public.iris ((pop_45_59::float / nullif(population,0) * 100)) where is_true_iris;

-- ── 100c (appliquée via MCP le 2026-07-07) — drop des 3 index bruts inutilisés
-- (la RPC filtre ces indicateurs via l'expression pct_of_population uniquement).
drop index if exists public.idx_iris_cible_pop_15_29;
drop index if exists public.idx_iris_cible_pop_30_44;
drop index if exists public.idx_iris_cible_pop_45_59;
