-- sql/276 — `paver_cercles` : une zone pavée en cercles, cellules retenues au seuil, perte EXACTE sur l'union des
-- cercles retenus — la maille « cercle » de Meta et de DV360 (lot 5, T4 ; spec carte-en-parcours § 16.2, plan A-8).
--
-- L'ALGORITHME (prototype M5, grille passée du carré à l'HEXAGONE : ≈ 23 % de cercles en moins à rayon égal ; un
-- cercle = le cercle CIRCONSCRIT à sa cellule) : 1. carreaux de la zone (`carreaux_de_forme_points`) et leur cellule ;
-- 2. candidates, population EN ZONE et TOTALE de chacune (carreaux lus par `&&` sur l'enveloppe de l'hexagone, puis la
-- MÊME cellule : un carreau dans une seule cellule, part ≤ 100 %) ; 3. retenues (part arrondie au dixième ≥ seuil ET
-- population totale ≥ p_pop_min), refus `trop_de_cercles` ICI, avant la perte ; 4. carreaux de l'UNION des cercles
-- retenus, lus par l'index autour de chaque centre (`&& ST_Expand` puis distance GÉODÉSIQUE, `distinct on`) ; 5. perte
-- en UN `full join` zone × union (ni boucle imbriquée, ni `exists` sur une CTE).
--   ⚠ PIÈGE MESURÉ (M5) : `exists (select … from <cte> where ST_DWithin(…))` — une CTE n'a pas d'index : 11,5 s sur
--   5 000 km², 445 s sur 13 000 km². Ne jamais l'écrire.
--
-- L'ÉCHELLE DE LA GRILLE (écart à A-8, admis). À l'échelle du CENTROÏDE, une cellule au sud déborde son cercle (CIRFA
-- à 5 km : un carreau à 5 030 m) et une zone à DROM (la composite : Martinique, La Réunion) aurait des cellules de
-- 1,34 r à La Réunion. Ici : UNE grille par territoire (`territoire_grille`), pas = r / échelle MESURÉE
-- (`echelle_sol_3857`) au carreau le plus proche de l'équateur, reculé d'un rayon : tout carreau d'une cellule retenue
-- est à ≤ r de son centre (testé). Coût : cellules un peu plus petites au nord d'une zone étendue (ARA : ≈ 3 %).
--
-- BORNES DE SÉCURITÉ seulement : zone ≤ 100 000 km², rayon ∈ [1 000, 200 000] m (22023 sinon), ≤ 5 000 candidates, et
-- ≤ 200 000 km² BALAYÉS (candidates × 2√3·r², l'enveloppe que l'étape 2 relit) — sinon `zone_trop_vaste` motif
-- `rayon`. Mesuré : ARA 10 km balaie 118 700 km² (1,65 s), la composite 10 km 154 000 (1,52 s) ; ARA 80 km (288 000)
-- prenait 2,08 s / 140 600 accès et 200 km (830 000) 3,03 s / 218 000, au-delà de l'arrêt du plan (2 s). Les limites
-- d'une PLATEFORME (200 cercles Meta, 1-80 km…) viennent de `plateformes_geo`, lues par la route (T8) et passées ici.
--
-- LA RÈGLE « CARREAUX D'UNE FORME » porte désormais la position du carreau : `carreaux_de_forme_points` est le corps,
-- `carreaux_de_forme_codes` (sql/275) en devient l'enveloppe, et `carreaux_de_forme` (enveloppe de celle-ci depuis
-- sql/275, non redéfinie ici) l'est par transitivité ; mêmes signatures, aucun DROP, les trois inlinées. Relire la
-- position par la clé primaire coûtait 190 000 accès sur la CIRFA contre 6 600 pour le parcours.
--
-- Mesures (CIRFA, composite, ARA ; 2e passe) : ARCHITECTURE.md, ligne `paver_cercles`. Droits : service_role.
-- Rejouable (`create or replace`, aucun `drop`).

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

comment on function public.carreaux_de_forme_points(geometry, integer) is
  'LA regle « carreaux d''une forme » (corps) : carreaux de carreau_couverture dont le centroide est dans la forme, '
  'effectif d''une cible, centroide 3857 et quatre codes. carreaux_de_forme_codes et carreaux_de_forme en sont des '
  'enveloppes. sql/276 (lot 5, T4).';

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
-- Centre à part (`centre_hex`) : grouper par (q, r) puis le calculer une fois par cellule coûte 3× moins (mesuré).
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

comment on function public.echelle_sol_3857(double precision) is
  'Metres au sol par unite de 3857 a l''ordonnee p_y : distance geodesique (ellipsoide) de 1 000 unites, le plus grand '
  'des axes est-ouest et nord-sud. sql/276 (lot 5, T4).';

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

comment on function public.territoire_grille(text) is
  'Territoire d''une grille de paver_cercles : le code du DROM (97x) ou ''metropole''. sql/276 (lot 5, T4).';

revoke all on function public.territoire_grille(text) from public, anon, authenticated;
grant execute on function public.territoire_grille(text) to service_role;

-- ── Les départements que le carroyage ne publie pas, touchés par une forme ───────────────────────────────────────────
-- Requête de `couverture_geometrie` (sql/269, 275), qui garde sa copie : la factoriser exigerait de redéfinir sa
-- fonction entière ici. Le filtre `not exists` laisse ≈ 6 contours sur 104 : le test géométrique ne porte que sur eux.
create or replace function public.territoires_non_carroyes(p_geom geometry)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_catalog'
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('code', rd.code_dept, 'nom', rd.nom_dept) order by rd.code_dept), '[]'::jsonb)
    from public.ref_departements rd
   where not exists (select 1 from public.unite_population_totale u
                      where u.maille = 'departement' and u.code = rd.code_dept)
     and ST_Intersects(coalesce(rd.geom_perimetre, rd.geom), p_geom)
$fn$;

comment on function public.territoires_non_carroyes(geometry) is
  'Departements absents du carroyage (aucun denominateur departemental) que la forme touche : [{code, nom}]. '
  'sql/276 (lot 5, T4).';

revoke all on function public.territoires_non_carroyes(geometry) from public, anon, authenticated;
grant execute on function public.territoires_non_carroyes(geometry) to service_role;

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
  '(territoire_non_carroye, aucun_carreau, aucune_cellule_au_seuil) ; rayon hors [1 000, 200 000] -> 22023. sql/276 (lot 5, T4).';

revoke all on function public.paver_cercles(uuid, uuid, text, integer, numeric, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.paver_cercles(uuid, uuid, text, integer, numeric, integer, integer, integer) to service_role;
