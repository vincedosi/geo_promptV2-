-- sql/275 — Découpages `commune` et `departement` de la couverture : la maille TikTok lue comme le CP (lot 5, T3 ;
-- spec carte-en-parcours § 16.2, plan du lot 5 A-5).
--
-- CE QUI CHANGE. `couverture_geometrie` (sql/269) admet `p_decoupage ∈ forme|cp|iris|commune|departement`, MÊME
-- signature (`create or replace`). Pour une commune ou un département, le code est celui que porte `carreau_couverture`
-- (`code_commune` = premier code `lcog_geo`, `code_departement` qui en dérive, sql/266) et le dénominateur est
-- `unite_population_totale` maille `commune|departement` (sql/221), compté par la MÊME règle sur les mêmes carreaux :
-- une part ne peut pas dépasser 100 % (le garde XX000 de sql/269 reste), la somme des lignes et du hors-territoire
-- égale la population de la forme. Les noms viennent de `ref_communes` / `ref_departements`.
--   ⚠ La commune est celle du carroyage : Paris, Lyon et Marseille sortent en ARRONDISSEMENTS (751xx, 6938x, 132xx),
--   jamais 75056 — TikTok les accepte-t-il ? Q-B du plan, « À vérifier » dans `plateformes_geo`.
--
-- LA JUMELLE `carreaux_de_forme_codes`. `carreaux_de_forme` (sql/269) ne rend que CP et IRIS ; lui ajouter deux
-- colonnes changerait son type de retour, donc exigerait un DROP (interdit : base partagée, `couverture_rayon_poi` et
-- `paver_cercles` l'appellent). Patron « jumelle » de CLAUDE.md : la jumelle porte LE corps et rend les quatre codes,
-- `carreaux_de_forme` devient une enveloppe qui la lit — une seule règle « carreaux d'une forme », dérive impossible.
-- Les deux restent SANS `set search_path` : elles sont INLINÉES l'une dans l'autre puis dans l'appelant (vérifié par
-- EXPLAIN : même plan, mêmes accès qu'avant pour `couverture_rayon_poi` ; une colonne inutilisée de la jumelle est
-- retirée du tri du `distinct on` par le planificateur).
--
-- FRAÎCHEUR DES DÉNOMINATEURS (même règle que le CP). Les dénominateurs commune et département sont comptés sur
-- `carreaux_filosofi` (sql/221) ; la table étroite en porte une COPIE construite après eux (égalité prouvée carreau par
-- carreau, test de sql/266). Un dénominateur reconstruit APRÈS la table ne compte plus forcément les mêmes carreaux :
-- refus `couverture_non_construite`, motif `denominateur_<maille>_plus_recent` (ou `_absent`), et le cache n'est plus
-- servi. La date d'un dénominateur est lue par `denominateur_construit_le`, seule copie, appelée par le calcul ET par
-- le cache. Index (maille, construit_le) : le `max` d'une maille lit une entrée d'index au lieu de 34 918 lignes.
--
-- LE CACHE (sql/270). `couverture_zone` n'est pas modifiée (elle relaie le découpage) ; `couverture_zone_en_cache`
-- étend sa condition 5 aux deux mailles ; la contrainte CHECK de `couverture_zone_cache.decoupage` admet les deux
-- valeurs. ⚠ Une contrainte CHECK ne s'élargit pas sans être remplacée : `drop` + `add` du MÊME nom dans UNE
-- instruction `alter table` (atomique), et seulement si elle n'admet pas encore `departement` — rejouée, rien ne bouge.
--
-- Mesuré le 24/10 (EXPLAIN (ANALYZE, BUFFERS) de l'appel, base locale, 2e passe ; « accès » = hit + read) :
--   composite 13 000 km² (127 898 carreaux)  commune 0,33 s · 36 190 (1 410)   departement 0,32 s · 26 855 (91)
--                                               cp 0,33 s · 31 712 (31 715 avant)   forme 0,29 s · 26 302 (inchangé)
--   Bouches-du-Rhône                            cp 57-60 ms · 4 650 (4 640 avant)   `couverture_rayon_poi` inchangé
--   (bornes du plan : commune ≤ 0,9 s / 47 000). Fichiers temporaires inchangés (921 blocs en CP avant et après).
-- Droits : service_role. Rejouable (`create or replace`, `if not exists`, aucun `drop` de fonction ni de table).

create index if not exists idx_unite_population_totale_maille_construit
  on public.unite_population_totale (maille, construit_le);

-- ── La jumelle : LE corps de « carreaux d'une forme », quatre codes ───────────────────────────────────────────────────
-- Règle et commentaires de sql/269 inchangés : `ST_Intersects` + `distinct on` (un centroïde sur la couture de deux
-- morceaux de `ST_Subdivide` compté une fois), l'effectif d'UNE cible, corps entièrement qualifié, pas de search_path.
create or replace function public.carreaux_de_forme_codes(p_geom geometry, p_rang integer)
returns table (carreau_id bigint, pop numeric, code_postal text, code_iris text, code_commune text, code_departement text)
language sql
stable
as $fn$
  select distinct on (cc.carreau_id) cc.carreau_id, cc.pops[p_rang]::numeric, cc.code_postal, cc.code_iris,
         cc.code_commune, cc.code_departement
    from (select public.ST_Subdivide(public.ST_Transform(p_geom, 3857), 256) as sg) z
    join public.carreau_couverture cc on cc.centroide_3857 operator(public.&&) z.sg and public.ST_Intersects(cc.centroide_3857, z.sg)
   order by cc.carreau_id
$fn$;

revoke all on function public.carreaux_de_forme_codes(geometry, integer) from public, anon, authenticated;
grant execute on function public.carreaux_de_forme_codes(geometry, integer) to service_role;

-- ── L'enveloppe mince : même signature, même type de retour qu'en sql/269 ─────────────────────────────────────────────
create or replace function public.carreaux_de_forme(p_geom geometry, p_rang integer)
returns table (carreau_id bigint, pop numeric, code_postal text, code_iris text)
language sql
stable
as $fn$
  select f.carreau_id, f.pop, f.code_postal, f.code_iris from public.carreaux_de_forme_codes(p_geom, p_rang) f
$fn$;

-- ── La date d'un dénominateur territorial (NULL : absent, ou découpage sans dénominateur) ──────────────────────────────
create or replace function public.denominateur_construit_le(p_decoupage text)
returns timestamptz
language sql
stable
set search_path to 'public', 'pg_catalog'
as $fn$
  select case p_decoupage
           when 'cp' then (select max(cp.construit_le) from public.cp_population_totale cp)
           when 'iris' then (select max(u.construit_le) from public.unite_population_totale u where u.maille = 'iris')
           when 'commune' then (select max(u.construit_le) from public.unite_population_totale u where u.maille = 'commune')
           when 'departement' then (select max(u.construit_le) from public.unite_population_totale u where u.maille = 'departement')
         end
$fn$;

comment on function public.denominateur_construit_le(text) is
  'Date de construction du denominateur d''un decoupage de couverture (cp : cp_population_totale ; iris, commune, '
  'departement : unite_population_totale), NULL s''il est absent. Lue par couverture_geometrie et '
  'couverture_zone_en_cache. sql/275 (lot 5, T3).';

revoke all on function public.denominateur_construit_le(text) from public, anon, authenticated;
grant execute on function public.denominateur_construit_le(text) to service_role;

-- ── couverture_geometrie : sql/269 + deux découpages ──────────────────────────────────────────────────────────────────
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
  if v_motif is not null then
    return jsonb_build_object('refus', 'couverture_non_construite', 'motif', v_motif);
  end if;

  with c as materialized (
    select f.carreau_id, f.pop,
           case p_decoupage when 'cp' then f.code_postal when 'iris' then f.code_iris
                            when 'commune' then f.code_commune when 'departement' then f.code_departement end as code
      from public.carreaux_de_forme_codes(v_geom, v_rang) f
     limit p_max_carreaux + 1
  ), g as materialized (
    select c.code, count(*) as n, sum(c.pop) as p from c where p_decoupage <> 'forme' group by c.code
  ), d as (
    select g.code, g.n, g.p, den.tot, den.nom, den.commune
      from g
      cross join lateral (
        select (cp.populations->>p_cible)::numeric as tot, rcp.nom_principal as nom, null::text as commune
          from public.cp_population_totale cp
          left join public.ref_codes_postaux rcp on rcp.code_postal = cp.code_postal
         where p_decoupage = 'cp' and cp.code_postal = g.code
        union all
        select (u.populations->>p_cible)::numeric,
               coalesce(i.nom_iris, rc.nom_commune, rd.nom_dept), i.nom_commune
          from public.unite_population_totale u
          left join public.iris i on p_decoupage = 'iris' and i.code_iris = u.code
          left join public.ref_communes rc on p_decoupage = 'commune' and rc.code_commune = u.code
          left join public.ref_departements rd on p_decoupage = 'departement' and rd.code_dept = u.code
         where p_decoupage <> 'cp' and u.maille = p_decoupage and u.code = g.code
        union all
        -- Un code sans dénominateur ne devrait pas exister (égalités prouvées, sql/266-267) ; s'il existait, la ligne
        -- resterait, part NULL, plutôt que de disparaître du total.
        select null::numeric, null::text, null::text
         where not exists (select 1 from public.cp_population_totale cp2 where p_decoupage = 'cp' and cp2.code_postal = g.code)
           and not exists (select 1 from public.unite_population_totale u2
                            where p_decoupage <> 'cp' and u2.maille = p_decoupage and u2.code = g.code)
         limit 1
      ) den
     where g.code is not null
  )
  select (select count(*) from c),
         (select coalesce(sum(c.pop), 0) from c),
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'code', d.code, 'nom', d.nom, 'commune', d.commune, 'n_carreaux', d.n,
                    'pop_en_zone', round(d.p), 'pop_totale', round(d.tot),
                    'part', round(100 * d.p / nullif(d.tot, 0), 1))
                  order by d.p desc, d.code), '[]'::jsonb) from d),
         (select count(*) from d),
         (select max(round(100 * d.p / nullif(d.tot, 0), 1)) from d),
         (select coalesce(sum(g.n), 0) from g where g.code is null),
         (select coalesce(sum(g.p), 0) from g where g.code is null)
    into v_n, v_pop, v_lignes, v_n_terr, v_part_max, v_hors_n, v_hors_p;

  if v_n > p_max_carreaux then
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

  select jsonb_build_object(
           'source', 'carroyage INSEE Filosofi 200 m (ménages fiscaux)',
           'millesime', (select max(cf.millesime) from public.carreaux_filosofi cf where cf.resolution = '200m'),
           'population_france', (select round(coalesce(sum((u.populations->>p_cible)::numeric), 0))
                                   from public.unite_population_totale u where u.maille = 'region'),
           'n_carreaux_france', (select k.n_lignes from public.carreau_couverture_controle k limit 1))
    into v_ref;

  return jsonb_build_object(
    'zone_id', p_zone_id,
    'cible', p_cible,
    'decoupage', p_decoupage,
    'surface_km2', round(v_surface, 1),
    'n_carreaux', v_n,
    'population', round(v_pop),
    'lignes', v_lignes,
    'hors_territoire', jsonb_build_object('n_carreaux', v_hors_n, 'population', round(v_hors_p)),
    'n_territoires', v_n_terr,
    'motif_vide', case when v_n > 0 then null
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
  'zone_trop_vaste, trop_de_carreaux, couverture_non_construite (+ motif). sql/269 (lot 4, T5), sql/275 (lot 5, T3).';

revoke all on function public.couverture_geometrie(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.couverture_geometrie(uuid, uuid, text, text, integer) to service_role;

-- ── Le cache : la contrainte admet les deux découpages ; la condition 5 les couvre ────────────────────────────────────
do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.couverture_zone_cache'::regclass
                    and conname = 'couverture_zone_cache_decoupage_check'
                    and pg_get_constraintdef(oid) like '%departement%') then
    alter table public.couverture_zone_cache
      drop constraint if exists couverture_zone_cache_decoupage_check,
      add constraint couverture_zone_cache_decoupage_check
        check (decoupage in ('forme', 'cp', 'iris', 'commune', 'departement'));
  end if;
end
$do$;

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
$fn$;

comment on function public.couverture_zone_en_cache(uuid, uuid, text, text) is
  'Chiffrage de couverture en cache (|| {cache: true, zone_maj}) s''il est encore valide — zone de l''espace, forme et '
  'base inchangees, base certifiee complete, denominateur CP / commune / departement pas plus recent que la base — '
  'sinon NULL. Lecture seule. sql/270 (lot 4, T6, T8), sql/275 (lot 5, T3).';

revoke all on function public.couverture_zone_en_cache(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.couverture_zone_en_cache(uuid, uuid, text, text) to service_role;
