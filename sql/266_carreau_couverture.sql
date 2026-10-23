-- sql/266 — `carreau_couverture` : une ligne ÉTROITE par carreau Filosofi, pour chiffrer n'importe quelle zone
-- (lot 4, T3, arbitrage A-1).
--
-- POURQUOI. Chiffrer une zone, c'est sommer les effectifs des carreaux dont le centroïde tombe dedans, puis — pour le
-- découpage « par CP » ou « par IRIS » — rattacher chaque carreau à son territoire. Calculé directement sur
-- `carreaux_filosofi` (3 195 Mo : les 24 effectifs sont dans `metadata` jsonb, ≈ 800 octets par ligne), chaque
-- centroïde détoaste un contour de CP ou d'IRIS : mesuré le 22/10 (plan du lot 4, mesures A), Auvergne-Rhône-Alpes
-- par IRIS coûte 26,9 s et 4,6 M accès, par CP 14,7 s et 2,8 M. Sur une table étroite pré-calculée (prototype,
-- mesures B) : forme 0,83 s · 316 426 accès, IRIS 1,29 s · ≈ 347 000 ; Bouches-du-Rhône par CP 115 ms · ≈ 39 000.
-- C'est la « table pré-agrégée » que la spec recommandait pour ouvrir la région (Q-G). Patron : `carreau_risque_distance`
-- (sql/203, 229), qui a fait passer la conversion zones → CP de 11,2 s à 0,9 s en ne lisant plus le jsonb.
--
-- UNE SEULE RÈGLE D'ATTRIBUTION, CELLE DES DÉNOMINATEURS. Un numérateur et son dénominateur doivent rattacher le
-- carreau au MÊME territoire (leçon sql/207/221), sans quoi une part dépasse 100 % ou n'atteint jamais 100 % :
--   - centroïde `ST_Centroid(geom_3857)` ;
--   - code postal par `cp_des_points` (sql/228), code CANONIQUE — la règle de `cp_population_totale` ;
--   - commune = premier code de `lcog_geo`, département dérivé comme `construire_unite_population_totale` (sql/221 :
--     deux caractères, trois pour `97x`/`98x`, Corse `2A`/`2B` comprise) — la règle de `unite_population_totale` ;
--   - IRIS par `ST_Contains(iris.geom, centroïde 4326)`, départagé par le PLUS PETIT code si deux IRIS se recouvrent
--     (déterministe) — le dénominateur IRIS sera construit DEPUIS cette table (T4, sql/267).
-- `tests/integration/carreau-couverture.test.ts` prouve l'égalité CP par CP, commune par commune, département par
-- département.
--
-- ⚠ PAS DE REPLI. Une lecture qui trouve cette table vide REFUSE (`couverture_non_construite`, T5) au lieu de relire
-- `carreaux_filosofi` : deux chemins pour la même donnée divergent (sql/229). La construire est l'affaire de
-- `scripts/construire_carreau_couverture.mjs` (par bandes, par psql) et de `scripts/local/11-reconstruire.sh`.
--
-- ⚠ L'ORDRE DES 24 EFFECTIFS est `cibles_exposition.rang_pop` (A-2), LU en base, jamais supposé : `pops[rang]` est
-- l'effectif de la cible de ce rang. La fonction refuse de construire si les rangs ne sont pas 1..n sans trou.
--
-- ⚠ INSERTION TRIÉE, PAS DE `CLUSTER`. Chaque bande insère ses carreaux dans l'ordre de leur geohash : une zone lue
-- par l'index GIST tombe ainsi sur des pages voisines, ce qui compte à froid sur le compute Micro (`shared_buffers`
-- 256 Mo pour une table de plusieurs centaines de Mo). Un `CLUSTER` réécrirait toute la table sous verrou exclusif,
-- sur une base locale PARTAGÉE avec d'autres agents (relecture du plan, R-8).
--
-- REJOUABLE : `create … if not exists`, `create or replace`, aucun `drop`. La construction elle-même est reprenable :
-- une bande rejouée REMPLACE ses lignes (la clé est le carreau), elle n'accumule pas.

create table if not exists public.carreau_couverture (
  carreau_id       bigint primary key,
  centroide_3857   geometry(Point, 3857) not null,
  -- Code postal CANONIQUE (`cp_groupe`), NULL quand aucun contour ne contient le centroïde (littoral, ≈ 0,17 %).
  code_postal      text,
  -- NULL quand aucun IRIS ne contient le centroïde : le carreau reste compté dans la forme, en « hors IRIS ».
  code_iris        text,
  code_commune     text,
  code_departement text,
  -- Les 24 effectifs, dans l'ordre de `cibles_exposition.rang_pop`. Une cible absente du jsonb vaut 0 (sql/229).
  pops             real[] not null
);

comment on table public.carreau_couverture is
  'Une ligne etroite par carreau Filosofi (2 324 577) : centroide 3857, code postal canonique, IRIS, commune, '
  'departement, 24 effectifs (ordre rang_pop). Meme regle d''attribution que cp_population_totale et '
  'unite_population_totale. Construite par bandes (construire_carreau_couverture), jamais de repli sur '
  'carreaux_filosofi. sql/266 (lot 4, T3).';

-- Le journal des bandes. `construit_le` est la DATE DE LA BASE pour le cache de la couverture (T6, R-2) : reconstruire
-- une bande périme tout chiffrage antérieur sans avoir à vider le cache.
create table if not exists public.carreau_couverture_bandes (
  bande        int primary key,
  lon_min      numeric not null,
  lon_max      numeric not null,
  n_carreaux   bigint not null,
  duree_ms     int not null,
  construit_le timestamptz not null default now()
);

comment on table public.carreau_couverture_bandes is
  'Journal de construction de carreau_couverture, une ligne par bande de longitude (cles >= 1000 : zones lointaines). '
  'max(construit_le) date la base pour le cache de couverture. A exclure de la sauvegarde AVEC la table. sql/266.';

-- Index. GIST pour « les carreaux de cette zone » (T5) ; btree pour la couverture par rayon d'un département lu par
-- code (T11, A-11). Pas d'index par commune, CP ou IRIS : 2, 10 et 12 parcours en tout (les tests), 65 Mo (relecture
-- finale du lot 4) — le découpage regroupe les carreaux d'une zone déjà lus par le GIST.
create index if not exists idx_carreau_couverture_centroide on public.carreau_couverture using gist (centroide_3857);
create index if not exists idx_carreau_couverture_departement on public.carreau_couverture (code_departement);

-- Droits : lue par des RPC `security definer` / `service_role`, jamais par un client.
alter table public.carreau_couverture enable row level security;
alter table public.carreau_couverture_bandes enable row level security;
revoke all on table public.carreau_couverture from public, anon, authenticated, service_role;
revoke all on table public.carreau_couverture_bandes from public, anon, authenticated, service_role;
grant select on table public.carreau_couverture to service_role;
grant select on table public.carreau_couverture_bandes to service_role;


create or replace function public.construire_carreau_couverture(
  p_bande     int,
  p_n_bandes  int default 24,
  -- Bornes de la métropole (bbox de CLAUDE.md). Les zones lointaines (Martinique, La Réunion — les seules que le
  -- carroyage Filosofi 2021 publie) passent par des appels séparés, une bande chacune, sous des clés >= 1000
  -- (`p_bande_id`) : un découpage uniforme de -61,6 à 56,0 mettrait toute la métropole dans une ou deux bandes.
  p_lon_ouest numeric default -5.5,
  p_lon_est   numeric default 9.8,
  p_bande_id  int default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_t0       timestamptz := clock_timestamp();
  v_id       int;
  v_lon_min  numeric;
  v_lon_max  numeric;
  v_x_min    double precision;
  v_x_max    double precision;
  v_codes    text[];
  v_n_rangs  int;
  v_max_rang int;
  v_n        bigint;
  v_sans_cp  bigint;
  v_sans_iri bigint;
begin
  -- Une construction, pas une lecture d'écran. Appelée par psql dans le conteneur (jamais par PostgREST, que Kong
  -- coupe à 60 s) : le délai de la session n'est pas armé à 8 s comme celui d'`authenticator`.
  set local statement_timeout = '30min';
  set local work_mem = '64MB';

  if p_n_bandes < 1 or p_bande < 0 or p_bande >= p_n_bandes then
    return jsonb_build_object('ok', false, 'error', 'bande_hors_bornes');
  end if;

  -- ⚠ L'ORDRE VIENT DE `rang_pop` (A-2). Un trou dans les rangs décalerait `pops[rang]` en silence : on refuse.
  select array_agg(code order by rang_pop), count(*), max(rang_pop)
    into v_codes, v_n_rangs, v_max_rang
    from public.cibles_exposition where rang_pop is not null;
  if v_codes is null or v_max_rang <> v_n_rangs or (select min(rang_pop) from public.cibles_exposition) <> 1 then
    return jsonb_build_object('ok', false, 'error', 'rangs_non_contigus');
  end if;

  v_id      := coalesce(p_bande_id, p_bande);
  v_lon_min := p_lon_ouest + (p_lon_est - p_lon_ouest) * p_bande       / p_n_bandes;
  v_lon_max := p_lon_ouest + (p_lon_est - p_lon_ouest) * (p_bande + 1) / p_n_bandes;
  -- Comparer des X en 3857 plutôt que transformer chaque centroïde : la projection est monotone en longitude, le
  -- découpage est identique (sql/203).
  v_x_min := ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(v_lon_min, 0), 4326), 3857));
  v_x_max := ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(v_lon_max, 0), 4326), 3857));

  -- ⚠ `as materialized` : la CTE est lue trois fois (les deux tableaux de `cp_des_points`, puis la jointure finale).
  -- Inlinée, la bande serait relue et ses centroïdes recalculés trois fois.
  --
  -- La bande est sélectionnée par l'index GIST de `geom_3857` (`&&` contre une tranche de toute la hauteur) puis
  -- affinée par le centroïde : `remplir_cp_population_totale` (sql/228) balayait toute la table à chaque bande — 24 fois
  -- 3,2 Go ici. Un carreau appartient à UNE bande, celle de son centroïde, intervalle fermé à gauche, ouvert à droite.
  with carreaux as materialized (
    select c.id,
           ST_Centroid(c.geom_3857) as ctr,
           ST_Transform(ST_Centroid(c.geom_3857), 4326) as p,
           nullif(split_part(c.metadata->>'lcog_geo', ',', 1), '') as commune,
           (select array_agg(coalesce((c.metadata->>t.code)::real, 0::real) order by t.ord)
              from unnest(v_codes) with ordinality as t(code, ord)) as pops
      from public.carreaux_filosofi c
     where c.geom_3857 && ST_MakeEnvelope(v_x_min, -20048966.1, v_x_max, 20048966.1, 3857)
       and ST_X(ST_Centroid(c.geom_3857)) >= v_x_min
       and ST_X(ST_Centroid(c.geom_3857)) <  v_x_max
  ),
  -- LA règle carreau → CP, sous sa forme ENSEMBLISTE (un appel par bande, jamais par carreau : 33 min contre quelques
  -- minutes, sql/228). Elle rend le code canonique.
  resolu as (
    select * from public.cp_des_points(
      (select array_agg(id) from carreaux),
      (select array_agg(p) from carreaux))
  )
  insert into public.carreau_couverture
         (carreau_id, centroide_3857, code_postal, code_iris, code_commune, code_departement, pops)
  select x.id, x.ctr, r.code_postal, i.code_iris, x.commune,
         case when left(x.commune, 2) in ('97', '98') then left(x.commune, 3) else left(x.commune, 2) end,
         x.pops
    from carreaux x
    left join resolu r on r.id = x.id
    left join lateral (
      select ir.code_iris from public.iris ir
       where ir.geom && x.p and ST_Contains(ir.geom, x.p)
       order by ir.code_iris
       limit 1) i on true
   -- Insertion TRIÉE spatialement (voir l'en-tête) : à la place d'un `CLUSTER`.
   order by ST_GeoHash(x.p, 6), x.id
  on conflict (carreau_id) do update
     set centroide_3857   = excluded.centroide_3857,
         code_postal      = excluded.code_postal,
         code_iris        = excluded.code_iris,
         code_commune     = excluded.code_commune,
         code_departement = excluded.code_departement,
         pops             = excluded.pops;

  get diagnostics v_n = row_count;

  insert into public.carreau_couverture_bandes (bande, lon_min, lon_max, n_carreaux, duree_ms)
  values (v_id, v_lon_min, v_lon_max, v_n, extract(milliseconds from clock_timestamp() - v_t0)::int)
  on conflict (bande) do update
     set lon_min = excluded.lon_min, lon_max = excluded.lon_max,
         n_carreaux = excluded.n_carreaux, duree_ms = excluded.duree_ms,
         construit_le = now();

  -- Les compteurs de la bande, pour la ligne de progression du script : lus par l'index GIST du centroïde sur la seule
  -- tranche de la bande, pas sur toute la table.
  select count(*) filter (where code_postal is null), count(*) filter (where code_iris is null)
    into v_sans_cp, v_sans_iri
    from public.carreau_couverture cc
   where cc.centroide_3857 && ST_MakeEnvelope(v_x_min, -20048966.1, v_x_max, 20048966.1, 3857)
     and ST_X(cc.centroide_3857) >= v_x_min and ST_X(cc.centroide_3857) < v_x_max;

  return jsonb_build_object(
    'ok', true, 'bande', v_id, 'lon_min', v_lon_min, 'lon_max', v_lon_max,
    'carreaux', v_n, 'sans_cp', v_sans_cp, 'sans_iris', v_sans_iri,
    'duree_ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end;
$fn$;

comment on function public.construire_carreau_couverture(int, int, numeric, numeric, int) is
  'Construit UNE bande de longitude de carreau_couverture (une transaction) et la journalise dans '
  'carreau_couverture_bandes. Rejouer une bande remplace ses lignes. Appelee par '
  'scripts/construire_carreau_couverture.mjs via psql, jamais par PostgREST. sql/266.';

revoke all on function public.construire_carreau_couverture(int, int, numeric, numeric, int) from public, anon, authenticated;
grant execute on function public.construire_carreau_couverture(int, int, numeric, numeric, int) to service_role;


create or replace function public.vider_carreau_couverture()
returns bigint
language plpgsql security definer set search_path to 'public' as $fn$
declare v_n bigint;
begin
  select count(*) into v_n from public.carreau_couverture;
  -- La table ET son journal, ensemble : un journal qui survit à sa table ferait sauter toutes les bandes au prochain
  -- lancement, et la table resterait vide (leçon du 22/09, 11-reconstruire.sh). Et le certificat (sql/268) : une table
  -- vidée n'est plus certifiée.
  truncate public.carreau_couverture;
  delete from public.carreau_couverture_bandes;
  delete from public.carreau_couverture_controle;
  return v_n;
end;
$fn$;

comment on function public.vider_carreau_couverture() is
  'Vide carreau_couverture, son journal de bandes ET son certificat (prealable de --tout). Rend le nombre de lignes '
  'effacees. sql/266, sql/268.';

revoke all on function public.vider_carreau_couverture() from public, anon, authenticated;
grant execute on function public.vider_carreau_couverture() to service_role;
