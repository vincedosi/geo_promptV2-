-- sql/276 — `paver_cercles` : une zone pavée en cercles, cellules retenues au seuil, perte EXACTE sur l'union des
-- cercles retenus — la maille « cercle » de Meta et de DV360 (lot 5, T4 ; spec carte-en-parcours § 16.2, plan A-8).
--
-- L'ALGORITHME (prototype M5 du plan, grille passée du carré à l'HEXAGONE : densité de recouvrement 1,209 contre
-- 1,571, ≈ 23 % de cercles en moins à rayon égal). Un cercle = le cercle CIRCONSCRIT à sa cellule hexagonale.
--   1. carreaux de la zone (`carreaux_de_forme_points`, la règle « carreaux d'une forme ») et leur cellule ;
--   2. cellules candidates (au plus `p_max_candidates`), population EN ZONE et population TOTALE de chacune — les
--      carreaux de la cellule lus par l'index (`&&` sur l'enveloppe de l'hexagone) puis la MÊME cellule (l'hexagone,
--      l'arrondi cubique tranchant les bords) : un carreau appartient à une seule cellule, part ≤ 100 % ;
--   3. cellules retenues : part (arrondie au dixième, celle qu'on affiche) ≥ seuil ET population totale ≥ p_pop_min ;
--      refus `trop_de_cercles` ICI, avant la perte, qui n'est pas nécessaire pour refuser ;
--   4. carreaux de l'UNION des cercles retenus, lus par l'index autour de chaque centre (`&& ST_Expand` puis distance
--      GÉODÉSIQUE, `distinct on`) ;
--   5. perte, en UN passage `full join` zone × union (une jointure complète ne peut être ni une boucle imbriquée ni un
--      `exists` sur une CTE) : couverte, manques, hors zone, achetée.
--   ⚠ PIÈGE MESURÉ (M5) : `exists (select … from <cte> where ST_DWithin(…))` — une CTE n'a pas d'index, chaque carreau
--   balaie toute la CTE : 11,5 s sur 5 000 km², 445 s sur 13 000 km². Ne jamais l'écrire.
--
-- L'ÉCHELLE DE LA GRILLE (écart à A-8, assumé). A-8 prenait `1/cos(lat)` du CENTROÏDE de la zone. Mais l'échelle de
-- 3857 varie avec la latitude : au sud du centroïde, une cellule déborde son cercle (mesuré sur la CIRFA à 5 km : un
-- carreau à 5 030 m de son centre, 7 au-delà de 5 km ; davantage sur une zone plus étendue en latitude), et une zone
-- qui porte des DROM (la composite de M5 a des carreaux en Martinique et à La Réunion) aurait des cellules de 1,34 r à
-- La Réunion. Ici : UNE grille par territoire (métropole, chaque DROM : `territoire_grille`), de
-- pas `r / échelle` où l'échelle est MESURÉE (distance géodésique, `echelle_sol_3857`) sur le carreau du territoire le
-- plus proche de l'équateur, reculé d'un rayon (le centre d'une cellule de bord peut sortir de la zone). L'échelle
-- décroît vers le pôle : tout carreau d'une cellule retenue est alors à ≤ r de son centre — garanti, et testé. Coût :
-- des cellules un peu plus petites au nord d'une zone étendue (ARA, 2,7° de latitude : ≈ 3 % de rayon).
--
-- Bornes de SÉCURITÉ seulement : zone ≤ 100 000 km², rayon ∈ [1 000, 80 000] m (22023 sinon), au plus 5 000
-- candidates. Les limites d'une PLATEFORME (200 cercles Meta, rayon 1-80 km…) ne sont pas lues ici : la route les lit
-- dans `plateformes_geo` et les passe (`p_max_cercles`, `p_pop_min`).
--
-- LA RÈGLE « CARREAUX D'UNE FORME » porte désormais la position du carreau : `carreaux_de_forme_points` est le corps,
-- `carreaux_de_forme_codes` (sql/275) et `carreaux_de_forme` (sql/269) en deviennent des enveloppes, mêmes signatures,
-- mêmes types de retour (`create or replace`, aucun DROP). Relire la position par la clé primaire coûtait
-- 190 000 accès sur la CIRFA (mesuré) contre 6 600 pour le parcours lui-même. Les trois restent inlinées.
--
-- Mesuré le 24/10 (EXPLAIN (ANALYZE, BUFFERS) de l'appel, base locale, 2e passe ; « accès » = hit + read ; M5 = la
-- grille carrée du prototype, même zone) :
--   CIRFA Bretagne 5 000 km²  5 km   114 cercles, utile 89,7 %   0,29-0,30 s · 25 600   (M5 141 · 88,0 % · 0,24 s · 25 400)
--                             10 km   35 cercles, utile 82,5 %   0,31-0,33 s · 26 480   (M5  44 · 80,8 % · 0,27 s · 25 900)
--   composite 13 000 km²      5 km   438 cercles, utile 47,0 %   1,24-1,27 s · 115 300  (M5 481 · 45,9 % · 0,96 s · 108 300)
--                             10 km  152 cercles, utile 41,5 %   1,52 s · 133 600       (M5 167 · 40,5 % · 1,06 s · 120 000)
--   région ARA 70 800 km²     10 km  309 cercles, utile 97,8 %   1,65-1,66 s · 117 500  (arrêt du plan : 2 s / 400 000)
--                              1 km  refus trop_de_candidates     0,84 s · 29 000
-- Droits : service_role. Rejouable (`create or replace`, aucun `drop`).

-- ── La règle « carreaux d'une forme » : LE corps, avec la position du carreau ──────────────────────────────────────────
-- Règle et commentaires de sql/269 inchangés : `ST_Intersects` + `distinct on` (un centroïde sur la couture de deux
-- morceaux de `ST_Subdivide` compté une fois), l'effectif d'UNE cible, corps entièrement qualifié, pas de search_path
-- (une fonction SQL qui en pose un n'est plus inlinée).
create or replace function public.carreaux_de_forme_points(p_geom geometry, p_rang integer)
returns table (carreau_id bigint, pop numeric, centroide_3857 geometry, code_postal text, code_iris text,
               code_commune text, code_departement text)
language sql
stable
as $fn$
  select distinct on (cc.carreau_id) cc.carreau_id, cc.pops[p_rang]::numeric, cc.centroide_3857, cc.code_postal,
         cc.code_iris, cc.code_commune, cc.code_departement
    from (select public.ST_Subdivide(public.ST_Transform(p_geom, 3857), 256) as sg) z
    join public.carreau_couverture cc on cc.centroide_3857 operator(public.&&) z.sg and public.ST_Intersects(cc.centroide_3857, z.sg)
   order by cc.carreau_id
$fn$;

revoke all on function public.carreaux_de_forme_points(geometry, integer) from public, anon, authenticated;
grant execute on function public.carreaux_de_forme_points(geometry, integer) to service_role;

-- sql/275 devient une enveloppe : même signature, même type de retour.
create or replace function public.carreaux_de_forme_codes(p_geom geometry, p_rang integer)
returns table (carreau_id bigint, pop numeric, code_postal text, code_iris text, code_commune text, code_departement text)
language sql
stable
as $fn$
  select f.carreau_id, f.pop, f.code_postal, f.code_iris, f.code_commune, f.code_departement
    from public.carreaux_de_forme_points(p_geom, p_rang) f
$fn$;

-- ── La cellule hexagonale d'un point, et son centre ───────────────────────────────────────────────────────────────────
-- Hexagones « pointe en haut », origine (0, 0), `p_pas` = rayon du cercle circonscrit (centre → sommet). Coordonnées
-- axiales (q, r), arrondi CUBIQUE (on arrondit les trois coordonnées et on recalcule celle dont l'arrondi a le plus
-- bougé : c'est ce qui rend la cellule la plus proche, l'arrondi de q et r seuls se trompe près des sommets).
-- Le centre est une fonction à part : grouper par (q, r) puis calculer le centre UNE fois par cellule coûte trois fois
-- moins que grouper sur (q, r, cx, cy) — mesuré sur 100 000 carreaux, 45 ms contre 135 ms.
create or replace function public.cellule_hex(p_x double precision, p_y double precision, p_pas double precision)
returns table (q integer, r integer)
language sql
immutable
parallel safe
as $fn$
  select (case when dq > dr and dq > ds then -rr - rs else rq end)::integer,
         (case when dq > dr and dq > ds then rr when ds > dr then rr else -rq - rs end)::integer
    from (select rq, rr, rs, abs(rq - fq) as dq, abs(rr - fr) as dr, abs(rs + fq + fr) as ds
            from (select round(fq) as rq, round(fr) as rr, round(-fq - fr) as rs, fq, fr
                    from (select (sqrt(3) / 3 * p_x - p_y / 3) / p_pas as fq, (2.0 / 3 * p_y) / p_pas as fr) a) b) c
$fn$;

comment on function public.cellule_hex(double precision, double precision, double precision) is
  'Cellule hexagonale (pointe en haut, origine 0,0, p_pas = rayon circonscrit) d''un point : coordonnees axiales (q, r) '
  'par arrondi cubique. Centre : centre_hex. sql/276 (lot 5, T4).';

revoke all on function public.cellule_hex(double precision, double precision, double precision) from public, anon, authenticated;
grant execute on function public.cellule_hex(double precision, double precision, double precision) to service_role;

create or replace function public.centre_hex(p_q integer, p_r integer, p_pas double precision)
returns table (cx double precision, cy double precision)
language sql
immutable
parallel safe
as $fn$
  select p_pas * sqrt(3) * (p_q + p_r / 2.0), p_pas * 1.5 * p_r
$fn$;

comment on function public.centre_hex(integer, integer, double precision) is
  'Centre de la cellule hexagonale (q, r) de cellule_hex, dans les unites de p_pas. sql/276 (lot 5, T4).';

revoke all on function public.centre_hex(integer, integer, double precision) from public, anon, authenticated;
grant execute on function public.centre_hex(integer, integer, double precision) to service_role;

-- ── Mètres au sol par unité de 3857, à une ordonnée donnée ────────────────────────────────────────────────────────────
-- MESURÉE (distance géodésique sur l'ellipsoïde) et non `cos(lat)` : sur l'ellipsoïde, l'échelle est-ouest dépasse
-- `cos(lat)` d'≈ 0,17 % à 45°, assez pour faire déborder un sommet de cellule de son cercle. Le plus grand des deux
-- axes : 3857 a ses axes de déformation sur les méridiens et les parallèles, aucune direction ne fait plus.
create or replace function public.echelle_sol_3857(p_y double precision)
returns double precision
language sql
immutable
parallel safe
as $fn$
  select greatest(public.ST_Distance(public.ST_Transform(public.ST_SetSRID(public.ST_MakePoint(0, p_y), 3857), 4326)::public.geography,
                                     public.ST_Transform(public.ST_SetSRID(public.ST_MakePoint(1000, p_y), 3857), 4326)::public.geography),
                  public.ST_Distance(public.ST_Transform(public.ST_SetSRID(public.ST_MakePoint(0, p_y), 3857), 4326)::public.geography,
                                     public.ST_Transform(public.ST_SetSRID(public.ST_MakePoint(0, p_y + 1000), 3857), 4326)::public.geography)
                 ) / 1000
$fn$;

revoke all on function public.echelle_sol_3857(double precision) from public, anon, authenticated;
grant execute on function public.echelle_sol_3857(double precision) to service_role;

-- ── Le territoire d'une grille : la métropole, ou un DROM ─────────────────────────────────────────────────────────────
-- Une grille par territoire : leurs latitudes n'ont rien de commun (voir l'en-tête). Lu pour les carreaux de la zone ET
-- pour ceux d'une cellule : la Guadeloupe et la Martinique sont à ≈ 110 km, une cellule de 80 km de rayon les toucherait.
create or replace function public.territoire_grille(p_code_departement text)
returns text
language sql
immutable
parallel safe
as $fn$
  select case when p_code_departement like '97_' then p_code_departement else 'metropole' end
$fn$;

revoke all on function public.territoire_grille(text) from public, anon, authenticated;
grant execute on function public.territoire_grille(text) to service_role;

-- ── paver_cercles ─────────────────────────────────────────────────────────────────────────────────────────────────────
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
  if p_rayon_m is null or p_rayon_m < 1000 or p_rayon_m > 80000 then
    raise exception 'rayon hors bornes (1 000 a 80 000 m) : %', p_rayon_m using errcode = '22023';
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
             limit p_max_candidates + 1) k
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
     where (select count(*) from cand) <= p_max_candidates
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
               and round(100 * tot.pop_en_zone / tot.pop_totale, 1) >= p_seuil) r0
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
  select (select count(*) from cand),
         (select count(*) from ret),
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'lon', round(ST_X(ret.centre)::numeric, 6), 'lat', round(ST_Y(ret.centre)::numeric, 6),
                    'pop_en_zone', round(ret.pop_en_zone), 'pop_totale', round(ret.pop_totale), 'part', ret.part)
                  order by ret.pop_en_zone desc, ret.territoire, ret.q, ret.r), '[]'::jsonb) from ret),
         (select coalesce(jsonb_agg(jsonb_build_object('territoire', gr.territoire, 'pas_3857', round(gr.pas::numeric, 3))
                                    order by gr.territoire), '[]'::jsonb) from grilles gr),
         (select max(round(100 * tot.pop_en_zone / nullif(tot.pop_totale, 0), 1)) from tot),
         perte.population, perte.couverte, perte.manques, perte.hors_zone, perte.achetee
    into v_n_cand, v_n_cercles, v_cercles, v_grilles, v_part_max,
         v_population, v_couverte, v_manques, v_hors_zone, v_achetee
    from perte;

  if v_n_cand > p_max_candidates then
    return jsonb_build_object('refus', 'trop_de_candidates', 'plafond', p_max_candidates);
  end if;
  if v_part_max > 100 then
    raise exception 'part de cellule > 100 %% (%) : la cellule d''un carreau ne suit plus une seule formule', v_part_max
      using errcode = 'XX000';
  end if;
  if p_max_cercles is not null and v_n_cercles > p_max_cercles then
    return jsonb_build_object('refus', 'trop_de_cercles', 'n_cercles', v_n_cercles, 'plafond', p_max_cercles);
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
  'zone_introuvable, cible_inconnue, zone_trop_vaste, couverture_non_construite, trop_de_candidates, trop_de_cercles '
  '(+ n_cercles, plafond) ; rayon hors [1 000, 80 000] -> 22023. sql/276 (lot 5, T4).';

revoke all on function public.paver_cercles(uuid, uuid, text, integer, numeric, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.paver_cercles(uuid, uuid, text, integer, numeric, integer, integer, integer) to service_role;
