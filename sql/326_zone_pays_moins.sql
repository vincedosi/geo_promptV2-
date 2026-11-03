-- ============================================================================
-- sql/326_zone_pays_moins.sql — C21 (plan de corrections du découpage des zones, lot 3, 2026-11-03) : « zone
-- nationale moins zones locales ».
--
-- LE CONSTAT (vérifié le 03/11). L'exécuteur de recette refusait toute combinaison qui prenait une zone pays en
-- opérande (`operande_pays`, lib/zones/executer-recette.ts) : la forme quasi nationale serait passée par
-- `couverture_geometrie`, qui la refuse (> 100 000 km²), et par `resolve_custom_geo_zone_codes` (2,1 s, 48 540 accès).
--
-- LE CORRECTIF. Une différence dont la PREMIÈRE zone est une zone pays (`METRO` | `FR`), les autres des zones locales,
-- est admise (l'exécuteur refuse tout autre emploi d'une zone nationale). Sa couverture = agrégats nationaux MOINS la
-- couverture de l'UNION des zones retirées, sans lire un carreau de la partie nationale :
--   - `zone_pays_moins_base(zone, espace)` : le code pays d'une telle zone, sinon NULL (la recette de la zone et celle
--     de sa première opérande, deux lectures par clé) ;
--   - `couverture_pays_moins_jsonb(code, cible, découpage, géométrie retirée)` porte le corps de
--     `couverture_pays_jsonb` (sql/324), plus le retrait ; `couverture_pays_jsonb` devient une ENVELOPPE MINCE qui
--     l'appelle avec une géométrie NULL — un seul corps, sorties nationales identiques (empreinte md5 des 16
--     combinaisons METRO/FR × ind/men_pauv × forme/cp/département/iris comparée avant/après) ;
--   - `couverture_zone` (sql/296) : une branche de plus, avant `couverture_geometrie` ; cache et quota inchangés ;
--   - `compter_zone_pays` (sql/296) : admet aussi une telle zone (compteurs nationaux moins les CP / IRIS entièrement
--     retirés), toujours sans écrire de code.
--
-- LE RETRAIT. Les carreaux de l'UNION des zones retirées (`carreaux_de_forme_menages`, une lecture, bornée comme
-- `couverture_geometrie` : 100 000 km², 400 000 carreaux) : une zone retirée qui en chevauche une autre n'est donc
-- retirée qu'une fois. N'est retiré que ce que l'agrégat national compte — un carreau dont le CP (département au
-- découpage département) est dans le pays (`pays_contient_code`), et qui passe le minimum de ménages de la cible (A5,
-- la règle de la jumelle filtrée). Le reste est dit dans `retire.hors_national` : les carreaux sans CP (C25, absents
-- de la population nationale au CP, donc non retirés) et ceux hors du pays.
--   - Totaux : n_carreaux, population, carreaux écartés = national − retiré.
--   - Lignes CP / département : chaque unité vaut national(unité) − retiré(unité). Une unité dont TOUS les carreaux
--     sont retirés disparaît (aucun carreau dans la zone) ; une unité jamais touchée garde sa ligne nationale à
--     l'identique (pop_totale = pop_en_zone, part 100) ; une unité touchée porte pop_totale = round(national), part et
--     part_brute = reste / national. Une valeur négative LÈVE (XX000) : numérateur et dénominateur ne suivraient plus
--     la même règle.
--   - Arrondi au plus fort reste (C18) sur les restes bruts : Σ lignes = round(Σ restes) = `population` au CP.
--   - IRIS et commune : refus `decoupage_trop_fin_pays`, comme une zone pays ; les unités non carroyées (A4, FR)
--     gardent leur ligne nationale.
--
-- Mesuré le 03/11 (EXPLAIN (ANALYZE, BUFFERS) de l'appel, base locale chaude ; « accès » = hit + read) — France
-- métropolitaine moins un rayon de 30 km autour de Lyon (26 745 carreaux lus dans le rayon) :
--   national 62 528 975 − retiré 1 903 232 = 60 625 743 hab. ; 1 carreau sans CP (61 hab.) dans `hors_national`
--   `forme`        47 ms · 3 269 accès (dont ≈ 2 400 pour les carreaux du rayon, index GIST de carreau_couverture)
--   `cp`          159 ms · 5 922 accès · 5 882 lignes (5 956 nationales, 74 CP entièrement retirés) — contre
--                 101 ms · 3 489 accès pour la métropole seule
--   `departement`  75 ms · 3 378 accès
--   Aucun parcours de carreau_couverture ni de carreaux_filosofi : seuls les carreaux de la géométrie retirée.
--   Empreinte md5 des 16 sorties de couverture_pays_jsonb (METRO/FR × ind/men_pauv × forme/cp/département/iris)
--   identique avant/après. Tests : tests/integration/zone-pays-moins.test.ts.
--
-- Droits : service_role. Rejouable (`create or replace`, mêmes signatures pour les fonctions existantes ; aucun DROP).
-- Appliquer par `psql -1`.
-- ============================================================================

-- ── La base nationale d'une différence ───────────────────────────────────────────────────────────────────────────────
create or replace function public.zone_pays_moins_base(p_zone_id uuid, p_org_id uuid)
returns text
language sql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
  select b.recette->>'code'
    from public.custom_geo_zones z
    join public.custom_geo_zones b
      on b.id = case when jsonb_typeof(z.recette->'zones') = 'array' then (z.recette->'zones'->>0)::uuid end
     and b.org_id = z.org_id
   where z.id = p_zone_id and z.org_id = p_org_id
     and z.recette->>'type' = 'combinaison' and z.recette->>'operation' = 'difference'
     and b.recette->>'type' = 'pays'
$fn$;

comment on function public.zone_pays_moins_base(uuid, uuid) is
  'Code pays (METRO | FR) d''une zone « nationale moins zones locales » : combinaison difference dont la premiere '
  'zone est une zone pays du meme espace ; NULL sinon. sql/326 (C21).';

revoke all on function public.zone_pays_moins_base(uuid, uuid) from public, anon, authenticated;
grant execute on function public.zone_pays_moins_base(uuid, uuid) to service_role;

-- ── La couverture d'un pays moins une géométrie retirée (corps de sql/324 + le retrait, marqué « C21 ») ─────────────
create or replace function public.couverture_pays_moins_jsonb(p_code text, p_cible text, p_decoupage text, p_retire geometry)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  c_max_km2  constant numeric := 100000;   -- C21 : les bornes de couverture_geometrie, pour la géométrie retirée
  c_max_carr constant integer := 400000;
  v_motif    text;
  v_base     timestamptz;
  v_denom_le timestamptz;
  v_n        bigint;
  v_pop      numeric;
  v_lignes   jsonb := '[]'::jsonb;
  v_n_terr   integer := 0;
  v_ref      jsonb;
  v_inc      jsonb := '[]'::jsonb;  -- A4 : les lignes des unités non carroyées du territoire
  v_n_inc    integer := 0;
  v_min      numeric;   -- A5 : le minimum de ménages appliqué (0 pour la population totale)
  v_ec_n     bigint;    -- A5 : carreaux du pays écartés (moins de v_min ménages)
  v_ec_p     numeric;
  -- C21 : le retrait
  v_moins    boolean := p_retire is not null;
  v_surf_ret numeric;
  v_rang     integer;
  v_rang_men integer;
  v_ret_lus  bigint := 0;
  v_ret_n    bigint := 0;
  v_ret_p    numeric := 0;
  v_ret_ec_n bigint := 0;
  v_ret_ec_p numeric := 0;
  v_hors_n   bigint := 0;
  v_hors_p   numeric := 0;
  v_ret      jsonb := '{}'::jsonb;  -- code → [n_carreaux, population] retirés, au découpage demandé
  v_neg      bigint := 0;
begin
  if p_code is null or p_code not in ('METRO', 'FR') then
    raise exception 'pays inconnu : % (METRO ou FR)', p_code using errcode = '22023';
  end if;
  if p_decoupage is null or p_decoupage not in ('forme', 'cp', 'iris', 'commune', 'departement') then
    raise exception 'decoupage non autorise : % (forme, cp, iris, commune ou departement)', p_decoupage using errcode = '22023';
  end if;
  -- Trop fin pour un pays : refusé AVANT toute lecture.
  if p_decoupage in ('iris', 'commune') then
    return jsonb_build_object('refus', 'decoupage_trop_fin_pays', 'decoupage', p_decoupage);
  end if;
  if not exists (select 1 from public.cibles_exposition ce where ce.code = p_cible and ce.actif and ce.rang_pop is not null) then
    return jsonb_build_object('refus', 'cible_inconnue');
  end if;
  v_min := public.min_menages_de_cible(p_cible);  -- A5 (ARB-4)

  -- C21 : la géométrie retirée, bornée comme une zone locale (avant toute lecture de carreau).
  if v_moins then
    v_surf_ret := ST_Area(p_retire::geography) / 1e6;
    if v_surf_ret > c_max_km2 then
      return jsonb_build_object('refus', 'zone_trop_vaste', 'surface_km2', round(v_surf_ret, 1), 'plafond_km2', c_max_km2);
    end if;
  end if;

  -- Les mêmes refus de base que couverture_geometrie : la forme se chiffre par les dénominateurs CP.
  select max(b.construit_le) into v_base from public.carreau_couverture_bandes b;
  v_motif := public.carreau_couverture_complete();
  if v_motif is null then
    v_denom_le := public.denominateur_construit_le(case p_decoupage when 'forme' then 'cp' else p_decoupage end);
    if v_denom_le is null then
      v_motif := 'denominateur_' || case p_decoupage when 'forme' then 'cp' else p_decoupage end || '_absent';
    elsif v_denom_le > v_base then
      v_motif := 'denominateur_' || case p_decoupage when 'forme' then 'cp' else p_decoupage end || '_plus_recent';
    end if;
  end if;
  -- A5 : sous un minimum, les chiffres viennent de la jumelle filtrée (CP pour la forme, sinon la maille demandée).
  if v_motif is null and v_min > 0 then
    v_motif := public.denominateur_menages_motif(case p_decoupage when 'forme' then 'cp' else p_decoupage end);
  end if;
  if v_motif is not null then
    return jsonb_build_object('refus', 'couverture_non_construite', 'motif', v_motif);
  end if;

  -- C21 : les carreaux de la géométrie retirée, lus UNE fois. `au_cp` : comptés par l'agrégat national au CP (CP dans
  -- le pays) ; `au_u` : par la ligne du découpage (département dans le pays au découpage département, sinon `au_cp`).
  if v_moins then
    select ce.rang_pop into v_rang from public.cibles_exposition ce where ce.code = p_cible and ce.actif and ce.rang_pop is not null;
    select ce.rang_pop into v_rang_men from public.cibles_exposition ce where ce.code = 'men' and ce.rang_pop is not null;
    if v_min > 0 and v_rang_men is null then
      raise exception 'cible men (menages) absente de cibles_exposition : le minimum ne peut pas se lire' using errcode = '55000';
    end if;
    with c as materialized (
      select f.pop, (v_min = 0 or f.men >= v_min) as compte,
             f.code_postal is not null and public.pays_contient_code(p_code, f.code_postal) as au_cp,
             case when p_decoupage = 'departement' then f.code_departement else f.code_postal end as code_u,
             case when p_decoupage = 'departement'
                  then f.code_departement is not null and public.pays_contient_code(p_code, f.code_departement)
                  else f.code_postal is not null and public.pays_contient_code(p_code, f.code_postal) end as au_u
        from public.carreaux_de_forme_menages(p_retire, v_rang, coalesce(v_rang_men, v_rang)) f
       limit c_max_carr + 1
    )
    select (select count(*) from c),
           (select count(*) from c where c.compte and c.au_cp),
           (select coalesce(sum(c.pop), 0) from c where c.compte and c.au_cp),
           (select count(*) from c where not c.compte and c.au_cp),
           (select coalesce(sum(c.pop), 0) from c where not c.compte and c.au_cp),
           (select count(*) from c where c.compte and not c.au_cp),
           (select coalesce(sum(c.pop), 0) from c where c.compte and not c.au_cp),
           (select coalesce(jsonb_object_agg(k.code_u, jsonb_build_array(k.n, k.p)), '{}'::jsonb)
              from (select c.code_u, count(*) as n, sum(c.pop) as p from c
                     where p_decoupage in ('cp', 'departement') and c.compte and c.au_u group by c.code_u) k)
      into v_ret_lus, v_ret_n, v_ret_p, v_ret_ec_n, v_ret_ec_p, v_hors_n, v_hors_p, v_ret;
    if v_ret_lus > c_max_carr then
      return jsonb_build_object('refus', 'trop_de_carreaux', 'plafond', c_max_carr);
    end if;
  end if;

  -- A5 : sans minimum, `cp_population_totale` ; sous un minimum, la jumelle filtrée maille cp, jointe par hachage. Les
  -- écartés = tous les carreaux du pays moins ceux qui comptent.
  select coalesce(sum(case when v_min > 0 then dm.n_carreaux else cp.n_carreaux end), 0),
         coalesce(sum(case when v_min > 0 then coalesce((dm.populations->>p_cible)::numeric, 0)
                           else (cp.populations->>p_cible)::numeric end), 0),
         coalesce(sum(cp.n_carreaux - coalesce(dm.n_carreaux, cp.n_carreaux)), 0),
         coalesce(sum((cp.populations->>p_cible)::numeric - coalesce((dm.populations->>p_cible)::numeric,
                                                                     (cp.populations->>p_cible)::numeric)), 0)
    into v_n, v_pop, v_ec_n, v_ec_p
    from public.cp_population_totale cp
    left join (select d.code, d.n_carreaux, d.populations from public.denominateur_menages_min d
                  where v_min > 0 and d.maille = 'cp' offset 0) dm on dm.code = cp.code_postal
   where public.pays_contient_code(p_code, cp.code_postal);
  -- C21 : national moins retiré (0 sans retrait).
  v_n := v_n - v_ret_n;
  v_pop := v_pop - v_ret_p;
  v_ec_n := v_ec_n - v_ret_ec_n;
  v_ec_p := v_ec_p - v_ret_ec_p;
  if v_n < 0 or v_pop < 0 or v_ec_n < 0 or v_ec_p < 0 then
    raise exception 'retrait superieur au national (% carreaux, % hab.) : numerateur et denominateur ne suivent plus la meme regle',
      v_n, v_pop using errcode = 'XX000';
  end if;

  if p_decoupage = 'cp' then
    -- C18 : les lignes d'abord (`l`), puis leur population arrondie au plus fort reste (`a`, la règle de sql/323) :
    -- Σ pop_en_zone = round(Σ t.p) = `population` (même dénominateur, mêmes carreaux). `round(t.p)` ligne à ligne
    -- arrondissait chaque ,5 vers le haut : +1 504 en FR, +1 489 en METRO (« manqués −1 504 » à l'écran).
    -- C21 : `t.p` / `t.n` sont nationaux ; `l.p` / `l.n` en retirent la part de la géométrie retirée (`v_ret`).
    with l0 as (
    select cp.code_postal as code, rcp.nom_principal as nom, t.n - r.n as n, t.p - r.p as p, t.p as tot, r.n > 0 as touche,
           m.membres
      from public.cp_population_totale cp
      -- A5 : sous un minimum, population et carreaux de la jumelle filtrée.
      left join (select d.code, d.n_carreaux, d.populations from public.denominateur_menages_min d
                  where v_min > 0 and d.maille = 'cp' offset 0) dm on dm.code = cp.code_postal
      cross join lateral (select case when v_min > 0 then coalesce((dm.populations->>p_cible)::numeric, 0)
                                      else (cp.populations->>p_cible)::numeric end as p,
                                 case when v_min > 0 then coalesce(dm.n_carreaux, 0) else cp.n_carreaux end as n) t
      cross join lateral (select coalesce((v_ret->cp.code_postal->>0)::bigint, 0) as n,
                                 coalesce((v_ret->cp.code_postal->>1)::numeric, 0) as p) r  -- C21
      -- A2 : les groupes lus UNE fois (181 lignes, n_membres > 1) puis joints par hachage ; une sous-requête par ligne
      -- coûtait 18 000 accès de plus sur la métropole (5 956 lignes : 22 879 contre 4 834 sans la clé, mesuré le 31/10).
      left join (select g.code_canonique, array_agg(g.code_postal order by g.code_postal) as codes
                   from public.cp_groupe g where g.n_membres > 1 group by g.code_canonique) grp
             on grp.code_canonique = cp.code_postal
      cross join lateral (select coalesce(grp.codes, array[cp.code_postal]) as membres) m
      left join public.ref_codes_postaux rcp on rcp.code_postal = cp.code_postal
     where public.pays_contient_code(p_code, cp.code_postal)
    ), l as (
      -- C21 : une unité dont tous les carreaux sont retirés n'est plus dans la zone.
      select * from l0 where not (l0.touche and l0.n = 0)
    ), a as (
      select l.*, floor(l.p) + case when row_number() over (order by l.p - floor(l.p) desc nulls last, l.p desc nulls last,
                                                                     l.code)
                                         <= round(sum(l.p) over ()) - sum(floor(l.p)) over () then 1 else 0 end as pa
        from l
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', a.code, 'nom', a.nom, 'commune', null, 'n_carreaux', a.n,
             -- C18 : pop_totale = pop_en_zone, toujours (le CP est entier dans le pays : taux utile 100 %).
             -- C21 : sauf un CP touché par le retrait — sa population nationale, et la part qui reste.
             'pop_en_zone', a.pa,
             'pop_totale', case when a.touche then round(a.tot) else a.pa end,
             'part', case when a.touche then round(100 * a.p / nullif(a.tot, 0), 1) when a.p > 0 then 100.0 end,
             'part_brute', case when a.touche then 100 * a.p / nullif(a.tot, 0) when a.p > 0 then 100 end,  -- B11
             'membres', to_jsonb(a.membres))  -- A2 : les codes de l'unité CP
           order by a.p desc, a.code), '[]'::jsonb), count(*), count(*) filter (where a.p < 0 or a.n < 0)
      into v_lignes, v_n_terr, v_neg
      from a;
  elsif p_decoupage = 'departement' then
    -- C18 : même répartition ; Σ pop_en_zone = round(Σ des départements). L'écart qui reste à `population` (comptée
    -- par CP) est celui des carreaux sans CP (I-2, rattaché à C25), hors de ce correctif.
    with l0 as (
    select u.code, rd.nom_dept as nom, t.n - r.n as n, t.p - r.p as p, t.p as tot, r.n > 0 as touche
      from public.unite_population_totale u
      left join (select d.code, d.n_carreaux, d.populations from public.denominateur_menages_min d
                  where v_min > 0 and d.maille = 'departement' offset 0) dm on dm.code = u.code
      cross join lateral (select case when v_min > 0 then coalesce((dm.populations->>p_cible)::numeric, 0)
                                      else (u.populations->>p_cible)::numeric end as p,
                                 case when v_min > 0 then coalesce(dm.n_carreaux, 0) else u.n_carreaux end as n) t
      cross join lateral (select coalesce((v_ret->u.code->>0)::bigint, 0) as n,
                                 coalesce((v_ret->u.code->>1)::numeric, 0) as p) r  -- C21
      left join public.ref_departements rd on rd.code_dept = u.code
     where u.maille = 'departement' and public.pays_contient_code(p_code, u.code)
    ), l as (
      select * from l0 where not (l0.touche and l0.n = 0)  -- C21
    ), a as (
      select l.*, floor(l.p) + case when row_number() over (order by l.p - floor(l.p) desc nulls last, l.p desc nulls last,
                                                                     l.code)
                                         <= round(sum(l.p) over ()) - sum(floor(l.p)) over () then 1 else 0 end as pa
        from l
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', a.code, 'nom', a.nom, 'commune', null, 'n_carreaux', a.n,
             'pop_en_zone', a.pa,
             'pop_totale', case when a.touche then round(a.tot) else a.pa end,  -- C21
             'part', case when a.touche then round(100 * a.p / nullif(a.tot, 0), 1) when a.p > 0 then 100.0 end,
             'part_brute', case when a.touche then 100 * a.p / nullif(a.tot, 0) when a.p > 0 then 100 end)  -- B11
           order by a.p desc, a.code), '[]'::jsonb), count(*), count(*) filter (where a.p < 0 or a.n < 0)
      into v_lignes, v_n_terr, v_neg
      from a;
  end if;
  if v_neg > 0 then  -- C21 : aucune ligne négative, jamais en silence
    raise exception '% ligne(s) negative(s) apres retrait : numerateur et denominateur ne suivent plus la meme regle', v_neg
      using errcode = 'XX000';
  end if;

  -- A4 (ARB-3) : les unités du TERRITOIRE de la recette que le carroyage ne couvre pas — départements ayant une région
  -- (la règle de `zone_pays_geometrie`, qui unit les régions) contenus dans le pays, sans dénominateur ; au CP, le
  -- canonique de chaque groupe de ces départements, avec ses `membres`. Population NULL (jamais 0) ; `incluse` = vrai :
  -- la zone EST le territoire, chaque unité y est entière — c'est ce qui la retient (`estRetenue`), quel que soit le seuil.
  -- FR → 971, 973, 976 au 31/10 (3 départements, 65 unités CP / 69 codes) ; METRO → aucun.
  if p_decoupage in ('cp', 'departement') then
    with nc as (
      select rd.code_dept as code, rd.nom_dept as nom
        from public.ref_departements rd
       where rd.code_region is not null
         and public.pays_contient_code(p_code, rd.code_dept)
         and not exists (select 1 from public.unite_population_totale u
                          where u.maille = 'departement' and u.code = rd.code_dept)
    ), u as (
      select nc.code, nc.nom, null::text[] as membres from nc where p_decoupage = 'departement'
      union all
      select r.code_postal, r.nom_principal,
             coalesce((select array_agg(m.code_postal order by m.code_postal)
                         from public.cp_groupe m where m.code_canonique = r.code_postal), array[r.code_postal])
        from public.ref_codes_postaux r join nc on nc.code = r.code_dept
       where p_decoupage = 'cp'
         and not exists (select 1 from public.cp_groupe g where g.code_postal = r.code_postal and g.code_canonique <> r.code_postal)
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', u.code, 'nom', u.nom, 'commune', null, 'n_carreaux', 0,
             'pop_en_zone', null, 'pop_totale', null, 'part', null, 'part_brute', null, 'incluse', true)
             || case when u.membres is not null then jsonb_build_object('membres', to_jsonb(u.membres)) else '{}'::jsonb end
           order by u.code), '[]'::jsonb), count(*)
      into v_inc, v_n_inc
      from u;
  end if;

  select jsonb_build_object(
           'source', 'carroyage INSEE Filosofi 200 m (ménages fiscaux)',
           'millesime', (select max(cf.millesime) from public.carreaux_filosofi cf where cf.resolution = '200m'),
           -- A5 : la France de la cible compte les mêmes carreaux que les lignes.
           'population_france', case when v_min > 0
                                  then (select round(coalesce(sum((dm.populations->>p_cible)::numeric), 0))
                                          from public.denominateur_menages_min dm where dm.maille = 'departement')
                                  else (select round(coalesce(sum((u.populations->>p_cible)::numeric), 0))
                                          from public.unite_population_totale u where u.maille = 'region') end,
           'n_carreaux_france', (select k.n_lignes from public.carreau_couverture_controle k limit 1))
    into v_ref;

  return jsonb_build_object(
    'pays', p_code,
    'cible', p_cible,
    'decoupage', p_decoupage,
    'n_carreaux', v_n,
    'population', round(v_pop),
    'lignes', v_lignes || v_inc,  -- A4 : les unités inconnues après les chiffrées
    'hors_territoire', jsonb_build_object('n_carreaux', 0, 'population', 0),
    'n_territoires', v_n_terr + v_n_inc,
    'n_inconnues', v_n_inc,  -- A4
    -- A5 : le minimum appliqué et ce qu'il écarte.
    'min_menages', v_min,
    'arrondi_lignes', 'plus_fort_reste',  -- C18 (sql/324) : lignes au plus fort reste
    'carreaux_ecartes', jsonb_build_object('n_carreaux', v_ec_n, 'population', round(v_ec_p)),
    'motif_vide', case when v_n > 0 then null when v_ec_n > 0 then 'carreaux_tous_ecartes' else 'aucun_carreau' end,
    'territoires_non_carroyes', '[]'::jsonb,
    'reference', v_ref,
    'base_construite_le', v_base,
    'calcule_le', now()
  )
  -- C21 : ce que le retrait a ôté, et ce qu'il n'a pas pu ôter (absent de l'agrégat national : sans CP, hors du pays).
  || case when v_moins then jsonb_build_object('retire', jsonb_build_object(
       'n_carreaux', v_ret_n, 'population', round(v_ret_p),
       'hors_national', jsonb_build_object('n_carreaux', v_hors_n, 'population', round(v_hors_p))),
       -- C21 round 1 : les territoires non carroyés du pays (A4) que la géométrie retirée recouvre. Sans carreau, le
       -- retrait ne peut pas les chiffrer : leurs lignes (population inconnue) RESTENT, et l'écran le dit
       -- (`avertissementNonCarroye`). Au plus trois contours testés (FR : 971, 973, 976 ; METRO : aucun).
       'inconnues_recouvertes', (
         select coalesce(jsonb_agg(jsonb_build_object('code', rd.code_dept, 'nom', rd.nom_dept) order by rd.code_dept), '[]'::jsonb)
           from public.ref_departements rd
          where rd.code_region is not null
            and public.pays_contient_code(p_code, rd.code_dept)
            and not exists (select 1 from public.unite_population_totale u
                             where u.maille = 'departement' and u.code = rd.code_dept)
            and ST_Intersects(coalesce(rd.geom_perimetre, rd.geom), p_retire)))
     else '{}'::jsonb end;
end
$fn$;

comment on function public.couverture_pays_moins_jsonb(text, text, text, geometry) is
  'Couverture d''un pays (METRO / FR) moins une geometrie retiree (NULL : le pays entier), sans lire un carreau de la '
  'partie nationale : agregats nationaux (cp_population_totale, unite_population_totale, jumelle filtree A5) moins les '
  'carreaux de la geometrie retiree comptes par ces agregats (CP ou departement dans le pays). Une unite entierement '
  'retiree disparait ; une ligne negative leve. Lignes au plus fort reste. + retire { n_carreaux, population, '
  'hors_national }. Corps de couverture_pays_jsonb (sql/324). sql/326 (C21).';

revoke all on function public.couverture_pays_moins_jsonb(text, text, text, geometry) from public, anon, authenticated;
grant execute on function public.couverture_pays_moins_jsonb(text, text, text, geometry) to service_role;

-- ── couverture_pays_jsonb : enveloppe mince (même signature, même retour) ────────────────────────────────────────────
create or replace function public.couverture_pays_jsonb(p_code text, p_cible text, p_decoupage text)
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
  select public.couverture_pays_moins_jsonb(p_code, p_cible, p_decoupage, null::geometry)
$fn$;

comment on function public.couverture_pays_jsonb(text, text, text) is
  'Couverture nationale d''une zone pays (METRO / FR) sans lire un carreau : forme = somme de cp_population_totale ; '
  'cp = chaque CP du pays a 100 % ; departement = unite_population_totale ; iris et commune refuses '
  '(decoupage_trop_fin_pays) sans lecture. Memes cles que couverture_geometrie + pays. sql/296 (T2), sql/303 (B11 : part_brute), sql/304 (A2 : membres '
  'des lignes CP), sql/308 (A4), sql/310 (A5), sql/324 (C18 : plus fort reste). sql/326 (C21) : enveloppe de '
  'couverture_pays_moins_jsonb(…, NULL), un seul corps.';

revoke all on function public.couverture_pays_jsonb(text, text, text) from public, anon, authenticated;
grant execute on function public.couverture_pays_jsonb(text, text, text) to service_role;

-- ── couverture_zone : sql/296 + la branche « nationale moins » (C21) ──────────────────────────────────────────────────
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
  '|| { cache, zone_maj }. sql/270 (lot 4, T6, T8), sql/296 (finitions de l''analyse, T2), sql/326 (C21).';

revoke all on function public.couverture_zone(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.couverture_zone(uuid, uuid, text, text) to service_role;

-- ── compter_zone_pays : sql/296 + la zone « nationale moins » (C21) ───────────────────────────────────────────────────
create or replace function public.compter_zone_pays(p_zone_id uuid, p_caller_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_org     uuid;
  v_recette jsonb;
  v_pays    text;
  v_cp      integer;
  v_iris    integer;
  v_retires uuid[];    -- C21
  v_retire  geometry;  -- C21
  v_rang    integer;   -- C21
  v_cp_ret  integer;   -- C21 : CP / IRIS dont TOUS les carreaux sont retirés
  v_iris_ret integer;
begin
  select g.org_id, g.recette into v_org, v_recette from public.custom_geo_zones g where g.id = p_zone_id;
  if v_org is null then
    raise exception 'Zone % not found', p_zone_id;
  end if;
  if v_recette->>'type' = 'pays' then
    v_pays := v_recette->>'code';
  else
    v_pays := public.zone_pays_moins_base(p_zone_id, v_org);  -- C21
    if v_pays is null then
      raise exception 'Zone % : pas une zone pays', p_zone_id using errcode = '22023';
    end if;
  end if;
  -- Le même contrôle d'appartenance que resolve_custom_geo_zone_codes (sql/252).
  if p_caller_user_id is null or (
       not exists (select 1 from public.organization_members m where m.user_id = p_caller_user_id and m.organization_id = v_org)
       and not exists (select 1 from public.profiles p where p.id = p_caller_user_id and p.organization_id = v_org)) then
    raise exception 'Access denied to zone %', p_zone_id;
  end if;

  -- Les CP de la couverture nationale (`cp_population_totale`, 5 956 en métropole) : le même compte que le découpage
  -- « Par code postal » de ④ et que la liste du score (relecture 1 : `ref_codes_postaux` en comptait 6 051).
  select count(*) into v_cp from public.cp_population_totale cp where public.pays_contient_code(v_pays, cp.code_postal);
  select count(*) into v_iris from public.unite_population_totale u
   where u.maille = 'iris' and public.pays_contient_code(v_pays, u.code);

  -- C21 : moins les CP et IRIS entièrement retirés (tous leurs carreaux dans l'union des zones retirées).
  if v_recette->>'type' = 'combinaison' then
    select array_agg(distinct (e.v)::uuid) into v_retires
      from jsonb_array_elements_text(v_recette->'zones') with ordinality as e(v, i) where e.i > 1;
    select ST_Union(ST_MakeValid(g.geometry)) into v_retire
      from public.custom_geo_zones g where g.id = any(v_retires) and g.org_id = v_org;
    select ce.rang_pop into v_rang from public.cibles_exposition ce where ce.code = 'ind' and ce.rang_pop is not null;
    if v_retire is not null and ST_Area(v_retire::geography) / 1e6 <= 100000 then
      with c as materialized (
        select f.code_postal, f.code_iris from public.carreaux_de_forme_menages(v_retire, v_rang, v_rang) f limit 400001
      )
      select (select count(*) from (select c.code_postal, count(*) n from c where c.code_postal is not null group by 1) k
                join public.cp_population_totale cp on cp.code_postal = k.code_postal
               where k.n = cp.n_carreaux and public.pays_contient_code(v_pays, cp.code_postal)),
             (select count(*) from (select c.code_iris, count(*) n from c where c.code_iris is not null group by 1) k
                join public.unite_population_totale u on u.maille = 'iris' and u.code = k.code_iris
               where k.n = u.n_carreaux and public.pays_contient_code(v_pays, u.code))
        into v_cp_ret, v_iris_ret;
      v_cp := v_cp - v_cp_ret;
      v_iris := v_iris - v_iris_ret;
    end if;
  end if;

  -- Aucun code par géométrie : une zone pays n'en garde pas (voir l'en-tête).
  delete from public.custom_geo_zone_codes c where c.zone_id = p_zone_id;
  update public.custom_geo_zones set feature_count_iris = v_iris, feature_count_cp = v_cp, resolved_at = now()
   where id = p_zone_id;

  return jsonb_build_object('zone_id', p_zone_id, 'count_iris', v_iris, 'count_cp', v_cp);
end
$fn$;

comment on function public.compter_zone_pays(uuid, uuid) is
  'Compteurs de Mes zones (feature_count_cp, feature_count_iris) d''une zone pays par comptes d''index, sans lecture '
  'geometrique ni ecriture de custom_geo_zone_codes (resolve_custom_geo_zone_codes lirait tous les IRIS). '
  '{ zone_id, count_iris, count_cp }. sql/296 (T2). sql/326 (C21) : aussi une zone nationale moins zones locales '
  '(moins les CP / IRIS dont tous les carreaux sont retires).';

revoke all on function public.compter_zone_pays(uuid, uuid) from public, anon, authenticated;
grant execute on function public.compter_zone_pays(uuid, uuid) to service_role;

-- Round 1 : un chiffrage « nationale moins » d'avant la clé `inconnues_recouvertes` n'est plus servi (cache
-- régénérable, borné aux lignes qui portent `retire`). Rejouable : au second passage, rien à supprimer.
delete from public.couverture_zone_cache c where c.resultat ? 'retire' and not (c.resultat ? 'inconnues_recouvertes');

notify pgrst, 'reload schema';
