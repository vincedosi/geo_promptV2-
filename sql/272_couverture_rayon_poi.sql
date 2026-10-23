-- sql/272 — `couverture_rayon_poi` : la courbe de couverture par rayon du module risque, autour de N'IMPORTE QUEL type
-- de POI, sans pré-calcul, bornée au département (lot 4, T11 ; spec carte-en-parcours § 4 ③, Q3 ; arbitrages A-11,
-- A-12, Q-I).
--
-- PARITÉ PAR CONSTRUCTION. La mise en forme des courbes (cumul, grille complète avec report, incrément = différence de
-- cumuls arrondis) quitte `lire_couverture_rayon` pour `courbes_par_palier`, que les deux fonctions appellent : un seul
-- corps, aucune dérive possible. `lire_couverture_rayon` est réécrite SANS changement de comportement (références du
-- département 13 : `couverture-caracterisation.test.ts`). Le reste suit la règle de `construire_couverture_rayon`
-- (sql/200) : distance géodésique centroïde du carreau → POI, minimum par carreau ET par valeur (`grouping sets`),
-- palier `least(floor(d/100)*100, r_max)`. `couverture-rayon-poi.test.ts` prouve l'égalité des 99 premiers paliers du
-- département 13 ; au dernier (10 km), le pré-calcul perd 43 carreaux que son tampon à 16 côtés n'atteint pas, et
-- celle-ci les compte.
--
-- PÉRIMÈTRE (A-11). `resoudre_perimetre` en garde (≤ 12 000 km², département, commune, CP ou zone ; région refusée,
-- Q-I). Carreaux d'un département par CODE (`code_departement`, la règle `lcog` du risque : c'est elle qui donne la
-- parité) ; d'une commune, d'un CP ou d'une zone par GÉOMÉTRIE (règle de `couverture_geometrie`, sql/269 : une commune
-- saisie par son nom ou un CP non canonique n'a pas de code dans `carreau_couverture`). POI à moins de r_max du
-- périmètre, même hors de lui (un lycée de l'autre côté de la limite couvre le périmètre), + 1 km pour un département
-- lu par code, dont des centroïdes débordent le contour.
--
-- PROFIL (A-12) : `{ valeur: [r1, r2, …] }` classe chaque carreau dans la PREMIÈRE valeur dont un anneau le contient,
-- bandes [0, r1), [r1, r2)… (règle de `classe_carreau_risque`, généralisée). jsonb ne garde pas l'ordre des clés :
-- la priorité est l'ordre de `p_valeurs`, puis l'ordre alphabétique. La clé `*` vise le POI le plus proche, toute
-- valeur confondue.
--
-- MESURES (EXPLAIN ANALYZE BUFFERS de l'appel, 3e passe, 23/10) : pire cas ICPE toutes natures des Bouches-du-Rhône à
-- 5 km, 1,0-1,6 s / 57 392 accès ; zone Île-de-France de 11 793 km², lycées à 10 km, 0,6-0,9 s / 31 817 (détail :
-- ARCHITECTURE.md). Lecture seule, jsonb (les courbes, pas des lignes). Droits : service_role. Rejouable
-- (`create or replace`, aucun `drop`).

begin;

create or replace function public.courbes_par_palier(
  p_cles text[], p_rayons integer[], p_pops numeric[], p_carreaux bigint[], p_rayon_max_m integer
)
returns jsonb
language sql
immutable
set search_path to 'public', 'pg_catalog'
as $fn$
  -- Entrée : une ligne par (clé, palier), le palier étant la borne BASSE (multiple de 100). Sortie : les courbes au
  -- format de `lire_couverture_rayon`, `*` d'abord puis par total décroissant.
  with par_palier as (
    select * from unnest(p_cles, p_rayons, p_pops, p_carreaux) as t(cle, rayon_m, pop, n_carreaux)
  ),
  -- Le point `r` porte la borne HAUTE du palier (décalage de 100 m) : `r = 1 000` = carreaux à moins de 1 km. `rows`
  -- explicite : le défaut `range` regrouperait des ex æquo si la clé changeait un jour.
  cumul as (
    select cle, rayon_m + 100 as rayon_m,
           sum(pop) over (partition by cle order by rayon_m rows between unbounded preceding and current row) as pop_cumulee,
           sum(n_carreaux) over (partition by cle order by rayon_m rows between unbounded preceding and current row) as carreaux_cumules
      from par_palier
  ),
  -- La grille ENTIÈRE, avec report du dernier cumul sur les paliers vides : une courbe à trous se dessine de travers
  -- (94 points sur 99 mesurés pour une nature rare, sql/201).
  complet as (
    select g.cle, r as rayon_m,
           coalesce(max(c.pop_cumulee) over w, 0) as pop_cumulee,
           coalesce(max(c.carreaux_cumules) over w, 0) as carreaux_cumules,
           coalesce(max(c.pop_cumulee) over (partition by g.cle order by r
                                             rows between unbounded preceding and 1 preceding), 0) as cumul_precedent
      from (select distinct cle from cumul) g
      cross join generate_series(100, p_rayon_max_m, 100) r
      left join cumul c on c.cle = g.cle and c.rayon_m = r
    window w as (partition by g.cle order by r rows between unbounded preceding and current row)
  ),
  courbes as (
    select cle, max(pop_cumulee) as total, max(carreaux_cumules) as carreaux,
           -- L'incrément est la différence de deux cumuls ARRONDIS : la somme des incréments retombe exactement sur le
           -- dernier cumul (100 arrondis indépendants s'écartaient de 26 habitants, sql/188).
           jsonb_agg(jsonb_build_object('r', rayon_m, 'p', round(pop_cumulee),
                                        'i', round(pop_cumulee) - round(cumul_precedent)) order by rayon_m) as points
      from complet
     group by cle
  )
  select coalesce(jsonb_agg(jsonb_build_object('cle', cle, 'total', round(total), 'carreaux', carreaux, 'points', points)
                            order by (cle = '*') desc, total desc), '[]'::jsonb)
    from courbes
$fn$;

comment on function public.courbes_par_palier(text[], integer[], numeric[], bigint[], integer) is
  'Met en forme les courbes de couverture par rayon (cumul, grille 100..r_max avec report, increment = difference de '
  'cumuls arrondis) depuis des lignes (cle, palier bas, population, carreaux). Corps commun de lire_couverture_rayon '
  'et couverture_rayon_poi. sql/272.';

revoke all on function public.courbes_par_palier(text[], integer[], numeric[], bigint[], integer) from public, anon, authenticated;
grant execute on function public.courbes_par_palier(text[], integer[], numeric[], bigint[], integer) to service_role;


-- `lire_couverture_rayon` (sql/201), même signature, même réponse : seule la mise en forme des courbes est déléguée.
create or replace function public.lire_couverture_rayon(
  p_cible text default 'ind', p_gravites text[] default null, p_natures text[] default null,
  p_perim_niveau text default null, p_perim_codes text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_gravite text;
  v_depts   text[] := null;
begin
  -- La cible est validée contre le CATALOGUE, jamais interpolée (sql/185).
  if not exists (select 1 from public.cibles_exposition where code = p_cible and actif) then
    return jsonb_build_object('error', 'cible_inconnue', 'calculable', false);
  end if;

  -- `'*'` est la ligne pré-calculée « toutes gravités », au minimum par carreau : deux gravités se lisent là, jamais
  -- en sommant leurs lignes.
  if p_gravites is null or array_length(p_gravites, 1) is null or array_length(p_gravites, 1) >= 2 then
    v_gravite := '*';
  else
    v_gravite := p_gravites[1];
  end if;

  if p_perim_niveau = 'departement' then
    v_depts := p_perim_codes;
  elsif p_perim_niveau = 'region' then
    select array_agg(d.code_dept) into v_depts from public.ref_departements d where d.code_region = any(p_perim_codes);
  end if;

  return jsonb_build_object(
    'calculable', true,
    'cible', p_cible,
    'gravite', v_gravite,
    'perim_niveau', p_perim_niveau,
    'perim_codes', to_jsonb(coalesce(p_perim_codes, array[]::text[])),
    'rayon_max_m', 10000,
    -- Le total porte-t-il sur plus de natures que celles affichées ?
    'total_est_global', p_natures is not null and array_length(p_natures, 1) is not null,
    'n_departements', (select count(distinct code_departement) from public.couverture_rayon_risque
                        where gravite = v_gravite and (v_depts is null or code_departement = any(v_depts))),
    'courbes', (
      select public.courbes_par_palier(array_agg(nature), array_agg(rayon_m), array_agg(pop), array_agg(n_carreaux), 10000)
        from (select r.nature, r.rayon_m, sum(coalesce((r.populations->>p_cible)::numeric, 0)) as pop,
                     sum(r.n_carreaux) as n_carreaux
                from public.couverture_rayon_risque r
               where r.gravite = v_gravite
                 and (v_depts is null or r.code_departement = any(v_depts))
                 -- La nature `'*'` est TOUJOURS retenue : c'est la courbe totale.
                 and (p_natures is null or array_length(p_natures, 1) is null
                      or r.nature = '*' or r.nature = any(p_natures))
               group by r.nature, r.rayon_m) s),
    -- La part du pré-calcul construite remonte à l'écran : une courbe sur une France incomplète SOUS-ESTIME sans rien
    -- qui le signale. `bande < 1000` : les zones lointaines (clés >= 1000, sql/200) gonfleraient le rapport à 112 %.
    'couverture_pct', (select round(100.0 * coalesce(sum(lon_max - lon_min), 0) / (9.8 - (-5.5)))
                         from public.couverture_rayon_bandes where bande < 1000),
    'n_bandes_construites', (select count(*) from public.couverture_rayon_bandes where bande < 1000),
    'n_zones_lointaines', (select count(*) from public.couverture_rayon_bandes where bande >= 1000),
    'calcule_le', now()
  );
end;
$fn$;


create or replace function public.couverture_rayon_poi(
  p_categorie text,
  p_perimetre_type text,
  p_perimetre_code text,
  p_org_id uuid,
  p_sources uuid[],
  p_cible text default 'ind',
  p_rayon_max_m integer default 5000,
  p_champ text default null,
  p_valeurs text[] default null,
  p_profil jsonb default null,
  p_inclure_inactifs boolean default false,
  p_max_poi integer default 5000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_rang  integer;
  v_per   geometry;
  v_refus text;
  v_motif text;
  v_g     geography[];
  v_v     text[];
  v_n_val integer;
  -- Pas de la grille qui rend sa cellule de Voronoï à chaque POI (unités 3857).
  c_tuile constant integer := 10000;
  -- + 1 km pour un département lu par code : des centroïdes de ses carreaux débordent son contour.
  v_portee integer := p_rayon_max_m + case when p_perimetre_type = 'departement' then 1000 else 0 end;
begin
  if p_rayon_max_m is null or p_rayon_max_m < 100 or p_rayon_max_m > 10000 then
    raise exception 'rayon maximal hors bornes (100 m a 10 km) : %', p_rayon_max_m using errcode = '22023';
  end if;
  if p_max_poi is null or p_max_poi < 1 or p_max_poi > 5000 then
    raise exception 'plafond de POI hors bornes (1 a 5 000) : %', p_max_poi using errcode = '22023';
  end if;
  -- Sans champ, aucune valeur à filtrer : un filtre ignoré en silence rendrait la courbe de TOUS les POI.
  if p_valeurs is not null and p_champ is null then
    raise exception 'p_valeurs exige p_champ' using errcode = '22023';
  end if;
  -- Un anneau au-delà de r_max ne verrait jamais un carreau (aucune distance n'est mesurée au-delà) : refusé.
  if exists (select 1 from jsonb_each(coalesce(p_profil, '{}')) e, jsonb_array_elements_text(e.value) a
              where a::numeric <= 0 or a::numeric > p_rayon_max_m) then
    raise exception 'anneau hors de ]0, %] m', p_rayon_max_m using errcode = '22023';
  end if;
  -- Liste FERMÉE (A-12) : un champ libre serait interpolé ou lirait le jsonb de chaque POI.
  if p_champ is not null and p_champ <> 'sous_categorie' then
    return jsonb_build_object('refus', 'champ_non_admis');
  end if;

  select ce.rang_pop into v_rang from public.cibles_exposition ce
   where ce.code = p_cible and ce.actif and ce.rang_pop is not null;
  if v_rang is null then
    return jsonb_build_object('refus', 'cible_inconnue');
  end if;

  select r.g, r.refus into v_per, v_refus
    from public.resoudre_perimetre(p_perimetre_type, p_perimetre_code, p_org_id, 12000,
                                   array['departement', 'commune', 'cp', 'zone']) r;
  if v_refus is not null then
    return jsonb_build_object('refus', v_refus);
  end if;

  -- Pas de repli sur `carreaux_filosofi` (A-1) : deux chemins pour la même donnée divergent.
  v_motif := public.carreau_couverture_complete();
  if v_motif is not null then
    return jsonb_build_object('refus', 'couverture_non_construite', 'motif', v_motif);
  end if;

  -- Les POI, lus une fois. `p_max_poi + 1` : au-delà, refus, jamais une courbe partielle (sql/254).
  select array_agg(s.g), array_agg(s.v), count(distinct s.v) into v_g, v_v, v_n_val
    from (select x.g, x.v
            from (select p.geom::geography as g,
                         case p_champ when 'sous_categorie' then coalesce(p.sous_categorie, 'non_renseigne') end as v
                    from public.poi_france p
                   where p.categorie = p_categorie
                     and (p.data_source_id is null or p.data_source_id = any (coalesce(p_sources, '{}'::uuid[])))
                     -- Sites ICPE « en fin d'exploitation » exclus par défaut, règle de `construire_couverture_rayon`.
                     and (p_categorie <> 'risque_industriel' or p_inclure_inactifs
                          or p.metadata->>'etat_activite' is distinct from 'En fin d''exploitation')
                     -- La boîte d'abord, par l'index : 60 km par degré minore le degré de longitude partout en France
                     -- (69 km à 51,5° N). Sans elle, 99 152 sites ICPE mesurés au contour : 2 s.
                     and p.geom && ST_Expand(v_per, v_portee / 60000.0)
                     and ST_DWithin(p.geom::geography, v_per::geography, v_portee)) x
           where p_valeurs is null or x.v = any (p_valeurs)
           limit p_max_poi + 1) s;
  if coalesce(cardinality(v_g), 0) > p_max_poi then
    return jsonb_build_object('refus', 'trop_de_poi', 'plafond', p_max_poi);
  end if;
  -- 8 teintes au plus (`--nature-1…8`).
  if coalesce(cardinality(p_valeurs), 0) > 8 or v_n_val > 8 then
    return jsonb_build_object('refus', 'trop_de_valeurs');
  end if;

  return (
    with car as materialized (
      select cc.carreau_id, cc.pops[v_rang]::numeric as pop
        from public.carreau_couverture cc
       where p_perimetre_type = 'departement' and cc.code_departement = p_perimetre_code
      union all
      -- `ST_Intersects` + `distinct on` : un centroïde sur la couture de deux morceaux compte une fois (sql/269).
      (select distinct on (cc.carreau_id) cc.carreau_id, cc.pops[v_rang]::numeric
         from (select ST_Subdivide(ST_Transform(v_per, 3857), 256) as sg) z
         join public.carreau_couverture cc on cc.centroide_3857 && z.sg and ST_Intersects(cc.centroide_3857, z.sg)
        where p_perimetre_type <> 'departement'
        order by cc.carreau_id)
    ),
    -- ── LE PLUS PROCHE POI PAR CARREAU, SANS ÉNUMÉRER LES PAIRES ──────────────
    -- Toutes les paires carreau × POI à moins de r_max : 4,7 M pour les lycées d'Île-de-France à 10 km, 10,9 s. Un
    -- plus-proche-voisin par index n'existe pas ici (la catégorie n'est pas dans l'index des POI : 34,6 s mesurées).
    -- On découpe donc le plan en cellules de Voronoï (une par POI, en 3857) : chaque carreau ne se mesure qu'au POI de
    -- sa cellule, coupée au disque de r_max — une distance par carreau, 0,6 à 0,9 s.
    -- Exact : la distance reste GÉODÉSIQUE et le minimum se prend sur les cellules à moins de 100 unités du centroïde.
    -- Mercator déforme les distances de ±0,3 % sur 10 km : ce n'est qu'au voisinage d'une frontière de cellule que le
    -- POI le plus proche en 3857 peut ne pas l'être sur l'ellipsoïde, et la bande de 100 y mesure les deux POI.
    poi as materialized (
      select t.g, t.v, x.g3, floor(ST_X(x.g3) / c_tuile)::int as tx, floor(ST_Y(x.g3) / c_tuile)::int as ty,
             -- Le rayon en unités 3857 (échelle 1/cos(latitude), 0,1° de marge) plus la bande : le disque, polygone
             -- INSCRIT, contient alors tout le cercle de r_max (le `quad_segs=4` sans marge de sql/200 en perdait le bord).
             (p_rayon_max_m + 100) / cos(radians(abs(ST_Y(t.g::geometry)) + 0.1)) as r3
        from unnest(v_g, v_v) as t(g, v)
        cross join lateral (select ST_Transform(t.g::geometry, 3857) as g3) x
    ),
    -- Une partition par valeur et une pour `*` (toutes valeurs). Les quatre coins d'une enveloppe élargie bornent les
    -- cellules du bord, et donnent une cellule à une valeur d'un seul POI (Voronoï d'un point : vide).
    cellules as materialized (
      select c.cle, (ST_Dump(c.diagramme)).geom as cell
        from (select case when grouping(v) = 1 then '*' else v end as cle,
                     ST_VoronoiPolygons(ST_Collect(ST_Collect(g3), ST_Points(ST_Expand(ST_Envelope(ST_Collect(g3)), 3 * max(r3)))))
                       as diagramme
                from poi
               group by grouping sets ((v), ())
              having grouping(v) = 1 or p_champ is not null) c
    ),
    -- La cellule retrouve son POI par une grille, jointe par hachage (CTE matérialisée, sans quoi le
    -- planificateur revient au produit cellules × POI : 3,5 M tests à 1 426 sites, 25 M à 5 000). Les cellules des
    -- quatre coins ne contiennent aucun POI : elles tombent ici.
    tuiles as materialized (
      select k.cle, k.cell, gx.x, gy.y
        from cellules k
        cross join generate_series(floor(ST_XMin(k.cell) / c_tuile)::int, floor(ST_XMax(k.cell) / c_tuile)::int) gx(x)
        cross join generate_series(floor(ST_YMin(k.cell) / c_tuile)::int, floor(ST_YMax(k.cell) / c_tuile)::int) gy(y)
       -- Une cellule loin du périmètre n'y a aucun carreau (2 000 unités : le débord d'un département lu par code).
       where k.cell && ST_Expand(ST_Transform(v_per, 3857), 2000)
    ),
    zones as materialized (
      select t.cle, p.g, ST_Intersection(t.cell, ST_Buffer(p.g3, p.r3)) as z
        from tuiles t
        join poi p on p.tx = t.x and p.ty = t.y and (t.cle = '*' or p.v = t.cle) and ST_Intersects(t.cell, p.g3)
    ),
    -- Minimum par carreau ET par valeur, et par carreau seul (`*`) : jamais une somme, sinon un carreau proche de deux
    -- valeurs compterait deux fois (sql/200).
    mins as materialized (
      select s.carreau_id, s.cle, min(s.d) as d
        from (select cc.carreau_id, k.cle, ST_Distance(ST_Transform(cc.centroide_3857, 4326)::geography, k.g) as d
                from zones k
                join public.carreau_couverture cc on ST_DWithin(cc.centroide_3857, k.z, 100)
               where cc.carreau_id in (select carreau_id from car)) s
       group by 1, 2
      having min(s.d) <= p_rayon_max_m
    ),
    paliers as (
      select m.cle, least(floor(m.d / 100)::int * 100, p_rayon_max_m) as rayon_m, sum(c.pop) as pop, count(*) as n
        from mins m join car c using (carreau_id)
       group by 1, 2
    ),
    profil as (
      select e.key as valeur, array(select a::int from jsonb_array_elements_text(e.value) a order by 1) as anneaux,
             row_number() over (order by array_position(p_valeurs, e.key) nulls last, e.key) as rang
        from jsonb_each(coalesce(p_profil, '{}')) e
    ),
    classe as (
      select distinct on (m.carreau_id) m.carreau_id, k.valeur, k.rang,
             (select min(a) from unnest(k.anneaux) a where m.d < a) as anneau_m
        from mins m join profil k on k.valeur = m.cle
       where m.d < k.anneaux[cardinality(k.anneaux)]
       order by m.carreau_id, k.rang
    )
    select jsonb_build_object(
             'calculable', true,
             'cible', p_cible,
             'rayon_max_m', p_rayon_max_m,
             'n_poi', coalesce(cardinality(v_g), 0),
             'population_perimetre', (select round(coalesce(sum(pop), 0)) from car),
             'courbes', (select public.courbes_par_palier(array_agg(cle), array_agg(rayon_m), array_agg(pop),
                                                          array_agg(n), p_rayon_max_m) from paliers))
           || case when p_profil is null then '{}'::jsonb else jsonb_build_object(
             'classes', (select coalesce(jsonb_agg(jsonb_build_object('valeur', valeur, 'anneau_m', anneau_m,
                                                                      'population', round(pop)) order by rang, anneau_m), '[]')
                           from (select k.valeur, k.rang, k.anneau_m, sum(c.pop) as pop
                                   from classe k join car c using (carreau_id) group by 1, 2, 3) s),
             'hors_classes', (select round(coalesce(sum(c.pop), 0)) from car c
                               where not exists (select 1 from classe k where k.carreau_id = c.carreau_id)))
           end
  );
end
$fn$;

comment on function public.couverture_rayon_poi(text, text, text, uuid, uuid[], text, integer, text, text[], jsonb, boolean, integer) is
  'Couverture par rayon autour des POI d''une categorie : courbes cumulees (format lire_couverture_rayon, * + une par '
  'valeur de sous_categorie), population du perimetre, classes d''un profil d''anneaux. Sans pre-calcul, perimetre '
  '<= 12 000 km2 (departement, commune, cp, zone), r_max <= 10 km, <= 5 000 POI, <= 8 valeurs. sql/272 (lot 4, T11).';

revoke all on function public.couverture_rayon_poi(text, text, text, uuid, uuid[], text, integer, text, text[], jsonb, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.couverture_rayon_poi(text, text, text, uuid, uuid[], text, integer, text, text[], jsonb, boolean, integer)
  to service_role;

commit;
