-- ============================================================================
-- sql/318_minimums_population.sql — B13 (plan de corrections du découpage des zones, lot 2, 2026-11-02) : les
-- minimums de population d'une plateforme, PAR UNITÉ et PAR GROUPE, chacun avec son COMPORTEMENT lu dans le registre.
--
-- LE CONSTAT. « 1 000 » n'a pas le même sens partout : un filtre DUR par cellule chez DV360 (un cercle de moins de
-- 1 000 personnes n'est pas servi), un AVERTISSEMENT par groupe d'annonces chez TikTok (UE : au moins 1 000 personnes
-- par groupe), rien chez Meta. `plateformes_geo.limites` portait les deux valeurs (`pop_min_unite`, `pop_min_groupe`)
-- mais pas leur comportement : le code l'écrivait en dur (filtre au pavage, avertissement au groupe), et le cercle
-- EXACT unique (rayon autour d'un point acheté tel quel) ne passait par AUCUN contrôle — un cercle de 1 km à 300
-- habitants partait chez DV360 sans un mot.
--
-- LE CORRECTIF.
--   1. Deux colonnes, `pop_min_unite_comportement` et `pop_min_groupe_comportement` : `refus` ou `avertissement`,
--      jamais sans la limite correspondante (CHECK `plateformes_geo_pop_min_comportements`). L'inverse — une limite
--      sans comportement — reste admis par la base : le seed de sql/274 (`insert … on conflict do nothing`, sans ces
--      colonnes) doit pouvoir se rejouer, et un CHECK s'évalue sur la ligne proposée AVANT le conflit. Le code lit
--      alors `avertissement` (jamais un refus que le registre ne dit pas), et `plateformes-geo.test.ts` exige un
--      comportement sur chaque limite du relevé.
--      `refus` par UNITÉ n'est admis qu'à la maille cercle : c'est la seule où le code sait écarter une unité (au
--      pavage, `p_pop_min`) ; un cercle exact unique sous le minimum refuse l'extraction (rien d'autre à acheter).
--   2. Les valeurs : DV360 cercle `pop_min_unite` 1 000 = `refus` ; TikTok département et commune `pop_min_groupe`
--      1 000 = `avertissement` ; Meta : aucune limite, aucun comportement. Le comportement de DV360 sur un cercle
--      exact UNIQUE n'est confirmé par aucune doc (le constat le dit « non défini ») : `pop_min_unite_comportement`
--      est « à vérifier » sur cette ligne (amendement E9, par paramètre).
--   3. `plateformes_geo_parametres_valides` (sql/312) admet les deux nouveaux paramètres.
--   4. `paver_cercles` (corps de sql/311) rend ce que le minimum par cercle ÉCARTE (règle 5, aucun ajustement
--      silencieux) : `ecartes_pop_min` = { n_cercles, population_max } — les cellules qui passaient le seuil et ne
--      sont écartées QUE par `p_pop_min`, et la population du plus peuplé de leurs disques. Lignes marquées « B13 ».
--
-- Rejouable (`add column if not exists`, contrainte posée si absente, `create or replace`, aucun DROP). Appliquer par
-- `psql -1`. Note de la relecture (M-1) : la première application locale avait posé une version STRICTE de
-- `plateformes_geo_pop_min_comportements` (limite ⇔ comportement), retirée à la main (`alter table … drop constraint`)
-- avant de poser celle-ci ; une base neuve ne voit que cette version.
-- ============================================================================

-- ── 1. Les colonnes ────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.plateformes_geo add column if not exists pop_min_unite_comportement text;
alter table public.plateformes_geo add column if not exists pop_min_groupe_comportement text;

comment on column public.plateformes_geo.pop_min_unite_comportement is
  'Comportement du minimum de population PAR UNITE (limites.pop_min_unite) : refus (l''unite sous le minimum n''est '
  'pas achetee : ecartee au pavage, extraction refusee pour un cercle exact unique ; maille cercle seulement) ou '
  'avertissement (achetee, et dite). NULL sans minimum. sql/318 (B13).';
comment on column public.plateformes_geo.pop_min_groupe_comportement is
  'Comportement du minimum de population PAR GROUPE (limites.pop_min_groupe, la diffusion achetee entiere) : refus '
  '(extraction refusee) ou avertissement (palier dit). NULL sans minimum. sql/318 (B13).';

-- ── 3. Les paramètres « à vérifier » admis (avant les données : la contrainte de la table appelle la fonction) ────────
create or replace function public.plateformes_geo_parametres_valides(p text[])
returns boolean
language sql
immutable
set search_path to 'public'
as $fn$
  select p is not null
     and p <@ array['poids_groupe_cp', 'max_unites', 'rayon_min_m', 'rayon_max_m', 'pop_min_unite', 'pop_min_groupe',
                    'max_sommets', 'polygone_sommets_max', 'polygone_morceaux_max',
                    'pop_min_unite_comportement', 'pop_min_groupe_comportement']::text[]
     and cardinality(p) = (select count(distinct x) from unnest(p) x)
$fn$;

-- ── 2. Les valeurs du relevé ───────────────────────────────────────────────────────────────────────────────────────────
update public.plateformes_geo
   set pop_min_unite_comportement = 'refus',
       parametres_a_verifier = case when 'pop_min_unite_comportement' = any (parametres_a_verifier) then parametres_a_verifier
                                    else parametres_a_verifier || 'pop_min_unite_comportement'::text end
 where plateforme = 'dv360' and maille = 'cercle' and limites ? 'pop_min_unite';

update public.plateformes_geo
   set pop_min_groupe_comportement = 'avertissement'
 where plateforme = 'tiktok' and maille in ('departement', 'commune') and limites ? 'pop_min_groupe';

-- ── 1 bis. La cohérence, une fois les valeurs posées ───────────────────────────────────────────────────────────────────
do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'plateformes_geo_pop_min_comportements'
                                               and conrelid = 'public.plateformes_geo'::regclass) then
    alter table public.plateformes_geo add constraint plateformes_geo_pop_min_comportements check (
      (pop_min_unite_comportement is null or pop_min_unite_comportement in ('refus', 'avertissement'))
      and (pop_min_groupe_comportement is null or pop_min_groupe_comportement in ('refus', 'avertissement'))
      and (pop_min_unite_comportement is null or limites ? 'pop_min_unite')
      and (pop_min_groupe_comportement is null or limites ? 'pop_min_groupe')
      and (pop_min_unite_comportement is distinct from 'refus' or maille = 'cercle'));
  end if;
end
$do$;

-- ── 4. `paver_cercles` : ce que le minimum par cercle écarte ───────────────────────────────────────────────────────────
-- Corps recopié de sql/311 ; les lignes changées sont marquées « B13 ». Même signature, même type de retour, mêmes droits.
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
  -- km² d'enveloppes de DISQUES relus par l'étape 2 (candidates × 4,0804 r², A6). 200 000 avec l'hexagone avant A6 ;
  -- relevé à 240 000 pour garder ARA 40 km (≈ 222 000 km² : 34 candidates × 6 529 km²). Mesure À FROID le 01/11
  -- (zones jamais lues, cache partagé froid pour leurs carreaux) : Occitanie 40 km, 31 candidates (≈ 202 000 km²),
  -- 8,2 s, 21 872 blocs lus hors cache, aucun fichier temporaire ; ARA 40 km 5,8 s, 20 742 blocs lus, aucun
  -- fichier temporaire. Le cache du système hôte n'a pas pu être vidé (base partagée, conteneur non redémarré).
  c_max_balaye   constant numeric := 240000;
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
  v_pm_n         bigint;    -- B13 : cellules au seuil écartées par le seul p_pop_min
  v_pm_max       numeric;   -- B13 : la population du plus peuplé de leurs disques
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

  -- Borne de coût : au plus `c_max_balaye` km² relus — chaque candidate lit l'enveloppe de son DISQUE par l'index,
  -- un carré de côté 2 × `r_ext` ≈ 2 × 1,01 r au sol, soit 4,0804 r² (A6 ; avant : l'hexagone, 2√3·r²).
  v_limite := least(p_max_candidates, floor(c_max_balaye * 1e6 / (4.0804 * p_rayon_m::numeric ^ 2))::integer);

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
         (select max(cand.r_ext / cand.pas) from cand),
         -- B13 : les cellules qui passaient le seuil (mêmes conditions que `ret`) et que SEUL `p_pop_min` écarte.
         (select count(*) from tot
            where tot.pop_totale > 0 and tot.pop_totale < p_pop_min and tot.pop_en_zone > 0
              and 100 * tot.pop_en_zone / tot.pop_totale >= p_seuil),
         -- `floor` (relecture M-4) : un disque de 999,6 écarté ne s'affiche pas « 1 000, sous le minimum de 1 000 ».
         (select max(floor(tot.pop_totale)) from tot
            where tot.pop_totale > 0 and tot.pop_totale < p_pop_min and tot.pop_en_zone > 0
              and 100 * tot.pop_en_zone / tot.pop_totale >= p_seuil)
    into v_n_carreaux, v_n_cand, v_n_cercles, v_cercles, v_grilles, v_part_max,
         v_population, v_couverte, v_manques, v_hors_zone, v_achetee, v_ec_n, v_ec_p, v_somme, v_fleur,
         v_pm_n, v_pm_max
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
    -- B13 (règle 5) : ce que le minimum d'habitants par cercle (`p_pop_min`, `pop_min_unite` en `refus`) écarte —
    -- avant : n_cercles + ces cellules ; après : n_cercles. `population_max` : le plus peuplé des disques écartés.
    'ecartes_pop_min', jsonb_build_object('n_cercles', v_pm_n, 'population_max', v_pm_max),
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
  'population, part et minimum d''habitants d''un cercle = ceux de son disque), sql/318 (B13 : ecartes_pop_min, les '
  'cercles au seuil ecartes par le seul p_pop_min, et la population du plus peuple).';

revoke all on function public.paver_cercles(uuid, uuid, text, integer, numeric, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.paver_cercles(uuid, uuid, text, integer, numeric, integer, integer, integer) to service_role;
