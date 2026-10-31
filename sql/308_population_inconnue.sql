-- sql/308 — A4 (plan de corrections du découpage des zones, 2026-10-31, lot 1) : l'unité à population totale INCONNUE
-- (territoire que le carroyage Filosofi 2021 ne couvre pas) devient une ligne de la couverture, achetable selon ARB-3.
--
-- LE CONSTAT, VÉRIFIÉ DANS LA BASE LE 31/10. Le brief disait « jamais retenue » au CP et au département, « achetée avec
-- population non renseignée » au pays. C'est pire au CP et au département : l'unité n'était pas écartée, elle était
-- ABSENTE. `couverture_pays_jsonb('FR', 'ind', 'departement')` rendait 98 lignes (96 + 972 + 974), aucune pour 971,
-- 973, 976 (absents de `unite_population_totale`) ; au CP, 6 009 lignes, aucune de ces trois départements (absents de
-- `cp_population_totale`). Une zone locale sur la Guadeloupe rendait 0 ligne (seulement `territoires_non_carroyes`).
--
-- ARB-3 (réponse A de Vincent, 31/10) : achetable avec la mention « population inconnue », même règle pour CP, commune,
-- département et pays, avec une ligne « diffusion à population inconnue » séparée dans le bilan.
--
-- CE QUE POSE CETTE MIGRATION.
--   1. Une ligne par unité NON CARROYÉE touchée — département absent de `unite_population_totale` (maille
--      `departement`), et toute commune ou unité CP (canonique de son groupe) de ce département — avec `pop_en_zone`,
--      `pop_totale`, `part`, `part_brute` NULL (jamais 0, E10), `n_carreaux` 0, et `incluse` : l'unité est-elle ENTIÈRE
--      dans la zone ? Le seuil de B11 ne peut pas comparer une part inconnue ; c'est `incluse` qui retient l'unité
--      (`estRetenue`, `lib/zones/conversion.ts`, UNE règle pour toutes les mailles) : entière dans la zone, sa part vaut
--      100 % quelle que soit sa population ; seulement touchée, on ne sait pas ce qu'on achèterait, elle ne l'est pas.
--      - `couverture_pays_jsonb` : le territoire de la recette — départements AYANT une région (`code_region`, la règle
--        de `zone_pays_geometrie`, qui unit les régions : les COM 975, 977, 978 n'en ont pas et n'y sont pas) contenus
--        dans le pays (`pays_contient_code`) — donc `incluse` = vrai, toujours. FR → 971, 973, 976 ; METRO → aucun.
--      - `couverture_geometrie` : seulement si la zone touche un département non carroyé (le test qui remplissait déjà
--        `territoires_non_carroyes`, ≈ 6 contours sur 104 ; une zone métropolitaine ne lit rien de plus), unités
--        `ST_Intersects` la zone, `incluse` = `ST_Covers(zone, unité)`. Pas de ligne inconnue en IRIS (hors A4).
--      Les lignes inconnues suivent les lignes chiffrées (tri par code), et comptent dans `n_territoires`.
--   2. Clé `n_inconnues` au premier niveau de la réponse (nombre de lignes inconnues, 0 sinon), pour les deux fonctions.
--   3. `couverture_zone_en_cache` ne sert plus un chiffrage CP / commune / département sans `n_inconnues` (calculé avant
--      cette migration) ; le prochain appel recalcule et réécrit la ligne de cache, sans DELETE (patron de sql/303-304).
--   `motif_vide` est inchangé : une zone sans carreau sur un territoire non carroyé reste `territoire_non_carroye` —
--   aucun habitant chiffrable —, même si ses unités entières sont désormais achetables.
--
-- Mesuré le 31/10 (base locale, EXPLAIN (ANALYZE, BUFFERS) de l'appel, 2e passe dans la même session, avant = sql/304
-- rejouée dans une transaction annulée ; « accès » = hit + read) :
--   couverture_pays_jsonb FR departement      899 → 955 accès · 6,4 → 4,5 ms · 98 → 101 lignes
--   couverture_pays_jsonb FR cp             3 414 → 3 739 accès · 82 → 89 ms · 6 009 → 6 074 lignes (temp 518, inchangé)
--   couverture_geometrie Lyon 5 km           inchangée : commune 393, cp 429, departement 246 accès (aucun DROM touché)
--   couverture_geometrie Pointe-à-Pitre + 300 m  commune 61 → 79, cp 62 → 107, departement 70 → 130 accès (< 6 ms)
--
-- Corps recopiés de sql/304 (dernière définition des trois fonctions), seules les lignes marquées « A4 » changent.
-- Mêmes signatures, mêmes droits. Rejouable (`create or replace`), aucun DROP. Pas de begin/commit : appliquer par
-- `psql -1`.

-- ── 1. couverture_geometrie : sql/304 + les unités non carroyées touchées (A4) ─────────────────────────────────────────
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
  if v_motif is not null then
    return jsonb_build_object('refus', 'couverture_non_construite', 'motif', v_motif);
  end if;

  with c as materialized (
    select f.carreau_id, f.pop,
           case p_decoupage when 'cp' then f.code_postal when 'iris' then f.code_iris
                            when 'commune' then f.code_commune when 'departement' then f.code_departement end as code
      from public.carreaux_de_forme_codes(v_geom, v_rang) f
     limit p_max_carreaux + 1
  ), g as materialized (
    select c.code, count(*) as n, sum(c.pop) as p from c where p_decoupage <> 'forme' group by c.code
  ), d as (
    select g.code, g.n, g.p, den.tot, den.nom, den.commune,
           -- A2 : les codes de l'unité CP (le groupe indiscernable, `[code]` pour un code ordinaire), triés.
           case when p_decoupage = 'cp' then
             coalesce((select array_agg(m.code_postal order by m.code_postal)
                         from public.cp_groupe m where m.code_canonique = g.code), array[g.code]) end as membres
      from g
      cross join lateral (
        select (cp.populations->>p_cible)::numeric as tot, rcp.nom_principal as nom, null::text as commune
          from public.cp_population_totale cp
          left join public.ref_codes_postaux rcp on rcp.code_postal = cp.code_postal
         where p_decoupage = 'cp' and cp.code_postal = g.code
        union all
        select (u.populations->>p_cible)::numeric,
               coalesce(i.nom_iris, rc.nom_commune, rd.nom_dept), i.nom_commune
          from public.unite_population_totale u
          left join public.iris i on p_decoupage = 'iris' and i.code_iris = u.code
          left join public.ref_communes rc on p_decoupage = 'commune' and rc.code_commune = u.code
          left join public.ref_departements rd on p_decoupage = 'departement' and rd.code_dept = u.code
         where p_decoupage <> 'cp' and u.maille = p_decoupage and u.code = g.code
        union all
        -- Un code sans dénominateur ne devrait pas exister (égalités prouvées, sql/266-267) ; s'il existait, la ligne
        -- resterait, part NULL, plutôt que de disparaître du total.
        select null::numeric, null::text, null::text
         where not exists (select 1 from public.cp_population_totale cp2 where p_decoupage = 'cp' and cp2.code_postal = g.code)
           and not exists (select 1 from public.unite_population_totale u2
                            where p_decoupage <> 'cp' and u2.maille = p_decoupage and u2.code = g.code)
         limit 1
      ) den
     where g.code is not null
  )
  select (select count(*) from c),
         (select coalesce(sum(c.pop), 0) from c),
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'code', d.code, 'nom', d.nom, 'commune', d.commune, 'n_carreaux', d.n,
                    'pop_en_zone', round(d.p), 'pop_totale', round(d.tot),
                    'part', round(100 * d.p / nullif(d.tot, 0), 1),
                    -- B11 : la part SANS arrondi, celle que le seuil compare (`estRetenue`) ; `part` reste l'affichage.
                    'part_brute', 100 * d.p / nullif(d.tot, 0))
                    -- A2 : une ligne CP = une unité ; `code` est son identifiant (le canonique), `membres` ses codes.
                    || case when d.membres is not null then jsonb_build_object('membres', to_jsonb(d.membres)) else '{}'::jsonb end
                  order by d.p desc, d.code), '[]'::jsonb) from d),
         (select count(*) from d),
         (select max(round(100 * d.p / nullif(d.tot, 0), 1)) from d),
         (select coalesce(sum(g.n), 0) from g where g.code is null),
         (select coalesce(sum(g.p), 0) from g where g.code is null)
    into v_n, v_pop, v_lignes, v_n_terr, v_part_max, v_hors_n, v_hors_p;

  if v_n > p_max_carreaux then
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
  -- 0) ; `incluse` (entière dans la zone) est ce qui les retient, à défaut de part (`estRetenue`). Rien n'est lu si la
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
             'pop_en_zone', null, 'pop_totale', null, 'part', null, 'part_brute', null,
             'incluse', ST_Covers(v_geom, u.geom))
             || case when u.membres is not null then jsonb_build_object('membres', to_jsonb(u.membres)) else '{}'::jsonb end
           order by u.code), '[]'::jsonb), count(*)
      into v_inc, v_n_inc
      from u;
  end if;

  select jsonb_build_object(
           'source', 'carroyage INSEE Filosofi 200 m (ménages fiscaux)',
           'millesime', (select max(cf.millesime) from public.carreaux_filosofi cf where cf.resolution = '200m'),
           'population_france', (select round(coalesce(sum((u.populations->>p_cible)::numeric), 0))
                                   from public.unite_population_totale u where u.maille = 'region'),
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
    'motif_vide', case when v_n > 0 then null
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
  'incluse = entiere dans la zone ; n_inconnues).';

revoke all on function public.couverture_geometrie(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.couverture_geometrie(uuid, uuid, text, text, integer) to service_role;


-- ── 2. couverture_pays_jsonb : sql/304 + les unités non carroyées du territoire (A4) ──────────────────────────────────
create or replace function public.couverture_pays_jsonb(p_code text, p_cible text, p_decoupage text)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
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
  if v_motif is not null then
    return jsonb_build_object('refus', 'couverture_non_construite', 'motif', v_motif);
  end if;

  select coalesce(sum(cp.n_carreaux), 0), coalesce(sum((cp.populations->>p_cible)::numeric), 0)
    into v_n, v_pop
    from public.cp_population_totale cp
   where public.pays_contient_code(p_code, cp.code_postal);

  if p_decoupage = 'cp' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', cp.code_postal, 'nom', rcp.nom_principal, 'commune', null, 'n_carreaux', cp.n_carreaux,
             'pop_en_zone', round(t.p), 'pop_totale', round(t.p), 'part', case when t.p > 0 then 100.0 end,
             'part_brute', case when t.p > 0 then 100 end,  -- B11 : exacte, mais la clé que lit `estRetenue`
             'membres', to_jsonb(m.membres))  -- A2 : les codes de l'unité CP
           order by t.p desc, cp.code_postal), '[]'::jsonb), count(*)
      into v_lignes, v_n_terr
      from public.cp_population_totale cp
      cross join lateral (select (cp.populations->>p_cible)::numeric as p) t
      -- A2 : les groupes lus UNE fois (181 lignes, n_membres > 1) puis joints par hachage ; une sous-requête par ligne
      -- coûtait 18 000 accès de plus sur la métropole (5 956 lignes : 22 879 contre 4 834 sans la clé, mesuré le 31/10).
      left join (select g.code_canonique, array_agg(g.code_postal order by g.code_postal) as codes
                   from public.cp_groupe g where g.n_membres > 1 group by g.code_canonique) grp
             on grp.code_canonique = cp.code_postal
      cross join lateral (select coalesce(grp.codes, array[cp.code_postal]) as membres) m
      left join public.ref_codes_postaux rcp on rcp.code_postal = cp.code_postal
     where public.pays_contient_code(p_code, cp.code_postal);
  elsif p_decoupage = 'departement' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', u.code, 'nom', rd.nom_dept, 'commune', null, 'n_carreaux', u.n_carreaux,
             'pop_en_zone', round(t.p), 'pop_totale', round(t.p), 'part', case when t.p > 0 then 100.0 end,
             'part_brute', case when t.p > 0 then 100 end)  -- B11
           order by t.p desc, u.code), '[]'::jsonb), count(*)
      into v_lignes, v_n_terr
      from public.unite_population_totale u
      cross join lateral (select (u.populations->>p_cible)::numeric as p) t
      left join public.ref_departements rd on rd.code_dept = u.code
     where u.maille = 'departement' and public.pays_contient_code(p_code, u.code);
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
           'population_france', (select round(coalesce(sum((u.populations->>p_cible)::numeric), 0))
                                   from public.unite_population_totale u where u.maille = 'region'),
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
    'motif_vide', case when v_n > 0 then null else 'aucun_carreau' end,
    'territoires_non_carroyes', '[]'::jsonb,
    'reference', v_ref,
    'base_construite_le', v_base,
    'calcule_le', now()
  );
end
$fn$;

comment on function public.couverture_pays_jsonb(text, text, text) is
  'Couverture nationale d''une zone pays (METRO / FR) sans lire un carreau : forme = somme de cp_population_totale ; '
  'cp = chaque CP du pays a 100 % ; departement = unite_population_totale ; iris et commune refuses '
  '(decoupage_trop_fin_pays) sans lecture. Memes cles que couverture_geometrie + pays. sql/296 (T2), sql/303 (B11 : part_brute), sql/304 (A2 : membres '
  'des lignes CP), sql/308 (A4 : cp et departement portent aussi les unites non carroyees du territoire, population '
  'NULL, incluse = true ; n_inconnues).';

revoke all on function public.couverture_pays_jsonb(text, text, text) from public, anon, authenticated;
grant execute on function public.couverture_pays_jsonb(text, text, text) to service_role;


-- ── 3. couverture_zone_en_cache : sql/304 + un chiffrage sans `n_inconnues` n'est plus servi (A4) ───────────────────
create or replace function public.couverture_zone_en_cache(
  p_zone_id uuid,
  p_org_id uuid,
  p_cible text,
  p_decoupage text
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
  select c.resultat || jsonb_build_object('cache', true, 'zone_maj', c.zone_maj)
    from public.couverture_zone_cache c
    join public.custom_geo_zones g on g.id = c.zone_id
   where c.zone_id = p_zone_id
     and c.cible = p_cible
     and c.decoupage = p_decoupage
     and g.org_id = p_org_id
     and c.zone_maj = g.updated_at
     and c.base_construite_le = (select max(b.construit_le) from public.carreau_couverture_bandes b)
     and public.carreau_couverture_complete() is null
     and (c.decoupage not in ('cp', 'commune', 'departement')
          or public.denominateur_construit_le(c.decoupage) <= c.base_construite_le)
     -- B11 : un chiffrage d'avant sql/303 (lignes sans `part_brute`) n'est plus servi ; le calcul le remplace.
     and (jsonb_array_length(coalesce(c.resultat->'lignes', '[]'::jsonb)) = 0 or (c.resultat->'lignes'->0) ? 'part_brute')
     -- A2 : un chiffrage CP d'avant sql/304 (lignes sans `membres`) n'est plus servi ; le calcul le remplace.
     and (c.decoupage <> 'cp' or jsonb_array_length(coalesce(c.resultat->'lignes', '[]'::jsonb)) = 0
          or (c.resultat->'lignes'->0) ? 'membres')
     -- A4 : un chiffrage CP / commune / département d'avant sql/308 (sans `n_inconnues`, donc sans les unités non
     -- carroyées) n'est plus servi ; le calcul le remplace. La forme et l'IRIS n'ont pas changé : servis comme avant.
     and (c.decoupage not in ('cp', 'commune', 'departement') or c.resultat ? 'n_inconnues')
$fn$;

comment on function public.couverture_zone_en_cache(uuid, uuid, text, text) is
  'Chiffrage de couverture en cache (|| {cache: true, zone_maj}) s''il est encore valide — zone de l''espace, forme et '
  'base inchangees, base certifiee complete, denominateur CP / commune / departement pas plus recent que la base — '
  'sinon NULL. Lecture seule. sql/270 (lot 4, T6, T8), sql/275 (lot 5, T3), sql/303 (B11 : lignes sans part_brute non servies), sql/304 (A2 : '
  'lignes CP sans membres non servies), sql/308 (A4 : cp / commune / departement sans n_inconnues non servis).';

revoke all on function public.couverture_zone_en_cache(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.couverture_zone_en_cache(uuid, uuid, text, text) to service_role;
