-- sql/296 — La zone « France métropolitaine » / « France entière » et sa couverture nationale, sans lire un carreau
-- (④ finitions, T2 ; plan 2026-10-30, arbitrages A-3, A-4 ; décision de Vincent du 25/10 : « le national passe par une
-- zone France entière créée en ③ »).
--
-- LA RECETTE `pays`. `{ v: 1, type: 'pays', code: 'METRO' | 'FR' }`, FIGÉE (jamais rejouée). Une zone pays se
-- reconnaît à sa RECETTE, jamais à sa surface. La contrainte `custom_geo_zones_recette_forme` (sql/253) admet le type :
-- ⚠ une contrainte CHECK ne s'élargit pas sans être remplacée — `drop` + `add` du MÊME nom dans UNE instruction
-- `alter table` (atomique, patron de sql/275), et seulement si elle n'admet pas encore `pays` : rejouée, rien ne bouge.
--
-- LA RÈGLE « LE PAYS CONTIENT CE CODE ». `pays_contient_code(p_pays, p_code)` : `FR` contient tout ; `METRO` tout code
-- (CP ou département) hors `97…` / `98…` — la règle de `codes_postaux_du_perimetre_jsonb('france', 'metro')` (sql/287),
-- la Corse dedans. UNE fonction, lue par la couverture ET par les codes postaux du score : même liste, au code près.
--
-- LA GÉOMÉTRIE. `zone_pays_geometrie(p_code)` → `{ geometry, surface_km2 }` : l'union de
-- `coalesce(geom_perimetre, geom)` des régions (métropole : hors 01-06). Elle sert à l'AFFICHAGE et à la surface ; aucun
-- chiffre ne la lit.
--
-- LA COUVERTURE. `couverture_pays_jsonb(p_code, p_cible, p_decoupage)` ne lit AUCUN carreau (ni `carreau_couverture`,
-- 2,3 M lignes, ni `carreaux_filosofi` hors l'index du millésime) : `forme` → la somme de `cp_population_totale` (la
-- référence de Q-J) ; `cp` → chaque CP du pays à 100 % ; `departement` → `unite_population_totale` ; `iris` et
-- `commune` → refus `decoupage_trop_fin_pays`, SANS lecture (48 872 IRIS, 2,4 Mo ; 34 918 communes). Mêmes clés que
-- `couverture_geometrie`, plus `pays`. Mêmes refus de base que `couverture_geometrie` (table non certifiée, dénominateur
-- absent ou plus récent que la base) : le cache (sql/270) n'en sert un chiffrage qu'aux mêmes conditions.
-- `couverture_zone` (sql/270) l'appelle quand la recette de la zone est `pays`, AVANT `couverture_geometrie` et sa
-- borne de 100 000 km² ; corps inchangé sinon (diff relu ligne à ligne), cache et quota inchangés.
--
-- LES CODES DU SCORE. `codes_postaux_de_zone_jsonb` (sql/295) est redéfinie : une zone pays rend les CP de
-- `cp_population_totale` contenus dans le pays (les lignes de la couverture « Par code postal »), et non plus ceux de
-- `ref_codes_postaux` (6 051 en métropole, dont 95 sans carreau habité). Corps sinon identique à sql/295.
--
-- LES COMPTEURS DE « MES ZONES ». `resolve_custom_geo_zone_codes` sur la métropole lit TOUS les IRIS par la géométrie
-- (mesuré : 2,1 s · 48 540 accès dont 15 845 lus) et écrirait ≈ 48 000 lignes de codes. `compter_zone_pays(p_zone,
-- p_appelant)` pose `feature_count_cp` / `feature_count_iris` par des comptes d'index (≈ 400 accès), sans écrire de
-- code : une zone pays n'a pas de `custom_geo_zone_codes` (⑤ la refuse, A-5 ; les exports par codes n'ont rien à
-- rendre). Les routes l'appellent à la place de la résolution géométrique pour une recette `pays`.
--
-- Mesuré le 30/10 (EXPLAIN (ANALYZE, BUFFERS) de l'appel, base locale ; « accès » = hit + read ; 2e passe sauf mention) :
--   zone_pays_geometrie('METRO')            84 ms · 292 accès · 2 765 sommets · 46 polygones · 547 779 km² · GeoJSON 76 Ko
--   union des régions, France entière      15 ms · 3 074 sommets · 67 polygones · 636 299 km²
--   couverture_pays_jsonb METRO `forme`     7,9 ms · 849 accès (1re passe : 71 ms · 1 971) · 62 528 975 hab. (ind)
--   couverture_pays_jsonb METRO `cp`        72 ms · 3 374 accès · temp 513 · 5 956 lignes · jsonb 796 Ko (1re : 218 ms)
--     ⚠ au-dessus des cibles du plan (< 2 000 accès, < 300 Ko) : la ligne garde le contrat `LigneCouverture` de
--     `couverture_geometrie` (7 clés, l'écran de ④ la lit telle quelle — 747 Ko sans même le nom) et le nom du CP
--     coûte ≈ 2 500 accès d'index sur `ref_codes_postaux`. Dix fois moins qu'une zone de 13 000 km² par CP (34 356
--     accès), une fois par (zone, cible) : le cache sert ensuite, et le quota `geo:rl:couverture` reste à 6 / min.
--   couverture_pays_jsonb METRO `cp`, cible `ind_25_39` (rang 5)   90 ms · 3 374 accès
--   couverture_pays_jsonb METRO `departement`   41 ms · 974 accès · 96 lignes
--   couverture_pays_jsonb FR `iris`         0,13 ms · 0 accès (refus avant toute lecture)
--   aucun de ces plans ne touche `carreau_couverture` ni `carreaux_filosofi` (hors l'index du millésime, 4 accès).
--   compter_zone_pays : 2 comptes d'index, ≈ 400 accès (ref_codes_postaux 8, unite_population_totale 383).
--
-- Droits : service_role. Rejouable (`create or replace`, contrainte gardée ; aucun `drop` de fonction ni de table).

-- ── La recette `pays` admise par la contrainte ────────────────────────────────────────────────────────────────────────
do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.custom_geo_zones'::regclass
                    and conname = 'custom_geo_zones_recette_forme'
                    and pg_get_constraintdef(oid) like '%''pays''%') then
    alter table public.custom_geo_zones
      drop constraint if exists custom_geo_zones_recette_forme,
      add constraint custom_geo_zones_recette_forme check (
        recette is null or (
          jsonb_typeof(recette) = 'object'
          and recette->>'v' = '1'
          and recette->>'type' in ('rayon_point', 'rayon_poi', 'seuil_carreaux', 'seuil_territoire', 'codes_postaux',
                                   'dessin', 'import', 'isochrone', 'combinaison', 'capture', 'pays')
        )
      );
  end if;
end
$do$;

-- ── La règle unique : un code (CP ou département) est-il dans le pays ? ───────────────────────────────────────────────
create or replace function public.pays_contient_code(p_pays text, p_code text)
returns boolean
language sql
immutable
as $fn$
  select p_pays = 'FR' or (p_pays = 'METRO' and p_code not like '97%' and p_code not like '98%')
$fn$;

comment on function public.pays_contient_code(text, text) is
  'Vrai si le code (CP ou departement) est dans le pays : FR contient tout, METRO tout hors 97x / 98x (la regle de '
  'codes_postaux_du_perimetre_jsonb france/metro, sql/287). sql/296 (finitions de l''analyse, T2).';

revoke all on function public.pays_contient_code(text, text) from public, anon, authenticated;
grant execute on function public.pays_contient_code(text, text) to service_role;

-- ── La géométrie d'une zone pays ──────────────────────────────────────────────────────────────────────────────────────
create or replace function public.zone_pays_geometrie(p_code text)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_geom geometry;
begin
  if p_code is null or p_code not in ('METRO', 'FR') then
    raise exception 'pays inconnu : % (METRO ou FR)', p_code using errcode = '22023';
  end if;
  -- Régions d'outre-mer : 01 Guadeloupe, 02 Martinique, 03 Guyane, 04 La Réunion, 06 Mayotte.
  select ST_Multi(ST_Union(coalesce(r.geom_perimetre, r.geom))) into v_geom
    from public.ref_regions r
   where p_code = 'FR' or r.code_region not in ('01', '02', '03', '04', '06');
  if v_geom is null or ST_IsEmpty(v_geom) then
    return jsonb_build_object('vide', true);
  end if;
  return jsonb_build_object(
    'geometry', ST_AsGeoJSON(v_geom)::jsonb,
    'surface_km2', round((ST_Area(v_geom::geography) / 1e6)::numeric, 1));
end
$fn$;

comment on function public.zone_pays_geometrie(text) is
  'Forme d''une zone pays : union de coalesce(geom_perimetre, geom) des regions (METRO : hors 01-06 ; FR : toutes). '
  '{ geometry, surface_km2 } | { vide }. Affichage et surface seulement : aucun chiffre ne la lit. sql/296 (T2).';

revoke all on function public.zone_pays_geometrie(text) from public, anon, authenticated;
grant execute on function public.zone_pays_geometrie(text) to service_role;

-- ── La couverture d'un pays, sans carreau ─────────────────────────────────────────────────────────────────────────────
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
             'pop_en_zone', round(t.p), 'pop_totale', round(t.p), 'part', case when t.p > 0 then 100.0 end)
           order by t.p desc, cp.code_postal), '[]'::jsonb), count(*)
      into v_lignes, v_n_terr
      from public.cp_population_totale cp
      cross join lateral (select (cp.populations->>p_cible)::numeric as p) t
      left join public.ref_codes_postaux rcp on rcp.code_postal = cp.code_postal
     where public.pays_contient_code(p_code, cp.code_postal);
  elsif p_decoupage = 'departement' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', u.code, 'nom', rd.nom_dept, 'commune', null, 'n_carreaux', u.n_carreaux,
             'pop_en_zone', round(t.p), 'pop_totale', round(t.p), 'part', case when t.p > 0 then 100.0 end)
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
  '(decoupage_trop_fin_pays) sans lecture. Memes cles que couverture_geometrie + pays. sql/296 (T2).';

revoke all on function public.couverture_pays_jsonb(text, text, text) from public, anon, authenticated;
grant execute on function public.couverture_pays_jsonb(text, text, text) to service_role;

-- ── couverture_zone : sql/270 + la branche pays, AVANT couverture_geometrie ───────────────────────────────────────────
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

  -- Zone pays (sql/296) : les dénominateurs nationaux, aucun carreau, avant la borne de surface.
  if v_maj is not null and v_recette->>'type' = 'pays' then
    v_res := public.couverture_pays_jsonb(v_recette->>'code', p_cible, p_decoupage);
    if not (v_res ? 'refus') then
      select round((ST_Area(g.geometry::geography) / 1e6)::numeric, 1) into v_surface
        from public.custom_geo_zones g where g.id = p_zone_id;
      v_res := v_res || jsonb_build_object('zone_id', p_zone_id, 'surface_km2', v_surface);
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
  'calcule (couverture_geometrie, ou couverture_pays_jsonb pour une zone pays, sql/296) et garde le chiffrage. '
  '|| { cache, zone_maj }. sql/270 (lot 4, T6, T8), sql/296 (finitions de l''analyse, T2).';

revoke all on function public.couverture_zone(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.couverture_zone(uuid, uuid, text, text) to service_role;

-- ── codes_postaux_de_zone_jsonb : sql/295, la branche pays sur la règle de la couverture ──────────────────────────────
create or replace function public.codes_postaux_de_zone_jsonb(p_zone uuid, p_org uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  c_max_km2 constant numeric := 100000;
  v_geom    geometry;
  v_recette jsonb;
  v_surface numeric;
  v_motif   text;
  v_codes   jsonb;
begin
  -- Absente OU d'un autre espace : la même réponse, on ne révèle pas qu'elle existe ailleurs.
  select g.geometry, g.recette into v_geom, v_recette
    from public.custom_geo_zones g where g.id = p_zone and g.org_id = p_org;
  if v_geom is null then
    return jsonb_build_object('refus', 'zone_introuvable');
  end if;

  -- Zone pays (sql/296) : les CP de la couverture nationale (`cp_population_totale`), sans lire un carreau ni mesurer
  -- la surface.
  if v_recette->>'type' = 'pays' then
    select coalesce(jsonb_agg(cp.code_postal order by cp.code_postal), '[]'::jsonb) into v_codes
      from public.cp_population_totale cp
     where public.pays_contient_code(v_recette->>'code', cp.code_postal);
    return jsonb_build_object('codes', v_codes);
  end if;

  v_surface := ST_Area(v_geom::geography) / 1e6;
  if v_surface > c_max_km2 then
    return jsonb_build_object('refus', 'zone_trop_vaste', 'surface_km2', round(v_surface, 1), 'plafond_km2', c_max_km2);
  end if;

  v_motif := public.carreau_couverture_complete();
  if v_motif is not null then
    return jsonb_build_object('refus', 'couverture_non_construite', 'motif', v_motif);
  end if;

  select coalesce(jsonb_agg(s.code_postal order by s.code_postal), '[]'::jsonb) into v_codes
    from (select distinct f.code_postal from public.carreaux_de_forme(v_geom, 1) f where f.code_postal is not null) s;

  return jsonb_build_object('codes', v_codes);
end
$fn$;

-- ── Les compteurs de « Mes zones » d'une zone pays, sans géométrie ────────────────────────────────────────────────────
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
begin
  select g.org_id, g.recette into v_org, v_recette from public.custom_geo_zones g where g.id = p_zone_id;
  if v_org is null then
    raise exception 'Zone % not found', p_zone_id;
  end if;
  if v_recette->>'type' is distinct from 'pays' then
    raise exception 'Zone % : pas une zone pays', p_zone_id using errcode = '22023';
  end if;
  -- Le même contrôle d'appartenance que resolve_custom_geo_zone_codes (sql/252).
  if p_caller_user_id is null or (
       not exists (select 1 from public.organization_members m where m.user_id = p_caller_user_id and m.organization_id = v_org)
       and not exists (select 1 from public.profiles p where p.id = p_caller_user_id and p.organization_id = v_org)) then
    raise exception 'Access denied to zone %', p_zone_id;
  end if;
  v_pays := v_recette->>'code';

  select count(*) into v_cp from public.ref_codes_postaux r where public.pays_contient_code(v_pays, r.code_dept);
  select count(*) into v_iris from public.unite_population_totale u
   where u.maille = 'iris' and public.pays_contient_code(v_pays, u.code);

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
  '{ zone_id, count_iris, count_cp }. sql/296 (T2).';

revoke all on function public.compter_zone_pays(uuid, uuid) from public, anon, authenticated;
grant execute on function public.compter_zone_pays(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
