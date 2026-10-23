-- sql/269 — `couverture_geometrie` : chiffrer une zone enregistrée TELLE QUELLE, ou découpée par code postal ou par
-- IRIS, sans jamais la convertir (lot 4, T5 ; spec carte-en-parcours § 16.2-2, § 16.4).
--
-- CE QU'ELLE FAIT. Pour une zone de l'espace, une cible (`cibles_exposition`) et un découpage :
--   - `forme` : le nombre de carreaux Filosofi dont le centroïde est dans la zone et la population de la cible ;
--   - `cp` / `iris` : en plus, pour chaque territoire touché, la population DANS la zone, la population TOTALE du
--     territoire et la PART couverte. Une LECTURE : rien n'est écrit, aucune zone n'est créée, aucun jeu rempli.
--
-- UNE SEULE RÈGLE D'ATTRIBUTION (plan, Global Constraints). Un carreau compte ENTIER quand son centroïde est dans la zone
-- (L3-2) ; il est rattaché au CP et à l'IRIS que porte `carreau_couverture` (sql/266) — exactement la règle des
-- dénominateurs `cp_population_totale` (sql/228) et `unite_population_totale` maille `iris` (sql/267). Numérateur et
-- dénominateur comptent donc les mêmes carreaux par la même règle : une part ne peut pas dépasser 100 %, et un CP
-- entièrement dans la zone vaut 100 %. Une part > 100 % est un DÉFAUT DE RÈGLE, pas une donnée : EXCEPTION.
-- Un carreau sans CP (resp. sans IRIS) reste compté dans la forme et sort en `hors_territoire` : la somme des lignes et
-- de `hors_territoire` égale TOUJOURS la population de la forme.
--
-- LA RÈGLE « CARREAUX D'UNE FORME » est `carreaux_de_forme` (ci-dessous), seule copie, appelée aussi par
-- `couverture_rayon_poi` (sql/272). ⚠ `ST_Intersects` + `distinct on`, PAS `ST_Contains` (relecture du plan, R-3) : la
-- règle EXACTE de `zone_seuil_carreaux` (sql/255:103-105). Un centroïde posé sur l'arête commune de deux morceaux de
-- `ST_Subdivide` est dans les deux — compté une fois par le `distinct on`. `ST_Contains` l'exclurait des deux : il
-- disparaîtrait, et la zone fabriquée par ③ et sa couverture en ④ ne compteraient plus les mêmes carreaux (test de
-- couture par données). sql/255 garde sa copie : elle lit `carreaux_filosofi` (polygones et `metadata`), pas la table
-- étroite.
--
-- BORNES (A-4, écrites ici, verrouillées par test) : zone ≤ 100 000 km² — la France est refusée, la plus grande région
-- (Nouvelle-Aquitaine, 84 617 km²) admise ; ≤ 400 000 carreaux LUS (`p_max_carreaux`, on lit `limit + 1` carreaux
-- distincts, au-delà refus `trop_de_carreaux` : jamais un chiffre partiel). ARA = 310 860 carreaux.
-- La surface est mesurée AVANT toute lecture de carreau : un refus `zone_trop_vaste` ne coûte que la zone.
--
-- PAS DE REPLI (A-1) : sans `carreau_couverture` CERTIFIÉE complète (sql/268), refus `couverture_non_construite` avec le
-- motif de `carreau_couverture_complete()` — jamais une relecture de `carreaux_filosofi` (deux chemins divergent). Le
-- découpage IRIS refuse aussi quand son dénominateur est absent ou PLUS ANCIEN que le journal des bandes
-- (`denominateur_iris_perime`) : le script de construction le reconstruit en fin de course, mais tout autre chemin
-- (restauration, script relancé seul avant sql/268) le laisserait périmé — et une part pourrait dépasser 100 %.
-- Symétrique pour le CP (vague finale, n° 6) : `cp_population_totale` (sql/228) est compté sur `carreaux_filosofi` et
-- les contours de CP, la table étroite porte le CP attribué à SA construction. Un dénominateur reconstruit APRÈS elle
-- (contours ou CP rechargés) ne compte plus les mêmes carreaux : refus `denominateur_cp_plus_recent`, et le cache CP se
-- périme avec (sql/270). Index sur `construit_le` : le `max` lit 3 pages au lieu des 831 de la table.
--
-- Q-J (décision du 22/10) : le chiffre est la population CARROYÉE (Filosofi, ménages fiscaux ; 63,8 M), pas la
-- population légale. Toute réponse porte `reference` (source, millésime, population et carreaux de France pour la
-- cible) pour que l'écran qualifie chaque chiffre ; une zone sans aucun carreau rend `motif_vide` —
-- `territoire_non_carroye` quand elle touche un département que le carroyage ne publie pas (Guadeloupe, Guyane,
-- Mayotte… : ceux de `ref_departements` absents de `unite_population_totale`, LUS en base, jamais une liste écrite),
-- listés dans `territoires_non_carroyes` ; `aucun_carreau` sinon (mer, montagne inhabitée).
--
-- T6 (cache) : `base_construite_le` = `max(construit_le)` du journal `carreau_couverture_bandes`, la date qui périme un
-- chiffrage en cache (R-2).
--
-- PostgREST coupe à 1 000 lignes : rendu `jsonb`, la liste ENTIÈRE (5 486 IRIS sur ARA). STABLE, lecture seule, AUCUNE
-- table temporaire (une RPC appelée en GET s'exécute en lecture seule) : CTE `as materialized` (mémoire
-- `reference_cte_materialized_postgres` : inlinée, l'expression serait recalculée à chaque référence).
-- Mesuré le 22/10 (EXPLAIN (ANALYZE, BUFFERS) de l'appel, base locale, 2e passe ; « accès » = hit + read) :
--   Lyon 5 km (1 661 carreaux)            forme 8 ms · 2 097   cp 4 ms · 375      iris 7 ms · 2 125
--   Bouches-du-Rhône (32 818)             forme 52 ms · 3 860  cp 53 ms · 4 661   iris 66 ms · 9 820
--   Île-de-France, 12 028 km² (72 689)    forme 97 ms · 6 757  cp 124 ms · 10 078 iris 186 ms · 43 422
--   Auvergne-Rhône-Alpes (310 860)        forme 0,43 s · 29 153 cp 0,46 s · 34 062 iris 0,57 s · 68 031
--   (bornes du plan : ARA iris ≤ 2 s / 500 000 ; BdR cp ≤ 0,3 s). ARA déborde `work_mem` (4 Mo) au tri du
--   `distinct on` : ≈ 14-30 Mo de fichiers temporaires, laissés tels quels (un `work_mem` de fonction relèverait la
--   mémoire de CHAQUE appel sur un compute Micro partagé).
-- Droits : service_role. Rejouable (`create or replace`, `if not exists`, aucun `drop`).

create index if not exists idx_cp_population_totale_construit_le on public.cp_population_totale (construit_le);

-- Les carreaux de `carreau_couverture` dont le centroïde est dans une forme (4326), chacun une fois, avec l'effectif
-- de la cible de rang `p_rang`. SANS `set search_path` : la fonction est alors INLINÉE dans l'appelant (qui fixe le
-- sien) et le plan reste celui des copies qu'elle remplace (corps entièrement qualifié, `public.`). L'effectif d'UNE
-- cible et non les 24 : le tri du `distinct on` les porterait tous (mesuré le 23/10 : 9 Mo de fichier temporaire sur
-- les Bouches-du-Rhône, 0 avant).
create or replace function public.carreaux_de_forme(p_geom geometry, p_rang integer)
returns table (carreau_id bigint, pop numeric, code_postal text, code_iris text)
language sql
stable
as $fn$
  select distinct on (cc.carreau_id) cc.carreau_id, cc.pops[p_rang]::numeric, cc.code_postal, cc.code_iris
    from (select public.ST_Subdivide(public.ST_Transform(p_geom, 3857), 256) as sg) z
    join public.carreau_couverture cc on cc.centroide_3857 operator(public.&&) z.sg and public.ST_Intersects(cc.centroide_3857, z.sg)
   order by cc.carreau_id
$fn$;

revoke all on function public.carreaux_de_forme(geometry, integer) from public, anon, authenticated;
grant execute on function public.carreaux_de_forme(geometry, integer) to service_role;

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
begin
  if p_decoupage is null or p_decoupage not in ('forme', 'cp', 'iris') then
    raise exception 'decoupage non autorise : % (forme, cp ou iris)', p_decoupage using errcode = '22023';
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

  v_motif := public.carreau_couverture_complete();
  if v_motif is null and p_decoupage = 'iris' then
    select u.construit_le into v_denom_le from public.unite_population_totale u where u.maille = 'iris' limit 1;
    if v_denom_le is null then
      v_motif := 'denominateur_iris_absent';
    elsif v_denom_le < (select max(b.construit_le) from public.carreau_couverture_bandes b) then
      v_motif := 'denominateur_iris_perime';
    end if;
  elsif v_motif is null and p_decoupage = 'cp' then
    select max(cp.construit_le) into v_denom_le from public.cp_population_totale cp;
    if v_denom_le is null then
      v_motif := 'denominateur_cp_absent';
    elsif v_denom_le > (select max(b.construit_le) from public.carreau_couverture_bandes b) then
      v_motif := 'denominateur_cp_plus_recent';
    end if;
  end if;
  if v_motif is not null then
    return jsonb_build_object('refus', 'couverture_non_construite', 'motif', v_motif);
  end if;

  select max(b.construit_le) into v_base from public.carreau_couverture_bandes b;

  with c as materialized (
    select f.carreau_id, f.pop, case p_decoupage when 'cp' then f.code_postal when 'iris' then f.code_iris end as code
      from public.carreaux_de_forme(v_geom, v_rang) f
     limit p_max_carreaux + 1
  ), g as materialized (
    select c.code, count(*) as n, sum(c.pop) as p from c where p_decoupage <> 'forme' group by c.code
  ), d as (
    select g.code, g.n, g.p, den.tot, den.nom, den.commune
      from g
      cross join lateral (
        select (cp.populations->>p_cible)::numeric as tot, rcp.nom_principal as nom, null::text as commune
          from public.cp_population_totale cp
          left join public.ref_codes_postaux rcp on rcp.code_postal = cp.code_postal
         where p_decoupage = 'cp' and cp.code_postal = g.code
        union all
        select (u.populations->>p_cible)::numeric, i.nom_iris, i.nom_commune
          from public.unite_population_totale u
          left join public.iris i on i.code_iris = u.code
         where p_decoupage = 'iris' and u.maille = 'iris' and u.code = g.code
        union all
        -- Un code sans dénominateur ne devrait pas exister (égalités prouvées, sql/266-267) ; s'il existait, la ligne
        -- resterait, part NULL, plutôt que de disparaître du total.
        select null::numeric, null::text, null::text
         where not exists (select 1 from public.cp_population_totale cp2 where p_decoupage = 'cp' and cp2.code_postal = g.code)
           and not exists (select 1 from public.unite_population_totale u2
                            where p_decoupage = 'iris' and u2.maille = 'iris' and u2.code = g.code)
         limit 1
      ) den
     where g.code is not null
  )
  select (select count(*) from c),
         (select coalesce(sum(c.pop), 0) from c),
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'code', d.code, 'nom', d.nom, 'commune', d.commune, 'n_carreaux', d.n,
                    'pop_en_zone', round(d.p), 'pop_totale', round(d.tot),
                    'part', round(100 * d.p / nullif(d.tot, 0), 1))
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
    'lignes', v_lignes,
    'hors_territoire', jsonb_build_object('n_carreaux', v_hors_n, 'population', round(v_hors_p)),
    'n_territoires', v_n_terr,
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
  'telle quelle ou par CP / IRIS avec part de chaque territoire (meme regle que les denominateurs). Lecture seule, '
  'jsonb, <= 100 000 km2, <= 400 000 carreaux ; refus zone_introuvable, cible_inconnue, zone_trop_vaste, '
  'trop_de_carreaux, couverture_non_construite (+ motif). sql/269 (lot 4, T5).';

revoke all on function public.couverture_geometrie(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.couverture_geometrie(uuid, uuid, text, text, integer) to service_role;
