-- sql/304 — A2 (plan de corrections du découpage des zones, 2026-10-31, lot 1) : le GROUPE de codes postaux
-- indiscernables devient l'unité de la maille CP, et la règle de poids d'un groupe est un paramètre du registre.
--
-- LE CONSTAT, VÉRIFIÉ DANS LA BASE LE 31/10 (et en partie infirmé).
--   Le brief craignait qu'un carreau rattaché à UN seul code d'un groupe laisse les autres membres sans population,
--   donc à part indéterminée et jamais retenus. Ce n'est pas le cas : depuis sql/228, chaque carreau est rattaché au
--   code CANONIQUE de son groupe (`cp_du_point`), `cp_population_totale` est indexée sur le canonique (6 009 lignes,
--   0 code non canonique) et `carreau_couverture` ne porte aucun code non canonique (0). Une zone qui couvre
--   Saint-Denis (93200, 93210, 93380, même contour) rend UNE ligne, 93200, à 100 % — le groupe passe le seuil entier.
--   Ce qui manquait : la ligne ne disait pas qu'elle était un groupe. Rien, dans la couverture, ne nommait 93210 ni
--   93380 ; il fallait relire `cp_groupe` à part (`lireGroupesCp`) pour le savoir.
--
-- CE QUE POSE CETTE MIGRATION.
--   1. Chaque ligne CP de `couverture_geometrie` et `couverture_pays_jsonb` porte `membres`, la liste triée des codes
--      de son unité (`[code]` pour un code ordinaire). `code` reste le canonique : c'est l'identifiant de l'unité.
--      Une ligne = une unité = une part = un multiplicateur ; l'extraction la développe en autant de codes que de
--      membres (`lib/zones/unite-cp.ts`). Les autres découpages ne portent pas la clé.
--   2. `couverture_zone_en_cache` ne sert plus un chiffrage CP sans `membres` (calculé avant cette migration) ; le
--      prochain appel recalcule et réécrit la ligne de cache, sans DELETE (même patron que sql/303).
--   3. `plateformes_geo.poids_groupe_cp` : sur une ligne CP, ce que la plateforme doit recevoir pour chaque membre
--      d'un groupe — `meme` (le multiplicateur de l'unité, répété) ou `divise` (divisé par le nombre de membres).
--      La bonne réponse dépend de la façon dont la plateforme cumule les poids d'une impression : un multiplicateur
--      d'enchère s'applique à l'impression géolocalisée dans UN code, sans cumul (→ `meme`) ; une répartition de
--      budget entre lignes cumule (→ `divise`). Aucune documentation ne le confirme pour les quatre plateformes :
--      seed `meme` (ce que fait l'extraction), et le paramètre est « à vérifier » partout.
--   4. `plateformes_geo.parametres_a_verifier` (amendement E9) : la liste des PARAMÈTRES de la ligne non confirmés,
--      au lieu du seul drapeau de ligne `a_verifier` (gardé tel quel, lu par le fichier et la maille par défaut).
--      Noms admis : `poids_groupe_cp` et les clés de `limites`. A2 n'y inscrit que `poids_groupe_cp`.
--
-- Corps recopiés de sql/303, seules les lignes marquées « A2 » changent. Mêmes signatures, mêmes droits. Rejouable
-- (`add column if not exists`, contraintes gardées, `create or replace`, mises à jour idempotentes), aucun DROP.
-- Pas de begin/commit : appliquer par `psql -1`.

-- ── 1. Le registre : poids d'un groupe de CP, et « à vérifier » par paramètre ───────────────────────────────────────
alter table public.plateformes_geo add column if not exists poids_groupe_cp text;
alter table public.plateformes_geo add column if not exists parametres_a_verifier text[] not null default '{}';

create or replace function public.plateformes_geo_parametres_valides(p text[])
returns boolean
language sql immutable set search_path to 'public' as $fn$
  select p is not null
     and p <@ array['poids_groupe_cp', 'max_unites', 'rayon_min_m', 'rayon_max_m', 'pop_min_unite', 'pop_min_groupe',
                    'max_sommets']::text[]
     and cardinality(p) = (select count(distinct x) from unnest(p) x)
$fn$;

revoke all on function public.plateformes_geo_parametres_valides(text[]) from public, anon, authenticated;
grant execute on function public.plateformes_geo_parametres_valides(text[]) to service_role;

do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.plateformes_geo'::regclass and conname = 'plateformes_geo_poids_groupe_cp_valide') then
    alter table public.plateformes_geo
      add constraint plateformes_geo_poids_groupe_cp_valide
      check (poids_groupe_cp is null or (maille = 'cp' and poids_groupe_cp in ('meme', 'divise')));
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.plateformes_geo'::regclass and conname = 'plateformes_geo_parametres_a_verifier_valides') then
    alter table public.plateformes_geo
      add constraint plateformes_geo_parametres_a_verifier_valides
      check (public.plateformes_geo_parametres_valides(parametres_a_verifier));
  end if;
end
$do$;

comment on column public.plateformes_geo.poids_groupe_cp is
  'Ligne CP seulement : ce que recoit chaque membre d''un groupe de CP indiscernables (cp_groupe) — meme (le '
  'multiplicateur de l''unite, repete) ou divise (divise par le nombre de membres). Depend du cumul des poids d''une '
  'impression chez la plateforme ; non confirme, donc dans parametres_a_verifier. NULL hors maille CP. sql/304 (A2).';
comment on column public.plateformes_geo.parametres_a_verifier is
  'Les parametres de la ligne non confirmes sur la documentation de la plateforme (amendement E9) : poids_groupe_cp '
  'ou une cle de limites. Vide = rien a verifier parmi eux. a_verifier reste le drapeau de la LIGNE. sql/304 (A2).';

-- Seed, une seule fois (ligne CP encore sans `poids_groupe_cp`) : une ligne réglée ensuite par `update` (mode
-- d'édition prévu, A-7) — valeur changée ou paramètre confirmé et retiré de la liste — n'est pas remise au seed.
update public.plateformes_geo
   set poids_groupe_cp = 'meme',
       parametres_a_verifier = case when 'poids_groupe_cp' = any (parametres_a_verifier) then parametres_a_verifier
                                    else parametres_a_verifier || '{poids_groupe_cp}'::text[] end
 where maille = 'cp' and poids_groupe_cp is null;

-- ── 2. couverture_geometrie : sql/303 + `membres` sur chaque ligne CP ───────────────────────────────────────────────
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
  'zone_trop_vaste, trop_de_carreaux, couverture_non_construite (+ motif). sql/269 (lot 4, T5), sql/275 (lot 5, T3), sql/303 (B11 : part_brute, la part non arrondie que compare le seuil), sql/304 (A2 : membres, les codes de '
  'l''unite CP — groupe de CP indiscernables).';

revoke all on function public.couverture_geometrie(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.couverture_geometrie(uuid, uuid, text, text, integer) to service_role;


-- ── 3. couverture_pays_jsonb : sql/303 + `membres` sur chaque ligne CP ───────────────────────────────────────────────────────
create or replace function public.couverture_pays_jsonb(p_code text, p_cible text, p_decoupage text)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_motif    text;
  v_base     timestamptz;
  v_denom_le timestamptz;
  v_n        bigint;
  v_pop      numeric;
  v_lignes   jsonb := '[]'::jsonb;
  v_n_terr   integer := 0;
  v_ref      jsonb;
begin
  if p_code is null or p_code not in ('METRO', 'FR') then
    raise exception 'pays inconnu : % (METRO ou FR)', p_code using errcode = '22023';
  end if;
  if p_decoupage is null or p_decoupage not in ('forme', 'cp', 'iris', 'commune', 'departement') then
    raise exception 'decoupage non autorise : % (forme, cp, iris, commune ou departement)', p_decoupage using errcode = '22023';
  end if;
  -- Trop fin pour un pays : refusé AVANT toute lecture.
  if p_decoupage in ('iris', 'commune') then
    return jsonb_build_object('refus', 'decoupage_trop_fin_pays', 'decoupage', p_decoupage);
  end if;
  if not exists (select 1 from public.cibles_exposition ce where ce.code = p_cible and ce.actif and ce.rang_pop is not null) then
    return jsonb_build_object('refus', 'cible_inconnue');
  end if;

  -- Les mêmes refus de base que couverture_geometrie : la forme se chiffre par les dénominateurs CP.
  select max(b.construit_le) into v_base from public.carreau_couverture_bandes b;
  v_motif := public.carreau_couverture_complete();
  if v_motif is null then
    v_denom_le := public.denominateur_construit_le(case p_decoupage when 'forme' then 'cp' else p_decoupage end);
    if v_denom_le is null then
      v_motif := 'denominateur_' || case p_decoupage when 'forme' then 'cp' else p_decoupage end || '_absent';
    elsif v_denom_le > v_base then
      v_motif := 'denominateur_' || case p_decoupage when 'forme' then 'cp' else p_decoupage end || '_plus_recent';
    end if;
  end if;
  if v_motif is not null then
    return jsonb_build_object('refus', 'couverture_non_construite', 'motif', v_motif);
  end if;

  select coalesce(sum(cp.n_carreaux), 0), coalesce(sum((cp.populations->>p_cible)::numeric), 0)
    into v_n, v_pop
    from public.cp_population_totale cp
   where public.pays_contient_code(p_code, cp.code_postal);

  if p_decoupage = 'cp' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', cp.code_postal, 'nom', rcp.nom_principal, 'commune', null, 'n_carreaux', cp.n_carreaux,
             'pop_en_zone', round(t.p), 'pop_totale', round(t.p), 'part', case when t.p > 0 then 100.0 end,
             'part_brute', case when t.p > 0 then 100 end,  -- B11 : exacte, mais la clé que lit `estRetenue`
             'membres', to_jsonb(m.membres))  -- A2 : les codes de l'unité CP
           order by t.p desc, cp.code_postal), '[]'::jsonb), count(*)
      into v_lignes, v_n_terr
      from public.cp_population_totale cp
      cross join lateral (select (cp.populations->>p_cible)::numeric as p) t
      -- A2 : les groupes lus UNE fois (181 lignes, n_membres > 1) puis joints par hachage ; une sous-requête par ligne
      -- coûtait 18 000 accès de plus sur la métropole (5 956 lignes : 22 879 contre 4 834 sans la clé, mesuré le 31/10).
      left join (select g.code_canonique, array_agg(g.code_postal order by g.code_postal) as codes
                   from public.cp_groupe g where g.n_membres > 1 group by g.code_canonique) grp
             on grp.code_canonique = cp.code_postal
      cross join lateral (select coalesce(grp.codes, array[cp.code_postal]) as membres) m
      left join public.ref_codes_postaux rcp on rcp.code_postal = cp.code_postal
     where public.pays_contient_code(p_code, cp.code_postal);
  elsif p_decoupage = 'departement' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', u.code, 'nom', rd.nom_dept, 'commune', null, 'n_carreaux', u.n_carreaux,
             'pop_en_zone', round(t.p), 'pop_totale', round(t.p), 'part', case when t.p > 0 then 100.0 end,
             'part_brute', case when t.p > 0 then 100 end)  -- B11
           order by t.p desc, u.code), '[]'::jsonb), count(*)
      into v_lignes, v_n_terr
      from public.unite_population_totale u
      cross join lateral (select (u.populations->>p_cible)::numeric as p) t
      left join public.ref_departements rd on rd.code_dept = u.code
     where u.maille = 'departement' and public.pays_contient_code(p_code, u.code);
  end if;

  select jsonb_build_object(
           'source', 'carroyage INSEE Filosofi 200 m (ménages fiscaux)',
           'millesime', (select max(cf.millesime) from public.carreaux_filosofi cf where cf.resolution = '200m'),
           'population_france', (select round(coalesce(sum((u.populations->>p_cible)::numeric), 0))
                                   from public.unite_population_totale u where u.maille = 'region'),
           'n_carreaux_france', (select k.n_lignes from public.carreau_couverture_controle k limit 1))
    into v_ref;

  return jsonb_build_object(
    'pays', p_code,
    'cible', p_cible,
    'decoupage', p_decoupage,
    'n_carreaux', v_n,
    'population', round(v_pop),
    'lignes', v_lignes,
    'hors_territoire', jsonb_build_object('n_carreaux', 0, 'population', 0),
    'n_territoires', v_n_terr,
    'motif_vide', case when v_n > 0 then null else 'aucun_carreau' end,
    'territoires_non_carroyes', '[]'::jsonb,
    'reference', v_ref,
    'base_construite_le', v_base,
    'calcule_le', now()
  );
end
$fn$;

comment on function public.couverture_pays_jsonb(text, text, text) is
  'Couverture nationale d''une zone pays (METRO / FR) sans lire un carreau : forme = somme de cp_population_totale ; '
  'cp = chaque CP du pays a 100 % ; departement = unite_population_totale ; iris et commune refuses '
  '(decoupage_trop_fin_pays) sans lecture. Memes cles que couverture_geometrie + pays. sql/296 (T2), sql/303 (B11 : part_brute), sql/304 (A2 : membres '
  'des lignes CP).';

revoke all on function public.couverture_pays_jsonb(text, text, text) from public, anon, authenticated;
grant execute on function public.couverture_pays_jsonb(text, text, text) to service_role;


-- ── 4. couverture_zone_en_cache : sql/303 + un chiffrage CP sans `membres` n'est plus servi ─────────────────────────────
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
$fn$;

comment on function public.couverture_zone_en_cache(uuid, uuid, text, text) is
  'Chiffrage de couverture en cache (|| {cache: true, zone_maj}) s''il est encore valide — zone de l''espace, forme et '
  'base inchangees, base certifiee complete, denominateur CP / commune / departement pas plus recent que la base — '
  'sinon NULL. Lecture seule. sql/270 (lot 4, T6, T8), sql/275 (lot 5, T3), sql/303 (B11 : lignes sans part_brute non servies), sql/304 (A2 : '
  'lignes CP sans membres non servies).';

revoke all on function public.couverture_zone_en_cache(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.couverture_zone_en_cache(uuid, uuid, text, text) to service_role;
