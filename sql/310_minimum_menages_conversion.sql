-- sql/310 — A5 (plan de corrections du découpage des zones, 2026-10-31, lot 1) : le minimum de ménages par carreau
-- s'applique à la CONVERSION dès qu'une cible autre que la population totale est choisie (ARB-4, réponse A de Vincent,
-- 31/10) ; une recette « seuil sur carreaux » ancienne reçoit explicitement `min_menages = 0`.
--
-- LE DÉFAUT. Sous 11 ménages, l'INSEE IMPUTE les valeurs d'un carreau Filosofi (secret statistique). Le garde-fou de
-- sql/292 ne protégeait que la CONSTRUCTION d'une zone par seuil sur carreaux (③) : la conversion (⑤, et la couverture
-- de ④ qui lit la même RPC) comptait tous les carreaux, y compris pour « ménages pauvres » — 1 795 895 carreaux sur
-- 2 324 577 ont moins de 11 ménages (mesuré le 01/11). La population totale (`ind`) n'est pas imputée : elle garde tous
-- ses carreaux, minimum 0.
--
-- LA VALEUR. 11 n'existait en base nulle part (sql/292 ne porte que la borne 0 à 1 000 ; 11 est la constante TS
-- `MIN_MENAGES_CARREAUX_DEFAUT`, défaut de l'écran ③). Elle est rangée dans `reglages_conversion` (sql/309), clé
-- `min_menages_cible`, bornée 0 à 1 000 entier, lue par `min_menages_de_cible(p_cible)` : 0 pour `ind`, le réglage
-- sinon. Jamais en dur dans une fonction.
--
-- UNE SEULE RÈGLE, NUMÉRATEUR ET DÉNOMINATEUR. Écarter un carreau du numérateur sans l'écarter du dénominateur ferait
-- tomber un territoire entièrement dans la zone sous 100 % (77 % des carreaux sont sous 11 ménages). Les dénominateurs
-- existants (`cp_population_totale`, `unite_population_totale`) comptent tous les carreaux : la jumelle filtrée est la
-- table `denominateur_menages_min` (maille cp / iris / commune / departement, code, populations des 24 cibles, carreaux
-- d'au moins `min_menages` ménages), construite DEPUIS `carreau_couverture` en UNE passe (`grouping sets`) par
-- `construire_denominateur_menages_min()` — la règle du dénominateur IRIS (sql/267) : même table, même attribution,
-- même type de somme que le numérateur. Aucune lecture de `carreaux_filosofi`.
-- Elle est refusée (`couverture_non_construite`, motif) quand elle est absente, construite à un AUTRE minimum que le
-- réglage courant (`denominateur_menages_autre_minimum` : un réglage changé exige une reconstruction), ou plus ancienne
-- que le journal de la table étroite (`denominateur_menages_perime`).
--
-- CE QUI CHANGE.
--   1. `reglages_conversion` : ligne `min_menages_cible` = 11 (posée une fois, `on conflict do nothing`).
--   2. `min_menages_de_cible(p_cible)` → numeric ; `denominateur_menages_motif(p_maille)` → text (NULL = utilisable).
--   3. `denominateur_menages_min` + `construire_denominateur_menages_min()` (≈ 30 s, une passe, construite ici si besoin).
--   4. `carreaux_de_forme_menages(p_geom, p_rang, p_rang_men)` : LE corps de « carreaux d'une forme », avec les ménages
--      du carreau ; `carreaux_de_forme_points` en devient l'enveloppe (même signature, même type de retour).
--   5. `couverture_geometrie`, `couverture_pays_jsonb`, `paver_cercles` : carreaux de moins de `min_menages` ménages
--      ÉCARTÉS du numérateur et du dénominateur ; chaque réponse porte `min_menages` (la valeur appliquée) et
--      `carreaux_ecartes` `{n_carreaux, population}` (avant = `n_carreaux` + écartés, après = `n_carreaux`).
--   6. `couverture_zone_en_cache` : un chiffrage à un autre minimum (ou d'avant cette migration, sans la clé) n'est
--      plus servi.
--   7. Recettes : toute recette `seuil_carreaux` sans `min_menages` reçoit `min_menages = 0` (le comportement qu'elle
--      avait), et une contrainte CHECK l'exige désormais à l'écriture — plus aucun défaut implicite.
--
-- Corps recopiés de sql/309 (`couverture_geometrie`, `couverture_zone_en_cache`), sql/308 (`couverture_pays_jsonb`),
-- sql/303 (`paver_cercles`) et sql/276 (`carreaux_de_forme_points`) ; les lignes changées sont marquées « A5 ». Mêmes
-- signatures, mêmes droits. Rejouable (`create … if not exists`, `on conflict do nothing`, `create or replace`, aucun
-- DROP). Appliquer par `psql -1`.

-- ── 1. Le réglage ────────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.reglages_conversion (cle, valeur, description)
values ('min_menages_cible', 11,
        'Conversion et couverture d''une zone pour une cible autre que la population totale : nombre minimal de '
        'menages d''un carreau Filosofi compte (sous 11, l''INSEE impute ses valeurs, secret statistique). Les '
        'carreaux en dessous sont ecartes du numerateur ET du denominateur (A5, ARB-4 ; sql/310). Changer la valeur '
        'exige construire_denominateur_menages_min().')
on conflict (cle) do nothing;

do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.reglages_conversion'::regclass and conname = 'reglages_conversion_min_menages_borne') then
    alter table public.reglages_conversion
      add constraint reglages_conversion_min_menages_borne
      check (cle <> 'min_menages_cible' or (valeur >= 0 and valeur <= 1000 and valeur = trunc(valeur)));
  end if;
end
$do$;

-- ── 2. Le minimum d'une cible ────────────────────────────────────────────────────────────────────────────────────────
-- `ind` (population totale, le défaut de toutes les RPC de couverture) n'est pas imputée : 0. Toute autre cible : le
-- réglage (EXCEPTION s'il manque, `reglage_conversion`).
create or replace function public.min_menages_de_cible(p_cible text)
returns numeric
language sql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
  select case when p_cible = 'ind' then 0::numeric else public.reglage_conversion('min_menages_cible') end
$fn$;

comment on function public.min_menages_de_cible(text) is
  'Minimum de menages d''un carreau compte pour une cible : 0 pour ind (population totale), sinon le reglage '
  'min_menages_cible de reglages_conversion (ARB-4, sql/310, A5).';

revoke all on function public.min_menages_de_cible(text) from public, anon, authenticated;
grant execute on function public.min_menages_de_cible(text) to service_role;

-- ── 3. Le dénominateur filtré ────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.denominateur_menages_min (
  maille       text not null check (maille in ('cp', 'iris', 'commune', 'departement')),
  code         text not null,
  -- Le minimum appliqué à la construction : toutes les lignes portent le même (une construction efface et réécrit tout).
  min_menages  numeric not null,
  -- Les 24 cibles (clés de `cibles_exposition`), sommées sur les SEULS carreaux d'au moins `min_menages` ménages.
  populations  jsonb not null,
  n_carreaux   integer not null,
  construit_le timestamptz not null default now(),
  primary key (maille, code)
);

comment on table public.denominateur_menages_min is
  'Denominateur de la couverture pour une cible autre que la population totale : par maille (cp, iris, commune, '
  'departement) et code, les 24 cibles sommees sur les carreaux de carreau_couverture d''au moins min_menages menages '
  '(reglage min_menages_cible). Construite depuis carreau_couverture (meme attribution que le numerateur) par '
  'construire_denominateur_menages_min(). sql/310 (A5, ARB-4).';

alter table public.denominateur_menages_min enable row level security;
revoke all on table public.denominateur_menages_min from public, anon, authenticated;
grant select on table public.denominateur_menages_min to service_role;

create or replace function public.construire_denominateur_menages_min()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set work_mem to '128MB'
as $fn$
declare
  v_t0       timestamptz := clock_timestamp();
  v_min      numeric;
  v_rang_men integer;
  v_n_cibles integer;
  v_paires   text;
  v_motif    text;
  v_n        integer;
begin
  v_motif := public.carreau_couverture_complete();
  if v_motif is not null then
    raise exception 'carreau_couverture incomplete ou non certifiee (%) : la construire jusqu''au bout '
      '(scripts/construire_carreau_couverture.mjs)', v_motif using errcode = '55000';
  end if;
  v_min := public.reglage_conversion('min_menages_cible');
  select ce.rang_pop into v_rang_men from public.cibles_exposition ce where ce.code = 'men' and ce.rang_pop is not null;
  if v_rang_men is null then
    raise exception 'cibles_exposition : cible men (menages) absente, le minimum ne peut pas se lire' using errcode = '55000';
  end if;

  -- Même liste que sql/267 (24 agrégats écrits en clair, SQL dynamique, codes par `quote_literal`), chacun filtré.
  select count(*),
         string_agg(format('%s, coalesce(sum(cc.pops[%s]::numeric) filter (where k.ok), 0)', quote_literal(code), rang_pop),
                    ', ' order by rang_pop)
    into v_n_cibles, v_paires
    from public.cibles_exposition
   where actif and rang_pop is not null;
  if v_n_cibles = 0 or v_n_cibles > 50 then
    raise exception 'cibles_exposition : % cibles actives avec un rang, attendu 1 a 50', v_n_cibles using errcode = '55000';
  end if;

  delete from public.denominateur_menages_min where true;

  -- UNE passe pour les quatre mailles (`grouping sets`) ; les carreaux sans code d'une maille n'en ont pas de ligne
  -- (ils sortent en `hors_territoire`, comme au numérateur).
  execute format($q$
    insert into public.denominateur_menages_min (maille, code, min_menages, populations, n_carreaux)
    select case when grouping(cc.code_postal) = 0 then 'cp' when grouping(cc.code_iris) = 0 then 'iris'
                when grouping(cc.code_commune) = 0 then 'commune' else 'departement' end,
           coalesce(cc.code_postal, cc.code_iris, cc.code_commune, cc.code_departement),
           %2$s, jsonb_build_object(%1$s), count(*) filter (where k.ok)
      from public.carreau_couverture cc
      cross join lateral (select (%2$s = 0 or cc.pops[%3$s] >= %2$s) as ok) k
      group by grouping sets ((cc.code_postal), (cc.code_iris), (cc.code_commune), (cc.code_departement))
      having coalesce(cc.code_postal, cc.code_iris, cc.code_commune, cc.code_departement) is not null$q$,
    v_paires, v_min, v_rang_men)
  ;
  get diagnostics v_n = row_count;
  analyze public.denominateur_menages_min;  -- statistiques fraîches pour les jointures de la couverture pays
  return jsonb_build_object('ok', true, 'min_menages', v_min, 'n_lignes', v_n, 'n_cibles', v_n_cibles,
                            'duree_ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end;
$fn$;

revoke all on function public.construire_denominateur_menages_min() from public, anon, authenticated;
grant execute on function public.construire_denominateur_menages_min() to service_role;

comment on function public.construire_denominateur_menages_min() is
  'Construit denominateur_menages_min DEPUIS carreau_couverture, au minimum de menages du reglage min_menages_cible : '
  'une passe (grouping sets cp, iris, commune, departement), 24 sommes filtrees ; efface puis reecrit tout, en une '
  'transaction. Refuse (55000) si carreau_couverture n''est pas certifiee complete. A rejouer apres toute construction '
  'de carreau_couverture et apres tout changement du reglage. sql/310 (A5).';

-- NULL si le dénominateur filtré d'une maille est utilisable, sinon le MOTIF du refus `couverture_non_construite`.
-- Une ligne suffit : une construction écrit toutes les lignes au même minimum, à la même date.
create or replace function public.denominateur_menages_motif(p_maille text)
returns text
language sql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
  select case
           when d.maille is null then 'denominateur_menages_absent'
           when d.min_menages <> public.reglage_conversion('min_menages_cible') then 'denominateur_menages_autre_minimum'
           when d.construit_le < (select max(b.construit_le) from public.carreau_couverture_bandes b) then 'denominateur_menages_perime'
         end
    from (select 1) un
    left join lateral (select dm.maille, dm.min_menages, dm.construit_le
                         from public.denominateur_menages_min dm where dm.maille = p_maille
                        -- par la clé primaire : sans tri, un parcours séquentiel peut lire les 89 000 lignes avant
                        -- la première de la maille (mesuré : 9 pages pour cp, jusqu'à ≈ 8 800 pour departement).
                        order by dm.maille, dm.code limit 1) d on true
$fn$;

comment on function public.denominateur_menages_motif(text) is
  'NULL si denominateur_menages_min est utilisable pour la maille, sinon le motif : denominateur_menages_absent, '
  'denominateur_menages_autre_minimum (construit a un autre minimum que le reglage), denominateur_menages_perime '
  '(plus ancien que carreau_couverture). sql/310 (A5).';

revoke all on function public.denominateur_menages_motif(text) from public, anon, authenticated;
grant execute on function public.denominateur_menages_motif(text) to service_role;

-- ── 4. LE corps de « carreaux d'une forme », avec les ménages du carreau ─────────────────────────────────────────────
-- Règle et commentaires de sql/269 / sql/276 inchangés (`ST_Intersects` + `distinct on`, corps entièrement qualifié,
-- PAS de search_path : inlinée). `men` = `pops[p_rang_men]`, les ménages du carreau, que le minimum compare.
create or replace function public.carreaux_de_forme_menages(p_geom geometry, p_rang integer, p_rang_men integer)
returns table (carreau_id bigint, pop numeric, men numeric, centroide_3857 geometry, code_postal text, code_iris text,
               code_commune text, code_departement text)
language sql
stable
as $fn$
  select distinct on (cc.carreau_id) cc.carreau_id, cc.pops[p_rang]::numeric, cc.pops[p_rang_men]::numeric,
         cc.centroide_3857, cc.code_postal, cc.code_iris, cc.code_commune, cc.code_departement
    from (select public.ST_Subdivide(public.ST_Transform(p_geom, 3857), 256) as sg) z
    join public.carreau_couverture cc on cc.centroide_3857 operator(public.&&) z.sg and public.ST_Intersects(cc.centroide_3857, z.sg)
   order by cc.carreau_id
$fn$;

comment on function public.carreaux_de_forme_menages(geometry, integer, integer) is
  'LA regle « carreaux d''une forme » (corps) : carreaux de carreau_couverture dont le centroide est dans la forme, '
  'effectif d''une cible, menages du carreau (pops[p_rang_men]), centroide 3857 et quatre codes. '
  'carreaux_de_forme_points, carreaux_de_forme_codes et carreaux_de_forme en sont des enveloppes. sql/310 (A5).';

revoke all on function public.carreaux_de_forme_menages(geometry, integer, integer) from public, anon, authenticated;
grant execute on function public.carreaux_de_forme_menages(geometry, integer, integer) to service_role;

-- sql/276 devient une enveloppe : même signature, même type de retour.
create or replace function public.carreaux_de_forme_points(p_geom geometry, p_rang integer)
returns table (carreau_id bigint, pop numeric, centroide_3857 geometry, code_postal text, code_iris text,
               code_commune text, code_departement text)
language sql
stable
as $fn$
  select f.carreau_id, f.pop, f.centroide_3857, f.code_postal, f.code_iris, f.code_commune, f.code_departement
    from public.carreaux_de_forme_menages(p_geom, p_rang, p_rang) f
$fn$;

-- ── 5a. couverture_geometrie : sql/309 + minimum de ménages (A5) ─────────────────────────────────────────────────────
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
  'carreaux_ecartes, motif_vide carreaux_tous_ecartes).';

revoke all on function public.couverture_geometrie(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.couverture_geometrie(uuid, uuid, text, text, integer) to service_role;

-- ── 5b. couverture_pays_jsonb : sql/308 + minimum de ménages (A5) ────────────────────────────────────────────────────
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
  v_min      numeric;   -- A5 : le minimum de ménages appliqué (0 pour la population totale)
  v_ec_n     bigint;    -- A5 : carreaux du pays écartés (moins de v_min ménages)
  v_ec_p     numeric;
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

  if p_decoupage = 'cp' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', cp.code_postal, 'nom', rcp.nom_principal, 'commune', null, 'n_carreaux', t.n,
             'pop_en_zone', round(t.p), 'pop_totale', round(t.p), 'part', case when t.p > 0 then 100.0 end,
             'part_brute', case when t.p > 0 then 100 end,  -- B11 : exacte, mais la clé que lit `estRetenue`
             'membres', to_jsonb(m.membres))  -- A2 : les codes de l'unité CP
           order by t.p desc, cp.code_postal), '[]'::jsonb), count(*)
      into v_lignes, v_n_terr
      from public.cp_population_totale cp
      -- A5 : sous un minimum, population et carreaux de la jumelle filtrée.
      left join (select d.code, d.n_carreaux, d.populations from public.denominateur_menages_min d
                  where v_min > 0 and d.maille = 'cp' offset 0) dm on dm.code = cp.code_postal
      cross join lateral (select case when v_min > 0 then coalesce((dm.populations->>p_cible)::numeric, 0)
                                      else (cp.populations->>p_cible)::numeric end as p,
                                 case when v_min > 0 then coalesce(dm.n_carreaux, 0) else cp.n_carreaux end as n) t
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
             'code', u.code, 'nom', rd.nom_dept, 'commune', null, 'n_carreaux', t.n,
             'pop_en_zone', round(t.p), 'pop_totale', round(t.p), 'part', case when t.p > 0 then 100.0 end,
             'part_brute', case when t.p > 0 then 100 end)  -- B11
           order by t.p desc, u.code), '[]'::jsonb), count(*)
      into v_lignes, v_n_terr
      from public.unite_population_totale u
      left join (select d.code, d.n_carreaux, d.populations from public.denominateur_menages_min d
                  where v_min > 0 and d.maille = 'departement' offset 0) dm on dm.code = u.code
      cross join lateral (select case when v_min > 0 then coalesce((dm.populations->>p_cible)::numeric, 0)
                                      else (u.populations->>p_cible)::numeric end as p,
                                 case when v_min > 0 then coalesce(dm.n_carreaux, 0) else u.n_carreaux end as n) t
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
    'carreaux_ecartes', jsonb_build_object('n_carreaux', v_ec_n, 'population', round(v_ec_p)),
    'motif_vide', case when v_n > 0 then null when v_ec_n > 0 then 'carreaux_tous_ecartes' else 'aucun_carreau' end,
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
  'NULL, incluse = true ; n_inconnues), sql/310 (A5 : cible autre que ind, chiffres de denominateur_menages_min, '
  'min_menages, carreaux_ecartes).';

revoke all on function public.couverture_pays_jsonb(text, text, text) from public, anon, authenticated;
grant execute on function public.couverture_pays_jsonb(text, text, text) to service_role;

-- ── 5c. paver_cercles : sql/303 + minimum de ménages (A5) ────────────────────────────────────────────────────────────
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
  v_min          numeric;   -- A5 : le minimum de ménages appliqué (0 pour la population totale)
  v_rang_men     integer;
  v_ec_n         bigint;    -- A5 : carreaux de la zone écartés
  v_ec_p         numeric;
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
  -- A5 (ARB-4) : le minimum de la cible ; il s'applique aux carreaux de la zone, des cellules et de l'union (une cellule
  -- n'a pas de dénominateur pré-calculé : ses carreaux sont lus ici, filtrés par la même règle).
  v_min := public.min_menages_de_cible(p_cible);
  select ce.rang_pop into v_rang_men from public.cibles_exposition ce where ce.code = 'men' and ce.rang_pop is not null;
  if v_min > 0 and v_rang_men is null then
    raise exception 'cible men (menages) absente de cibles_exposition : le minimum ne peut pas se lire' using errcode = '55000';
  end if;
  v_rang_men := coalesce(v_rang_men, v_rang);

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

  with z_tous as materialized (                                             -- (1) carreaux de la zone
    select f.carreau_id, f.pop, f.centroide_3857, f.code_departement, (v_min = 0 or f.men >= v_min) as compte
      from public.carreaux_de_forme_menages(v_geom, v_rang, v_rang_men) f
  ), z as materialized (                                                    -- A5 : ceux qui comptent
    select z_tous.carreau_id, z_tous.pop, ST_X(z_tous.centroide_3857) as x, ST_Y(z_tous.centroide_3857) as y,
           public.territoire_grille(z_tous.code_departement) as territoire
      from z_tous where z_tous.compte
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
           and (v_min = 0 or cc.pops[v_rang_men] >= v_min)  -- A5 : la cellule compte les mêmes carreaux
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
                  order by ret.pop_en_zone desc, ret.territoire, ret.q, ret.r), '[]'::jsonb) from ret),
         (select coalesce(jsonb_agg(jsonb_build_object('territoire', gr.territoire, 'pas_3857', round(gr.pas::numeric, 3))
                                    order by gr.territoire), '[]'::jsonb) from grilles gr),
         (select max(round(100 * tot.pop_en_zone / nullif(tot.pop_totale, 0), 1)) from tot),
         perte.population, perte.couverte, perte.manques, perte.hors_zone, perte.achetee,
         (select count(*) from z_tous where not z_tous.compte),
         (select coalesce(sum(z_tous.pop), 0) from z_tous where not z_tous.compte)
    into v_n_carreaux, v_n_cand, v_n_cercles, v_cercles, v_grilles, v_part_max,
         v_population, v_couverte, v_manques, v_hors_zone, v_achetee, v_ec_n, v_ec_p
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
    'n_carreaux', v_n_carreaux,
    -- A5 : le minimum appliqué et ce qu'il écarte (avant = n_carreaux + écartés ; après = n_carreaux).
    'min_menages', v_min,
    'carreaux_ecartes', jsonb_build_object('n_carreaux', v_ec_n, 'population', round(v_ec_p)),
    'motif_vide', case when v_n_carreaux = 0 and v_ec_n > 0 then 'carreaux_tous_ecartes'
                       when v_n_carreaux = 0 and jsonb_array_length(v_non_carr) > 0 then 'territoire_non_carroye'
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
  '(territoire_non_carroye, aucun_carreau, aucune_cellule_au_seuil) ; rayon hors [1 000, 200 000] -> 22023. sql/276 (lot 5, T4), sql/303 (B11 : part non arrondie, cellule vide jamais retenue), sql/310 (A5 : cible autre que ind, carreaux de '
  'moins de min_menages_cible menages ecartes de la zone, des cellules et de l''union ; min_menages, carreaux_ecartes, '
  'motif_vide carreaux_tous_ecartes).';

revoke all on function public.paver_cercles(uuid, uuid, text, integer, numeric, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.paver_cercles(uuid, uuid, text, integer, numeric, integer, integer, integer) to service_role;

-- ── 6. couverture_zone_en_cache : sql/309 + un chiffrage à un autre minimum n'est plus servi (A5) ────────────────────
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
     -- A4 tour 1 : un chiffrage LOCAL à lignes inconnues jugées à une autre tolérance (ou par `ST_Covers`, sql/308, sans
     -- la clé) n'est plus servi ; une zone pays (tout le territoire) et un chiffrage sans inconnue ne dépendent pas d'elle.
     and (coalesce((c.resultat->>'n_inconnues')::integer, 0) = 0 or c.resultat ? 'pays'
          or (c.resultat->>'tolerance_inclusion')::numeric = public.reglage_conversion('inclusion_surface_inconnue'))
     -- A5 : un chiffrage à un AUTRE minimum de ménages que celui de la cible aujourd'hui (ou d'avant sql/310, sans la
     -- clé) n'est plus servi ; le calcul le remplace (`on conflict … do update`), aucun DELETE.
     and (c.resultat->>'min_menages')::numeric is not distinct from public.min_menages_de_cible(c.cible)
$fn$;

comment on function public.couverture_zone_en_cache(uuid, uuid, text, text) is
  'Chiffrage de couverture en cache (|| {cache: true, zone_maj}) s''il est encore valide — zone de l''espace, forme et '
  'base inchangees, base certifiee complete, denominateur CP / commune / departement pas plus recent que la base — '
  'sinon NULL. Lecture seule. sql/270 (lot 4, T6, T8), sql/275 (lot 5, T3), sql/303 (B11 : lignes sans part_brute non servies), sql/304 (A2 : '
  'lignes CP sans membres non servies), sql/308 (A4 : cp / commune / departement sans n_inconnues non servis), sql/309 (A4 tour 1 : '
  'lignes inconnues jugees a une autre tolerance non servies), sql/310 (A5 : chiffrage a un autre minimum de menages, '
  'ou sans min_menages, non servi).';

revoke all on function public.couverture_zone_en_cache(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.couverture_zone_en_cache(uuid, uuid, text, text) to service_role;

-- ── 7. Les recettes « seuil sur carreaux » : un minimum EXPLICITE ────────────────────────────────────────────────────
-- Une recette enregistrée avant sql/292 n'a pas de `min_menages` ; le serveur la recalculait avec 0 (`?? 0`), un défaut
-- implicite DIFFÉRENT de celui d'une recette neuve (11, posé par l'écran). Elle reçoit 0 — le comportement qu'elle
-- avait, désormais écrit et affiché (« minimum de ménages : 0 ») — et la contrainte l'exige pour toute écriture.
-- ⚠ Le trigger `custom_geo_zones_before_write` pose `updated_at` : la couverture en cache de ces zones se relit une fois.
do $do$
declare
  v_avant integer;
  v_maj   integer;
  v_apres integer;
begin
  select count(*) into v_avant from public.custom_geo_zones
   where recette->>'type' = 'seuil_carreaux' and not (recette ? 'min_menages');
  update public.custom_geo_zones
     set recette = recette || jsonb_build_object('min_menages', 0)
   where recette->>'type' = 'seuil_carreaux' and not (recette ? 'min_menages');
  get diagnostics v_maj = row_count;
  select count(*) into v_apres from public.custom_geo_zones
   where recette->>'type' = 'seuil_carreaux' and not (recette ? 'min_menages');
  raise notice 'A5 recettes seuil_carreaux sans min_menages : avant %, mises a 0 : %, apres %', v_avant, v_maj, v_apres;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.custom_geo_zones'::regclass and conname = 'custom_geo_zones_seuil_carreaux_min_menages') then
    alter table public.custom_geo_zones
      add constraint custom_geo_zones_seuil_carreaux_min_menages
      -- `coalesce(…, false)` : sans la clé, `jsonb_typeof` rend NULL, et un CHECK NULL PASSE (mesuré : la première
      -- écriture de cette contrainte, sans lui, laissait entrer une recette sans minimum).
      check (recette is null or recette->>'type' is distinct from 'seuil_carreaux'
             or coalesce(jsonb_typeof(recette->'min_menages') = 'number', false));
  end if;
end
$do$;

-- ── 8. Construire le dénominateur filtré s'il manque ou ne vaut plus ─────────────────────────────────────────────────
-- Une passe sur `carreau_couverture` (≈ 30 s) ; rejouer la migration ne le reconstruit pas s'il est à jour. Sans table
-- étroite certifiée, rien n'est construit : la couverture refusera (`denominateur_menages_absent`) jusqu'à
-- `construire_denominateur_menages_min()` (11-reconstruire.sh, étape 7bis).
do $do$
begin
  if public.carreau_couverture_complete() is null
     and (public.denominateur_menages_motif('cp') is not null or public.denominateur_menages_motif('iris') is not null
          or public.denominateur_menages_motif('commune') is not null
          or public.denominateur_menages_motif('departement') is not null) then
    raise notice 'A5 denominateur_menages_min : %', public.construire_denominateur_menages_min();
  else
    raise notice 'A5 denominateur_menages_min : a jour, ou carreau_couverture non certifiee (%)', public.carreau_couverture_complete();
  end if;
end
$do$;
