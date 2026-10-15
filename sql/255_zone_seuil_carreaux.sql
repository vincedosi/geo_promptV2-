-- 255 — Zone : l'union des carreaux Filosofi 200 m au-dessus (ou au-dessous) d'un seuil (2026-10-15)
--
-- Spec : carte-en-parcours § 16.3 ; arbitrages A-4 (périmètre ≤ DÉPARTEMENT : département, commune, CP ou zone
-- ≤ 12 000 km² ; région et national refusés ; plafond 20 000 carreaux RETENUS) et L3-2 (carreau retenu par son
-- CENTROÏDE dans le périmètre ; zone = union des carreaux ENTIERS).
-- Pourquoi le département : le plafond borne les carreaux RETENUS, pas les carreaux LUS — tout carreau du périmètre
-- est lu (son jsonb). Mesure de la relecture (14/10), seuil sélectif ≥ 99 % (zéro retenu) : région 75 → 433 000
-- buffers dont 110 000 hors cache, 10,4 s à froid ; Gironde → 69 000 buffers, 0,26 s. L'ouverture à la région est la
-- question Q-G de Vincent.
-- Remplace, POUR L'ÉTAPE ③ SEULEMENT, get_carreaux_capture_geometry (sql/252, 48 s par appel : elle reparse du
-- GeoJSON produit par get_carreaux_by_zoom) — qui reste pour React.
--
-- ⚠ geom_centroid est NULL sur les 2 324 577 carreaux locaux (spec § 16.6) : le centroïde est ST_Centroid(geom_3857),
-- par l'index GIST idx_carreaux_filosofi_geom_3857, contre le périmètre subdivisé (ST_Subdivide 256) en 3857.
-- Indicateurs : liste FERMÉE (INDICATEURS_SEUIL_CARREAUX, lib/zones/recette.ts — test qui lit ce case). Une part en %
-- (numérateur / ménages ou individus du carreau, dénominateur nul exclu) ; densite_ind = individus / 0,04 km².
-- Plafond : on lit p_max_carreaux + 1 carreaux DISTINCTS ; au-delà, refus AVANT toute union (jamais une zone partielle).
--
-- Mesuré le 2026-10-14 (EXPLAIN ANALYZE local, cache tiède, relecture du plan) :
--   Bouches-du-Rhône, part_men_pauv ≥ 40 %  → 505 carreaux,    1,7 s,  46 000 buffers
--   Gironde,          part_men_pauv ≥ 99 %  → 0 carreau,       0,26 s, 69 000 buffers (pire cas DÉPARTEMENT : tout est lu)
--   zone-périmètre DENSE au voisinage du plafond : l'IDF. Sa surface officielle est 12 012 km², AU-DESSUS des 12 000 ;
--   mais la garde mesure ST_Area(geography) du contour de ref_regions, qui donne 11 899 km² : une zone « IDF » est
--   donc ADMISE, et c'est le vrai pire cas admis (≈ 1,1 M buffers / min / compte au quota de 12).
--   (régions, désormais REFUSÉES : IDF ≥ 40 % 3,0 s / 90 000 ; ARA ≥ 35 % 2,6 s / 351 000 ; région 75 ≥ 99 % 433 000)
-- Remesuré le 2026-10-15 sur CETTE fonction (EXPLAIN (ANALYZE, BUFFERS) local, cache tel quel) :
--   Bouches-du-Rhône ≥ 40 %   → 557 carreaux,  0,17 s, 47 400 buffers (23 hors cache)
--   Gironde ≥ 99 %            → 0 carreau,     1,2 s,  70 100 buffers (17 700 hors cache)
--   Nord ≥ 99 %               → 0 carreau,     2,0 s,  54 600 buffers (14 200 hors cache)
--   Paris (commune) densité ≥ 20 000 hab./km² → 1 178 carreaux, 0,23 s, 9 600 buffers
--   zone « IDF » (11 899 km²) ≥ 40 % → 795 carreaux, 2,9 s, 91 100 buffers ; ≥ 99 % → 0,46 s, 90 100 buffers
--   région 75 → refus perimetre_non_admis, 123 buffers (catalogue), aucun carreau lu
-- Le coût est la lecture du jsonb metadata (811 o par carreau, sql/229) : quota unique des routes de zone, 12/min (A-7).
-- Rend jsonb. Droits : service_role. Rejouable.

begin;

create or replace function public.zone_seuil_carreaux(
  p_indicateur text, p_operateur text, p_seuil numeric, p_perimetre_type text, p_perimetre_code text,
  p_org_id uuid, p_max_carreaux integer default 20000
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

revoke all on function public.zone_seuil_carreaux(text, text, numeric, text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.zone_seuil_carreaux(text, text, numeric, text, text, uuid, integer) to service_role;

commit;
