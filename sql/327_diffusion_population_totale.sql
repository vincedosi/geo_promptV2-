-- ============================================================================
-- sql/327_diffusion_population_totale.sql — C24 (plan de corrections du découpage des zones, lot 3, 2026-11-03) :
-- la diffusion achetée reste en POPULATION TOTALE quand la part est calculée sur une cible.
--
-- LE CONSTAT (vérifié dans le code le 03/11). Pour une cible autre que `ind` (ex. `ind_18_24`), `couverture_geometrie`
-- rend `pop_totale` = la population de la CIBLE de l'unité (`populations->>p_cible`). `appliquerSeuil`
-- (lib/zones/conversion.ts) somme ces `pop_totale` dans `achetee` : la « diffusion achetée » était donc comptée en
-- 18-24 ans, alors que la plateforme achète l'unité entière, tous ses habitants.
--
-- LE CORRECTIF. Sur chaque ligne chiffrée, et pour une cible autre que `ind` seulement, `pop_totale_ind` = la
-- population totale de l'unité (`cp_population_totale` / `unite_population_totale`, clé `ind`), sans le filtre du
-- minimum de ménages (A5) : la plateforme diffuse à toute l'unité. `appliquerSeuil` en tire
-- `diffusion_population_totale` (Σ sur les unités retenues), que le bilan affiche. `pop_totale`, `part`,
-- `part_brute`, `achetee` et le taux d'utile restent dans l'unité de la cible : les égalités du bilan tiennent.
-- Pour `ind`, la réponse est inchangée octet pour octet (aucune clé de plus).
--
-- LE CACHE. Les chiffrages à une cible autre que `ind` d'avant cette migration (lignes chiffrées sans la clé) sont
-- supprimés de `couverture_zone_cache`, une fois : cache régénérable, recalculé au prochain appel. Zones pays
-- (`couverture_pays_jsonb`, non modifiée) gardées. Rejouable : au second passage, rien à supprimer.
--
-- Hors de ce correctif (concerns du ticket) : `paver_cercles` (cercles), `couverture_pays_jsonb` (zone nationale) et
-- la maille polygone gardent une diffusion dans l'unité de la cible.
--
-- Corps recopié de sql/323 (identique à la définition en base au 03/11) ; les lignes changées sont marquées « C24 ».
-- Même signature, mêmes droits, aucun DROP. Appliquer par `psql -1`.
-- ============================================================================

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
    select f.carreau_id, f.pop, (v_min = 0 or f.men >= v_min) as compte,
           case p_decoupage when 'cp' then f.code_postal when 'iris' then f.code_iris
                            when 'commune' then f.code_commune when 'departement' then f.code_departement end as code
      from public.carreaux_de_forme_menages(v_geom, v_rang, coalesce(v_rang_men, v_rang)) f
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
         (select coalesce(sum(a.pop_arrondie), 0) from a where a.code is null)  -- C18 : sa part de la répartition
    into v_n, v_pop, v_n_lus, v_ec_n, v_ec_p, v_lignes, v_n_terr, v_part_max, v_hors_n, v_hors_p;

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
  );
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
  'pop_totale_ind sur chaque ligne chiffree = population totale de l''unite, la diffusion achetee).';

revoke all on function public.couverture_geometrie(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.couverture_geometrie(uuid, uuid, text, text, integer) to service_role;

-- C24 : les chiffrages à une cible autre que `ind` sans `pop_totale_ind` ne sont plus servis : supprimés une fois.
delete from public.couverture_zone_cache c
 where c.cible <> 'ind' and not (c.resultat ? 'pays')
   and exists (select 1 from jsonb_array_elements(coalesce(c.resultat->'lignes', '[]'::jsonb)) e
                where e->>'pop_totale' is not null and not (e ? 'pop_totale_ind'));
