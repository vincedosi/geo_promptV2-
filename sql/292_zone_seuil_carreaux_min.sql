-- 292 — Seuil sur carreaux : un minimum de ménages par carreau (2026-10-29, ③ finitions, T1 ; V-2, Q-2)
--
-- Plan : docs/superpowers/plans/2026-10-29-carte-en-parcours-zones.md, arbitrage A-3. JUMELLE de zone_seuil_carreaux
-- (sql/255) qui porte désormais LE corps ; l'originale devient une enveloppe mince qui l'appelle avec 0 ménage. Un seul
-- corps, deux signatures, dérive impossible ; aucun DROP (base locale partagée, CLAUDE.md).
--
-- Pourquoi : un carreau Filosofi de moins de 11 ménages a des valeurs IMPUTÉES par l'INSEE (secret statistique). Avant
-- ce lot, seul un dénominateur NUL était exclu : un carreau de 0,4 ménage pouvait passer « 100 % de ménages pauvres ».
-- Le minimum porte TOUJOURS sur les ménages (`men`), quel que soit l'indicateur : c'est la règle de l'INSEE, et c'est
-- ce que dit l'écran (« carreaux d'au moins 11 ménages ») — y compris pour une part d'individus ou la densité.
-- `p_min_menages = 0` : la règle d'avant, à l'identique (un carreau sans `men` reste retenu) — les zones enregistrées
-- avant le lot (recette sans `min_menages`) se recalculent avec la même forme. Borne : 0 à 1 000, sinon 22023.
--
-- Mesuré le 2026-10-29 (local, EXPLAIN (ANALYZE, BUFFERS), cache tiède), ménages pauvres ≥ 40 % :
--   Gironde           sans minimum : 732 carreaux, 29,28 km², 0,68 s, 89 400 buffers ; à 11 : 191 carreaux
--                     (541 écartés, dont 244 de moins d'UN ménage)
--   Bouches-du-Rhône  sans minimum : 573 carreaux, 22,92 km², 0,32 s, 53 900 buffers ; à 11 : 381 carreaux
--   (sur les 54 495 carreaux de la Gironde, 39 918 ont moins de 11 ménages ; 21 505 sur 32 818 dans le 13)
-- Le prédicat s'ajoute au filtre des carreaux DÉJÀ lus (jsonb du carreau) : aucune lecture de plus — buffers mesurés
-- après application (revue finale, 30/10, Gironde, cache tiède) : 89 463 buffers à 0 comme à 11 ménages.
-- Rend jsonb. Droits : service_role. Rejouable (create or replace).

begin;

create or replace function public.zone_seuil_carreaux_min(
  p_indicateur text, p_operateur text, p_seuil numeric, p_perimetre_type text, p_perimetre_code text,
  p_org_id uuid, p_min_menages numeric, p_max_carreaux integer default 20000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_num text;
  v_den text;
  v_per geometry;
  v_refus text;
  v_ids bigint[];
  v_geoms geometry[];
  v_pops numeric[];
  v_n integer;
  v_g geometry;
begin
  if p_operateur is null or p_operateur not in ('>=', '<=') then
    raise exception 'operateur non autorise : %', p_operateur using errcode = '22023';
  end if;
  if p_seuil is null then
    raise exception 'seuil absent' using errcode = '22023';
  end if;
  if p_min_menages is null or p_min_menages < 0 or p_min_menages > 1000 then
    raise exception 'minimum de menages hors bornes (0 a 1 000) : %', p_min_menages using errcode = '22023';
  end if;
  if p_max_carreaux is null or p_max_carreaux < 1 or p_max_carreaux > 20000 then
    raise exception 'plafond de carreaux hors bornes (1 a 20 000) : %', p_max_carreaux using errcode = '22023';
  end if;

  case p_indicateur
    when 'part_men_pauv'  then v_num := 'men_pauv';  v_den := 'men';
    when 'part_men_1ind'  then v_num := 'men_1ind';  v_den := 'men';
    when 'part_men_5ind'  then v_num := 'men_5ind';  v_den := 'men';
    when 'part_men_prop'  then v_num := 'men_prop';  v_den := 'men';
    when 'part_men_fmp'   then v_num := 'men_fmp';   v_den := 'men';
    when 'part_men_coll'  then v_num := 'men_coll';  v_den := 'men';
    when 'part_ind_18_24' then v_num := 'ind_18_24'; v_den := 'ind';
    when 'part_ind_25_39' then v_num := 'ind_25_39'; v_den := 'ind';
    when 'part_ind_40_54' then v_num := 'ind_40_54'; v_den := 'ind';
    when 'part_ind_55_64' then v_num := 'ind_55_64'; v_den := 'ind';
    when 'part_ind_65_79' then v_num := 'ind_65_79'; v_den := 'ind';
    when 'part_ind_80p'   then v_num := 'ind_80p';   v_den := 'ind';
    when 'densite_ind'    then v_num := 'ind';       v_den := null;
    else return jsonb_build_object('refus', 'indicateur_inconnu');
  end case;

  -- Borne au DÉPARTEMENT (A-4, question Q-G) : la région est refusée, une zone-périmètre ≤ 12 000 km².
  -- La liste est EXACTEMENT PERIMETRES_ADMIS.seuil_carreaux (lib/zones/recette.ts, test qui lit ce fichier).
  select r.g, r.refus into v_per, v_refus
    from public.resoudre_perimetre(p_perimetre_type, p_perimetre_code, p_org_id, 12000,
                                   array['departement', 'commune', 'cp', 'zone']) r;
  if v_refus is not null then
    return jsonb_build_object('refus', v_refus);
  end if;

  with morceaux as materialized (
    select ST_Subdivide(ST_Transform(v_per, 3857), 256) as g
  ), retenus as materialized (
    -- DÉDOUBLONNÉ AVANT le limit : un centroïde posé sur la couture de deux morceaux subdivisés sort deux fois de la
    -- jointure ; limiter des lignes doublonnées pourrait laisser sous le plafond un compte qui le dépasse — une zone
    -- partielle rendue sans le dire. Le distinct lit tout le périmètre, ce que le seuil sélectif fait déjà (pire cas
    -- mesuré ci-dessus) : la borne au département tient le coût.
    select * from (
    select distinct on (cf.id) cf.id, cf.geom_3857 as g, (cf.metadata->>'ind')::numeric as pop
      from public.carreaux_filosofi cf
      join morceaux m on cf.geom_3857 && m.g and ST_Intersects(ST_Centroid(cf.geom_3857), m.g)
      cross join lateral (
        select case
                 when v_den is null then (cf.metadata->>v_num)::numeric / 0.04
                 else (cf.metadata->>v_num)::numeric * 100 / nullif((cf.metadata->>v_den)::numeric, 0)
               end as val
      ) x
     where x.val is not null
       -- V-2 : sous 11 ménages, l'INSEE IMPUTE les valeurs du carreau (secret statistique) — 0,4 ménage → 100 %.
       -- `p_min_menages = 0` court-circuite le test : un carreau sans `men` (densité) reste retenu, comme avant.
       and (p_min_menages = 0 or (cf.metadata->>'men')::numeric >= p_min_menages)
       and ((p_operateur = '>=' and x.val >= p_seuil) or (p_operateur = '<=' and x.val <= p_seuil))
    ) d
    limit p_max_carreaux + 1
  )
  select array_agg(id), array_agg(g), array_agg(pop) into v_ids, v_geoms, v_pops from retenus;

  v_n := coalesce(cardinality(v_ids), 0);   -- ids déjà distincts (distinct on avant le limit)
  if v_n > p_max_carreaux then
    return jsonb_build_object('refus', 'trop_de_carreaux', 'plafond', p_max_carreaux);
  end if;
  if v_n = 0 then
    return jsonb_build_object('vide', true, 'compte', 0, 'population', 0, 'geometry', null, 'surface_km2', 0);
  end if;

  select ST_Multi(ST_Transform(ST_Union(g), 4326)) into v_g from unnest(v_geoms) as g;

  return jsonb_build_object(
    'vide', v_g is null or ST_IsEmpty(v_g),
    'compte', v_n,
    'population', round(coalesce((select sum(p) from (select distinct on (i) i, p from unnest(v_ids, v_pops) as u(i, p)) d), 0)),
    'geometry', case when v_g is null or ST_IsEmpty(v_g) then null else ST_AsGeoJSON(v_g, 6)::jsonb end,
    'surface_km2', case when v_g is null or ST_IsEmpty(v_g) then 0
                        else round((ST_Area(v_g::geography) / 1e6)::numeric, 2) end
  );
end
$fn$;

revoke all on function public.zone_seuil_carreaux_min(text, text, numeric, text, text, uuid, numeric, integer) from public, anon, authenticated;
grant execute on function public.zone_seuil_carreaux_min(text, text, numeric, text, text, uuid, numeric, integer) to service_role;

comment on function public.zone_seuil_carreaux_min(text, text, numeric, text, text, uuid, numeric, integer) is
  'Union des carreaux Filosofi 200 m au-dela d''un seuil, dans le perimetre (<= departement), carreaux d''au moins '
  'p_min_menages menages (0 = regle d''avant sql/292). Corps unique ; zone_seuil_carreaux est son enveloppe (sql/292).';

-- L'originale : même signature, même type de retour (aucun DROP) ; elle appelle la jumelle avec 0 ménage.
create or replace function public.zone_seuil_carreaux(
  p_indicateur text, p_operateur text, p_seuil numeric, p_perimetre_type text, p_perimetre_code text,
  p_org_id uuid, p_max_carreaux integer default 20000
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
  select public.zone_seuil_carreaux_min(p_indicateur, p_operateur, p_seuil, p_perimetre_type, p_perimetre_code,
                                        p_org_id, 0, p_max_carreaux);
$fn$;

revoke all on function public.zone_seuil_carreaux(text, text, numeric, text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.zone_seuil_carreaux(text, text, numeric, text, text, uuid, integer) to service_role;

comment on function public.zone_seuil_carreaux(text, text, numeric, text, text, uuid, integer) is
  'Enveloppe de zone_seuil_carreaux_min avec 0 menage minimum (sql/292) : zones d''avant le lot recalculees a l''identique.';

commit;
