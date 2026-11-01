-- sql/309 — A4, tour de correction 1 (relecture I-1, décision du chef de projet du 31/10) : en zone LOCALE, une unité à
-- population inconnue est retenue si la part de SA surface comprise dans la zone atteint une TOLÉRANCE, paramètre en
-- base (défaut 0,95), au lieu de l'inclusion stricte `ST_Covers` de sql/308.
--
-- POURQUOI. Mesuré par la relecture puis revérifié le 31/10 : les contours de `ref_departements` (96 sommets pour la
-- Guadeloupe), `ref_communes` et `ref_codes_postaux` ne viennent pas de la même source. Une zone égale au contour du
-- département ne couvrait strictement que 1 commune sur 32 en 971 (3/22 en 973, 2/17 en 976) et 1 CP sur 33 (3/25, 0/11) :
-- la règle était la même pour toutes les mailles, pas le résultat.
--
-- CE QUE POSE CETTE MIGRATION.
--   1. `reglages_conversion` (cle, valeur, description) : petite table de réglages de la conversion d'une zone. Aucune
--      table de paramètres existante ne convenait (`plateformes_geo` / `plateformes_poids` sont PAR plateforme ; la
--      tolérance ne dépend d'aucune). Ligne `inclusion_surface_inconnue` = 0,95, posée une fois (une valeur réglée
--      ensuite par `update` n'est pas remise au défaut). Bornée à ]0, 1].
--   2. `reglage_conversion(p_cle)` : la valeur d'un réglage, EXCEPTION si absent (jamais de défaut caché dans le code).
--   3. `unite_inconnue_dans_zone(p_zone, p_unite)` → jsonb `{part_surface, incluse}` : LA fonction qui juge une unité à
--      population inconnue pour les trois mailles (département, commune, CP) — part de la surface de l'unité dans la
--      zone (géographie, m²), `incluse` = part ≥ tolérance lue dans `reglages_conversion`.
--   4. `couverture_geometrie` : chaque ligne inconnue porte `part_surface` (au millième) et `incluse` par cette
--      fonction ; la réponse porte `tolerance_inclusion`. `couverture_pays_jsonb` est INCHANGÉE : la zone nationale
--      garde « tout le territoire » (`incluse` = vrai).
--   5. `couverture_zone_en_cache` : un chiffrage local à lignes inconnues n'est servi que si sa `tolerance_inclusion`
--      est la tolérance COURANTE — celui de sql/308 (sans la clé) est recalculé, et un réglage changé périme le cache.
--
-- RÉSULTAT, zone = contour du département (mesuré le 31/10, tolérance 0,95) : département retenu (part 1,000) en 971,
-- 973 et 976 ; communes retenues 18/32, 21/22, 8/17 ; CP 18/32, 21/22, 6/11. Les écarts restants viennent des contours
-- (Terre-de-Haut : 34 % de sa surface dans le contour du département 971) : à 0,95, la règle ne les comble pas.
--
-- Corps recopiés de sql/308, seules les lignes marquées « A4 tour 1 » changent. Mêmes signatures, mêmes droits.
-- Rejouable (`create table if not exists`, `on conflict do nothing`, `create or replace`), aucun DROP. `psql -1`.

-- ── 1. Les réglages de la conversion ─────────────────────────────────────────────────────────────────────────────────
create table if not exists public.reglages_conversion (
  cle         text primary key,
  valeur      numeric not null,
  description text not null
);
alter table public.reglages_conversion enable row level security;
revoke all on table public.reglages_conversion from public, anon, authenticated;
grant select, insert, update on table public.reglages_conversion to service_role;

do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.reglages_conversion'::regclass and conname = 'reglages_conversion_inclusion_bornee') then
    alter table public.reglages_conversion
      add constraint reglages_conversion_inclusion_bornee
      check (cle <> 'inclusion_surface_inconnue' or (valeur > 0 and valeur <= 1));
  end if;
end
$do$;

insert into public.reglages_conversion (cle, valeur, description)
values ('inclusion_surface_inconnue', 0.95,
        'Zone locale : part minimale de la surface d''une unite a population inconnue (territoire non carroye) comprise '
        'dans la zone pour qu''elle soit retenue (A4, ARB-3 ; sql/309). La zone nationale retient tout son territoire.')
on conflict (cle) do nothing;

comment on table public.reglages_conversion is
  'Reglages de la conversion d''une zone dans une maille qui ne dependent d''aucune plateforme (sql/309, A4). '
  'Lus par reglage_conversion ; jamais ecrits en dur dans le code.';

-- ── 2. La valeur d'un réglage ────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.reglage_conversion(p_cle text)
returns numeric
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v numeric;
begin
  select r.valeur into v from public.reglages_conversion r where r.cle = p_cle;
  if v is null then
    raise exception 'reglage de conversion absent : %', p_cle using errcode = 'P0002';
  end if;
  return v;
end
$fn$;

revoke all on function public.reglage_conversion(text) from public, anon, authenticated;
grant execute on function public.reglage_conversion(text) to service_role;

-- ── 3. LA règle d'inclusion d'une unité à population inconnue ────────────────────────────────────────────────────────
create or replace function public.unite_inconnue_dans_zone(p_zone geometry, p_unite geometry)
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
  select jsonb_build_object('part_surface', round(s.part, 3),
                            'incluse', coalesce(s.part >= public.reglage_conversion('inclusion_surface_inconnue'), false))
    from (select (ST_Area(ST_Intersection(p_unite, p_zone)::geography) / nullif(ST_Area(p_unite::geography), 0))::numeric
                   as part) s
$fn$;

comment on function public.unite_inconnue_dans_zone(geometry, geometry) is
  'Une unite a population inconnue (departement, commune ou CP non carroye) et une zone : part de la surface de '
  'l''unite dans la zone, et incluse = part >= reglage inclusion_surface_inconnue. La seule regle, pour les trois '
  'mailles ; lue par couverture_geometrie (sql/309, A4).';

revoke all on function public.unite_inconnue_dans_zone(geometry, geometry) from public, anon, authenticated;
grant execute on function public.unite_inconnue_dans_zone(geometry, geometry) to service_role;

-- ── 4. couverture_geometrie : sql/308 + part de surface et tolérance (A4 tour 1) ──────────────────────────────────────
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
  v_inc      jsonb := '[]'::jsonb;  -- A4 : les lignes des unités non carroyées touchées
  v_n_inc    integer := 0;
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
    select g.code, g.n, g.p, den.tot, den.nom, den.commune,
           -- A2 : les codes de l'unité CP (le groupe indiscernable, `[code]` pour un code ordinaire), triés.
           case when p_decoupage = 'cp' then
             coalesce((select array_agg(m.code_postal order by m.code_postal)
                         from public.cp_groupe m where m.code_canonique = g.code), array[g.code]) end as membres
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
                    'part', round(100 * d.p / nullif(d.tot, 0), 1),
                    -- B11 : la part SANS arrondi, celle que le seuil compare (`estRetenue`) ; `part` reste l'affichage.
                    'part_brute', 100 * d.p / nullif(d.tot, 0))
                    -- A2 : une ligne CP = une unité ; `code` est son identifiant (le canonique), `membres` ses codes.
                    || case when d.membres is not null then jsonb_build_object('membres', to_jsonb(d.membres)) else '{}'::jsonb end
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
    'lignes', v_lignes || v_inc,  -- A4 : les unités inconnues après les chiffrées
    'hors_territoire', jsonb_build_object('n_carreaux', v_hors_n, 'population', round(v_hors_p)),
    'n_territoires', v_n_terr + v_n_inc,
    'n_inconnues', v_n_inc,  -- A4
    'tolerance_inclusion', public.reglage_conversion('inclusion_surface_inconnue'),  -- A4 tour 1 : la tolérance appliquée
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
  'zone_trop_vaste, trop_de_carreaux, couverture_non_construite (+ motif). sql/269 (lot 4, T5), sql/275 (lot 5, T3), sql/303 (B11 : part_brute, la part non arrondie que compare le seuil), sql/304 (A2 : membres, les codes de '
  'l''unite CP — groupe de CP indiscernables), sql/308 (A4 : une ligne par unite non carroyee touchee, population NULL, '
  'n_inconnues), sql/309 (A4 tour 1 : part_surface et incluse = part >= reglage inclusion_surface_inconnue, '
  'unite_inconnue_dans_zone ; tolerance_inclusion).';

revoke all on function public.couverture_geometrie(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.couverture_geometrie(uuid, uuid, text, text, integer) to service_role;

-- ── 5. couverture_zone_en_cache : sql/308 + un chiffrage local à une autre tolérance n'est plus servi (A4 tour 1) ──────
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
     -- B11 : un chiffrage d'avant sql/303 (lignes sans `part_brute`) n'est plus servi ; le calcul le remplace.
     and (jsonb_array_length(coalesce(c.resultat->'lignes', '[]'::jsonb)) = 0 or (c.resultat->'lignes'->0) ? 'part_brute')
     -- A2 : un chiffrage CP d'avant sql/304 (lignes sans `membres`) n'est plus servi ; le calcul le remplace.
     and (c.decoupage <> 'cp' or jsonb_array_length(coalesce(c.resultat->'lignes', '[]'::jsonb)) = 0
          or (c.resultat->'lignes'->0) ? 'membres')
     -- A4 : un chiffrage CP / commune / département d'avant sql/308 (sans `n_inconnues`, donc sans les unités non
     -- carroyées) n'est plus servi ; le calcul le remplace. La forme et l'IRIS n'ont pas changé : servis comme avant.
     and (c.decoupage not in ('cp', 'commune', 'departement') or c.resultat ? 'n_inconnues')
     -- A4 tour 1 : un chiffrage LOCAL à lignes inconnues jugées à une autre tolérance (ou par `ST_Covers`, sql/308, sans
     -- la clé) n'est plus servi ; une zone pays (tout le territoire) et un chiffrage sans inconnue ne dépendent pas d'elle.
     and (coalesce((c.resultat->>'n_inconnues')::integer, 0) = 0 or c.resultat ? 'pays'
          or (c.resultat->>'tolerance_inclusion')::numeric = public.reglage_conversion('inclusion_surface_inconnue'))
$fn$;

comment on function public.couverture_zone_en_cache(uuid, uuid, text, text) is
  'Chiffrage de couverture en cache (|| {cache: true, zone_maj}) s''il est encore valide — zone de l''espace, forme et '
  'base inchangees, base certifiee complete, denominateur CP / commune / departement pas plus recent que la base — '
  'sinon NULL. Lecture seule. sql/270 (lot 4, T6, T8), sql/275 (lot 5, T3), sql/303 (B11 : lignes sans part_brute non servies), sql/304 (A2 : '
  'lignes CP sans membres non servies), sql/308 (A4 : cp / commune / departement sans n_inconnues non servis), sql/309 (A4 tour 1 : '
  'lignes inconnues jugees a une autre tolerance non servies).';

revoke all on function public.couverture_zone_en_cache(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.couverture_zone_en_cache(uuid, uuid, text, text) to service_role;
