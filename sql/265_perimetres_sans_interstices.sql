-- sql/265 — Des périmètres département et région SANS INTERSTICES (lot 4, T2, arbitrage A-5).
--
-- POURQUOI. `ref_departements.geom` et `ref_regions.geom` sont des unions de communes simplifiées : la simplification
-- laisse entre deux communes voisines des fentes qui deviennent des TROUS intérieurs de l'union. Mesuré le 22/10 :
-- 45 834 trous sur les départements (47 310 sur les régions), 1 976 km². Dans les Bouches-du-Rhône, 678 trous
-- (21,7 km², le plus grand 0,78 km²) avalaient 356 carreaux Filosofi et 78 834 habitants — 4,3 % du département,
-- dont le centre d'Aix : d'où « 13100 couvert à 92,5 % par les Bouches-du-Rhône ». Tout calcul qui lit le périmètre
-- par centroïde (zone_seuil_carreaux, sql/255) ou qui le découpe (zone_rayon_poi, sql/254) en était faussé.
--
-- LA RÈGLE. Un trou est BOUCHÉ, sauf s'il est une vraie enclave :
--   (a) des communes d'une AUTRE unité en couvrent plus de la moitié (aire d'intersection cumulée) — pour un
--       département, `ref_communes.code_dept` ≠ le code ; pour une région, `ref_communes.code_region` ≠ le code
--       (vérifié le 22/10 : il égale `ref_departements.code_region` du département de la commune, sur 34 921
--       communes, aucune exception) ;
--   (b) ou les communes françaises en couvrent MOINS de la moitié et il dépasse 5 km² (Llívia, ville espagnole).
--       « Moins de la moitié » et non « aucune commune » comme l'écrivait le plan : les contours simplifiés de deux
--       communes voisines débordent sur Llívia (14,9 % de son trou), et la règle « aucune » l'aurait bouchée.
-- Cumulée et non « UNE commune à plus de 50 % » : l'enclave des Papes compte quatre communes du Vaucluse dont la
-- plus grande, Valréas, n'en couvre que 42 %.
--
-- Trous gardés, mesurés le 22/10 (départements) : 26 enclave des Papes 129,8 km² (Grillon, Richerenches, Valréas,
-- Visan) · 64 enclaves des Hautes-Pyrénées 41,5 (Escaunets, Séron, Luquet, Gardères) · 62 communes du Nord 23,5
-- (Doignies, Boursies, Mœuvres) · 66 Llívia 11,4 · 55 Othe (54) 2,4 · 02 Vauciennes et Ivors (60) 0,66 + 0,04 + 0,03
-- · 71 Chêne-Sec (39) 0,09 + 0,02 · 61 Pont-d'Ouilly (14) 0,05 · 53 Segré-en-Anjou Bleu (49) 0,02.
-- Régions : les enclaves dont les deux départements sont de la même région (62/59, 55/54, 02/60, 71/39, 61/14, 53/49)
-- y sont bouchées ; restent l'enclave des Papes (84 ARA / 93 PACA), les Hautes-Pyrénées (75 / 76) et Llívia (76).
--
-- `geom` reste INTACTE (tuiles, React, filtres de carte). Seul `resoudre_perimetre` lit la nouvelle colonne.
-- Effet assumé (A-5) : une zone du lot 3 dont la recette part d'un département ou d'une région prend une forme pleine
-- à son prochain recalcul ; une zone référencée par un jeu ou une stratégie n'est pas recalculable (spec A-2) et
-- garde ses trous jusqu'au lot 5. Le 22/10, aucune zone de `custom_geo_zones` n'avait une telle recette.
--
-- REJOUABLE : la colonne n'est calculée que là où elle est NULL ; une seconde application ne recalcule rien.
-- Pour FORCER le recalcul (contours de référence rechargés ; `11-reconstruire.sh` le fait avec FORCER_PERIMETRES=1) :
--   docker exec -i supabase_db_genesis_app psql -U postgres -v forcer_perimetres=1 < sql/265_perimetres_sans_interstices.sql
-- ⚠ `\if :{?forcer_perimetres}` force dès que la variable est DÉFINIE, même à 0. C'est une méta-commande psql : cette
-- migration ne passe que par psql (pas par un éditeur SQL ni `apply_migration`).
-- Durée mesurée du remplissage complet : 17,2 s en local (rapport de T2).

alter table public.ref_departements add column if not exists geom_perimetre geometry(MultiPolygon, 4326);
alter table public.ref_regions      add column if not exists geom_perimetre geometry(MultiPolygon, 4326);

comment on column public.ref_departements.geom_perimetre is
  'geom dont les interstices de couture entre communes sont bouchés, vraies enclaves gardées (boucher_interstices). Lue par resoudre_perimetre. sql/265.';
comment on column public.ref_regions.geom_perimetre is
  'geom dont les interstices de couture entre communes sont bouchés, vraies enclaves gardées (boucher_interstices). Lue par resoudre_perimetre. sql/265.';

-- GIST : aucune lecture spatiale aujourd'hui (`resoudre_perimetre` lit par code), mais la colonne remplace `geom` pour
-- tout calcul à venir qui chercherait un département PAR POSITION ; sans coût sur 122 lignes.
create index if not exists idx_ref_dept_geom_perimetre    on public.ref_departements using gist (geom_perimetre);
create index if not exists idx_ref_regions_geom_perimetre on public.ref_regions      using gist (geom_perimetre);

create or replace function public.boucher_interstices(p_geom geometry, p_code text, p_niveau text)
returns geometry
language plpgsql
stable  -- lit ref_communes : IMMUTABLE serait faux
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_poly geometry;
  v_anneau geometry;
  v_trou geometry;
  v_gardes geometry[];
  v_polys geometry[] := '{}';
  v_aire float8;
  v_autre float8;
  v_toutes float8;
begin
  if p_niveau is null or p_niveau not in ('departement', 'region') then
    raise exception 'niveau inconnu (%) : departement ou region', p_niveau using errcode = '22023';
  end if;
  if p_geom is null or ST_IsEmpty(p_geom) then
    return null;
  end if;

  -- CollectionExtract : 66 départements et 14 régions sont des GEOMETRYCOLLECTION qui portent des LINESTRING
  -- résiduelles de l'union (199 et 92, mesuré le 22/10) ; un périmètre est une surface, elles tombent.
  for v_poly in select (ST_Dump(ST_CollectionExtract(p_geom, 3))).geom loop
    v_gardes := '{}';
    for i in 1 .. ST_NumInteriorRings(v_poly) loop
      v_anneau := ST_InteriorRingN(v_poly, i);
      v_trou := ST_MakePolygon(v_anneau);
      v_aire := ST_Area(v_trou);  -- en degrés² : seuls des RAPPORTS d'aires sont comparés ici
      select coalesce(sum(a) filter (where autre), 0), coalesce(sum(a), 0)
        into v_autre, v_toutes
        from (
          select ST_Area(ST_Intersection(c.geom, v_trou)) as a,
                 case p_niveau when 'departement' then c.code_dept is distinct from p_code
                               else c.code_region is distinct from p_code end as autre
            from public.ref_communes c
           where c.geom && v_trou
        ) x;
      if v_autre > 0.5 * v_aire
         or (v_toutes < 0.5 * v_aire and ST_Area(v_trou::geography) > 5e6) then
        v_gardes := v_gardes || v_anneau;
      end if;
    end loop;
    v_polys := v_polys || ST_MakePolygon(ST_ExteriorRing(v_poly), v_gardes);
  end loop;

  -- Union et non simple collecte : un polygone de l'unité posé DANS un trou bouché le chevaucherait désormais.
  return ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_UnaryUnion(ST_Collect(v_polys))), 3));
end
$fn$;

comment on function public.boucher_interstices(geometry, text, text) is
  'Bouche les trous intérieurs d''un contour de département ou de région, sauf les vraies enclaves (communes d''une autre unité > 50 %, ou zone étrangère > 5 km²). sql/265.';

revoke all on function public.boucher_interstices(geometry, text, text) from public, anon, authenticated;
grant execute on function public.boucher_interstices(geometry, text, text) to service_role;

\if :{?forcer_perimetres}
  update public.ref_departements set geom_perimetre = null where geom_perimetre is not null;
  update public.ref_regions      set geom_perimetre = null where geom_perimetre is not null;
\endif

-- Remplissage UNE ligne à la fois, progression affichée (traitement par lots, CLAUDE.md).
do $$
declare
  r record;
  v_n integer := 0;
  v_total integer;
  v_t0 timestamptz := clock_timestamp();
begin
  select count(*) into v_total from public.ref_departements where geom_perimetre is null and geom is not null;
  for r in select code_dept from public.ref_departements where geom_perimetre is null and geom is not null order by code_dept loop
    update public.ref_departements set geom_perimetre = public.boucher_interstices(geom, code_dept, 'departement')
     where code_dept = r.code_dept;
    v_n := v_n + 1;
    raise notice '[départements %/%] % — % s', v_n, v_total, r.code_dept,
      round(extract(epoch from clock_timestamp() - v_t0)::numeric, 1);
  end loop;

  v_n := 0;
  select count(*) into v_total from public.ref_regions where geom_perimetre is null and geom is not null;
  for r in select code_region from public.ref_regions where geom_perimetre is null and geom is not null order by code_region loop
    update public.ref_regions set geom_perimetre = public.boucher_interstices(geom, code_region, 'region')
     where code_region = r.code_region;
    v_n := v_n + 1;
    raise notice '[régions %/%] % — % s', v_n, v_total, r.code_region,
      round(extract(epoch from clock_timestamp() - v_t0)::numeric, 1);
  end loop;
  raise notice 'périmètres sans interstices : terminé en % s', round(extract(epoch from clock_timestamp() - v_t0)::numeric, 1);
end
$$;

-- resoudre_perimetre : À L'IDENTIQUE de sql/253, à deux lignes près (region et departement lisent
-- coalesce(geom_perimetre, geom)). Signature, refus, commune, CP et zone inchangés.
create or replace function public.resoudre_perimetre(
  p_type text, p_code text, p_org_id uuid, p_max_km2 numeric, p_types_admis text[],
  out g geometry, out refus text
)
language plpgsql
stable
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_nom text;
  v_n integer;
begin
  g := null;
  refus := null;
  if p_type = 'france' then
    refus := 'perimetre_national_refuse';
    return;
  end if;
  if p_type is null or not (p_type = any (coalesce(p_types_admis, '{}'::text[]))) then
    refus := 'perimetre_non_admis';
    return;
  end if;

  case p_type
    when 'region' then
      select ST_Multi(coalesce(geom_perimetre, geom)) into g from public.ref_regions where code_region = p_code;
    when 'departement' then
      select ST_Multi(coalesce(geom_perimetre, geom)) into g from public.ref_departements where code_dept = p_code;
    when 'cp' then
      select ST_Multi(geom) into g from public.ref_codes_postaux where code_postal = p_code limit 1;
    when 'commune' then
      -- ① met la saisie en minuscules : un code corse arrive « 2a004 » — comparé en majuscules.
      if upper(trim(p_code)) ~ '^[0-9][0-9AB][0-9]{3}$' then
        select ST_Multi(geom) into g from public.ref_communes where code_commune = upper(trim(p_code));
      else
        v_nom := lower(unaccent(trim(p_code)));
        select count(*), ST_Multi(ST_Union(geom)) into v_n, g
          from public.ref_communes where lower(unaccent(nom_commune)) = v_nom;
        if v_n > 1 then
          g := null;
          refus := 'commune_ambigue';
          return;
        end if;
        if v_n = 0 then
          -- Paris, Lyon, Marseille : ref_communes ne porte que leurs arrondissements.
          -- Préfixe comparé par `left()` et non par une regex construite sur la saisie : aucun échappement à écrire.
          -- Vérifié le 14/10 (SELECT) : marseille 16 / 235 km², paris 20 / 105 km², lyon 9 / 48 km².
          select ST_Multi(ST_Union(geom)) into g
            from public.ref_communes
           where left(lower(unaccent(nom_commune)), length(v_nom) + 1) = v_nom || ' '
             and lower(unaccent(nom_commune)) ~ '^[^0-9]+ [0-9]+(er|e) arrondissement$';
        end if;
      end if;
    when 'zone' then
      -- plpgsql et non sql : un cast ::uuid d'un code invalide lèverait, même derrière un CASE replié à la planification.
      -- lower() : un UUID en majuscules désigne la même zone (revue T3).
      if lower(trim(p_code)) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        select z.geometry into g from public.custom_geo_zones z
         where z.id = lower(trim(p_code))::uuid and z.org_id = p_org_id;
      end if;
    else
      g := null;
  end case;

  if g is null or ST_IsEmpty(g) then
    g := null;
    refus := 'perimetre_inconnu';
  elsif ST_Area(g::geography) / 1e6 > p_max_km2 then
    g := null;
    refus := 'perimetre_trop_grand';
  end if;
end
$fn$;

revoke all on function public.resoudre_perimetre(text, text, uuid, numeric, text[]) from public, anon, authenticated;
grant execute on function public.resoudre_perimetre(text, text, uuid, numeric, text[]) to service_role;
