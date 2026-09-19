-- sql/203 — Distances JOINTES d'un carreau aux sites à risque, par niveau
--           (2026-09-19)
--
-- Sert la règle d'affectation unique (`lib/risques/affectation.ts`) : un
-- carreau INSEE de 200 m, un seul niveau, une seule bande.
--
-- ── POURQUOI sql/198 NE SUFFIT PAS ────────────────────────────────────────
--
-- `couverture_rayon_risque` porte une distribution MARGINALE : une ligne par
-- gravité, chacune exacte pour sa propre question. Elle sait dire « combien
-- d'habitants à tel palier du plus proche Seveso seuil haut », mais **pas**,
-- pour un carreau donné, sa distance au seuil haut ET sa distance au seuil bas
-- en même temps. Or la priorité « haut prime sur bas » a besoin exactement de
-- ce couple.
--
-- Ce n'est pas un cas limite. Mesure APRÈS construction de cette table, le
-- 2026-09-19 : sur **883 451 carreaux** retenus (98 départements, 84 Mo,
-- 415 s de construction), **317 367 sont à portée des DEUX niveaux**, soit
-- 35,9 %. L'écran affichait donc deux nombres dont la somme dépassait le total,
-- sans qu'aucun ne soit faux pris isolément.
--
-- ⚠ L'estimation faite AVANT construction, tirée de `couverture_rayon_risque`,
-- annonçait 914 154 carreaux et 328 071 recouvrements. L'écart vient de ce que
-- cette table-là s'alimente par ACCUMULATION (`on conflict do update` qui
-- additionne) : une bande rejouée y sur-compte. C'est la mesure sur la table
-- jointe qui fait foi — elle, son insertion REMPLACE.
--
-- ── POURQUOI PAS DE POPULATION DANS CETTE TABLE ───────────────────────────
--
-- Le jsonb `metadata` de `carreaux_filosofi` pèse ~806 octets. Le recopier sur
-- 914 000 lignes ferait ~730 Mo pour une information déjà en base. Sans lui, la
-- ligne tient dans une cinquantaine d'octets : ~50 Mo, et la jointure se fait
-- par clé primaire, sur les seuls carreaux concernés — jamais sur les
-- 2,3 millions.
--
-- C'est la même leçon que sql/198, mesurée : traîner `metadata` dans les clés
-- de `group by` avait coûté 54,5 s sur une bande, contre 7,4 s sans.
--
-- ── CE QUI RESTE HORS PÉRIMÈTRE, ET POURQUOI ──────────────────────────────
--
-- Seuls les deux niveaux Seveso sont calculés. Les autres régimes pèsent
-- 97 825 sites sur 99 152 (comptés le 2026-09-19 : autre 43 195,
-- enregistrement 30 441, autorisation 18 512, ied 5 677) contre 1 327 Seveso.
-- `population_exposee_agregee` refuse déjà au-delà de 3 000 sites retenus
-- (sql/190) parce que le coût mesuré est de 2,3 à 4,5 ms par site. La colonne
-- `d_autres_m` existe donc dans le modèle TypeScript mais **pas ici** : une
-- colonne toujours nulle se lit « aucun site à proximité », pas « non calculé ».

create table if not exists public.carreau_risque_distance (
  -- `carreaux_filosofi.id`, un bigint de séquence. PAS de clé étrangère : la
  -- table des carreaux est rechargée en entier depuis le CSV INSEE
  -- (`scripts/local/07-carreaux-insee.sh`) et les id ne survivent pas au
  -- rechargement. Une contrainte ferait échouer ce rechargement sur un ordre
  -- d'exécution, pour une intégrité que `vider_carreau_risque_distance()`
  -- rétablit de toute façon.
  carreau_id       bigint  not null primary key,
  code_departement text    not null,
  -- Code commune INSEE, premier de la liste quand le carreau est à cheval
  -- (`lcog_geo` vaut alors '75103,75104,75111' — relevé sur Paris). Retenir le
  -- premier préserve « un carreau, une unité », donc l'égalité somme = total.
  code_commune     text,
  -- Distance en mètres au site le plus proche de ce niveau, ou NULL au-delà de
  -- 10 km. NULL veut dire « hors du pré-calcul », jamais « inconnu ».
  d_haut_m         int,
  d_bas_m          int,
  -- Niveau du site GÉNÉRATEUR du périmètre PPRT qui couvre ce carreau
  -- ('haut' | 'bas' | NULL). Un niveau et non un booléen : un PPRT est une
  -- servitude générée par un établissement, et c'est le niveau de CET
  -- établissement qui décide dans quelle famille le carreau se range.
  pprt_niveau      text,
  constraint carreau_risque_distance_pprt_niveau_check
    check (pprt_niveau is null or pprt_niveau in ('haut', 'bas')),
  -- Une ligne sans aucune distance et sans PPRT ne dit rien : elle ne doit pas
  -- exister. Sans cette contrainte, une bande mal filtrée pourrait insérer des
  -- centaines de milliers de lignes vides qui gonfleraient la table sans qu'on
  -- le voie.
  constraint carreau_risque_distance_non_vide
    check (d_haut_m is not null or d_bas_m is not null or pprt_niveau is not null)
);

comment on table public.carreau_risque_distance is
  'Distances JOINTES (seuil haut ET seuil bas pour le MEME carreau) au site a risque '
  'le plus proche. Rend la regle d''affectation unique calculable sans geometrie : '
  'couverture_rayon_risque ne porte que les marges, et 35,9 % des carreaux exposes '
  'sont a portee des deux niveaux.';

alter table public.carreau_risque_distance enable row level security;
revoke all on table public.carreau_risque_distance from public, anon, authenticated;
grant select, insert, update, delete on table public.carreau_risque_distance to service_role;

-- L'agrégation se fait toujours PAR TERRITOIRE : c'est l'index qui porte
-- l'onglet Territoires et la ventilation CP de l'onglet Diffusion.
create index if not exists idx_crd_departement
  on public.carreau_risque_distance (code_departement);
create index if not exists idx_crd_commune
  on public.carreau_risque_distance (code_commune)
  where code_commune is not null;

-- Journal des bandes, pour que la construction soit REPRENABLE. Même patron que
-- `couverture_rayon_bandes` (sql/198) et `carreaux_1km_bandes` (sql/129) : elle
-- touche 40 % de la base et on ne veut pas la reprendre depuis zéro.
create table if not exists public.carreau_risque_bandes (
  bande        int primary key,
  lon_min      numeric not null,
  lon_max      numeric not null,
  n_lignes     bigint  not null,
  duree_ms     int     not null,
  construit_le timestamptz not null default now()
);

alter table public.carreau_risque_bandes enable row level security;
revoke all on table public.carreau_risque_bandes from public, anon, authenticated;
grant select, insert, update, delete on table public.carreau_risque_bandes to service_role;

-- ⚠ MATÉRIALISÉE, et c'est une mesure et non une précaution. Écrite d'abord
-- comme une fonction `stable`, elle coûtait **51,9 s** par appel — 664
-- périmètres × une sous-requête corrélée `ST_DWithin` contre `poi_france`. Or
-- la construction l'appelle UNE FOIS PAR BANDE : à 20 bandes, 17 minutes de
-- recalcul rigoureusement identique.
--
-- Le symptôme désignait mal la cause : la bande 0 (l'Atlantique, aucun site)
-- a produit ZÉRO ligne en 42 s, quand la bande 5 en produisait 48 391 en 3,7 s.
-- Un coût qui ne suit pas le volume de sortie est un coût fixe, pas une
-- lenteur de calcul.

create table if not exists public.pprt_niveau_generateur (
  pprt_id   uuid primary key,
  geom_3857 geometry not null,
  -- 'haut' | 'bas' | NULL. NULL veut dire qu'aucun site Seveso ACTIF n'est à
  -- moins de 500 m : le périmètre existe, son générateur a pu cesser son
  -- activité. Mesuré le 2026-09-19 : 532 périmètres sur 664 se rattachent,
  -- 132 non. Ce n'est pas une lacune d'import, c'est un référentiel de
  -- servitudes qui survit à l'exploitant.
  niveau    text,
  constraint pprt_niveau_generateur_check check (niveau is null or niveau in ('haut','bas'))
);

alter table public.pprt_niveau_generateur enable row level security;
revoke all on table public.pprt_niveau_generateur from public, anon, authenticated;
grant select, insert, update, delete on table public.pprt_niveau_generateur to service_role;

create index if not exists idx_pprt_niveau_geom
  on public.pprt_niveau_generateur using gist (geom_3857);

-- ═══════════════════════════════════════════════════════════════════════════
-- LE NIVEAU D'UN PÉRIMÈTRE PPRT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `pprt_perimetres` porte `id_generateur` — l'établissement à l'origine du
-- risque — mais AUCUNE clé vers `poi_france` : les deux flux sont importés
-- séparément (Géoplateforme IGN d'un côté, Géorisques de l'autre) et rien ne
-- les relie. On retombe donc sur la règle de rattachement déjà établie par
-- sql/179 : le site à risque le plus proche à moins de 500 m.
--
-- ⚠ 500 m et non l'inclusion stricte, pour la raison mesurée dans sql/179 : les
-- coordonnées AIOT pointent parfois l'entrée du site ou le centroïde communal,
-- et l'inclusion stricte perdait 71 Seveso seuil haut dont le PPRT est à 200 m.
--
-- ⚠ `ST_DWithin` en `geography` EXIGE `idx_pprt_geog` (GIST sur
-- `geom::geography`, sql/179). Sans lui : Seq Scan des 664 polygones par site,
-- 118 340 ms mesurées contre 164 ms.

create or replace function public.remplir_pprt_niveau_generateur()
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare v_n int; v_rattaches int;
begin
  set local statement_timeout = '10min';
  truncate public.pprt_niveau_generateur;
  insert into public.pprt_niveau_generateur (pprt_id, geom_3857, niveau)
  select pp.id, pp.geom_3857,
         -- Le plus proche décide, et le seuil haut l'emporte à distance égale :
         -- un périmètre entre deux sites est rattaché au plus grave, ce qui est
         -- le bon sens de l'erreur pour une servitude de prévention.
         (select case when p.sous_categorie = 'seveso_haut' then 'haut' else 'bas' end
            from public.poi_france p
           where p.categorie = 'risque_industriel'
             and p.sous_categorie in ('seveso_haut', 'seveso_bas')
             and coalesce(p.metadata->>'etat_activite', '') is distinct from 'En fin d''exploitation'
             and p.lng is not null and p.lat is not null
             and ST_DWithin(
                   ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
                   pp.geom::geography, 500)
           order by (p.sous_categorie = 'seveso_bas'),
                    ST_Distance(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
                                pp.geom::geography)
           limit 1)
    from public.pprt_perimetres pp;

  get diagnostics v_n = row_count;
  select count(*) into v_rattaches from public.pprt_niveau_generateur where niveau is not null;
  return jsonb_build_object('ok', true, 'perimetres', v_n, 'rattaches', v_rattaches);
end;
$fn$;

comment on function public.remplir_pprt_niveau_generateur is
  'Remplit pprt_niveau_generateur : le niveau (haut/bas) du site generateur de chaque '
  'perimetre PPRT, par rattachement au site le plus proche a 500 m — MEME regle que '
  'sql/179. A rejouer apres tout import de sites ou de perimetres.';

revoke all on function public.remplir_pprt_niveau_generateur() from public, anon, authenticated;
grant execute on function public.remplir_pprt_niveau_generateur() to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- CONSTRUCTION, PAR BANDE DE LONGITUDE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Pourquoi des bandes et non des départements : un carreau doit être traité
-- EXACTEMENT une fois. Découper par département des SITES ferait traiter deux
-- fois un carreau proche de sites de deux départements. Les bandes découpent
-- les CARREAUX, qui sont ce qu'on agrège. Raisonnement identique à sql/198.
--
-- Les bornes sont paramétrables (leçon de sql/200) : elles valaient la bbox
-- métropole en dur, et 1 698 sites ICPE dont 45 Seveso tombent hors de cet
-- intervalle. Ils n'apparaissaient sur aucune courbe, et rien ne le disait.

create or replace function public.construire_carreau_risque_distance(
  p_bande       int,
  p_n_bandes    int default 20,
  p_rayon_max_m int default 10000,
  p_lon_ouest   numeric default -5.5,
  p_lon_est     numeric default 9.8,
  p_bande_id    int default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_lon_min numeric;
  v_lon_max numeric;
  v_t0      timestamptz := clock_timestamp();
  v_x_min   double precision;
  v_x_max   double precision;
  v_lignes  bigint;
  v_id      int;
begin
  -- ⚠ `work_mem` vaut 3,4 Mo sur ce palier. Le `group by` sur des centaines de
  -- milliers de lignes déborde massivement sur disque : mesuré sur sql/198, les
  -- bandes denses passaient leur temps en `BuffileRead`. `set local` ne vaut que
  -- pour la transaction de cette fonction.
  set local work_mem = '64MB';
  -- ⚠ Et le délai. Le rôle de PostgREST porte 8 s en local, 2 min en prod ; les
  -- bandes denses seraient ANNULÉES, pas lentes — « canceling statement due to
  -- statement timeout », que le script compterait en échec.
  set local statement_timeout = '30min';

  if p_bande < 0 or p_bande >= p_n_bandes then
    return jsonb_build_object('error', 'bande_hors_bornes', 'ok', false);
  end if;

  v_lon_min := p_lon_ouest + (p_lon_est - p_lon_ouest) * p_bande     / p_n_bandes;
  v_lon_max := p_lon_ouest + (p_lon_est - p_lon_ouest) * (p_bande+1) / p_n_bandes;
  v_id      := coalesce(p_bande_id, p_bande);

  -- Les bornes converties UNE fois en 3857, projection dans laquelle
  -- `carreaux_filosofi` est stockée et indexée. Filtrer en 4326 obligerait à
  -- transformer le centroïde de CHAQUE carreau pour comparer deux nombres. La
  -- transformation étant monotone en longitude, le découpage est identique.
  v_x_min := ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(v_lon_min, 0), 4326), 3857));
  v_x_max := ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(v_lon_max, 0), 4326), 3857));

  with
  sites as (
    select p.sous_categorie as gravite,
           ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography as g,
           ST_Transform(
             ST_Buffer(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
                       p_rayon_max_m, 'quad_segs=4')::geometry, 3857) as z
      from public.poi_france p
     where p.categorie = 'risque_industriel'
       and p.sous_categorie in ('seveso_haut', 'seveso_bas')
       and coalesce(p.metadata->>'etat_activite', '') is distinct from 'En fin d''exploitation'
       and p.lng is not null and p.lat is not null
       -- ⚠ LES SITES AUSSI SONT FILTRÉS PAR LA BANDE, et c'est ce qui rend la
       -- construction faisable : sans ce prédicat, chaque bande parcourt les
       -- 1 259 sites de France pour n'en utiliser qu'une poignée (sql/198, où
       -- la première bande lancée a dépassé le délai sans rien écrire).
       -- La marge de 0,15° vaut ~11 km à nos latitudes, donc plus que le rayon
       -- maximal : un site au-delà ne peut avoir aucun carreau de la bande.
       and p.lng >= v_lon_min - 0.15
       and p.lng <  v_lon_max + 0.15
  ),
  -- Distance minimale par carreau ET par gravité. C'est ici que naît la forme
  -- JOINTE : le `group by` porte sur le carreau, pas seulement sur la gravité.
  distances as (
    select c.id as carreau,
           s.gravite,
           min(ST_Distance(ST_Transform(ST_Centroid(c.geom_3857), 4326)::geography, s.g)) as d
      from sites s
      join public.carreaux_filosofi c
        on c.geom_3857 && s.z
       and ST_Intersects(c.geom_3857, s.z)
     where ST_X(ST_Centroid(c.geom_3857)) >= v_x_min
       and ST_X(ST_Centroid(c.geom_3857)) <  v_x_max
     group by c.id, s.gravite
  ),
  jointes as (
    select carreau,
           min(d) filter (where gravite = 'seveso_haut') as d_haut,
           min(d) filter (where gravite = 'seveso_bas')  as d_bas
      from distances
     group by carreau
  ),
  -- Les carreaux de la bande couverts par un périmètre PPRT, avec le niveau de
  -- son générateur. Le seuil haut l'emporte quand deux périmètres se recouvrent.
  couverts as (
    select c.id as carreau,
           min(case when pn.niveau = 'haut' then 1 else 2 end) as rang
      from public.pprt_niveau_generateur pn
      join public.carreaux_filosofi c
        on c.geom_3857 && pn.geom_3857
       and ST_Intersects(c.geom_3857, pn.geom_3857)
     where pn.niveau is not null
       and ST_X(ST_Centroid(c.geom_3857)) >= v_x_min
       and ST_X(ST_Centroid(c.geom_3857)) <  v_x_max
     group by c.id
  ),
  -- `full join` et non `left` : un carreau peut être DANS un périmètre PPRT
  -- tout en étant à plus de 10 km du site générateur — les plus grandes
  -- servitudes mesurées atteignent 12,3 km de rayon équivalent (sql/185). Le
  -- perdre effacerait de la carte une zone opposable.
  assemble as (
    select coalesce(j.carreau, cv.carreau) as carreau,
           j.d_haut, j.d_bas,
           case cv.rang when 1 then 'haut' when 2 then 'bas' else null end as pprt_niveau
      from jointes j
      full join couverts cv on cv.carreau = j.carreau
  )
  insert into public.carreau_risque_distance
    (carreau_id, code_departement, code_commune, d_haut_m, d_bas_m, pprt_niveau)
  select a.carreau,
         -- ⚠ `lcog_geo` est une LISTE dès que le carreau est à cheval. On retient
         -- le PREMIER code, comme partout ailleurs dans ce module (sql/194).
         -- Les DROM sont en trois chiffres.
         case when left(split_part(c.metadata->>'lcog_geo', ',', 1), 2) = '97'
              then left(split_part(c.metadata->>'lcog_geo', ',', 1), 3)
              else left(split_part(c.metadata->>'lcog_geo', ',', 1), 2) end,
         nullif(split_part(c.metadata->>'lcog_geo', ',', 1), ''),
         round(a.d_haut)::int,
         round(a.d_bas)::int,
         a.pprt_niveau
    from assemble a
    join public.carreaux_filosofi c on c.id = a.carreau
   where coalesce(nullif(left(split_part(c.metadata->>'lcog_geo', ',', 1), 2), ''), '') <> ''
  on conflict (carreau_id) do update
     set code_departement = excluded.code_departement,
         code_commune     = excluded.code_commune,
         d_haut_m         = excluded.d_haut_m,
         d_bas_m          = excluded.d_bas_m,
         pprt_niveau      = excluded.pprt_niveau;

  get diagnostics v_lignes = row_count;

  insert into public.carreau_risque_bandes (bande, lon_min, lon_max, n_lignes, duree_ms)
  values (v_id, v_lon_min, v_lon_max, v_lignes,
          extract(milliseconds from clock_timestamp() - v_t0)::int)
  on conflict (bande) do update
     set lon_min = excluded.lon_min, lon_max = excluded.lon_max,
         n_lignes = excluded.n_lignes, duree_ms = excluded.duree_ms,
         construit_le = now();

  return jsonb_build_object(
    'ok', true, 'bande', v_id, 'lon_min', v_lon_min, 'lon_max', v_lon_max,
    'lignes', v_lignes,
    'duree_ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end;
$fn$;

comment on function public.construire_carreau_risque_distance is
  'Construit UNE bande de longitude de carreau_risque_distance. Les bandes decoupent '
  'les CARREAUX et jamais les sites : un carreau doit etre traite exactement une fois, '
  'sinon son minimum serait calcule sur un sous-ensemble a chaque passe.';

revoke all on function public.construire_carreau_risque_distance(int, int, int, numeric, numeric, int)
  from public, anon, authenticated;
grant execute on function public.construire_carreau_risque_distance(int, int, int, numeric, numeric, int)
  to service_role;

create or replace function public.vider_carreau_risque_distance()
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_n bigint;
begin
  select count(*) into v_n from public.carreau_risque_distance;
  truncate public.carreau_risque_distance;
  delete from public.carreau_risque_bandes;
  -- `pprt_niveau_generateur` n'est PAS vidée : elle ne dépend pas des carreaux,
  -- seulement des sites et des périmètres. La vider imposerait 52 s de recalcul
  -- avant la première bande, pour une donnée inchangée.
  return jsonb_build_object('ok', true, 'supprimees', v_n);
end;
$$;

comment on function public.vider_carreau_risque_distance is
  'Vidange complete, a rejouer apres un rechargement de carreaux_filosofi : les id '
  'sont des bigint de sequence et ne survivent pas au rechargement.';

revoke all on function public.vider_carreau_risque_distance() from public, anon, authenticated;
grant execute on function public.vider_carreau_risque_distance() to service_role;
