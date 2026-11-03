-- ============================================================================
-- sql/332_carreau_couverture_e7.sql — C25 (amendement E7) : cohérence hiérarchique carreau → IRIS ⊂ commune ⊂
-- département, et rattachement des carreaux sans CP (2026-11-03).
--
-- ── LE CONSTAT (mesuré le 03/11 sur les 2 324 577 carreaux, par lots de 250 000) ──────────────────────────────────
--
-- `carreau_couverture` (sql/266) rattache le CP et l'IRIS par le CENTRE du carreau (`ST_Centroid(geom_3857)` ; le coin
-- sud-ouest de la géométrie est exactement celui de l'identifiant `CRS3035RES200mN…E…`, à 1e-9 près, en 3035, 2975 et
-- 5490 : aucun décalage de 100 m), mais la COMMUNE par le premier code de `lcog_geo`, liste dont l'ordre n'est pas
-- garanti, et le département dérivé de cette commune.
--   - commune ≠ IRIS[0:5] : 54 300 carreaux (2,34 %), 803 132 hab. — 40 509 dont la commune de l'IRIS est AILLEURS dans
--     la liste `lcog_geo`, 13 791 où elle n'y est pas. Aucun écart PLM : `lcog_geo` donne déjà les arrondissements.
--   - département faux : 2 615 carreaux, 32 859 hab.
--   - sans CP : 3 926 carreaux, 71 788 hab. (dont 3 879 sans IRIS non plus) : l'écart département / CP de la
--     population nationale (63 684 en métropole, 8 104 outre-mer).
--   La table `iris` elle-même est cohérente : commune = IRIS[0:5] et département = f(commune) sur ses 49 448 lignes.
--
-- ── LA DÉCISION (coordinateur, 03/11 : option b allégée) ──────────────────────────────────────────────────────────
--
-- La base locale est PARTAGÉE : `carreau_couverture` et ses dénominateurs sont lus par 8 autres branches, et
-- `tests/integration/carreau-couverture.test.ts` décrit la table BRUTE. On ne la réécrit donc pas :
--   1. trois colonnes de correction NULLABLES, sans défaut (pas de réécriture de la table) — `code_commune_e7`,
--      `code_departement_e7`, `code_postal_e7` — et la distance de contrôle `distance_cp_e7_m`, posées sur les SEULS
--      carreaux qui changent, par lots (`construire_carreau_couverture_e7`, script
--      `scripts/construire_carreau_couverture_e7.mjs`, progression et journal `carreau_couverture_e7_lots`) ;
--   2. la vue `carreau_couverture_e7` : `coalesce(x_e7, x)`, mêmes noms de colonnes que la table ;
--   3. des dénominateurs JUMEAUX construits depuis la vue — `unite_population_totale_e7`, `cp_population_totale_e7`
--      (avec le département majoritaire du CP), `denominateur_menages_min_e7` — les originaux ne sont pas touchés ;
--   4. les lecteurs du découpage lisent la vue et les jumeaux (fonctions redéfinies en fin de fichier).
--
-- LES RÈGLES.
--   - commune = IRIS[0:5] quand le carreau a un IRIS (arrondissements PLM compris) ; sinon la commune `lcog_geo`, qui
--     reste l'attribut de CONTRÔLE (les `_e7` non nuls sont le rapport des écarts) ;
--   - département = f(commune) : deux caractères, trois pour `97x` / `98x`, `2A` / `2B` compris ;
--   - carreau sans CP : le CP (canonique, `cp_groupe`) dont le CONTOUR est le plus proche du centre, distance géodésique
--     gardée en contrôle ; 8 candidats par l'index GIST (`<->` en degrés), départagés en mètres puis par code ;
--   - CP à cheval sur deux départements : le département MAJORITAIRE en population (`ind`) du CP, puis le nombre de
--     carreaux, puis le code (`cp_population_totale_e7.code_departement`).
--
-- ⚠ DEUX RÈGLES JUSQU'AU MERGE. La table brute garde l'ancienne règle, lue par les autres branches ; les fonctions
-- redéfinies ici (partagées, comme toutes les fonctions de la base locale) lisent la nouvelle. À FUSIONNER au merge :
-- reconstruire `carreau_couverture` et ses dénominateurs avec la règle E7, puis retirer les `_e7`.
-- ⚠ HORS PÉRIMÈTRE, non modifiés : `carreau_risque_distance.code_postal` (module risque), `population_par_classe`,
-- `remplir_zone_set_cp`, `export_couverture_rayon` (jeux de zones et risque, ancienne règle), et le filtre par
-- département de `couverture_rayon_poi` (lit la colonne brute ; ses carreaux, eux, passent par la vue).
--
-- ⚠ FRAÎCHEUR. Les jumeaux sont construits DEPUIS la vue : ils sont périmés s'ils sont plus ANCIENS que la base,
-- `base_couverture_e7_le()` = le plus récent du journal des bandes et du journal des lots E7 — la règle que l'IRIS
-- suivait déjà (sql/269). Une bande reconstruite fait donc refuser le découpage jusqu'à la reprise des lots E7 et des
-- jumeaux (le script le fait), au lieu de servir des corrections périmées.
--
-- Rejouable : `if not exists`, `create or replace`, mises à jour filtrées (`is distinct from`) ; aucun DROP.
-- Appliquer par `psql -1`, puis `node scripts/construire_carreau_couverture_e7.mjs`.
-- ============================================================================

-- ── 1. Les colonnes de correction ──────────────────────────────────────────────────────────────────────────────────

alter table public.carreau_couverture add column if not exists code_commune_e7 text;
alter table public.carreau_couverture add column if not exists code_departement_e7 text;
alter table public.carreau_couverture add column if not exists code_postal_e7 text;
alter table public.carreau_couverture add column if not exists distance_cp_e7_m real;

comment on column public.carreau_couverture.code_commune_e7 is
  'C25 (E7, sql/332) : IRIS[0:5] quand il differe de code_commune (lcog_geo, ordre non garanti) ; NULL sinon. '
  'Lu par la vue carreau_couverture_e7. A fusionner au merge.';
comment on column public.carreau_couverture.code_departement_e7 is
  'C25 (E7, sql/332) : departement de la commune corrigee quand il differe de code_departement ; NULL sinon.';
comment on column public.carreau_couverture.code_postal_e7 is
  'C25 (sql/332) : CP canonique au contour le plus proche, pour un carreau dont le centre ne tombe dans aucun contour '
  '(code_postal NULL) ; NULL sinon.';
comment on column public.carreau_couverture.distance_cp_e7_m is
  'C25 (sql/332) : distance geodesique (m) du centre du carreau au contour de code_postal_e7. Controle.';

create table if not exists public.carreau_couverture_e7_lots (
  lot           int primary key,
  id_min        bigint not null,
  id_max        bigint not null,
  n_lus         bigint not null,
  n_ecrits      bigint not null,
  n_commune     bigint not null,
  n_departement bigint not null,
  n_cp          bigint not null,
  duree_ms      int not null,
  construit_le  timestamptz not null default now()
);

comment on table public.carreau_couverture_e7_lots is
  'Journal des lots de construire_carreau_couverture_e7 (C25, sql/332) : un lot = une plage de carreau_id. '
  'max(construit_le) entre dans base_couverture_e7_le().';

alter table public.carreau_couverture_e7_lots enable row level security;
revoke all on table public.carreau_couverture_e7_lots from public, anon, authenticated, service_role;
grant select on table public.carreau_couverture_e7_lots to service_role;

-- ── 2. La vue : la table, colonnes corrigées ────────────────────────────────────────────────────────────────────────
-- Mêmes noms que la table : un lecteur bascule en changeant le seul nom de la relation. `security_invoker` : les droits
-- sont ceux de l'appelant (les RPC `security definer` et `service_role`), comme sur la table.

create or replace view public.carreau_couverture_e7 with (security_invoker = true) as
select cc.carreau_id,
       cc.centroide_3857,
       coalesce(cc.code_postal_e7, cc.code_postal)           as code_postal,
       cc.code_iris,
       coalesce(cc.code_commune_e7, cc.code_commune)         as code_commune,
       coalesce(cc.code_departement_e7, cc.code_departement) as code_departement,
       cc.pops,
       cc.code_postal      as code_postal_brut,
       cc.code_commune     as code_commune_brut,
       cc.code_departement as code_departement_brut,
       cc.distance_cp_e7_m
  from public.carreau_couverture cc;

comment on view public.carreau_couverture_e7 is
  'C25 (E7, sql/332) : carreau_couverture avec coalesce(x_e7, x) pour le CP, la commune et le departement. '
  'Lue par le decoupage de cette branche ; la table brute reste celle des autres. A fusionner au merge.';

revoke all on table public.carreau_couverture_e7 from public, anon, authenticated, service_role;
grant select on table public.carreau_couverture_e7 to service_role;

-- ── 3. Les dénominateurs jumeaux ───────────────────────────────────────────────────────────────────────────────────

create table if not exists public.unite_population_totale_e7 (like public.unite_population_totale including all);
create table if not exists public.cp_population_totale_e7 (like public.cp_population_totale including all);
create table if not exists public.denominateur_menages_min_e7 (like public.denominateur_menages_min including all);
alter table public.cp_population_totale_e7 add column if not exists code_departement text;
alter table public.cp_population_totale_e7 add column if not exists n_departements smallint;

comment on table public.unite_population_totale_e7 is
  'C25 (sql/332) : jumeau de unite_population_totale (iris, commune, departement, region) construit depuis la vue '
  'carreau_couverture_e7. A fusionner au merge.';
comment on table public.cp_population_totale_e7 is
  'C25 (sql/332) : jumeau de cp_population_totale construit depuis la vue carreau_couverture_e7 (carreaux sans CP '
  'rattaches au plus proche) ; code_departement = departement majoritaire en population du CP. A fusionner au merge.';
comment on table public.denominateur_menages_min_e7 is
  'C25 (sql/332) : jumeau de denominateur_menages_min construit depuis la vue carreau_couverture_e7.';

alter table public.unite_population_totale_e7 enable row level security;
alter table public.cp_population_totale_e7 enable row level security;
alter table public.denominateur_menages_min_e7 enable row level security;
revoke all on table public.unite_population_totale_e7 from public, anon, authenticated, service_role;
revoke all on table public.cp_population_totale_e7 from public, anon, authenticated, service_role;
revoke all on table public.denominateur_menages_min_e7 from public, anon, authenticated, service_role;
grant select on table public.unite_population_totale_e7 to service_role;
grant select on table public.cp_population_totale_e7 to service_role;
grant select on table public.denominateur_menages_min_e7 to service_role;

-- ── 4. Les règles ──────────────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.departement_de_commune(p_commune text)
returns text
language sql immutable parallel safe as $fn$
  select case when left(p_commune, 2) in ('97', '98') then left(p_commune, 3) else left(p_commune, 2) end
$fn$;

comment on function public.departement_de_commune(text) is
  'Departement d''un code commune INSEE : deux caracteres, trois pour 97x/98x, 2A/2B compris. C25 (sql/332).';

create or replace function public.base_couverture_e7_le()
returns timestamptz
language sql stable set search_path to 'public', 'pg_catalog' as $fn$
  select greatest((select max(b.construit_le) from public.carreau_couverture_bandes b),
                  (select max(l.construit_le) from public.carreau_couverture_e7_lots l))
$fn$;

comment on function public.base_couverture_e7_le() is
  'Date de la base lue par le decoupage : le plus recent des bandes de carreau_couverture et des lots E7. Un '
  'denominateur _e7 plus ancien est perime. C25 (sql/332).';

create or replace function public.construire_carreau_couverture_e7(p_lot int, p_taille int default 100000)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_t0     timestamptz := clock_timestamp();
  v_min    bigint;
  v_max    bigint;
  v_lus    bigint;
  v_ecrits bigint;
  v_c      bigint;
  v_d      bigint;
  v_p      bigint;
  v_dist   real;
begin
  -- Une construction, appelée par psql dans le conteneur (jamais par PostgREST) : aucun délai posé.
  if p_lot is null or p_lot < 0 or p_taille is null or p_taille < 1000 or p_taille > 500000 then
    return jsonb_build_object('ok', false, 'error', 'lot_hors_bornes');
  end if;
  v_min := p_lot::bigint * p_taille + 1;
  v_max := (p_lot::bigint + 1) * p_taille;

  -- Le lot par la clé primaire (plage de carreau_id). Seules les lignes dont une correction CHANGE sont écrites
  -- (`is distinct from`) : la première passe touche ≈ 58 000 lignes, un rejeu aucune.
  with x as materialized (
    select cc.carreau_id, cc.code_postal, cc.code_iris, cc.code_commune, cc.code_departement, cc.centroide_3857,
           cc.code_commune_e7 as a_c, cc.code_departement_e7 as a_d, cc.code_postal_e7 as a_p, cc.distance_cp_e7_m as a_m
      from public.carreau_couverture cc
     where cc.carreau_id between v_min and v_max
  ), c as (
    -- La commune de l'IRIS, quand elle diffère de l'attribut INSEE.
    select x.*, case when x.code_iris is not null and left(x.code_iris, 5) is distinct from x.code_commune
                     then left(x.code_iris, 5) end as n_c
      from x
  ), d as (
    select c.*, case when public.departement_de_commune(coalesce(c.n_c, c.code_commune)) is distinct from c.code_departement
                     then public.departement_de_commune(coalesce(c.n_c, c.code_commune)) end as n_d
      from c
  ), p as (
    -- Le CP au contour le plus proche, pour les seuls carreaux sans CP.
    select d.carreau_id, k.code_canonique as n_p, k.dist as n_m
      from d
      cross join lateral (
        select g.code_canonique,
               ST_Distance(r.geom::geography, ST_Transform(d.centroide_3857, 4326)::geography)::real as dist
          from (select r0.code_postal, r0.geom from public.ref_codes_postaux r0
                 where r0.geom is not null
                 order by r0.geom <-> ST_Transform(d.centroide_3857, 4326)
                 limit 8) r
          join public.cp_groupe g on g.code_postal = r.code_postal
         order by 2, 1
         limit 1) k
     where d.code_postal is null
  ), n as (
    select d.carreau_id, d.n_c, d.n_d, p.n_p, p.n_m, d.a_c, d.a_d, d.a_p, d.a_m
      from d left join p on p.carreau_id = d.carreau_id
  )
  update public.carreau_couverture t
     set code_commune_e7 = n.n_c, code_departement_e7 = n.n_d, code_postal_e7 = n.n_p, distance_cp_e7_m = n.n_m
    from n
   where t.carreau_id = n.carreau_id
     and (n.n_c is distinct from n.a_c or n.n_d is distinct from n.a_d
          or n.n_p is distinct from n.a_p or n.n_m is distinct from n.a_m);
  get diagnostics v_ecrits = row_count;

  select count(*), count(code_commune_e7), count(code_departement_e7), count(code_postal_e7), max(distance_cp_e7_m)
    into v_lus, v_c, v_d, v_p, v_dist
    from public.carreau_couverture where carreau_id between v_min and v_max;

  insert into public.carreau_couverture_e7_lots
         (lot, id_min, id_max, n_lus, n_ecrits, n_commune, n_departement, n_cp, duree_ms)
  values (p_lot, v_min, v_max, v_lus, v_ecrits, v_c, v_d, v_p,
          extract(milliseconds from clock_timestamp() - v_t0)::int)
  on conflict (lot) do update
     set id_min = excluded.id_min, id_max = excluded.id_max, n_lus = excluded.n_lus, n_ecrits = excluded.n_ecrits,
         n_commune = excluded.n_commune, n_departement = excluded.n_departement, n_cp = excluded.n_cp,
         duree_ms = excluded.duree_ms, construit_le = now();

  return jsonb_build_object('ok', true, 'lot', p_lot, 'id_min', v_min, 'id_max', v_max, 'lus', v_lus,
                            'ecrits', v_ecrits, 'commune', v_c, 'departement', v_d, 'cp', v_p, 'distance_max_m', v_dist,
                            'duree_ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end;
$fn$;

comment on function public.construire_carreau_couverture_e7(int, int) is
  'C25 (E7, sql/332) : pose les corrections commune / departement / CP d''UN lot de carreau_id (une transaction), '
  'sur les seules lignes qui changent, et le journalise. Appelee par scripts/construire_carreau_couverture_e7.mjs.';

revoke all on function public.construire_carreau_couverture_e7(int, int) from public, anon, authenticated;
grant execute on function public.construire_carreau_couverture_e7(int, int) to service_role;


create or replace function public.construire_denominateurs_e7()
returns jsonb
language plpgsql security definer set search_path to 'public' set work_mem to '128MB' as $fn$
declare
  v_t0       timestamptz := clock_timestamp();
  v_motif    text;
  v_lignes   bigint;
  v_lus      bigint;
  v_lot_min  timestamptz;
  v_bandes   timestamptz;
  v_n_cibles integer;
  v_paires   text;
  v_paires_f text;
  v_rang_ind integer;
  v_rang_men integer;
  v_min      numeric;
  v_n_cp     bigint;
  v_n_men    bigint;
begin
  v_motif := public.carreau_couverture_complete();
  if v_motif is not null then
    raise exception 'carreau_couverture incomplete ou non certifiee (%)', v_motif using errcode = '55000';
  end if;
  -- Les lots E7 couvrent toute la table, et sont postérieurs à la dernière bande (sinon une bande reconstruite
  -- porterait des corrections calculées sur ses anciennes valeurs).
  select k.n_lignes into v_lignes from public.carreau_couverture_controle k limit 1;
  select coalesce(sum(n_lus), 0), min(construit_le) into v_lus, v_lot_min from public.carreau_couverture_e7_lots;
  select max(construit_le) into v_bandes from public.carreau_couverture_bandes;
  if v_lus <> v_lignes then
    raise exception 'lots E7 incomplets : % carreaux traites sur %', v_lus, v_lignes using errcode = '55000';
  end if;
  if v_lot_min < v_bandes then
    raise exception 'lots E7 anterieurs a la derniere bande (% < %) : les rejouer', v_lot_min, v_bandes
      using errcode = '55000';
  end if;

  select ce.rang_pop into v_rang_ind from public.cibles_exposition ce where ce.code = 'ind' and ce.rang_pop is not null;
  select ce.rang_pop into v_rang_men from public.cibles_exposition ce where ce.code = 'men' and ce.rang_pop is not null;
  v_min := public.reglage_conversion('min_menages_cible');
  if v_rang_ind is null or v_rang_men is null then
    raise exception 'cibles_exposition : ind ou men sans rang' using errcode = '55000';
  end if;

  -- Les 24 agrégats écrits en clair (patron sql/267), et leur version filtrée par le minimum de ménages (sql/310).
  select count(*),
         string_agg(format('%s, sum(cc.pops[%s]::numeric)', quote_literal(code), rang_pop), ', ' order by rang_pop),
         string_agg(format('%s, coalesce(sum(cc.pops[%s]::numeric) filter (where k.ok), 0)', quote_literal(code), rang_pop),
                    ', ' order by rang_pop)
    into v_n_cibles, v_paires, v_paires_f
    from public.cibles_exposition
   where actif and rang_pop is not null;
  if v_n_cibles = 0 or v_n_cibles > 50 then
    raise exception 'cibles_exposition : % cibles actives avec un rang, attendu 1 a 50', v_n_cibles using errcode = '55000';
  end if;

  -- IRIS, commune, département : UNE passe sur la vue.
  delete from public.unite_population_totale_e7 where true;
  execute format($q$
    insert into public.unite_population_totale_e7 (maille, code, populations, n_carreaux)
    select case when grouping(cc.code_iris) = 0 then 'iris' when grouping(cc.code_commune) = 0 then 'commune'
                else 'departement' end,
           coalesce(case when grouping(cc.code_iris) = 0 then cc.code_iris end,
                    case when grouping(cc.code_commune) = 0 then cc.code_commune end,
                    cc.code_departement),
           jsonb_build_object(%s), count(*)
      from public.carreau_couverture_e7 cc
     group by grouping sets ((cc.code_iris), (cc.code_commune), (cc.code_departement))
    having coalesce(case when grouping(cc.code_iris) = 0 then cc.code_iris end,
                    case when grouping(cc.code_commune) = 0 then cc.code_commune end,
                    case when grouping(cc.code_departement) = 0 then cc.code_departement end) is not null$q$, v_paires);

  -- La région, sommée depuis le département (jointure INSEE ; 'HORS' sans région, comme sql/221).
  with dep as (
    select coalesce(r.code_region, 'HORS') as reg, u.populations, u.n_carreaux
      from public.unite_population_totale_e7 u
      left join public.ref_departements r on r.code_dept = u.code
     where u.maille = 'departement'
  ), p as (
    select dep.reg, e.key as k, sum(e.value::numeric) as v
      from dep cross join lateral jsonb_each_text(dep.populations) e
     group by 1, 2
  ), n as (
    select dep.reg, sum(dep.n_carreaux) as n from dep group by 1
  )
  insert into public.unite_population_totale_e7 (maille, code, populations, n_carreaux)
  select 'region', p.reg, jsonb_object_agg(p.k, p.v), max(n.n)
    from p join n on n.reg = p.reg
   group by p.reg;

  -- Code postal, puis son département majoritaire en population.
  delete from public.cp_population_totale_e7 where true;
  execute format($q$
    insert into public.cp_population_totale_e7 (code_postal, populations, n_carreaux)
    select cc.code_postal, jsonb_build_object(%s), count(*)
      from public.carreau_couverture_e7 cc
     where cc.code_postal is not null
     group by cc.code_postal$q$, v_paires);
  get diagnostics v_n_cp = row_count;

  with d as (
    select cc.code_postal, cc.code_departement, sum(cc.pops[v_rang_ind]::numeric) as p, count(*) as n
      from public.carreau_couverture_e7 cc
     where cc.code_postal is not null
     group by 1, 2
  ), m as (
    select distinct on (d.code_postal) d.code_postal, d.code_departement,
           count(*) over (partition by d.code_postal) as nd
      from d
     order by d.code_postal, d.p desc, d.n desc, d.code_departement
  )
  update public.cp_population_totale_e7 t
     set code_departement = m.code_departement, n_departements = m.nd
    from m where m.code_postal = t.code_postal;

  -- Le jumeau filtré par le minimum de ménages (patron sql/310, sur la vue).
  delete from public.denominateur_menages_min_e7 where true;
  execute format($q$
    insert into public.denominateur_menages_min_e7 (maille, code, min_menages, populations, n_carreaux)
    select case when grouping(cc.code_postal) = 0 then 'cp' when grouping(cc.code_iris) = 0 then 'iris'
                when grouping(cc.code_commune) = 0 then 'commune' else 'departement' end,
           coalesce(cc.code_postal, cc.code_iris, cc.code_commune, cc.code_departement),
           %2$s, jsonb_build_object(%1$s), count(*) filter (where k.ok)
      from public.carreau_couverture_e7 cc
      cross join lateral (select (%2$s = 0 or cc.pops[%3$s] >= %2$s) as ok) k
      group by grouping sets ((cc.code_postal), (cc.code_iris), (cc.code_commune), (cc.code_departement))
      having coalesce(cc.code_postal, cc.code_iris, cc.code_commune, cc.code_departement) is not null$q$,
    v_paires_f, v_min, v_rang_men);
  get diagnostics v_n_men = row_count;

  analyze public.unite_population_totale_e7;
  analyze public.cp_population_totale_e7;
  analyze public.denominateur_menages_min_e7;

  return jsonb_build_object(
    'ok', true,
    'unites', (select jsonb_object_agg(maille, n) from (select maille, count(*) n from public.unite_population_totale_e7 group by 1) s),
    'cp', v_n_cp,
    'cp_a_cheval', (select count(*) from public.cp_population_totale_e7 where n_departements > 1),
    'menages_min', v_n_men,
    'pop_cp', (select round(sum((populations->>'ind')::numeric)) from public.cp_population_totale_e7),
    'pop_departement', (select round(sum((populations->>'ind')::numeric)) from public.unite_population_totale_e7
                         where maille = 'departement'),
    'duree_ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end;
$fn$;

comment on function public.construire_denominateurs_e7() is
  'C25 (sql/332) : reconstruit unite_population_totale_e7, cp_population_totale_e7 (departement majoritaire) et '
  'denominateur_menages_min_e7 depuis la vue carreau_couverture_e7. Refuse si les lots E7 sont incomplets ou plus '
  'anciens que la derniere bande.';

revoke all on function public.construire_denominateurs_e7() from public, anon, authenticated;
grant execute on function public.construire_denominateurs_e7() to service_role;

-- ── 5. Les lecteurs du découpage : la vue et les jumeaux ────────────────────────────────────────────────────────────

create or replace function public.denominateur_construit_le(p_decoupage text)
 returns timestamp with time zone
 language sql
 stable
 set search_path to 'public', 'pg_catalog'
as $function$
  -- C25 (sql/332) : les jumeaux `_e7`, construits depuis la vue carreau_couverture_e7.
  select case p_decoupage
           when 'cp' then (select max(cp.construit_le) from public.cp_population_totale_e7 cp)
           when 'iris' then (select max(u.construit_le) from public.unite_population_totale_e7 u where u.maille = 'iris')
           when 'commune' then (select max(u.construit_le) from public.unite_population_totale_e7 u where u.maille = 'commune')
           when 'departement' then (select max(u.construit_le) from public.unite_population_totale_e7 u where u.maille = 'departement')
         end
$function$;

create or replace function public.denominateur_menages_motif(p_maille text)
 returns text
 language sql
 stable
 set search_path to 'public', 'pg_catalog'
as $function$
  -- C25 (sql/332) : le jumeau `_e7`, périmé s'il est plus ancien que la base (bandes ET lots E7).
  select case
           when d.maille is null then 'denominateur_menages_absent'
           when d.min_menages <> public.reglage_conversion('min_menages_cible') then 'denominateur_menages_autre_minimum'
           when d.construit_le < public.base_couverture_e7_le() then 'denominateur_menages_perime'
         end
    from (select 1) un
    left join lateral (select dm.maille, dm.min_menages, dm.construit_le
                         from public.denominateur_menages_min_e7 dm where dm.maille = p_maille
                        -- par la clé primaire : sans tri, un parcours séquentiel peut lire les 89 000 lignes avant
                        -- la première de la maille (mesuré : 9 pages pour cp, jusqu'à ≈ 8 800 pour departement).
                        order by dm.maille, dm.code limit 1) d on true
$function$;

create or replace function public.couverture_zone_en_cache(p_zone_id uuid, p_org_id uuid, p_cible text, p_decoupage text)
 returns jsonb
 language sql
 stable
 set search_path to 'public', 'pg_catalog'
as $function$
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
          or (c.resultat->>'tolerance_inclusion')::numeric = public.reglage_conversion('inclusion_surface_inconnue'))
     and (c.resultat->>'min_menages')::numeric is not distinct from public.min_menages_de_cible(c.cible)
$function$;

-- ── 6. Lecteurs redéfinis à l'identique, la vue et les jumeaux à la place de la table et des dénominateurs ──────────
-- Corps repris de la base au 03/11 (dernières versions : sql/310, 330, 323-330, 296, 295, 306, 276), avec pour seuls
-- changements : `public.carreau_couverture` → `public.carreau_couverture_e7`, `public.unite_population_totale`,
-- `public.cp_population_totale` et `public.denominateur_menages_min` → leurs jumeaux `_e7`, et la règle de fraîcheur
-- (`base_couverture_e7_le()`, dénominateur périmé s'il est plus ancien que la base).

CREATE OR REPLACE FUNCTION public.carreaux_de_forme_menages(p_geom geometry, p_rang integer, p_rang_men integer)
 RETURNS TABLE(carreau_id bigint, pop numeric, men numeric, centroide_3857 geometry, code_postal text, code_iris text, code_commune text, code_departement text)
 LANGUAGE sql
 STABLE
AS $function$
  select distinct on (cc.carreau_id) cc.carreau_id, cc.pops[p_rang]::numeric, cc.pops[p_rang_men]::numeric,
         cc.centroide_3857, cc.code_postal, cc.code_iris, cc.code_commune, cc.code_departement
    from (select public.ST_Subdivide(public.ST_Transform(p_geom, 3857), 256) as sg) z
    join public.carreau_couverture_e7 cc on cc.centroide_3857 operator(public.&&) z.sg and public.ST_Intersects(cc.centroide_3857, z.sg)
   order by cc.carreau_id
$function$
;

CREATE OR REPLACE FUNCTION public.carreaux_de_forme_menages_ind(p_geom geometry, p_rang integer, p_rang_men integer, p_rang_ind integer)
 RETURNS TABLE(carreau_id bigint, pop numeric, men numeric, pop_ind numeric, centroide_3857 geometry, code_postal text, code_iris text, code_commune text, code_departement text)
 LANGUAGE sql
 STABLE
AS $function$
  select distinct on (cc.carreau_id) cc.carreau_id, cc.pops[p_rang]::numeric, cc.pops[p_rang_men]::numeric,
         cc.pops[p_rang_ind]::numeric, cc.centroide_3857, cc.code_postal, cc.code_iris, cc.code_commune, cc.code_departement
    from (select public.ST_Subdivide(public.ST_Transform(p_geom, 3857), 256) as sg) z
    join public.carreau_couverture_e7 cc on cc.centroide_3857 operator(public.&&) z.sg and public.ST_Intersects(cc.centroide_3857, z.sg)
   order by cc.carreau_id
$function$
;

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

CREATE OR REPLACE FUNCTION public.couverture_pays_moins_jsonb(p_code text, p_cible text, p_decoupage text, p_retire geometry)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  v_base := public.base_couverture_e7_le();  -- C25 (sql/332) : bandes ET lots E7
  v_motif := public.carreau_couverture_complete();
  if v_motif is null then
    v_denom_le := public.denominateur_construit_le(case p_decoupage when 'forme' then 'cp' else p_decoupage end);
    if v_denom_le is null then
      v_motif := 'denominateur_' || case p_decoupage when 'forme' then 'cp' else p_decoupage end || '_absent';
    elsif v_denom_le < v_base then  -- C25 : jumeau construit depuis la vue, périmé s'il est plus ancien
      v_motif := 'denominateur_' || case p_decoupage when 'forme' then 'cp' else p_decoupage end || '_perime';
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
    from public.cp_population_totale_e7 cp
    left join (select d.code, d.n_carreaux, d.populations from public.denominateur_menages_min_e7 d
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
      from public.cp_population_totale_e7 cp
      -- A5 : sous un minimum, population et carreaux de la jumelle filtrée.
      left join (select d.code, d.n_carreaux, d.populations from public.denominateur_menages_min_e7 d
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
      from public.unite_population_totale_e7 u
      left join (select d.code, d.n_carreaux, d.populations from public.denominateur_menages_min_e7 d
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
         and not exists (select 1 from public.unite_population_totale_e7 u
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
                                          from public.denominateur_menages_min_e7 dm where dm.maille = 'departement')
                                  else (select round(coalesce(sum((u.populations->>p_cible)::numeric), 0))
                                          from public.unite_population_totale_e7 u where u.maille = 'region') end,
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
            and not exists (select 1 from public.unite_population_totale_e7 u
                             where u.maille = 'departement' and u.code = rd.code_dept)
            and ST_Intersects(coalesce(rd.geom_perimetre, rd.geom), p_retire)))
     else '{}'::jsonb end;
end
$function$
;

CREATE OR REPLACE FUNCTION public.compter_zone_pays(p_zone_id uuid, p_caller_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  select count(*) into v_cp from public.cp_population_totale_e7 cp where public.pays_contient_code(v_pays, cp.code_postal);
  select count(*) into v_iris from public.unite_population_totale_e7 u
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
                join public.cp_population_totale_e7 cp on cp.code_postal = k.code_postal
               where k.n = cp.n_carreaux and public.pays_contient_code(v_pays, cp.code_postal)),
             (select count(*) from (select c.code_iris, count(*) n from c where c.code_iris is not null group by 1) k
                join public.unite_population_totale_e7 u on u.maille = 'iris' and u.code = k.code_iris
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
$function$
;

CREATE OR REPLACE FUNCTION public.codes_postaux_de_zone_jsonb(p_zone uuid, p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
      from public.cp_population_totale_e7 cp
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
$function$
;

CREATE OR REPLACE FUNCTION public.volumes_attendus_cp(p_codes text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
           'volume', 'population_totale',
           'total', coalesce(sum((cp.populations ->> 'ind')::numeric), 0),
           'codes', coalesce(jsonb_object_agg(cp.code_postal, (cp.populations ->> 'ind')::numeric)
                               filter (where cp.code_postal = any (coalesce(p_codes, '{}'::text[]))
                                         and cp.populations ? 'ind'), '{}'::jsonb))
    from public.cp_population_totale_e7 cp
$function$
;

CREATE OR REPLACE FUNCTION public.territoires_non_carroyes(p_geom geometry)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('code', rd.code_dept, 'nom', rd.nom_dept) order by rd.code_dept), '[]'::jsonb)
    from public.ref_departements rd
   where not exists (select 1 from public.unite_population_totale_e7 u
                      where u.maille = 'departement' and u.code = rd.code_dept)
     and ST_Intersects(coalesce(rd.geom_perimetre, rd.geom), p_geom)
$function$
;

