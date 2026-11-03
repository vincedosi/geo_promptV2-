-- sql/339 — D36 (lot 4 du plan de découpage, décision de Vincent du 03/11/2026) : les contours des DROM sont ceux du
-- RÉFÉRENTIEL régions/départements déjà en base, pour les cinq DROM.
--
-- POURQUOI. A4 (sql/309) jugeait une unité à population inconnue (Guadeloupe 971, Guyane 973, Mayotte 976 : aucun
-- carreau Filosofi) par la part de SA surface dans la zone, tolérance 0,95. Or `ref_communes` et `ref_codes_postaux`
-- ne viennent pas de la même source que `ref_departements` : leurs contours débordent en mer (Terre-de-Haut : 34 % de
-- sa surface dans le contour de 971). Une zone égale au département ne retenait que 18/32 communes en 971, 21/22 en
-- 973, 8/17 en 976 (CP : 18/32, 21/22, 6/11) — question 3 du compte rendu du lot 1.
--
-- LA RÈGLE (et rien de plus, consigne D36). Dans `couverture_geometrie`, la commune ou le CP d'un département non
-- carroyé prend pour contour la part du sien comprise dans le contour du référentiel de son département
-- (`coalesce(geom_perimetre, geom)` de `ref_departements`, celui que la ligne département emploie déjà). Elle n'est une
-- ligne que si la zone touche CE contour ; `part_surface` est la part de cette « surface du référentiel » dans la zone.
-- La réponse le dit : `surface_inconnues` = 'surface du référentiel'. Les cinq DROM sont dans ce référentiel (régions
-- 01 à 06, départements 971 à 976) ; seuls GP, GF et YT y sont jugés par la surface : MQ et RE sont carroyés, leurs
-- unités se chiffrent par leurs carreaux (C25), inchangés. Population : NULL pour GP, GF, YT (ARB-3 = A), aucun
-- carreau, inchangé. Tolérance 0,95 inchangée. Zone nationale (`couverture_pays_jsonb`) inchangée : tout le territoire.
--
-- Aucun contour n'est réécrit en table : `ref_communes`, `ref_codes_postaux`, `ref_departements` intacts (tuiles,
-- autres branches). Le découpage se fait à la lecture, sur les seules unités d'un département non carroyé que la zone
-- touche (au plus 32 communes ou 33 CP par département).
--
-- RÉSULTAT mesuré le 03/11 (base locale), zone = contour du département, tolérance 0,95 :
--   971 : communes 18/32 → 32/32 ; CP 18/32 → 32/32
--   973 : communes 21/22 → 22/22 ; CP 21/22 → 22/22
--   976 : communes  8/17 → 17/17 ; CP  6/11 → 11/11
--
-- CACHE. `couverture_zone_en_cache` ne sert plus un chiffrage local à lignes inconnues sans `surface_inconnues` (jugé
-- sur les contours d'avant).
--
-- Corps recopiés de sql/332 (identiques à la base), seules les lignes marquées « D36 » changent. Mêmes signatures,
-- mêmes droits, aucun DROP. Rejouable (`create or replace`). `psql -1`.

-- ── 1. couverture_geometrie ──────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.couverture_geometrie(p_zone_id uuid, p_org_id uuid, p_cible text DEFAULT 'ind'::text, p_decoupage text DEFAULT 'forme'::text, p_max_carreaux integer DEFAULT 400000)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  c_max_km2  constant numeric := 100000;
  v_geom     geometry;
  v_rang     integer;
  v_surface  numeric;
  v_motif    text;
  v_base     timestamptz;
  v_denom_le timestamptz;
  v_n        bigint;
  v_pop      numeric;
  v_lignes   jsonb;
  v_n_terr   integer;
  v_hors_n   bigint;
  v_hors_p   numeric;
  v_part_max numeric;
  v_non_carr jsonb;
  v_ref      jsonb;
  v_inc      jsonb := '[]'::jsonb;  -- A4 : les lignes des unités non carroyées touchées
  v_n_inc    integer := 0;
  v_min      numeric;               -- A5 : le minimum de ménages appliqué (0 pour la population totale)
  v_rang_men integer;
  v_ec_n     bigint;                -- A5 : carreaux de la zone écartés (moins de v_min ménages)
  v_ec_p     numeric;
  v_n_lus    bigint;
  v_rang_ind integer;               -- C24 round 1 : le rang de la population totale (ind)
  v_pop_ind  numeric;               -- C24 round 1 : population TOTALE de la forme, tous ses carreaux
begin
  if p_decoupage is null or p_decoupage not in ('forme', 'cp', 'iris', 'commune', 'departement') then
    raise exception 'decoupage non autorise : % (forme, cp, iris, commune ou departement)', p_decoupage using errcode = '22023';
  end if;
  if p_max_carreaux is null or p_max_carreaux < 1 or p_max_carreaux > 400000 then
    raise exception 'plafond de carreaux hors bornes (1 a 400 000) : %', p_max_carreaux using errcode = '22023';
  end if;

  -- Absente OU d'un autre espace : la même réponse, on ne révèle pas qu'elle existe ailleurs.
  select g.geometry into v_geom from public.custom_geo_zones g where g.id = p_zone_id and g.org_id = p_org_id;
  if v_geom is null then
    return jsonb_build_object('refus', 'zone_introuvable');
  end if;

  select ce.rang_pop into v_rang from public.cibles_exposition ce
   where ce.code = p_cible and ce.actif and ce.rang_pop is not null;
  if v_rang is null then
    return jsonb_build_object('refus', 'cible_inconnue');
  end if;
  -- A5 (ARB-4) : le minimum de la cible, et le rang des ménages qu'il compare (lu en base, jamais supposé).
  v_min := public.min_menages_de_cible(p_cible);
  select ce.rang_pop into v_rang_men from public.cibles_exposition ce where ce.code = 'men' and ce.rang_pop is not null;
  if v_min > 0 and v_rang_men is null then
    raise exception 'cible men (menages) absente de cibles_exposition : le minimum ne peut pas se lire' using errcode = '55000';
  end if;
  -- C24 round 1 : la population totale, lue au même passage que la cible (rang lu en base, jamais supposé).
  select ce.rang_pop into v_rang_ind from public.cibles_exposition ce where ce.code = 'ind' and ce.rang_pop is not null;

  v_surface := ST_Area(v_geom::geography) / 1e6;
  if v_surface > c_max_km2 then
    return jsonb_build_object('refus', 'zone_trop_vaste', 'surface_km2', round(v_surface, 1), 'plafond_km2', c_max_km2);
  end if;

  -- C25 (sql/332) : les quatre dénominateurs sont des jumeaux `_e7` construits DEPUIS la vue : périmés s'ils sont plus
  -- ANCIENS que la base (bandes ET lots E7), la règle que l'IRIS suivait déjà (sql/269).
  v_base := public.base_couverture_e7_le();
  v_motif := public.carreau_couverture_complete();
  if v_motif is null and p_decoupage <> 'forme' then
    v_denom_le := public.denominateur_construit_le(p_decoupage);
    if v_denom_le is null then
      v_motif := 'denominateur_' || p_decoupage || '_absent';
    elsif v_denom_le < v_base then
      v_motif := 'denominateur_' || p_decoupage || '_perime';
    end if;
  end if;
  -- A5 : sous un minimum, le dénominateur est la jumelle filtrée (et la référence France, maille département).
  if v_motif is null and v_min > 0 then
    v_motif := public.denominateur_menages_motif(case when p_decoupage = 'forme' then 'departement' else p_decoupage end);
  end if;
  if v_motif is not null then
    return jsonb_build_object('refus', 'couverture_non_construite', 'motif', v_motif);
  end if;

  -- A5 : `c_tous` = tous les carreaux de la zone (la borne `p_max_carreaux` compte les carreaux LUS) ; `c` = ceux qui
  -- comptent (au moins v_min ménages ; tous à v_min = 0). Le filtre porte sur les carreaux déjà lus : aucune lecture de plus.
  with c_tous as materialized (
    select f.carreau_id, f.pop, f.pop_ind, (v_min = 0 or f.men >= v_min) as compte,
           case p_decoupage when 'cp' then f.code_postal when 'iris' then f.code_iris
                            when 'commune' then f.code_commune when 'departement' then f.code_departement end as code
      from public.carreaux_de_forme_menages_ind(v_geom, v_rang, coalesce(v_rang_men, v_rang), coalesce(v_rang_ind, v_rang)) f  -- C24 round 1
     limit p_max_carreaux + 1
  ), c as materialized (
    select c_tous.carreau_id, c_tous.pop, c_tous.code from c_tous where c_tous.compte
  ), g as materialized (
    select c.code, count(*) as n, sum(c.pop) as p from c where p_decoupage <> 'forme' group by c.code
  ), a as materialized (
    -- C18 : la population ARRONDIE de chaque groupe (les territoires et le hors-territoire, code NULL), répartie au plus
    -- fort reste pour que leur somme soit round(Σ p) = la `population` rendue : chacun reçoit floor(p), puis les
    -- round(Σ p) − Σ floor(p) plus grands restes reçoivent +1 (départage : population puis code, déterministe).
    -- `round(d.p)` ligne à ligne arrondissait chaque ,5 (des demi-habitants) vers le haut : +230 sur la composite.
    select g.code,
           -- `nulls last` (round 1) : un groupe à p NULL ne prend jamais une unité d'arrondi.
           floor(g.p) + case when row_number() over (order by g.p - floor(g.p) desc nulls last, g.p desc nulls last,
                                                              g.code nulls last)
                                  <= round(sum(g.p) over ()) - sum(floor(g.p)) over () then 1 else 0 end as pop_arrondie
      from g
  ), d as (
    select g.code, g.n, g.p, a.pop_arrondie, den.tot, den.nom, den.commune,
           -- A2 : les codes de l'unité CP (le groupe indiscernable, `[code]` pour un code ordinaire), triés.
           case when p_decoupage = 'cp' then
             coalesce((select array_agg(m.code_postal order by m.code_postal)
                         from public.cp_groupe m where m.code_canonique = g.code), array[g.code]) end as membres,
           -- C24 : cible autre que la population totale, la population TOTALE (`ind`) de l'unité — la diffusion
           -- qu'achète la plateforme, tous les habitants de l'unité, sans le filtre du minimum de ménages (A5).
           case when p_cible <> 'ind' then
             coalesce((select (cp.populations->>'ind')::numeric from public.cp_population_totale_e7 cp
                        where p_decoupage = 'cp' and cp.code_postal = g.code),
                      (select (u.populations->>'ind')::numeric from public.unite_population_totale_e7 u
                        where p_decoupage <> 'cp' and u.maille = p_decoupage and u.code = g.code)) end as tot_ind
      from g
      join a on a.code = g.code  -- C18 : la population arrondie de la ligne
      cross join lateral (
        select (cp.populations->>p_cible)::numeric as tot, rcp.nom_principal as nom, null::text as commune
          from public.cp_population_totale_e7 cp
          left join public.ref_codes_postaux rcp on rcp.code_postal = cp.code_postal
         where v_min = 0 and p_decoupage = 'cp' and cp.code_postal = g.code
        union all
        select (u.populations->>p_cible)::numeric,
               coalesce(i.nom_iris, rc.nom_commune, rd.nom_dept), i.nom_commune
          from public.unite_population_totale_e7 u
          left join public.iris i on p_decoupage = 'iris' and i.code_iris = u.code
          left join public.ref_communes rc on p_decoupage = 'commune' and rc.code_commune = u.code
          left join public.ref_departements rd on p_decoupage = 'departement' and rd.code_dept = u.code
         where v_min = 0 and p_decoupage <> 'cp' and u.maille = p_decoupage and u.code = g.code
        union all
        -- A5 : sous un minimum, la jumelle filtrée (mêmes carreaux, même règle que le numérateur `c`) ; mêmes noms.
        select (dm.populations->>p_cible)::numeric,
               coalesce(rcp.nom_principal, i.nom_iris, rc.nom_commune, rd.nom_dept), i.nom_commune
          from public.denominateur_menages_min_e7 dm
          left join public.ref_codes_postaux rcp on p_decoupage = 'cp' and rcp.code_postal = dm.code
          left join public.iris i on p_decoupage = 'iris' and i.code_iris = dm.code
          left join public.ref_communes rc on p_decoupage = 'commune' and rc.code_commune = dm.code
          left join public.ref_departements rd on p_decoupage = 'departement' and rd.code_dept = dm.code
         where v_min > 0 and dm.maille = p_decoupage and dm.code = g.code
        union all
        -- Un code sans dénominateur ne devrait pas exister (égalités prouvées, sql/266-267) ; s'il existait, la ligne
        -- resterait, part NULL, plutôt que de disparaître du total.
        select null::numeric, null::text, null::text
         where not exists (select 1 from public.cp_population_totale_e7 cp2
                            where v_min = 0 and p_decoupage = 'cp' and cp2.code_postal = g.code)
           and not exists (select 1 from public.unite_population_totale_e7 u2
                            where v_min = 0 and p_decoupage <> 'cp' and u2.maille = p_decoupage and u2.code = g.code)
           and not exists (select 1 from public.denominateur_menages_min_e7 dm2
                            where v_min > 0 and dm2.maille = p_decoupage and dm2.code = g.code)
         limit 1
      ) den
     where g.code is not null
  )
  select (select count(*) from c),
         (select coalesce(sum(c.pop), 0) from c),
         -- A5 : les carreaux lus (la borne) et les écartés (moins de v_min ménages).
         (select count(*) from c_tous),
         (select count(*) from c_tous where not c_tous.compte),
         (select coalesce(sum(c_tous.pop), 0) from c_tous where not c_tous.compte),
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'code', d.code, 'nom', d.nom, 'commune', d.commune, 'n_carreaux', d.n,
                    'pop_en_zone', d.pop_arrondie,  -- C18 : au plus fort reste, et non plus round(d.p)
                    'pop_totale', round(d.tot),
                    'part', round(100 * d.p / nullif(d.tot, 0), 1),
                    -- B11 : la part SANS arrondi, celle que le seuil compare (`estRetenue`) ; `part` reste l'affichage.
                    'part_brute', 100 * d.p / nullif(d.tot, 0))
                    -- A2 : une ligne CP = une unité ; `code` est son identifiant (le canonique), `membres` ses codes.
                    || case when d.membres is not null then jsonb_build_object('membres', to_jsonb(d.membres)) else '{}'::jsonb end
                    -- C24 : la diffusion en population totale, à côté de `pop_totale` (celle de la cible).
                    || case when p_cible <> 'ind' then jsonb_build_object('pop_totale_ind', round(d.tot_ind)) else '{}'::jsonb end
                  order by d.p desc, d.code), '[]'::jsonb) from d),
         (select count(*) from d),
         (select max(round(100 * d.p / nullif(d.tot, 0), 1)) from d),
         (select coalesce(sum(g.n), 0) from g where g.code is null),
         (select coalesce(sum(a.pop_arrondie), 0) from a where a.code is null),  -- C18 : sa part de la répartition
         (select coalesce(sum(c_tous.pop_ind), 0) from c_tous)  -- C24 round 1 : tous les carreaux, sans minimum
    into v_n, v_pop, v_n_lus, v_ec_n, v_ec_p, v_lignes, v_n_terr, v_part_max, v_hors_n, v_hors_p, v_pop_ind;

  if v_n_lus > p_max_carreaux then  -- A5 : la borne porte sur les carreaux LUS, écartés compris
    return jsonb_build_object('refus', 'trop_de_carreaux', 'plafond', p_max_carreaux);
  end if;
  if v_part_max > 100 then
    raise exception 'part de territoire > 100 %% (%) : numerateur et denominateur ne suivent plus la meme regle', v_part_max
      using errcode = 'XX000';
  end if;

  -- Départements que le carroyage ne publie pas (aucune ligne de dénominateur) touchés par la zone. Le filtre
  -- `not exists` laisse ≈ 6 contours sur 104 : le test géométrique ne porte que sur eux.
  select coalesce(jsonb_agg(jsonb_build_object('code', rd.code_dept, 'nom', rd.nom_dept) order by rd.code_dept), '[]'::jsonb)
    into v_non_carr
    from public.ref_departements rd
   where not exists (select 1 from public.unite_population_totale_e7 u
                      where u.maille = 'departement' and u.code = rd.code_dept)
     and ST_Intersects(coalesce(rd.geom_perimetre, rd.geom), v_geom);

  -- A4 (ARB-3) : les unités de ces départements que la zone touche, une ligne chacune, population INCONNUE (NULL, jamais
  -- 0) ; `incluse` (part de surface ≥ tolérance, A4 tour 1) est ce qui les retient, à défaut de part (`estRetenue`). Rien n'est lu si la
  -- zone ne touche aucun département non carroyé (toute zone métropolitaine). CP : le canonique de chaque groupe, avec
  -- ses `membres` (sql/304) — un membre non canonique a le même contour.
  if p_decoupage in ('cp', 'commune', 'departement') and jsonb_array_length(v_non_carr) > 0 then
    with nc as (
      select e->>'code' as code from jsonb_array_elements(v_non_carr) e
    ), u as (
      select rd.code_dept as code, rd.nom_dept as nom, coalesce(rd.geom_perimetre, rd.geom) as geom, null::text[] as membres
        from public.ref_departements rd join nc on nc.code = rd.code_dept
       where p_decoupage = 'departement'
      union all
      -- D36 (sql/339) : commune et CP prennent pour contour la part du leur comprise dans le contour du RÉFÉRENTIEL
      -- régions/départements (`coalesce(geom_perimetre, geom)` de leur département, celui de la ligne département) :
      -- les trois mailles partagent un même cadre, et la surface jugée est la « surface du référentiel ».
      select rc.code_commune, rc.nom_commune, ST_Intersection(rc.geom, coalesce(rd.geom_perimetre, rd.geom)), null::text[]
        from public.ref_communes rc join nc on nc.code = rc.code_dept
        join public.ref_departements rd on rd.code_dept = rc.code_dept
       where p_decoupage = 'commune' and ST_Intersects(rc.geom, v_geom)
      union all
      select r.code_postal, r.nom_principal, ST_Intersection(r.geom, coalesce(rd.geom_perimetre, rd.geom)),  -- D36
             coalesce((select array_agg(m.code_postal order by m.code_postal)
                         from public.cp_groupe m where m.code_canonique = r.code_postal), array[r.code_postal])
        from public.ref_codes_postaux r join nc on nc.code = r.code_dept
        join public.ref_departements rd on rd.code_dept = r.code_dept
       where p_decoupage = 'cp' and ST_Intersects(r.geom, v_geom)
         and not exists (select 1 from public.cp_groupe g where g.code_postal = r.code_postal and g.code_canonique <> r.code_postal)
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', u.code, 'nom', u.nom, 'commune', null, 'n_carreaux', 0,
             'pop_en_zone', null, 'pop_totale', null, 'part', null, 'part_brute', null)
             -- A4 tour 1 : `part_surface` et `incluse` par LA règle (tolérance en base), plus `ST_Covers`.
             || public.unite_inconnue_dans_zone(v_geom, u.geom)
             || case when u.membres is not null then jsonb_build_object('membres', to_jsonb(u.membres)) else '{}'::jsonb end
           order by u.code), '[]'::jsonb), count(*)
      into v_inc, v_n_inc
      from u
     -- D36 : touchée par son contour du référentiel (une unité que la zone ne touche que par un débord n'est pas une ligne).
     where ST_Intersects(u.geom, v_geom);
  end if;

  select jsonb_build_object(
           'source', 'carroyage INSEE Filosofi 200 m (ménages fiscaux)',
           'millesime', (select max(cf.millesime) from public.carreaux_filosofi cf where cf.resolution = '200m'),
           -- A5 : sous un minimum, la France de la cible compte les mêmes carreaux (jumelle filtrée, par département).
           'population_france', case when v_min > 0
                                  then (select round(coalesce(sum((dm.populations->>p_cible)::numeric), 0))
                                          from public.denominateur_menages_min_e7 dm where dm.maille = 'departement')
                                  else (select round(coalesce(sum((u.populations->>p_cible)::numeric), 0))
                                          from public.unite_population_totale_e7 u where u.maille = 'region') end,
           'n_carreaux_france', (select k.n_lignes from public.carreau_couverture_controle k limit 1))
    into v_ref;

  return jsonb_build_object(
    'zone_id', p_zone_id,
    'cible', p_cible,
    'decoupage', p_decoupage,
    'surface_km2', round(v_surface, 1),
    'n_carreaux', v_n,
    'population', round(v_pop),
    'lignes', v_lignes || v_inc,  -- A4 : les unités inconnues après les chiffrées
    'hors_territoire', jsonb_build_object('n_carreaux', v_hors_n, 'population', round(v_hors_p)),
    'n_territoires', v_n_terr + v_n_inc,
    'n_inconnues', v_n_inc,  -- A4
    'tolerance_inclusion', public.reglage_conversion('inclusion_surface_inconnue'),  -- A4 tour 1 : la tolérance appliquée
    -- D36 : la surface sur laquelle `part_surface` est jugée (contours du référentiel régions/départements).
    'surface_inconnues', 'surface du référentiel',
    -- A5 : le minimum appliqué et ce qu'il écarte (avant = n_carreaux + écartés ; après = n_carreaux).
    'min_menages', v_min,
    'arrondi_lignes', 'plus_fort_reste',  -- C18 : Σ lignes pop_en_zone + hors_territoire.population = population
    'carreaux_ecartes', jsonb_build_object('n_carreaux', v_ec_n, 'population', round(v_ec_p)),
    'motif_vide', case when v_n > 0 then null
                       when v_ec_n > 0 then 'carreaux_tous_ecartes'  -- A5 : des carreaux, tous sous le minimum
                       when jsonb_array_length(v_non_carr) > 0 then 'territoire_non_carroye'
                       else 'aucun_carreau' end,
    'territoires_non_carroyes', v_non_carr,
    'reference', v_ref,
    'base_construite_le', v_base,
    'calcule_le', now()
  )
  -- C24 round 1 : cible autre que ind, la population TOTALE de la forme (la diffusion d'une maille exacte).
  || case when p_cible <> 'ind' then jsonb_build_object('population_ind', round(v_pop_ind)) else '{}'::jsonb end;
end
$function$
;

-- ── 2. couverture_zone_en_cache ──────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.couverture_zone_en_cache(p_zone_id uuid, p_org_id uuid, p_cible text, p_decoupage text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select c.resultat || jsonb_build_object('cache', true, 'zone_maj', c.zone_maj)
    from public.couverture_zone_cache c
    join public.custom_geo_zones g on g.id = c.zone_id
   where c.zone_id = p_zone_id
     and c.cible = p_cible
     and c.decoupage = p_decoupage
     and g.org_id = p_org_id
     and c.zone_maj = g.updated_at
     -- C25 (sql/332) : la base est celle des bandes ET des lots E7 (`base_couverture_e7_le`, comme le calcul).
     and c.base_construite_le = public.base_couverture_e7_le()
     and public.carreau_couverture_complete() is null
     -- C25 : les jumeaux sont construits APRÈS la base ; un chiffrage reste valable tant qu'ils n'ont pas été
     -- reconstruits depuis (l'ancienne règle « pas plus récents que la base » visait des dénominateurs bâtis avant).
     and (c.decoupage = 'forme' or public.denominateur_construit_le(c.decoupage) <= c.calcule_le)
     and (jsonb_array_length(coalesce(c.resultat->'lignes', '[]'::jsonb)) = 0 or (c.resultat->'lignes'->0) ? 'part_brute')
     and (c.decoupage <> 'cp' or jsonb_array_length(coalesce(c.resultat->'lignes', '[]'::jsonb)) = 0
          or (c.resultat->'lignes'->0) ? 'membres')
     and (c.decoupage not in ('cp', 'commune', 'departement') or c.resultat ? 'n_inconnues')
     and (coalesce((c.resultat->>'n_inconnues')::integer, 0) = 0 or c.resultat ? 'pays'
          or ((c.resultat->>'tolerance_inclusion')::numeric = public.reglage_conversion('inclusion_surface_inconnue')
              -- D36 (sql/339) : un chiffrage jugé sur les contours d'avant le référentiel n'est plus servi.
              and c.resultat->>'surface_inconnues' = 'surface du référentiel'))
     and (c.resultat->>'min_menages')::numeric is not distinct from public.min_menages_de_cible(c.cible)
$function$
;
