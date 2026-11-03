-- ============================================================================
-- sql/330_minimums_population_totale.sql — C24 round 1 (plan de corrections du découpage des zones, 2026-11-03) :
-- les minimums de plateforme se comparent à la POPULATION TOTALE, jamais à la cible.
--
-- LE CONSTAT (relecture de C24, I-1). La plateforme diffuse à TOUS les habitants d'une unité ; son minimum porte sur
-- l'audience réelle. Or `paver_cercles` comparait `p_pop_min` à la population du disque DANS LA CIBLE (rang de la
-- cible, carreaux du minimum de ménages seulement) : DV360 en cercles, cible 18-24 ans, minimum 1 000 par cercle —
-- un disque de 3 000 habitants (≈ 250 jeunes) était écarté, jusqu'au 422 « Aucun cercle ne reste ».
--
-- LE CORRECTIF.
--   1. `carreaux_de_forme_menages_ind` : la jumelle de `carreaux_de_forme_menages` (inchangée, d'autres l'appellent)
--      qui rend aussi la population totale de chaque carreau, au même passage — aucune lecture de plus.
--   2. `paver_cercles` : `pop_ind`, population TOTALE du disque (tous ses carreaux), est ce que compare `p_pop_min`
--      (retenues, cellules écartées, `population_max` des écartées) ; `pop_totale_ind` par cercle (cible ≠ ind).
--   3. `couverture_geometrie` : `population_ind`, population totale de la forme (cible ≠ ind) — la diffusion d'une
--      maille exacte (polygone, cercle exact) et le minimum qu'on lui compare.
--   4. `couverture_zone` : `population_ind` des zones pays et « nationale moins » (cible ≠ ind).
-- Les minimums par groupe et par unité territoriale se comparent, côté TypeScript, à `diffusion_population_totale` /
-- `pop_totale_ind` (`controlerPopulation`, lib et copie Angular). Pour `ind`, réponses et retenues inchangées.
--
-- LE CACHE. Les chiffrages à une cible autre que `ind` sans `population_ind` sont supprimés une fois (régénérables).
--
-- Corps recopiés de sql/327 (`couverture_geometrie`), sql/318 (`paver_cercles`) et sql/326 (`couverture_zone`),
-- identiques aux définitions en base au 03/11 ; lignes changées marquées « C24 round 1 ». Mêmes signatures, mêmes
-- droits, aucun DROP. Appliquer par `psql -1`.
-- ============================================================================

-- ── 1. La jumelle de lecture des carreaux, avec la population totale ─────────────────────────────────────────────
create or replace function public.carreaux_de_forme_menages_ind(p_geom geometry, p_rang integer, p_rang_men integer, p_rang_ind integer)
returns table(carreau_id bigint, pop numeric, men numeric, pop_ind numeric, centroide_3857 geometry, code_postal text,
              code_iris text, code_commune text, code_departement text)
language sql
stable
as $fn$
  select distinct on (cc.carreau_id) cc.carreau_id, cc.pops[p_rang]::numeric, cc.pops[p_rang_men]::numeric,
         cc.pops[p_rang_ind]::numeric, cc.centroide_3857, cc.code_postal, cc.code_iris, cc.code_commune, cc.code_departement
    from (select public.ST_Subdivide(public.ST_Transform(p_geom, 3857), 256) as sg) z
    join public.carreau_couverture cc on cc.centroide_3857 operator(public.&&) z.sg and public.ST_Intersects(cc.centroide_3857, z.sg)
   order by cc.carreau_id
$fn$;
comment on function public.carreaux_de_forme_menages_ind(geometry, integer, integer, integer) is
  'carreaux_de_forme_menages + pops[p_rang_ind] (population totale) au meme passage. sql/330 (C24 round 1).';
revoke all on function public.carreaux_de_forme_menages_ind(geometry, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.carreaux_de_forme_menages_ind(geometry, integer, integer, integer) to service_role;

-- ── 2. couverture_geometrie ──────────────────────────────────────────────────────────────────────────────────────
create or replace function public.couverture_geometrie(
  p_zone_id uuid,
  p_org_id uuid,
  p_cible text default 'ind',
  p_decoupage text default 'forme',
  p_max_carreaux integer default 400000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
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

  -- IRIS : construit DEPUIS la table étroite, périmé s'il est plus ANCIEN qu'elle (sql/269). CP, commune, département :
  -- comptés sur `carreaux_filosofi`, refusés s'ils sont plus RÉCENTS qu'elle (voir l'en-tête).
  select max(b.construit_le) into v_base from public.carreau_couverture_bandes b;
  v_motif := public.carreau_couverture_complete();
  if v_motif is null and p_decoupage <> 'forme' then
    v_denom_le := public.denominateur_construit_le(p_decoupage);
    if v_denom_le is null then
      v_motif := 'denominateur_' || p_decoupage || '_absent';
    elsif p_decoupage = 'iris' and v_denom_le < v_base then
      v_motif := 'denominateur_iris_perime';
    elsif p_decoupage <> 'iris' and v_denom_le > v_base then
      v_motif := 'denominateur_' || p_decoupage || '_plus_recent';
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
             coalesce((select (cp.populations->>'ind')::numeric from public.cp_population_totale cp
                        where p_decoupage = 'cp' and cp.code_postal = g.code),
                      (select (u.populations->>'ind')::numeric from public.unite_population_totale u
                        where p_decoupage <> 'cp' and u.maille = p_decoupage and u.code = g.code)) end as tot_ind
      from g
      join a on a.code = g.code  -- C18 : la population arrondie de la ligne
      cross join lateral (
        select (cp.populations->>p_cible)::numeric as tot, rcp.nom_principal as nom, null::text as commune
          from public.cp_population_totale cp
          left join public.ref_codes_postaux rcp on rcp.code_postal = cp.code_postal
         where v_min = 0 and p_decoupage = 'cp' and cp.code_postal = g.code
        union all
        select (u.populations->>p_cible)::numeric,
               coalesce(i.nom_iris, rc.nom_commune, rd.nom_dept), i.nom_commune
          from public.unite_population_totale u
          left join public.iris i on p_decoupage = 'iris' and i.code_iris = u.code
          left join public.ref_communes rc on p_decoupage = 'commune' and rc.code_commune = u.code
          left join public.ref_departements rd on p_decoupage = 'departement' and rd.code_dept = u.code
         where v_min = 0 and p_decoupage <> 'cp' and u.maille = p_decoupage and u.code = g.code
        union all
        -- A5 : sous un minimum, la jumelle filtrée (mêmes carreaux, même règle que le numérateur `c`) ; mêmes noms.
        select (dm.populations->>p_cible)::numeric,
               coalesce(rcp.nom_principal, i.nom_iris, rc.nom_commune, rd.nom_dept), i.nom_commune
          from public.denominateur_menages_min dm
          left join public.ref_codes_postaux rcp on p_decoupage = 'cp' and rcp.code_postal = dm.code
          left join public.iris i on p_decoupage = 'iris' and i.code_iris = dm.code
          left join public.ref_communes rc on p_decoupage = 'commune' and rc.code_commune = dm.code
          left join public.ref_departements rd on p_decoupage = 'departement' and rd.code_dept = dm.code
         where v_min > 0 and dm.maille = p_decoupage and dm.code = g.code
        union all
        -- Un code sans dénominateur ne devrait pas exister (égalités prouvées, sql/266-267) ; s'il existait, la ligne
        -- resterait, part NULL, plutôt que de disparaître du total.
        select null::numeric, null::text, null::text
         where not exists (select 1 from public.cp_population_totale cp2
                            where v_min = 0 and p_decoupage = 'cp' and cp2.code_postal = g.code)
           and not exists (select 1 from public.unite_population_totale u2
                            where v_min = 0 and p_decoupage <> 'cp' and u2.maille = p_decoupage and u2.code = g.code)
           and not exists (select 1 from public.denominateur_menages_min dm2
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
   where not exists (select 1 from public.unite_population_totale u
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
      select rc.code_commune, rc.nom_commune, rc.geom, null::text[]
        from public.ref_communes rc join nc on nc.code = rc.code_dept
       where p_decoupage = 'commune' and ST_Intersects(rc.geom, v_geom)
      union all
      select r.code_postal, r.nom_principal, r.geom,
             coalesce((select array_agg(m.code_postal order by m.code_postal)
                         from public.cp_groupe m where m.code_canonique = r.code_postal), array[r.code_postal])
        from public.ref_codes_postaux r join nc on nc.code = r.code_dept
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
      from u;
  end if;

  select jsonb_build_object(
           'source', 'carroyage INSEE Filosofi 200 m (ménages fiscaux)',
           'millesime', (select max(cf.millesime) from public.carreaux_filosofi cf where cf.resolution = '200m'),
           -- A5 : sous un minimum, la France de la cible compte les mêmes carreaux (jumelle filtrée, par département).
           'population_france', case when v_min > 0
                                  then (select round(coalesce(sum((dm.populations->>p_cible)::numeric), 0))
                                          from public.denominateur_menages_min dm where dm.maille = 'departement')
                                  else (select round(coalesce(sum((u.populations->>p_cible)::numeric), 0))
                                          from public.unite_population_totale u where u.maille = 'region') end,
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
$fn$;

comment on function public.couverture_geometrie(uuid, uuid, text, text, integer) is
  'Couverture d''une zone de l''espace : population de la cible (carreaux Filosofi dont le centroide est dans la zone), '
  'telle quelle ou par CP / IRIS / commune / departement avec part de chaque territoire (meme regle que les '
  'denominateurs). Lecture seule, jsonb, <= 100 000 km2, <= 400 000 carreaux ; refus zone_introuvable, cible_inconnue, '
  'zone_trop_vaste, trop_de_carreaux, couverture_non_construite (+ motif). sql/269 (lot 4, T5), sql/275 (lot 5, T3), sql/303 (B11 : part_brute, la part non arrondie que compare le seuil), sql/304 (A2 : membres, les codes de '
  'l''unite CP — groupe de CP indiscernables), sql/308 (A4 : une ligne par unite non carroyee touchee, population NULL, '
  'n_inconnues), sql/309 (A4 tour 1 : part_surface et incluse = part >= reglage inclusion_surface_inconnue, '
  'unite_inconnue_dans_zone ; tolerance_inclusion), sql/310 (A5, ARB-4 : cible autre que ind, carreaux de moins de '
  'min_menages_cible menages ecartes du numerateur et du denominateur denominateur_menages_min ; min_menages, '
  'carreaux_ecartes, motif_vide carreaux_tous_ecartes), sql/323 (C18 : pop_en_zone et hors_territoire.population '
  'arrondis au plus fort reste, leur somme = population ; arrondi_lignes), sql/327 (C24 : cible autre que ind, '
  'pop_totale_ind sur chaque ligne chiffree = population totale de l''unite, la diffusion achetee), sql/330 (C24 round 1 : '
  'population_ind = population totale de la forme, cible autre que ind).';

revoke all on function public.couverture_geometrie(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.couverture_geometrie(uuid, uuid, text, text, integer) to service_role;

-- ── 3. paver_cercles ──────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.paver_cercles(
  p_zone_id uuid,
  p_org_id uuid,
  p_cible text,
  p_rayon_m integer,
  p_seuil numeric,
  p_pop_min integer default 0,
  p_max_cercles integer default null,
  p_max_candidates integer default 5000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
-- Un plan générique (préparé une fois, réutilisé) ignore la taille réelle de la zone : leçon du pic de 165 s du lot 4.
set plan_cache_mode to 'force_custom_plan'
-- 64 Mo (comme sql/272) : les carreaux de la zone, de l'union et leur jointure complète débordaient le `work_mem` de
-- 4 Mo sur la composite (≈ 5 500 blocs de fichiers temporaires) ; `set` de fonction, rendu à la sortie.
set work_mem to '64MB'
as $fn$
declare
  c_max_km2      constant numeric := 100000;
  c_max_cand     constant integer := 5000;
  -- km² d'enveloppes de DISQUES relus par l'étape 2 (candidates × 4,0804 r², A6). 200 000 avec l'hexagone avant A6 ;
  -- relevé à 240 000 pour garder ARA 40 km (≈ 222 000 km² : 34 candidates × 6 529 km²). Mesure À FROID le 01/11
  -- (zones jamais lues, cache partagé froid pour leurs carreaux) : Occitanie 40 km, 31 candidates (≈ 202 000 km²),
  -- 8,2 s, 21 872 blocs lus hors cache, aucun fichier temporaire ; ARA 40 km 5,8 s, 20 742 blocs lus, aucun
  -- fichier temporaire. Le cache du système hôte n'a pas pu être vidé (base partagée, conteneur non redémarré).
  c_max_balaye   constant numeric := 240000;
  v_limite       integer;
  v_n_carreaux   bigint;
  v_non_carr     jsonb := '[]'::jsonb;
  v_geom         geometry;
  v_rang         integer;
  v_surface      numeric;
  v_motif        text;
  v_n_cand       bigint;
  v_n_cercles    bigint;
  v_cercles      jsonb;
  v_grilles      jsonb;
  v_part_max     numeric;
  v_population   numeric;
  v_couverte     numeric;
  v_manques      numeric;
  v_hors_zone    numeric;
  v_achetee      numeric;
  v_min          numeric;   -- A5 : le minimum de ménages appliqué (0 pour la population totale)
  v_rang_ind     integer;   -- C24 round 1
  v_rang_men     integer;
  v_ec_n         bigint;    -- A5 : carreaux de la zone écartés
  v_ec_p         numeric;
  v_somme        numeric;   -- A6 : somme des populations des disques retenus (≥ achetee : chevauchements)
  v_fleur        numeric;   -- A6 : max(r_ext / pas) des candidates, < 2 exigé (étape 2b)
  v_pm_n         bigint;    -- B13 : cellules au seuil écartées par le seul p_pop_min
  v_pm_max       numeric;   -- B13 : la population du plus peuplé de leurs disques
begin
  if p_rayon_m is null or p_rayon_m < 1000 or p_rayon_m > 200000 then
    raise exception 'rayon hors bornes (1 000 a 200 000 m) : %', p_rayon_m using errcode = '22023';
  end if;
  if p_seuil is null or p_seuil < 0 or p_seuil > 100 then
    raise exception 'seuil hors bornes (0 a 100) : %', p_seuil using errcode = '22023';
  end if;
  if p_pop_min is null or p_pop_min < 0 or (p_max_cercles is not null and p_max_cercles < 1) then
    raise exception 'population minimale ou plafond de cercles invalide : %, %', p_pop_min, p_max_cercles using errcode = '22023';
  end if;
  if p_max_candidates is null or p_max_candidates < 1 or p_max_candidates > c_max_cand then
    raise exception 'plafond de candidates hors bornes (1 a %) : %', c_max_cand, p_max_candidates using errcode = '22023';
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
  -- A5 (ARB-4) : le minimum de la cible ; il s'applique aux carreaux de la zone, des disques et de l'union.
  v_min := public.min_menages_de_cible(p_cible);
  select ce.rang_pop into v_rang_men from public.cibles_exposition ce where ce.code = 'men' and ce.rang_pop is not null;
  if v_min > 0 and v_rang_men is null then
    raise exception 'cible men (menages) absente de cibles_exposition : le minimum ne peut pas se lire' using errcode = '55000';
  end if;
  v_rang_men := coalesce(v_rang_men, v_rang);
  -- C24 round 1 : le minimum d'habitants par cercle porte sur la population TOTALE du disque (l'audience réelle).
  select ce.rang_pop into v_rang_ind from public.cibles_exposition ce where ce.code = 'ind' and ce.rang_pop is not null;
  v_rang_ind := coalesce(v_rang_ind, v_rang);

  v_surface := ST_Area(v_geom::geography) / 1e6;
  if v_surface > c_max_km2 then
    return jsonb_build_object('refus', 'zone_trop_vaste', 'surface_km2', round(v_surface, 1), 'plafond_km2', c_max_km2);
  end if;

  -- Borne de coût : au plus `c_max_balaye` km² relus — chaque candidate lit l'enveloppe de son DISQUE par l'index,
  -- un carré de côté 2 × `r_ext` ≈ 2 × 1,01 r au sol, soit 4,0804 r² (A6 ; avant : l'hexagone, 2√3·r²).
  v_limite := least(p_max_candidates, floor(c_max_balaye * 1e6 / (4.0804 * p_rayon_m::numeric ^ 2))::integer);

  -- Pas de dénominateur ici (la population d'un disque se compte sur ses carreaux) : seule la table étroite compte.
  v_motif := public.carreau_couverture_complete();
  if v_motif is not null then
    return jsonb_build_object('refus', 'couverture_non_construite', 'motif', v_motif);
  end if;

  with z_tous as materialized (                                             -- (1) carreaux de la zone
    select f.carreau_id, f.pop, f.centroide_3857, f.code_departement, (v_min = 0 or f.men >= v_min) as compte
      from public.carreaux_de_forme_menages(v_geom, v_rang, v_rang_men) f
  ), z as materialized (                                                    -- A5 : ceux qui comptent
    select z_tous.carreau_id, z_tous.pop, ST_X(z_tous.centroide_3857) as x, ST_Y(z_tous.centroide_3857) as y,
           public.territoire_grille(z_tous.code_departement) as territoire
      from z_tous where z_tous.compte
  ), grilles as materialized (                                              -- un pas par territoire (en-tête)
    -- A6 : `r_bas` / `r_haut`, rayons 3857 qui bornent TOUS les disques du territoire (marge de 4 rayons, large) : en
    -- deçà de `r_bas` un carreau est dans le disque, au-delà de `r_haut` il n'y est pas, sans calcul géodésique.
    select t.territoire,
           p_rayon_m / public.echelle_sol_3857(greatest(t.y_eq - p_rayon_m / public.echelle_sol_3857(t.y_eq), 0)) as pas,
           p_rayon_m / public.echelle_sol_3857(greatest(t.y_eq - 4 * p_rayon_m / public.echelle_sol_3857(t.y_eq), 0)) as r_bas,
           1.01 * p_rayon_m / public.echelle_sol_3857(t.y_max + 4 * p_rayon_m / public.echelle_sol_3857(t.y_max)) as r_haut
      from (select z.territoire, min(abs(z.y)) as y_eq, max(abs(z.y)) as y_max from z group by z.territoire) t
  ), zq as materialized (                                                   -- A6 : chaque carreau de la zone et sa cellule
    select z.carreau_id, z.pop, z.x, z.y, z.territoire, gr.pas, gr.r_bas, gr.r_haut, h.q, h.r
      from z
      join grilles gr on gr.territoire = z.territoire
      cross join lateral public.cellule_hex(z.x, z.y, gr.pas) h
  ), cand as materialized (                                                 -- (2) cellules candidates
    -- A6 : le centre porte ici ses rayons 3857 (avant : calculés à l'étape 3, pour les seules retenues) — le disque de
    -- chaque candidate est lu pour sa population. `r_ext` au bord POLAIRE du cercle (échelle la plus petite) borne la
    -- présélection par l'index ; `r_int` au bord ÉQUATORIAL (échelle la plus grande) : en deçà, un carreau est dans le
    -- cercle sans calcul géodésique — celui-ci n'est fait que dans l'anneau entre les deux.
    select k.*, c.cx, c.cy, ST_SetSRID(ST_MakePoint(c.cx, c.cy), 3857) as centre_3857,
           ST_Transform(ST_SetSRID(ST_MakePoint(c.cx, c.cy), 3857), 4326)::geography as centre_g,
           -- A6 : × 1,01. `echelle_sol_3857` rend le PLUS GRAND des deux axes (est-ouest, sur l'ellipsoïde) : divisé par
           -- lui, le rayon était sous-estimé d'≈ 0,17 % au nord-sud (0,67 % à l'équateur), et la présélection par
           -- l'index manquait des carreaux du bord polaire que le test géodésique aurait admis (CIRFA, cellule
           -- (-292, 552) : un carreau à 4 998,98 m, 7 487 unités 3857 pour un `r_ext` de 7 476). Une borne de
           -- présélection plus large ne change rien d'autre : le test géodésique tranche dans l'anneau.
           1.01 * p_rayon_m / public.echelle_sol_3857(abs(c.cy) + 2 * p_rayon_m / public.echelle_sol_3857(abs(c.cy))) as r_ext,
           p_rayon_m / public.echelle_sol_3857(greatest(abs(c.cy) - 2 * p_rayon_m / public.echelle_sol_3857(abs(c.cy)), 0)) as r_int
      from (select zq.territoire, zq.pas, zq.q, zq.r
              from zq
             group by zq.territoire, zq.pas, zq.q, zq.r
             limit v_limite + 1) k
      cross join lateral public.centre_hex(k.q, k.r, k.pas) c
  ), zin as materialized (                                                  -- A6 (2b) : la ZONE dans chaque disque
    -- Un carreau à ≤ r du centre c est dans la cellule de c ou dans l'une de ses 6 voisines : la fleur de 7 hexagones
    -- contient le disque de rayon 2 × pas autour de c (les sommets rentrants sont à 2 × pas), et `r_ext` < 2 × pas
    -- (vérifié après la requête, exception sinon). Donc 7 centres à tester par carreau de la zone, par arithmétique
    -- (`centre_hex`), sans jointure ni index — jamais `exists (… from <cte> …)` (M5), jamais une boucle sur `z`.
    select zq.territoire, zq.q + v.dq as q, zq.r + v.dr as r, sum(zq.pop) as pop_en_zone
      from zq
      cross join (values (0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (1, -1), (-1, 1)) v(dq, dr)
      cross join lateral public.centre_hex(zq.q + v.dq, zq.r + v.dr, zq.pas) c
     where (select count(*) from cand) <= v_limite
       and case when (zq.x - c.cx) ^ 2 + (zq.y - c.cy) ^ 2 <= zq.r_bas ^ 2 then true
                when (zq.x - c.cx) ^ 2 + (zq.y - c.cy) ^ 2 > zq.r_haut ^ 2 then false
                else ST_DWithin(ST_Transform(ST_SetSRID(ST_MakePoint(zq.x, zq.y), 3857), 4326)::geography,
                                ST_Transform(ST_SetSRID(ST_MakePoint(c.cx, c.cy), 3857), 4326)::geography, p_rayon_m)
           end
     group by zq.territoire, zq.q + v.dq, zq.r + v.dr
  ), tot as materialized (
    -- A6 : population du DISQUE (tous ses carreaux, lus par l'index autour du centre — même test que l'union, sommés
    -- au fil de la lecture, aucun tri) et population de la zone dans le disque (`zin`).
    select cand.*, t.pop_totale, t.pop_ind, coalesce(zin.pop_en_zone, 0) as pop_en_zone
      from cand
      cross join lateral (
        -- C24 round 1 : pop_ind, la population TOTALE du disque (tous ses carreaux, sans le minimum de ménages) :
        -- c'est elle que compare p_pop_min. Le filtre du minimum ne porte plus que sur pop_totale (la cible).
        select coalesce(sum(cc.pops[v_rang]::numeric) filter (where v_min = 0 or cc.pops[v_rang_men] >= v_min), 0) as pop_totale,
               coalesce(sum(cc.pops[v_rang_ind]::numeric), 0) as pop_ind
          from public.carreau_couverture cc
          -- `offset 0` : les coordonnées sont lues UNE fois (sans lui, l'inlining recopie `ST_X(…)` dans chaque terme).
          -- Le test est arithmétique (comme celui de l'hexagone qu'il remplace) : `ST_DWithin` en 3857 sur chacun des
          -- ≈ 580 000 carreaux lus de la composite coûtait ≈ 1 s de plus.
          cross join lateral (select ST_X(cc.centroide_3857) - cand.cx as dx, ST_Y(cc.centroide_3857) - cand.cy as dy offset 0) p
         where cc.centroide_3857 && ST_Expand(cand.centre_3857, cand.r_ext)
           and case when p.dx ^ 2 + p.dy ^ 2 <= cand.r_int ^ 2 then true
                    when p.dx ^ 2 + p.dy ^ 2 > cand.r_ext ^ 2 then false
                    else ST_DWithin(ST_Transform(cc.centroide_3857, 4326)::geography, cand.centre_g, p_rayon_m)
               end
           -- A5 : pop_totale compte les mêmes carreaux que la zone (filtre du select, C24 round 1).
      ) t
      left join zin on zin.territoire = cand.territoire and zin.q = cand.q and zin.r = cand.r
     where (select count(*) from cand) <= v_limite
  ), ret as materialized (                                                  -- (3) cellules retenues
    select r0.*
      from (select tot.*, round(100 * tot.pop_en_zone / tot.pop_totale, 1) as part,
                   ST_Transform(tot.centre_3857, 4326) as centre
              from tot
             where tot.pop_totale > 0
               and tot.pop_ind >= p_pop_min             -- A6 : la population du DISQUE ; C24 round 1 : TOTALE
               -- B11 : la part NON arrondie (19,96 % ne passe plus un seuil de 20 %), et jamais un disque sans
               -- personne de la zone (à seuil 0, part > 0) ; `part`, rendue au dixième, reste l'affichage.
               and tot.pop_en_zone > 0
               and 100 * tot.pop_en_zone / tot.pop_totale >= p_seuil) r0
  ), u as materialized (                                                    -- (4) carreaux de l'union, par l'index
    select distinct on (cc.carreau_id) cc.carreau_id, cc.pops[v_rang]::numeric as pop
      from ret
      join public.carreau_couverture cc
        on cc.centroide_3857 && ST_Expand(ret.centre_3857, ret.r_ext)
       and (ST_DWithin(cc.centroide_3857, ret.centre_3857, ret.r_int)
            or ST_DWithin(ST_Transform(cc.centroide_3857, 4326)::geography, ret.centre_g, p_rayon_m))
     where (p_max_cercles is null or (select count(*) from ret) <= p_max_cercles)
       and (v_min = 0 or cc.pops[v_rang_men] >= v_min)  -- A5 : l'union aussi
     order by cc.carreau_id
  ), perte as (                                                             -- (5) un seul passage zone × union
    select coalesce(sum(z.pop), 0) as population,
           coalesce(sum(u.pop) filter (where z.carreau_id is not null), 0) as couverte,
           coalesce(sum(z.pop) filter (where u.carreau_id is null), 0) as manques,
           coalesce(sum(u.pop) filter (where z.carreau_id is null), 0) as hors_zone,
           coalesce(sum(u.pop), 0) as achetee
      from z full join u on u.carreau_id = z.carreau_id
  )
  select (select count(*) from z),
         (select count(*) from cand),
         (select count(*) from ret),
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'lon', round(ST_X(ret.centre)::numeric, 6), 'lat', round(ST_Y(ret.centre)::numeric, 6),
                    'pop_en_zone', round(ret.pop_en_zone), 'pop_totale', round(ret.pop_totale), 'part', ret.part)
                    -- C24 round 1 : cible autre que ind, la population totale du disque.
                    || case when p_cible <> 'ind' then jsonb_build_object('pop_totale_ind', round(ret.pop_ind)) else '{}'::jsonb end
                  order by ret.pop_en_zone desc, ret.territoire, ret.q, ret.r), '[]'::jsonb) from ret),
         (select coalesce(jsonb_agg(jsonb_build_object('territoire', gr.territoire, 'pas_3857', round(gr.pas::numeric, 3))
                                    order by gr.territoire), '[]'::jsonb) from grilles gr),
         (select max(round(100 * tot.pop_en_zone / nullif(tot.pop_totale, 0), 1)) from tot),
         perte.population, perte.couverte, perte.manques, perte.hors_zone, perte.achetee,
         (select count(*) from z_tous where not z_tous.compte),
         (select coalesce(sum(z_tous.pop), 0) from z_tous where not z_tous.compte),
         -- A6 : la somme des lignes telles que rendues (chacune arrondie à l'entier) — c'est elle que lit l'écran.
         (select coalesce(sum(round(ret.pop_totale)), 0) from ret),
         (select max(cand.r_ext / cand.pas) from cand),
         -- B13 : les cellules qui passaient le seuil (mêmes conditions que `ret`) et que SEUL `p_pop_min` écarte.
         (select count(*) from tot
            where tot.pop_totale > 0 and tot.pop_ind < p_pop_min and tot.pop_en_zone > 0
              and 100 * tot.pop_en_zone / tot.pop_totale >= p_seuil),
         -- `floor` (relecture M-4) : un disque de 999,6 écarté ne s'affiche pas « 1 000, sous le minimum de 1 000 ».
         (select max(floor(tot.pop_ind)) from tot
            where tot.pop_totale > 0 and tot.pop_ind < p_pop_min and tot.pop_en_zone > 0
              and 100 * tot.pop_en_zone / tot.pop_totale >= p_seuil)
    into v_n_carreaux, v_n_cand, v_n_cercles, v_cercles, v_grilles, v_part_max,
         v_population, v_couverte, v_manques, v_hors_zone, v_achetee, v_ec_n, v_ec_p, v_somme, v_fleur,
         v_pm_n, v_pm_max
    from perte;

  if v_n_cand > v_limite and v_limite = p_max_candidates then
    return jsonb_build_object('refus', 'trop_de_candidates', 'plafond', p_max_candidates);
  elsif v_n_cand > v_limite then
    return jsonb_build_object('refus', 'zone_trop_vaste', 'motif', 'rayon', 'n_candidates_max', v_limite,
                              'plafond_balaye_km2', c_max_balaye);
  end if;
  -- A6 : la population de la zone dans un disque ne lit que la cellule du centre et ses 6 voisines (étape 2b) — exact
  -- tant que le rayon 3857 du disque reste sous 2 pas. Jamais atteint en France (≈ 1,2 au pire, Corse-Nord) : si un
  -- territoire le dépassait un jour, on échoue au lieu de sous-compter.
  if v_fleur >= 2 then
    raise exception 'rayon 3857 d''un disque >= 2 pas de grille (%) : la population en zone ne se lit plus sur 7 cellules', v_fleur
      using errcode = 'XX000';
  end if;
  if v_part_max > 100 then
    raise exception 'part de disque > 100 %% (%) : un carreau de la zone compte sans etre dans le disque', v_part_max
      using errcode = 'XX000';
  end if;
  if p_max_cercles is not null and v_n_cercles > p_max_cercles then
    return jsonb_build_object('refus', 'trop_de_cercles', 'n_cercles', v_n_cercles, 'plafond', p_max_cercles);
  end if;

  -- L'écran distingue « territoire non carroyé » de « aucun cercle au seuil » (même règle que `couverture_geometrie`).
  if v_n_carreaux = 0 and v_ec_n = 0 then
    v_non_carr := public.territoires_non_carroyes(v_geom);
  end if;

  return jsonb_build_object(
    'zone_id', p_zone_id,
    'cible', p_cible,
    'rayon_m', p_rayon_m,
    'seuil', p_seuil,
    'pop_min', p_pop_min,
    'n_candidates', v_n_cand,
    'n_cercles', v_n_cercles,
    'cercles', v_cercles,
    'population', round(v_population),
    'couverte', round(v_couverte),
    'manques', round(v_manques),
    'hors_zone', round(v_hors_zone),
    'achetee', round(v_achetee),
    'taux_utile', round(100 * v_couverte / nullif(v_achetee, 0), 1),
    -- A6 : somme des `pop_totale` des cercles (populations des DISQUES) ; elle dépasse `achetee` (l'union dédoublonnée)
    -- de `chevauchement` habitants, comptés dans plusieurs disques voisins.
    'somme_disques', v_somme,
    'chevauchement', greatest(v_somme - round(v_achetee), 0),
    'n_carreaux', v_n_carreaux,
    -- A5 : le minimum appliqué et ce qu'il écarte (avant = n_carreaux + écartés ; après = n_carreaux).
    'min_menages', v_min,
    'carreaux_ecartes', jsonb_build_object('n_carreaux', v_ec_n, 'population', round(v_ec_p)),
    -- B13 (règle 5) : ce que le minimum d'habitants par cercle (`p_pop_min`, `pop_min_unite` en `refus`) écarte —
    -- avant : n_cercles + ces cellules ; après : n_cercles. `population_max` : le plus peuplé des disques écartés.
    'ecartes_pop_min', jsonb_build_object('n_cercles', v_pm_n, 'population_max', v_pm_max),
    'motif_vide', case when v_n_carreaux = 0 and v_ec_n > 0 then 'carreaux_tous_ecartes'
                       when v_n_carreaux = 0 and jsonb_array_length(v_non_carr) > 0 then 'territoire_non_carroye'
                       when v_n_carreaux = 0 then 'aucun_carreau'
                       when v_n_cercles = 0 then 'aucune_cellule_au_seuil' end,
    'territoires_non_carroyes', v_non_carr,
    'reference', jsonb_build_object(
      'source', 'carroyage INSEE Filosofi 200 m (ménages fiscaux)',
      'millesime', (select max(cf.millesime) from public.carreaux_filosofi cf where cf.resolution = '200m'),
      'grille', 'hexagonale, cercle circonscrit, distance géodésique ; population d''un cercle = celle de son disque',
      'grilles', v_grilles),
    'calcule_le', now()
  );
end
$fn$;

comment on function public.paver_cercles(uuid, uuid, text, integer, numeric, integer, integer, integer) is
  'Pave une zone de l''espace en cercles de rayon p_rayon_m (grille hexagonale par territoire, cercle circonscrit), '
  'retient les cercles dont la part en zone >= p_seuil et la population >= p_pop_min (chiffres du DISQUE, sql/311), et '
  'chiffre la perte exacte sur l''union dedoublonnee des disques retenus (couverte, manques, hors_zone, achetee, '
  'taux_utile) ; somme_disques (somme des pop_totale des cercles) depasse achetee de chevauchement. Lecture seule, '
  'jsonb ; refus zone_introuvable, cible_inconnue, zone_trop_vaste (surface, ou motif rayon : > 200 000 km2 balayes), '
  'couverture_non_construite, trop_de_candidates, trop_de_cercles (+ n_cercles, plafond) ; motif_vide '
  '(territoire_non_carroye, aucun_carreau, aucune_cellule_au_seuil, carreaux_tous_ecartes) ; rayon hors '
  '[1 000, 200 000] -> 22023. sql/276 (lot 5, T4), sql/303 (B11), sql/310 (A5 : minimum de menages), sql/311 (A6 : '
  'population, part et minimum d''habitants d''un cercle = ceux de son disque), sql/318 (B13 : ecartes_pop_min, les '
  'cercles au seuil ecartes par le seul p_pop_min, et la population du plus peuple). sql/330 (C24 round 1 : p_pop_min compare la population TOTALE du disque ; pop_totale_ind par cercle).';

revoke all on function public.paver_cercles(uuid, uuid, text, integer, numeric, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.paver_cercles(uuid, uuid, text, integer, numeric, integer, integer, integer) to service_role;

-- ── 4. couverture_zone ────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.couverture_zone(p_zone_id uuid, p_org_id uuid, p_cible text, p_decoupage text)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_res     jsonb;
  v_maj     timestamptz;
  v_base    timestamptz;
  v_recette jsonb;
  v_surface numeric;
  v_pays    text;      -- C21
  v_retires uuid[];    -- C21
  v_retire  geometry;  -- C21
  v_trouves integer;   -- C21
begin
  -- Un autre appel a pu remplir le cache depuis la lecture de la route.
  v_res := public.couverture_zone_en_cache(p_zone_id, p_org_id, p_cible, p_decoupage);
  if v_res is not null then
    return v_res;
  end if;

  -- AVANT le calcul (voir l'en-tête de sql/270) ; NULL pour une zone absente ou d'un autre espace — le calcul le refusera.
  -- La recette est lue avec la date (une colonne de plus, pas la géométrie : une forme de 23 000 sommets pèse ≈ 370 Ko).
  select g.updated_at, g.recette into v_maj, v_recette
    from public.custom_geo_zones g where g.id = p_zone_id and g.org_id = p_org_id;
  -- C21 : « zone nationale moins zones locales » — le code pays de sa première opérande.
  if v_maj is not null and v_recette->>'type' = 'combinaison' then
    v_pays := public.zone_pays_moins_base(p_zone_id, p_org_id);
  end if;

  -- Zone pays (sql/296) : les dénominateurs nationaux, aucun carreau, avant la borne de surface.
  if v_maj is not null and v_recette->>'type' = 'pays' then
    v_res := public.couverture_pays_jsonb(v_recette->>'code', p_cible, p_decoupage);
    -- C24 round 1 : cible autre que ind, la population TOTALE de la zone (dénominateurs nationaux, ≈ 8 ms).
    if p_cible <> 'ind' and not (v_res ? 'refus') then
      v_res := v_res || jsonb_build_object('population_ind', public.couverture_pays_jsonb(v_recette->>'code', 'ind', 'forme')->'population');
    end if;
    if not (v_res ? 'refus') then
      select round((ST_Area(g.geometry::geography) / 1e6)::numeric, 1) into v_surface
        from public.custom_geo_zones g where g.id = p_zone_id;
      v_res := v_res || jsonb_build_object('zone_id', p_zone_id, 'surface_km2', v_surface);
    end if;
  elsif v_pays is not null then
    -- C21 : les agrégats nationaux moins l'UNION des zones retirées (une zone qui en chevauche une autre n'est retirée
    -- qu'une fois). Les opérandes ne peuvent être supprimées tant que la zone les cite (`zone_referencee`) ; une
    -- opérande manquante est refusée plutôt que de retirer moins.
    -- LE CACHE (round 1) : ce chiffrage lit la forme des zones RETIRÉES, mais le cache ne se valide que sur la date de
    -- CETTE zone (`zone_maj` = son `updated_at`, `couverture_zone_en_cache`). C'est sûr tant que `zone_referencee`
    -- (sql/253) interdit de recalculer ou de supprimer une zone citée par une combinaison : une zone retirée ne change
    -- pas tant que celle-ci la cite. Si cette garde tombait, le cache servirait un retrait périmé.
    select array_agg(distinct (e.v)::uuid) into v_retires
      from jsonb_array_elements_text(v_recette->'zones') with ordinality as e(v, i) where e.i > 1;
    select ST_Union(ST_MakeValid(g.geometry)), count(*) into v_retire, v_trouves
      from public.custom_geo_zones g where g.id = any(v_retires) and g.org_id = p_org_id;
    if v_trouves is distinct from coalesce(cardinality(v_retires), 0) or v_retire is null then
      return jsonb_build_object('refus', 'zone_introuvable');
    end if;
    v_res := public.couverture_pays_moins_jsonb(v_pays, p_cible, p_decoupage, v_retire);
    -- C24 round 1 : la population totale de la zone (relit les carreaux des seules zones retirées).
    if p_cible <> 'ind' and not (v_res ? 'refus') then
      v_res := v_res || jsonb_build_object('population_ind', public.couverture_pays_moins_jsonb(v_pays, 'ind', 'forme', v_retire)->'population');
    end if;
    if not (v_res ? 'refus') then
      select round((ST_Area(g.geometry::geography) / 1e6)::numeric, 1) into v_surface
        from public.custom_geo_zones g where g.id = p_zone_id;
      v_res := v_res || jsonb_build_object('zone_id', p_zone_id, 'surface_km2', v_surface, 'zones_retirees', to_jsonb(v_retires));
    end if;
  else
    v_res := public.couverture_geometrie(p_zone_id, p_org_id, p_cible, p_decoupage);
  end if;
  if v_res ? 'refus' then
    return v_res;
  end if;

  v_base := (v_res->>'base_construite_le')::timestamptz;
  if v_maj is not null and v_base is not null then
    begin
      insert into public.couverture_zone_cache as c (zone_id, cible, decoupage, zone_maj, base_construite_le, resultat, calcule_le)
      values (p_zone_id, p_cible, p_decoupage, v_maj, v_base, v_res, now())
      on conflict (zone_id, cible, decoupage) do update
        set zone_maj = excluded.zone_maj,
            base_construite_le = excluded.base_construite_le,
            resultat = excluded.resultat,
            calcule_le = excluded.calcule_le
        where c.zone_maj <= excluded.zone_maj;
    exception when foreign_key_violation then
      -- La zone a été supprimée pendant le calcul : le chiffrage est rendu, rien n'est gardé.
      null;
    end;
  end if;

  return v_res || jsonb_build_object('cache', false, 'zone_maj', v_maj);
end
$fn$;

comment on function public.couverture_zone(uuid, uuid, text, text) is
  'Couverture d''une zone de l''espace avec cache (couverture_zone_cache) : sert le cache s''il est valide, sinon '
  'calcule (couverture_geometrie, ou couverture_pays_jsonb pour une zone pays, sql/296, ou couverture_pays_moins_jsonb '
  'pour une zone nationale moins zones locales, sql/326) et garde le chiffrage. '
  '|| { cache, zone_maj }. sql/270 (lot 4, T6, T8), sql/296 (finitions de l''analyse, T2), sql/326 (C21). sql/330 (C24 round 1 : population_ind des zones pays, cible autre que ind).';

revoke all on function public.couverture_zone(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.couverture_zone(uuid, uuid, text, text) to service_role;

-- ── 5. Le cache : les chiffrages à une autre cible sans population totale ne sont plus servis (supprimés une fois) ─
delete from public.couverture_zone_cache c
 where c.cible <> 'ind' and not (c.resultat ? 'population_ind');
