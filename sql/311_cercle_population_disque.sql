-- ============================================================================
-- sql/311_cercle_population_disque.sql — A6 (plan de corrections du découpage des zones, lot 1, 2026-10-31) : la
-- population d'un cercle est celle de son DISQUE, pas celle de sa cellule hexagonale (Q15 = A, recommandation).
--
-- LE DÉFAUT. `paver_cercles` (sql/276, puis sql/303, sql/310) chiffrait la perte sur l'UNION des disques retenus
-- (`couverte`, `hors_zone`, `achetee` : déjà dédoublonnés), mais la ligne de chaque cercle portait la population de sa
-- CELLULE hexagonale (`pop_totale`, `pop_en_zone`, `part`), et le seuil comme le minimum d'habitants
-- (`p_pop_min`, `pop_min_unite` du registre) s'y appliquaient. Or la plateforme achète le disque : le disque
-- circonscrit vaut 1,21 fois l'hexagone en surface (π / (3√3/2)), et les disques voisins se chevauchent. Mesuré le
-- 01/11 sur la CIRFA Bretagne (5 km, seuil 20) avant correctif : somme des `pop_totale` des 114 cercles 1 470 343,
-- INFÉRIEURE à la diffusion achetée du bilan (1 502 486) — les lignes et le bilan ne comptaient pas la même chose.
--
-- LE CORRECTIF.
--   1. Étape (2) : la population d'une cellule candidate est celle de son DISQUE (rayon `p_rayon_m`, distance
--      géodésique, même test que l'union : `&& ST_Expand` au rayon 3857 du bord polaire, géodésique dans l'anneau
--      seulement) — `pop_totale` = tous les carreaux du disque, `pop_en_zone` = ceux du disque qui sont dans la zone,
--      `part` = leur rapport. Le seuil (part NON arrondie, B11) et `p_pop_min` s'appliquent à ces chiffres-là.
--      Les cellules candidates restent celles du pavage (une cellule qui contient au moins un carreau de la zone).
--   2. Le bilan ne change pas de définition : `achetee`, `hors_zone`, `couverte` restent calculés sur l'union
--      DÉDOUBLONNÉE des disques retenus (un habitant compté une fois). La somme des lignes la dépasse dès que deux
--      disques se chevauchent : la réponse le dit (`somme_disques`, `chevauchement`), l'écran aussi.
--   3. Le territoire de la grille ne restreint plus la population d'un cercle : la plateforme achète tout le disque
--      (l'union ne le restreignait déjà pas). Les territoires de grille (métropole, chaque DROM) sont à des milliers
--      de kilomètres les uns des autres : aucun disque admis (≤ 200 km) n'en touche deux.
--   4. E7 : le commentaire de `zone_set_extraction_unites.pop_totale` disait « CERCLE : celle de sa cellule
--      hexagonale » ; il dit désormais le disque.
--   5. `r_ext` (rayon 3857 de présélection par l'index, étapes 2 et 4) × 1,01 : il était sous-estimé d'≈ 0,17 %, et
--      l'union manquait des carreaux du bord polaire que le test géodésique admettait (constaté par l'exception
--      « part > 100 » sur la CIRFA pendant ce correctif). Le test géodésique tranche toujours dans l'anneau.
--
-- COÛT. L'étape (2) lit les carreaux du disque au lieu de ceux de l'hexagone (enveloppe 4r² au lieu de 2√3·r², plus
-- le test géodésique dans l'anneau) ; la borne de coût `c_max_balaye` (candidates × 2√3·r² km²) est inchangée. Les
-- mesures avant/après sont dans le rapport A6 et la ligne `paver_cercles` d'ARCHITECTURE.md.
--
-- Corps recopié de sql/310 (5c) ; les lignes changées sont marquées « A6 ». Même signature, même type de retour
-- (jsonb), mêmes droits. Rejouable (`create or replace`, `comment on`, aucun DROP). Appliquer par `psql -1`.
-- ============================================================================

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
  v_somme        numeric;   -- A6 : somme des populations des disques retenus (≥ achetee : chevauchements)
  v_fleur        numeric;   -- A6 : max(r_ext / pas) des candidates, < 2 exigé (étape 2b)
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
  -- A5 (ARB-4) : le minimum de la cible ; il s'applique aux carreaux de la zone, des disques et de l'union.
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

  -- Pas de dénominateur ici (la population d'un disque se compte sur ses carreaux) : seule la table étroite compte.
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
    -- A6 : `r_bas` / `r_haut`, rayons 3857 qui bornent TOUS les disques du territoire (marge de 4 rayons, large) : en
    -- deçà de `r_bas` un carreau est dans le disque, au-delà de `r_haut` il n'y est pas, sans calcul géodésique.
    select t.territoire,
           p_rayon_m / public.echelle_sol_3857(greatest(t.y_eq - p_rayon_m / public.echelle_sol_3857(t.y_eq), 0)) as pas,
           p_rayon_m / public.echelle_sol_3857(greatest(t.y_eq - 4 * p_rayon_m / public.echelle_sol_3857(t.y_eq), 0)) as r_bas,
           1.01 * p_rayon_m / public.echelle_sol_3857(t.y_max + 4 * p_rayon_m / public.echelle_sol_3857(t.y_max)) as r_haut
      from (select z.territoire, min(abs(z.y)) as y_eq, max(abs(z.y)) as y_max from z group by z.territoire) t
  ), zq as materialized (                                                   -- A6 : chaque carreau de la zone et sa cellule
    select z.carreau_id, z.pop, z.x, z.y, z.territoire, gr.pas, gr.r_bas, gr.r_haut, h.q, h.r
      from z
      join grilles gr on gr.territoire = z.territoire
      cross join lateral public.cellule_hex(z.x, z.y, gr.pas) h
  ), cand as materialized (                                                 -- (2) cellules candidates
    -- A6 : le centre porte ici ses rayons 3857 (avant : calculés à l'étape 3, pour les seules retenues) — le disque de
    -- chaque candidate est lu pour sa population. `r_ext` au bord POLAIRE du cercle (échelle la plus petite) borne la
    -- présélection par l'index ; `r_int` au bord ÉQUATORIAL (échelle la plus grande) : en deçà, un carreau est dans le
    -- cercle sans calcul géodésique — celui-ci n'est fait que dans l'anneau entre les deux.
    select k.*, c.cx, c.cy, ST_SetSRID(ST_MakePoint(c.cx, c.cy), 3857) as centre_3857,
           ST_Transform(ST_SetSRID(ST_MakePoint(c.cx, c.cy), 3857), 4326)::geography as centre_g,
           -- A6 : × 1,01. `echelle_sol_3857` rend le PLUS GRAND des deux axes (est-ouest, sur l'ellipsoïde) : divisé par
           -- lui, le rayon était sous-estimé d'≈ 0,17 % au nord-sud (0,67 % à l'équateur), et la présélection par
           -- l'index manquait des carreaux du bord polaire que le test géodésique aurait admis (CIRFA, cellule
           -- (-292, 552) : un carreau à 4 998,98 m, 7 487 unités 3857 pour un `r_ext` de 7 476). Une borne de
           -- présélection plus large ne change rien d'autre : le test géodésique tranche dans l'anneau.
           1.01 * p_rayon_m / public.echelle_sol_3857(abs(c.cy) + 2 * p_rayon_m / public.echelle_sol_3857(abs(c.cy))) as r_ext,
           p_rayon_m / public.echelle_sol_3857(greatest(abs(c.cy) - 2 * p_rayon_m / public.echelle_sol_3857(abs(c.cy)), 0)) as r_int
      from (select zq.territoire, zq.pas, zq.q, zq.r
              from zq
             group by zq.territoire, zq.pas, zq.q, zq.r
             limit v_limite + 1) k
      cross join lateral public.centre_hex(k.q, k.r, k.pas) c
  ), zin as materialized (                                                  -- A6 (2b) : la ZONE dans chaque disque
    -- Un carreau à ≤ r du centre c est dans la cellule de c ou dans l'une de ses 6 voisines : la fleur de 7 hexagones
    -- contient le disque de rayon 2 × pas autour de c (les sommets rentrants sont à 2 × pas), et `r_ext` < 2 × pas
    -- (vérifié après la requête, exception sinon). Donc 7 centres à tester par carreau de la zone, par arithmétique
    -- (`centre_hex`), sans jointure ni index — jamais `exists (… from <cte> …)` (M5), jamais une boucle sur `z`.
    select zq.territoire, zq.q + v.dq as q, zq.r + v.dr as r, sum(zq.pop) as pop_en_zone
      from zq
      cross join (values (0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (1, -1), (-1, 1)) v(dq, dr)
      cross join lateral public.centre_hex(zq.q + v.dq, zq.r + v.dr, zq.pas) c
     where (select count(*) from cand) <= v_limite
       and case when (zq.x - c.cx) ^ 2 + (zq.y - c.cy) ^ 2 <= zq.r_bas ^ 2 then true
                when (zq.x - c.cx) ^ 2 + (zq.y - c.cy) ^ 2 > zq.r_haut ^ 2 then false
                else ST_DWithin(ST_Transform(ST_SetSRID(ST_MakePoint(zq.x, zq.y), 3857), 4326)::geography,
                                ST_Transform(ST_SetSRID(ST_MakePoint(c.cx, c.cy), 3857), 4326)::geography, p_rayon_m)
           end
     group by zq.territoire, zq.q + v.dq, zq.r + v.dr
  ), tot as materialized (
    -- A6 : population du DISQUE (tous ses carreaux, lus par l'index autour du centre — même test que l'union, sommés
    -- au fil de la lecture, aucun tri) et population de la zone dans le disque (`zin`).
    select cand.*, t.pop_totale, coalesce(zin.pop_en_zone, 0) as pop_en_zone
      from cand
      cross join lateral (
        select coalesce(sum(cc.pops[v_rang]::numeric), 0) as pop_totale
          from public.carreau_couverture cc
          -- `offset 0` : les coordonnées sont lues UNE fois (sans lui, l'inlining recopie `ST_X(…)` dans chaque terme).
          -- Le test est arithmétique (comme celui de l'hexagone qu'il remplace) : `ST_DWithin` en 3857 sur chacun des
          -- ≈ 580 000 carreaux lus de la composite coûtait ≈ 1 s de plus.
          cross join lateral (select ST_X(cc.centroide_3857) - cand.cx as dx, ST_Y(cc.centroide_3857) - cand.cy as dy offset 0) p
         where cc.centroide_3857 && ST_Expand(cand.centre_3857, cand.r_ext)
           and case when p.dx ^ 2 + p.dy ^ 2 <= cand.r_int ^ 2 then true
                    when p.dx ^ 2 + p.dy ^ 2 > cand.r_ext ^ 2 then false
                    else ST_DWithin(ST_Transform(cc.centroide_3857, 4326)::geography, cand.centre_g, p_rayon_m)
               end
           and (v_min = 0 or cc.pops[v_rang_men] >= v_min)  -- A5 : le disque compte les mêmes carreaux que la zone
      ) t
      left join zin on zin.territoire = cand.territoire and zin.q = cand.q and zin.r = cand.r
     where (select count(*) from cand) <= v_limite
  ), ret as materialized (                                                  -- (3) cellules retenues
    select r0.*
      from (select tot.*, round(100 * tot.pop_en_zone / tot.pop_totale, 1) as part,
                   ST_Transform(tot.centre_3857, 4326) as centre
              from tot
             where tot.pop_totale > 0
               and tot.pop_totale >= p_pop_min          -- A6 : la population du DISQUE
               -- B11 : la part NON arrondie (19,96 % ne passe plus un seuil de 20 %), et jamais un disque sans
               -- personne de la zone (à seuil 0, part > 0) ; `part`, rendue au dixième, reste l'affichage.
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
         (select coalesce(sum(z_tous.pop), 0) from z_tous where not z_tous.compte),
         -- A6 : la somme des lignes telles que rendues (chacune arrondie à l'entier) — c'est elle que lit l'écran.
         (select coalesce(sum(round(ret.pop_totale)), 0) from ret),
         (select max(cand.r_ext / cand.pas) from cand)
    into v_n_carreaux, v_n_cand, v_n_cercles, v_cercles, v_grilles, v_part_max,
         v_population, v_couverte, v_manques, v_hors_zone, v_achetee, v_ec_n, v_ec_p, v_somme, v_fleur
    from perte;

  if v_n_cand > v_limite and v_limite = p_max_candidates then
    return jsonb_build_object('refus', 'trop_de_candidates', 'plafond', p_max_candidates);
  elsif v_n_cand > v_limite then
    return jsonb_build_object('refus', 'zone_trop_vaste', 'motif', 'rayon', 'n_candidates_max', v_limite,
                              'plafond_balaye_km2', c_max_balaye);
  end if;
  -- A6 : la population de la zone dans un disque ne lit que la cellule du centre et ses 6 voisines (étape 2b) — exact
  -- tant que le rayon 3857 du disque reste sous 2 pas. Jamais atteint en France (≈ 1,2 au pire, Corse-Nord) : si un
  -- territoire le dépassait un jour, on échoue au lieu de sous-compter.
  if v_fleur >= 2 then
    raise exception 'rayon 3857 d''un disque >= 2 pas de grille (%) : la population en zone ne se lit plus sur 7 cellules', v_fleur
      using errcode = 'XX000';
  end if;
  if v_part_max > 100 then
    raise exception 'part de disque > 100 %% (%) : un carreau de la zone compte sans etre dans le disque', v_part_max
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
    -- A6 : somme des `pop_totale` des cercles (populations des DISQUES) ; elle dépasse `achetee` (l'union dédoublonnée)
    -- de `chevauchement` habitants, comptés dans plusieurs disques voisins.
    'somme_disques', v_somme,
    'chevauchement', greatest(v_somme - round(v_achetee), 0),
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
      'grille', 'hexagonale, cercle circonscrit, distance géodésique ; population d''un cercle = celle de son disque',
      'grilles', v_grilles),
    'calcule_le', now()
  );
end
$fn$;

comment on function public.paver_cercles(uuid, uuid, text, integer, numeric, integer, integer, integer) is
  'Pave une zone de l''espace en cercles de rayon p_rayon_m (grille hexagonale par territoire, cercle circonscrit), '
  'retient les cercles dont la part en zone >= p_seuil et la population >= p_pop_min (chiffres du DISQUE, sql/311), et '
  'chiffre la perte exacte sur l''union dedoublonnee des disques retenus (couverte, manques, hors_zone, achetee, '
  'taux_utile) ; somme_disques (somme des pop_totale des cercles) depasse achetee de chevauchement. Lecture seule, '
  'jsonb ; refus zone_introuvable, cible_inconnue, zone_trop_vaste (surface, ou motif rayon : > 200 000 km2 balayes), '
  'couverture_non_construite, trop_de_candidates, trop_de_cercles (+ n_cercles, plafond) ; motif_vide '
  '(territoire_non_carroye, aucun_carreau, aucune_cellule_au_seuil, carreaux_tous_ecartes) ; rayon hors '
  '[1 000, 200 000] -> 22023. sql/276 (lot 5, T4), sql/303 (B11), sql/310 (A5 : minimum de menages), sql/311 (A6 : '
  'population, part et minimum d''habitants d''un cercle = ceux de son disque).';

revoke all on function public.paver_cercles(uuid, uuid, text, integer, numeric, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.paver_cercles(uuid, uuid, text, integer, numeric, integer, integer, integer) to service_role;

-- ── E7 : ce que compte `pop_totale` d'une unité figée ────────────────────────────────────────────────────────────────
comment on column public.zone_set_extraction_unites.pop_totale is
  'Population totale de l''unite, a la cible du jeu. CERCLE : celle de son DISQUE (rayon de l''unite), pas celle de '
  'sa cellule hexagonale de pavage (sql/311, A6) ; les disques voisins se chevauchent, donc la somme des cercles '
  'depasse la diffusion achetee du resume (union dedoublonnee). Territoire (CP, commune, departement, IRIS) : celle '
  'du territoire. Polygone : celle de la zone. Pays : la population carroyee du territoire (metropole, ou DROM par '
  'son departement). NULL = non carroye (population inconnue, jamais 0). sql/300, sql/311.';
