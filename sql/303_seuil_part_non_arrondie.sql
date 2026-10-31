-- sql/303 — B11 (plan de corrections du découpage des zones, 2026-10-31, lot 1) : le seuil se compare à la part NON
-- arrondie ; à seuil 0, une part nulle n'est pas retenue.
--
-- LE DÉFAUT. La part d'une unité (en %) était arrondie au DIXIÈME avant d'être comparée au seuil : 19,96 % devenait
-- 20,0 % et passait un seuil de 20 % ; à seuil 0, une part de 0,02 % (affichée 0,0 %) passait, mais une part de 0
-- aussi. Deux lieux de comparaison, une seule règle (`estRetenue`, lib/zones/conversion.ts, et sa copie Angular) :
--   1. la conversion TS rejoue le seuil sur les `lignes` de `couverture_geometrie` / `couverture_pays_jsonb`. Elle ne
--      recevait que `part`, arrondie : chaque ligne porte désormais `part_brute`, la part SANS arrondi (même formule,
--      `100 * pop_en_zone / pop_totale` sur les populations fractionnaires), lue par `estRetenue`. `part` reste au
--      dixième : c'est elle que l'écran AFFICHE.
--   2. `paver_cercles` compare en SQL : `round(…, 1) >= p_seuil` devient la part brute `>= p_seuil`, et une cellule
--      sans habitant en zone n'est jamais retenue (`pop_en_zone > 0`, la règle « à seuil 0, part > 0 »).
--
-- LE CACHE. `couverture_zone_cache` garde des chiffrages SANS `part_brute` (calculés avant cette migration). Ils ne
-- sont plus servis : `couverture_zone_en_cache` exige que la première ligne porte la clé (ou qu'il n'y ait aucune
-- ligne, découpage `forme`). Le prochain appel recalcule et réécrit la ligne de cache (`on conflict … do update`) ;
-- aucun DELETE.
--
-- AUTRES COMPARAISONS CHERCHÉES (grep `>= p_seuil`, `part … >=`, `round(` dans sql/) : `zone_seuil_carreaux`,
-- `zone_seuil_carreaux_min`, `zone_seuil_territoire` comparent une VALEUR d'indicateur, non arrondie (hors sujet) ;
-- `appliquer_seuil_zone_set` (moteur RISQUE, sql/225) compare une somme de `part_en_zone` arrondies au CENTIÈME
-- (sql/229) — même famille de défaut, à 0,01 point près, hors du périmètre ①→⑤ (moteur risque intact, caractérisé
-- par tests/integration/jeu-risque-caracterisation.test.ts) : signalé au rapport B11, non modifié.
--
-- Corps recopiés de sql/275 (`couverture_geometrie`, `couverture_zone_en_cache`), sql/296 (`couverture_pays_jsonb`) et
-- sql/276 (`paver_cercles`), seules les lignes marquées « B11 » changent. Mêmes signatures, mêmes droits.
-- Rejouable (`create or replace`, aucun DROP). Pas de begin/commit : appliquer par `psql -1`.

-- ── couverture_geometrie : sql/275 + `part_brute` par ligne ──────────────────────────────────────────────────────────
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
    select g.code, g.n, g.p, den.tot, den.nom, den.commune
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
  'telle quelle ou par CP / IRIS / commune / departement avec part de chaque territoire (meme regle que les '
  'denominateurs). Lecture seule, jsonb, <= 100 000 km2, <= 400 000 carreaux ; refus zone_introuvable, cible_inconnue, '
  'zone_trop_vaste, trop_de_carreaux, couverture_non_construite (+ motif). sql/269 (lot 4, T5), sql/275 (lot 5, T3), sql/303 (B11 : part_brute, la part non arrondie que compare le seuil).';

revoke all on function public.couverture_geometrie(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.couverture_geometrie(uuid, uuid, text, text, integer) to service_role;

-- ── couverture_pays_jsonb : sql/296 + `part_brute` par ligne ───────────────────────────────────────────────────────
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
             'part_brute', case when t.p > 0 then 100 end)  -- B11 : exacte, mais la clé que lit `estRetenue`
           order by t.p desc, cp.code_postal), '[]'::jsonb), count(*)
      into v_lignes, v_n_terr
      from public.cp_population_totale cp
      cross join lateral (select (cp.populations->>p_cible)::numeric as p) t
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
    'lignes', v_lignes,
    'hors_territoire', jsonb_build_object('n_carreaux', 0, 'population', 0),
    'n_territoires', v_n_terr,
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
  '(decoupage_trop_fin_pays) sans lecture. Memes cles que couverture_geometrie + pays. sql/296 (T2), sql/303 (B11 : part_brute).';

revoke all on function public.couverture_pays_jsonb(text, text, text) from public, anon, authenticated;
grant execute on function public.couverture_pays_jsonb(text, text, text) to service_role;

-- ── couverture_zone_en_cache : sql/275 + un chiffrage sans `part_brute` n'est plus servi ─────────────────────────────
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
$fn$;

comment on function public.couverture_zone_en_cache(uuid, uuid, text, text) is
  'Chiffrage de couverture en cache (|| {cache: true, zone_maj}) s''il est encore valide — zone de l''espace, forme et '
  'base inchangees, base certifiee complete, denominateur CP / commune / departement pas plus recent que la base — '
  'sinon NULL. Lecture seule. sql/270 (lot 4, T6, T8), sql/275 (lot 5, T3), sql/303 (B11 : lignes sans part_brute non servies).';

revoke all on function public.couverture_zone_en_cache(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.couverture_zone_en_cache(uuid, uuid, text, text) to service_role;

-- ── paver_cercles : sql/276, la part NON arrondie comparée au seuil, une cellule vide jamais retenue ───────────────────
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
  c_max_balaye   constant numeric := 200000;  -- km² relus par l'étape 2 (en-tête)
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

  v_surface := ST_Area(v_geom::geography) / 1e6;
  if v_surface > c_max_km2 then
    return jsonb_build_object('refus', 'zone_trop_vaste', 'surface_km2', round(v_surface, 1), 'plafond_km2', c_max_km2);
  end if;

  -- Borne de coût : au plus `c_max_balaye` km² relus (candidates × 2√3·r², la cellule faisant r de rayon au sol).
  v_limite := least(p_max_candidates, floor(c_max_balaye * 1e6 / (2 * sqrt(3) * p_rayon_m::numeric ^ 2))::integer);

  -- Pas de dénominateur ici (la population d'une cellule se compte sur ses carreaux) : seule la table étroite compte.
  v_motif := public.carreau_couverture_complete();
  if v_motif is not null then
    return jsonb_build_object('refus', 'couverture_non_construite', 'motif', v_motif);
  end if;

  with z as materialized (                                                  -- (1) carreaux de la zone
    select f.carreau_id, f.pop, ST_X(f.centroide_3857) as x, ST_Y(f.centroide_3857) as y,
           public.territoire_grille(f.code_departement) as territoire
      from public.carreaux_de_forme_points(v_geom, v_rang) f
  ), grilles as materialized (                                              -- un pas par territoire (en-tête)
    select t.territoire,
           p_rayon_m / public.echelle_sol_3857(greatest(t.y_eq - p_rayon_m / public.echelle_sol_3857(t.y_eq), 0)) as pas
      from (select z.territoire, min(abs(z.y)) as y_eq from z group by z.territoire) t
  ), cand as materialized (                                                 -- (2) cellules candidates
    select k.*, c.cx, c.cy, ST_SetSRID(ST_MakePoint(c.cx, c.cy), 3857) as centre_3857
      from (select z.territoire, gr.pas, h.q, h.r, sum(z.pop) as pop_en_zone
              from z
              join grilles gr on gr.territoire = z.territoire
              cross join lateral public.cellule_hex(z.x, z.y, gr.pas) h
             group by z.territoire, gr.pas, h.q, h.r
             limit v_limite + 1) k
      cross join lateral public.centre_hex(k.q, k.r, k.pas) c
  ), tot as materialized (
    select cand.*, t.pop_totale
      from cand
      cross join lateral (
        select coalesce(sum(cc.pops[v_rang]::numeric), 0) as pop_totale
          from public.carreau_couverture cc
          -- `offset 0` : les coordonnées sont lues UNE fois (sans lui, l'inlining recopie `ST_X(…)` dans chaque terme).
          cross join lateral (select ST_X(cc.centroide_3857) as x, ST_Y(cc.centroide_3857) as y offset 0) p
         where cc.centroide_3857 && ST_MakeEnvelope(cand.cx - cand.pas * sqrt(3) / 2, cand.cy - cand.pas,
                                                    cand.cx + cand.pas * sqrt(3) / 2, cand.cy + cand.pas, 3857)
           -- La cellule de Voronoï d'un centre EST l'hexagone : strictement dedans, le carreau est dans la cellule ;
           -- strictement dehors, il n'y est pas ; l'arrondi cubique ne tranche que les points SUR un bord (même règle
           -- que l'étape 1, aucune part > 100 %). Mesuré sur la composite : 842 000 carreaux lus, l'arrondi cubique de
           -- chacun coûtait l'essentiel de l'appel.
           and case when abs(p.x - cand.cx) < cand.pas * sqrt(3) / 2
                     and abs(p.y - cand.cy) + abs(p.x - cand.cx) / sqrt(3) < cand.pas then true
                    when abs(p.x - cand.cx) > cand.pas * sqrt(3) / 2
                      or abs(p.y - cand.cy) + abs(p.x - cand.cx) / sqrt(3) > cand.pas then false
                    else exists (select 1 from public.cellule_hex(p.x, p.y, cand.pas) h where h.q = cand.q and h.r = cand.r)
               end
           and public.territoire_grille(cc.code_departement) = cand.territoire
      ) t
     where (select count(*) from cand) <= v_limite
  ), ret as materialized (                                                  -- (3) cellules retenues
    select r0.*, r0.centre::geography as centre_g,
           -- Rayons en 3857 : `r_ext` au bord POLAIRE du cercle (échelle la plus petite) borne la présélection par
           -- l'index ; `r_int` au bord ÉQUATORIAL (échelle la plus grande) : en deçà, un carreau est dans le cercle
           -- sans calcul géodésique — celui-ci n'est fait que dans l'anneau entre les deux.
           p_rayon_m / public.echelle_sol_3857(abs(r0.cy) + 2 * p_rayon_m / public.echelle_sol_3857(abs(r0.cy))) as r_ext,
           p_rayon_m / public.echelle_sol_3857(greatest(abs(r0.cy) - 2 * p_rayon_m / public.echelle_sol_3857(abs(r0.cy)), 0)) as r_int
      from (select tot.*, round(100 * tot.pop_en_zone / tot.pop_totale, 1) as part,
                   ST_Transform(tot.centre_3857, 4326) as centre
              from tot
             where tot.pop_totale > 0
               and tot.pop_totale >= p_pop_min
               -- B11 : la part NON arrondie (19,96 % ne passe plus un seuil de 20 %), et jamais une cellule vide
               -- (à seuil 0, part > 0) ; `part`, rendue au dixième, reste l'affichage.
               and tot.pop_en_zone > 0
               and 100 * tot.pop_en_zone / tot.pop_totale >= p_seuil) r0
  ), u as materialized (                                                    -- (4) carreaux de l'union, par l'index
    select distinct on (cc.carreau_id) cc.carreau_id, cc.pops[v_rang]::numeric as pop
      from ret
      join public.carreau_couverture cc
        on cc.centroide_3857 && ST_Expand(ret.centre_3857, ret.r_ext)
       and (ST_DWithin(cc.centroide_3857, ret.centre_3857, ret.r_int)
            or ST_DWithin(ST_Transform(cc.centroide_3857, 4326)::geography, ret.centre_g, p_rayon_m))
     where p_max_cercles is null or (select count(*) from ret) <= p_max_cercles
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
                  order by ret.pop_en_zone desc, ret.territoire, ret.q, ret.r), '[]'::jsonb) from ret),
         (select coalesce(jsonb_agg(jsonb_build_object('territoire', gr.territoire, 'pas_3857', round(gr.pas::numeric, 3))
                                    order by gr.territoire), '[]'::jsonb) from grilles gr),
         (select max(round(100 * tot.pop_en_zone / nullif(tot.pop_totale, 0), 1)) from tot),
         perte.population, perte.couverte, perte.manques, perte.hors_zone, perte.achetee
    into v_n_carreaux, v_n_cand, v_n_cercles, v_cercles, v_grilles, v_part_max,
         v_population, v_couverte, v_manques, v_hors_zone, v_achetee
    from perte;

  if v_n_cand > v_limite and v_limite = p_max_candidates then
    return jsonb_build_object('refus', 'trop_de_candidates', 'plafond', p_max_candidates);
  elsif v_n_cand > v_limite then
    return jsonb_build_object('refus', 'zone_trop_vaste', 'motif', 'rayon', 'n_candidates_max', v_limite,
                              'plafond_balaye_km2', c_max_balaye);
  end if;
  if v_part_max > 100 then
    raise exception 'part de cellule > 100 %% (%) : la cellule d''un carreau ne suit plus une seule formule', v_part_max
      using errcode = 'XX000';
  end if;
  if p_max_cercles is not null and v_n_cercles > p_max_cercles then
    return jsonb_build_object('refus', 'trop_de_cercles', 'n_cercles', v_n_cercles, 'plafond', p_max_cercles);
  end if;

  -- L'écran distingue « territoire non carroyé » de « aucun cercle au seuil » (même règle que `couverture_geometrie`).
  if v_n_carreaux = 0 then
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
    'n_carreaux', v_n_carreaux,
    'motif_vide', case when v_n_carreaux = 0 and jsonb_array_length(v_non_carr) > 0 then 'territoire_non_carroye'
                       when v_n_carreaux = 0 then 'aucun_carreau'
                       when v_n_cercles = 0 then 'aucune_cellule_au_seuil' end,
    'territoires_non_carroyes', v_non_carr,
    'reference', jsonb_build_object(
      'source', 'carroyage INSEE Filosofi 200 m (ménages fiscaux)',
      'millesime', (select max(cf.millesime) from public.carreaux_filosofi cf where cf.resolution = '200m'),
      'grille', 'hexagonale, cercle circonscrit, distance géodésique',
      'grilles', v_grilles),
    'calcule_le', now()
  );
end
$fn$;

comment on function public.paver_cercles(uuid, uuid, text, integer, numeric, integer, integer, integer) is
  'Pave une zone de l''espace en cercles de rayon p_rayon_m (grille hexagonale par territoire, cercle circonscrit), '
  'retient les cellules dont la part en zone >= p_seuil et la population >= p_pop_min, et chiffre la perte exacte sur '
  'l''union des cercles retenus (couverte, manques, hors_zone, achetee, taux_utile). Lecture seule, jsonb ; refus '
  'zone_introuvable, cible_inconnue, zone_trop_vaste (surface, ou motif rayon : > 200 000 km2 balayes), '
  'couverture_non_construite, trop_de_candidates, trop_de_cercles (+ n_cercles, plafond) ; motif_vide '
  '(territoire_non_carroye, aucun_carreau, aucune_cellule_au_seuil) ; rayon hors [1 000, 200 000] -> 22023. sql/276 (lot 5, T4), sql/303 (B11 : part non arrondie, cellule vide jamais retenue).';

revoke all on function public.paver_cercles(uuid, uuid, text, integer, numeric, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.paver_cercles(uuid, uuid, text, integer, numeric, integer, integer, integer) to service_role;
