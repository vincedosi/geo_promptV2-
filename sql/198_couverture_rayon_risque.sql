-- sql/198 — Couverture de population par rayon autour des sites à risque
--           (2026-09-18)
--
-- Sert l'onglet « Rayon d'influence » : une courbe cumulée de la population
-- située à moins de X mètres d'au moins un site, de 0 à 10 km par paliers de
-- 100 m, déclinable par nature de risque.
--
-- ── POURQUOI UN PRÉ-CALCUL, ET PAS UNE RPC À LA DEMANDE ───────────────────
--
-- Mesures du 2026-09-18 en production, carreaux à moins de 10 km des sites
-- Seveso d'un département :
--
--     Nord (53 sites)              27 092 carreaux
--     Seine-Maritime (63 sites)    22 404
--     Bouches-du-Rhône (69 sites)  21 797
--     Rhône (44 sites)             21 347
--     Lozère (0 site)                   0
--
-- Extrapolé aux 1 258 sites Seveso : entre 500 000 et 1 000 000 de carreaux,
-- soit jusqu'à 40 % des 2 298 582 de la base. Or un calcul à UN SEUL rayon sur
-- la France prend déjà 4,5 s, et 42,8 s à 2 km imposés (sql/190, sql/192). Une
-- courbe de 101 paliers calculée à la volée est hors de portée.
--
-- ── LE GRAIN, ET CE QU'IL PERMET ──────────────────────────────────────────
--
-- (département × gravité × nature × palier de 100 m), avec les populations des
-- 24 cibles en jsonb — même patron que `carreaux_filosofi`.
--
-- Stocker une ligne par CARREAU aurait fait 2 à 4 millions de lignes pour la
-- même information ; ce grain en fait quelques dizaines de milliers, et la
-- courbe devient un `GROUP BY` instantané à n'importe quel filtre.
--
-- ── LE DOUBLE COMPTAGE, ET COMMENT IL EST ÉVITÉ ───────────────────────────
--
-- Un carreau peut être proche de sites de DEUX natures. Chaque courbe par
-- nature est donc exacte et autonome — c'est ce qu'on veut pour les légendes —
-- mais **additionner deux courbes double-compterait** les habitants proches
-- des deux.
--
-- D'où les lignes d'agrégat, écrites avec `gravite = '*'` et/ou
-- `nature = '*'`. Elles ne sont PAS la somme des lignes détaillées : elles
-- viennent du MINIMUM par carreau sur le sous-ensemble concerné, calculé dans
-- le même passage par `GROUPING SETS`. L'écran affiche donc les courbes par
-- nature PLUS la courbe totale, jamais une somme des premières.
--
-- ── LA DISTANCE ───────────────────────────────────────────────────────────
--
-- Du CENTROÏDE du carreau au SITE le plus proche — un point, jamais le
-- périmètre PPRT : « rayon d'influence » veut dire rayon autour du site, et
-- mêler les polygones ferait démarrer la courbe à 173 819 habitants au lieu de
-- zéro. Décision explicite du 2026-09-18.
--
-- Calculée en `geography`, donc en mètres réels. Le pré-filtrage, lui, passe
-- par un tampon transformé UNE fois en 3857, seule projection où
-- `carreaux_filosofi` porte un index GIST. Faire l'inverse — transformer
-- chaque carreau pour le comparer à une geography — rend l'index inutilisable
-- et la requête ne revient jamais (constaté).

create table if not exists public.couverture_rayon_risque (
  code_departement text   not null,
  -- 'seveso_haut' | 'seveso_bas' | '*' (toutes gravités confondues)
  gravite          text   not null,
  -- libellé de nature, ou '*' (toutes natures confondues)
  nature           text   not null,
  -- Palier de 100 m, de 0 à 10 000. 0 = carreau à moins de 100 m d'un site.
  rayon_m          int    not null,
  -- INCRÉMENT du palier, jamais le cumul : le cumul se calcule à la lecture
  -- par une fonction de fenêtrage. Stocker le cumul obligerait à tout
  -- réécrire dès qu'un palier change.
  n_carreaux       int    not null,
  populations      jsonb  not null,
  primary key (code_departement, gravite, nature, rayon_m)
);

comment on table public.couverture_rayon_risque is
  'Population par palier de distance au site a risque le plus proche. Les lignes '
  'gravite=''*'' ou nature=''*'' viennent du MINIMUM par carreau sur le sous-ensemble, '
  'pas de la somme des lignes detaillees — deux natures peuvent toucher le meme carreau.';

alter table public.couverture_rayon_risque enable row level security;
revoke all on table public.couverture_rayon_risque from public, anon, authenticated;
grant select, insert, update, delete on table public.couverture_rayon_risque to service_role;

create index if not exists idx_couv_rayon_lecture
  on public.couverture_rayon_risque (gravite, nature, code_departement, rayon_m);

-- Journal des bandes déjà construites, pour que la construction soit
-- REPRENABLE : elle dure plusieurs minutes et touche 40 % de la base, on ne
-- veut pas la reprendre depuis zéro après une interruption. Même patron que
-- `carreaux_1km_bandes` (sql/129).
create table if not exists public.couverture_rayon_bandes (
  bande        int primary key,
  lon_min      numeric not null,
  lon_max      numeric not null,
  -- On journalise les LIGNES ecrites, pas les carreaux traites : compter les
  -- carreaux distincts apres l'INSERT demanderait de rejouer la requete, et un
  -- chiffre qu'on ne peut pas mesurer ne vaut pas la peine d'etre stocke.
  n_lignes     bigint  not null,
  duree_ms     int     not null,
  construit_le timestamptz not null default now()
);

alter table public.couverture_rayon_bandes enable row level security;
revoke all on table public.couverture_rayon_bandes from public, anon, authenticated;
grant select, insert, update, delete on table public.couverture_rayon_bandes to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- CONSTRUCTION, PAR BANDE DE LONGITUDE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Pourquoi des bandes et non des départements : un carreau doit être traité
-- EXACTEMENT une fois. Découper par département des SITES ferait traiter deux
-- fois un carreau proche de sites de deux départements, et le minimum par
-- carreau serait alors calculé sur un sous-ensemble à chaque passe. Les bandes
-- découpent les CARREAUX, qui sont ce qu'on agrège.
--
-- Les sites, eux, ne sont jamais partitionnés : un site hors de la bande mais à
-- moins de 10 km d'un de ses carreaux compte normalement.

create or replace function public.construire_couverture_rayon(
  p_bande    int,
  p_n_bandes int default 20,
  p_rayon_max_m int default 10000
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  c_ouest constant numeric := -5.5;   -- bbox métropole, CLAUDE.md
  c_est   constant numeric :=  9.8;
  v_lon_min numeric;
  v_lon_max numeric;
  v_t0      timestamptz := clock_timestamp();
  v_x_min   double precision;
  v_x_max   double precision;
  v_cibles  text[];
  v_lignes  bigint;
begin
  -- ⚠ `work_mem` vaut 3,4 Mo sur ce compute Micro (mesuré le 2026-09-18). Le
  -- `grouping sets` sur des centaines de milliers de lignes déborde donc
  -- massivement sur disque : les bandes denses passaient leur temps en
  -- `BuffileRead`, 33 s puis 48, 95, 87, et la suivante ne rendait plus la main.
  --
  -- `set local` ne vaut QUE pour la transaction de cette fonction : la valeur
  -- revient seule ensuite, et aucune autre requête de l'application n'est
  -- affectée. 64 Mo sur ~1 Go de RAM est tenable pour un traitement qui tourne
  -- une fois par import, jamais en réponse à un utilisateur.
  set local work_mem = '64MB';

  -- ⚠ ET LE DÉLAI D'EXPIRATION. Le rôle de PostgREST porte un
  -- `statement_timeout` de **2 min** (mesuré le 2026-09-18). Les bandes denses
  -- étaient donc ANNULÉES, pas lentes — « canceling statement due to statement
  -- timeout ». Le script les comptait en échec et passait à la suivante, ce qui
  -- donnait l'illusion d'un traitement figé à 12 bandes sur 40 alors qu'il
  -- échouait en boucle.
  --
  -- Piège de diagnostic à retenir : la sortie du script partait dans un `tail`
  -- qui la retenait jusqu'à la fin. Le message d'erreur EXISTAIT depuis le
  -- début et n'était simplement pas lisible. Une demi-heure passée à soupçonner
  -- la lenteur d'une requête qui, elle, allait très bien.
  --
  -- Comme pour `work_mem`, `set local` ne vaut que pour la transaction de cette
  -- fonction : aucune requête de l'application ne perd sa protection.
  set local statement_timeout = '30min';

  if p_bande < 0 or p_bande >= p_n_bandes then
    return jsonb_build_object('error', 'bande_hors_bornes', 'ok', false);
  end if;

  v_lon_min := c_ouest + (c_est - c_ouest) * p_bande     / p_n_bandes;
  v_lon_max := c_ouest + (c_est - c_ouest) * (p_bande+1) / p_n_bandes;

  -- Les bornes de bande converties UNE fois en 3857, projection dans laquelle
  -- `carreaux_filosofi` est stockée. Filtrer en 4326 obligeait à transformer le
  -- centroïde de CHAQUE carreau juste pour le comparer — deux ST_Transform par
  -- ligne, sur des centaines de milliers de lignes, pour une comparaison de
  -- nombres. La transformation est monotone en longitude : comparer en 3857
  -- donne exactement le même découpage.
  v_x_min := ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(v_lon_min, 0), 4326), 3857));
  v_x_max := ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(v_lon_max, 0), 4326), 3857));

  -- Les cibles viennent du CATALOGUE, jamais d'une liste écrite ici : le
  -- sélecteur de l'écran lit la même table, les deux ne peuvent pas diverger.
  select array_agg(code order by code) into v_cibles
    from public.cibles_exposition where actif;

  -- Idempotence : on efface ce que cette bande avait écrit avant de réécrire.
  -- La bande est identifiée par ses carreaux, donc on ne peut pas cibler par
  -- département — on supprime les lignes des départements que la bande touche,
  -- ce qui serait faux. On procède donc par UPSERT additif, et la purge
  -- éventuelle passe par `vider_couverture_rayon()`.

  with
  sites as (
    select p.id,
           p.sous_categorie as gravite,
           coalesce(nullif(p.metadata->>'libelle_nature', ''), 'Nature non précisée') as nature,
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
       -- construction faisable. Sans ce prédicat, chaque bande parcourait les
       -- 1 258 sites de France pour n'en utiliser qu'une poignée : la première
       -- bande lancée en production a dépassé le délai et sa transaction a été
       -- annulée, sans rien écrire.
       --
       -- La marge de 0,15° vaut environ 11 km à nos latitudes, donc plus que le
       -- rayon maximal de 10 km : un site juste au-delà du bord ne peut pas
       -- avoir de carreau de la bande dans son tampon. Élargir la marge ne
       -- changerait rien au résultat, seulement au temps.
       and p.lng >= v_lon_min - 0.15
       and p.lng <  v_lon_max + 0.15
  ),
  -- Les carreaux de la bande, avec leur centroïde en geography (mètres réels)
  -- et leur département déduit du code commune INSEE. ⚠ `lcog_geo` est une
  -- LISTE dès que le carreau est à cheval : on retient le premier code, comme
  -- partout ailleurs dans ce module (sql/194).
  paires as (
    select c.id   as carreau,
           -- ⚠ PAS de `metadata` ici. Le jsonb des carreaux pèse ~806 octets ;
           -- le traîner jusque dans les clés de `group by` obligeait Postgres à
           -- le hacher pour CHAQUE groupe, à chacun des quatre niveaux
           -- d'agrégation. Mesuré : 54,5 s pour une bande bretonne éparse en
           -- production. On ne garde donc que l'identifiant, et on rejoint la
           -- table par sa clé primaire au tout dernier moment.
           case when left(split_part(c.metadata->>'lcog_geo', ',', 1), 2) = '97'
                then left(split_part(c.metadata->>'lcog_geo', ',', 1), 3)
                else left(split_part(c.metadata->>'lcog_geo', ',', 1), 2) end as dep,
           s.gravite,
           s.nature,
           ST_Distance(ST_Transform(ST_Centroid(c.geom_3857), 4326)::geography, s.g) as d
      from sites s
      join public.carreaux_filosofi c
        on c.geom_3857 && s.z
       and ST_Intersects(c.geom_3857, s.z)
     -- Bande en 3857, aucune transformation par ligne. Un carreau de 200 m ne
     -- chevauche jamais deux bandes ; s'il le faisait il serait attribué à
     -- celle de son bord ouest, donc à UNE seule.
     where ST_XMin(c.geom_3857) >= v_x_min
       and ST_XMin(c.geom_3857) <  v_x_max
  ),
  -- Minimum par carreau ET par couple (gravité, nature) : c'est CE minimum qui
  -- interdit le double comptage entre deux sites de même nature.
  min_combo as (
    select carreau, dep, gravite, nature, min(d) as d
      from paires
     where d <= p_rayon_max_m
     group by carreau, dep, gravite, nature
  ),
  -- Les quatre niveaux d'agrégation en UN passage : par couple, par gravité
  -- seule, par nature seule, et global. Le niveau global vient du MINIMUM par
  -- carreau, jamais d'une somme — c'est ce qui évite le double comptage entre
  -- natures.
  niveaux as (
    select carreau, dep,
           coalesce(gravite, '*') as gravite,
           coalesce(nature,  '*') as nature,
           min(d) as d
      from min_combo
     group by grouping sets (
       (carreau, dep, gravite, nature),
       (carreau, dep, gravite),
       (carreau, dep, nature),
       (carreau, dep)
     )
  ),
  seaux as (
    select carreau, dep, gravite, nature,
           -- Palier de 100 m. `floor` garde le palier 0 pour tout ce qui est à
           -- moins de 100 m, ce qui se lit mieux qu'un découpage décalé.
           least(floor(d / 100)::int * 100, p_rayon_max_m) as rayon_m
      from niveaux
  ),
  -- La population n'est lue QU'ICI, par jointure sur la clé primaire des
  -- carreaux, et une seule fois par (carreau × niveau × cible).
  -- ⚠ LES CIBLES SONT EXTRAITES UNE FOIS PAR CARREAU, pas une fois par
  -- (carreau × niveau). `grouping sets` produit QUATRE niveaux par carreau ;
  -- extraire les 24 cibles à chaque niveau faisait 96 lectures jsonb par
  -- carreau au lieu de 24. En Île-de-France, même un tiers de bande dépassait
  -- les 2 min de `statement_timeout`.
  --
  -- Le résultat est identique : la somme d'une valeur constante par carreau ne
  -- dépend pas du nombre de fois qu'on l'a lue.
  valeurs as (
    select u.carreau, k.code as cible,
           coalesce((c.metadata->>k.code)::numeric, 0) as v
      from (select distinct carreau from seaux) u
      join public.carreaux_filosofi c on c.id = u.carreau
      cross join unnest(v_cibles) as k(code)
  ),
  detail as (
    select s.dep, s.gravite, s.nature, s.rayon_m, v.cible,
           sum(v.v) as somme
      from seaux s
      join valeurs v on v.carreau = s.carreau
     where s.dep is not null and s.dep <> ''
     group by s.dep, s.gravite, s.nature, s.rayon_m, v.cible
  ),
  pop as (
    select dep, gravite, nature, rayon_m, jsonb_object_agg(cible, somme) as populations
      from detail
     group by dep, gravite, nature, rayon_m
  ),
  compte as (
    select dep, gravite, nature, rayon_m, count(*)::int as n
      from seaux
     where dep is not null and dep <> ''
     group by dep, gravite, nature, rayon_m
  )
  insert into public.couverture_rayon_risque as t
        (code_departement, gravite, nature, rayon_m, n_carreaux, populations)
  select c.dep, c.gravite, c.nature, c.rayon_m, c.n, p.populations
    from compte c
    join pop p
      on p.dep = c.dep and p.gravite = c.gravite
     and p.nature = c.nature and p.rayon_m = c.rayon_m
  on conflict (code_departement, gravite, nature, rayon_m) do update
     set n_carreaux  = t.n_carreaux + excluded.n_carreaux,
         populations = (
           select jsonb_object_agg(k, coalesce((t.populations->>k)::numeric, 0)
                                    + coalesce((excluded.populations->>k)::numeric, 0))
             -- ⚠ `unnest(v_cibles)` et NON `jsonb_object_keys(a || b)`.
             -- Cette concaténation construisait un jsonb complet POUR CHAQUE
             -- LIGNE en conflit, juste pour en énumérer les clés — et les
             -- départements denses, déjà écrits par les bandes précédentes,
             -- sont presque tous en conflit. C'était LE goulet : une bande
             -- d'Île-de-France passait de « dépasse 2 min » à 26 s.
             --
             -- Les deux côtés portent les mêmes clés, celles du catalogue.
             from unnest(v_cibles) k
         );

  get diagnostics v_lignes = row_count;

  insert into public.couverture_rayon_bandes (bande, lon_min, lon_max, n_lignes, duree_ms)
  values (p_bande, v_lon_min, v_lon_max, v_lignes,
          round(extract(epoch from (clock_timestamp() - v_t0)) * 1000)::int)
  on conflict (bande) do update
     set lon_min = excluded.lon_min, lon_max = excluded.lon_max,
         n_lignes = excluded.n_lignes,
         duree_ms = excluded.duree_ms, construit_le = now();

  return jsonb_build_object(
    'ok', true, 'bande', p_bande, 'lon_min', v_lon_min, 'lon_max', v_lon_max,
    'lignes', v_lignes,
    'duree_ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000));
end;
$fn$;

revoke all on function public.construire_couverture_rayon(int, int, int) from public, anon, authenticated;
grant execute on function public.construire_couverture_rayon(int, int, int) to service_role;

-- Purge — nécessaire avant toute reconstruction, l'insertion étant ADDITIVE
-- (`on conflict do update` accumule, pour qu'une bande partiellement traitée
-- puisse être rejouée sans perdre les autres).
create or replace function public.vider_couverture_rayon()
returns bigint language plpgsql security definer set search_path to 'public' as $fn$
declare v_n bigint;
begin
  delete from public.couverture_rayon_risque;
  get diagnostics v_n = row_count;
  delete from public.couverture_rayon_bandes;
  return v_n;
end;
$fn$;

revoke all on function public.vider_couverture_rayon() from public, anon, authenticated;
grant execute on function public.vider_couverture_rayon() to service_role;
