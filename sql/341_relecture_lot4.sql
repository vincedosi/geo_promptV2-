-- sql/341 — relecture finale du lot 4 (découpage des zones, 03/11) : deux corrections.
--
-- 1. I-1 (D33, sql/338) : `pavage_cercles_en_cache` ne vérifiait pas le minimum de ménages de la cible, alors que
--    `couverture_zone_en_cache` le fait (sql/339) : changer `reglages_conversion.min_menages_cible` laissait servir un
--    pavage compté à l'ancien minimum. Même condition ajoutée, sur `resultat->>'min_menages'` (un refus géométrique
--    n'en porte pas et n'en dépend pas : il reste servi). Et `paver_cercles_md5()` couvre désormais les fonctions
--    qu'appelle `paver_cercles` (`carreaux_de_forme_menages`, `cellule_hex`, `centre_hex`, `territoire_grille`,
--    `territoires_non_carroyes`, `min_menages_de_cible`) : en remplacer une périme le cache.
--    ANGLE MORT ASSUMÉ : un seul niveau. Une fonction appelée par CELLES-CI (deuxième niveau) n'entre pas dans le md5 ;
--    les données lues (carreaux, territoires) sont gardées par `base_couverture_e7_le()` et le certificat, pas ici.
--    Changer cette liste exige de la tenir à jour à la main quand `paver_cercles` appelle une nouvelle fonction.
--    Effet de bord voulu : le md5 change une fois, toutes les lignes existantes sont repavées à leur prochaine lecture.
-- 2. Mineur (D37, sql/340) : `morceaux_retires` valait `morceaux_avant − morceaux`, ce qui comptait aussi un morceau
--    FUSIONNÉ par la réparation de la forme simplifiée. Il compte désormais les seuls morceaux sous
--    `polygone_morceau_min_km2` (solution retenue : la plus simple, la clé et les textes ne changent pas).
--
-- Rejouable : `create or replace` aux mêmes signatures et types de retour, aucun DROP. Appliquer par `psql -1`.

-- ── 1. Le md5 de paver_cercles et des fonctions qu'elle appelle ──────────────────────────────────────────────────────
create or replace function public.paver_cercles_md5()
returns text
language sql
stable
set search_path to 'public', 'pg_catalog'
as $fn$
  select md5(string_agg(pg_get_functiondef(p.oid), ';' order by p.proname, p.oid::regprocedure::text))
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('paver_cercles', 'carreaux_de_forme_menages', 'cellule_hex', 'centre_hex', 'territoire_grille',
                       'territoires_non_carroyes', 'min_menages_de_cible')
$fn$;

comment on function public.paver_cercles_md5() is
  'md5 des definitions courantes de paver_cercles et des fonctions qu''elle appelle (un niveau : carreaux_de_forme_menages, '
  'cellule_hex, centre_hex, territoire_grille, territoires_non_carroyes, min_menages_de_cible) : en remplacer une perime '
  'pavage_cercles_cache. Angle mort : le deuxieme niveau d''appel. sql/338 (D33), sql/341.';

revoke all on function public.paver_cercles_md5() from public, anon, authenticated;
grant execute on function public.paver_cercles_md5() to service_role;

-- ── 1 bis. Le pavage en cache : minimum de ménages vérifié ───────────────────────────────────────────────────────────
create or replace function public.pavage_cercles_en_cache(
  p_zone_id uuid,
  p_org_id uuid,
  p_cible text,
  p_rayon_m integer,
  p_seuil numeric,
  p_pop_min integer default 0,
  p_max_cercles integer default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
  select c.resultat || jsonb_build_object('cache', true, 'zone_maj', c.zone_maj)
    from public.pavage_cercles_cache c
    join public.custom_geo_zones g on g.id = c.zone_id
   where c.zone_id = p_zone_id
     and c.cible = p_cible
     and c.rayon_m = p_rayon_m
     and c.seuil = p_seuil
     and c.pop_min = coalesce(p_pop_min, 0)
     and c.max_cercles = coalesce(p_max_cercles, 0)
     and g.org_id = p_org_id
     and c.zone_maj = g.updated_at
     and c.base_construite_le = public.base_couverture_e7_le()
     and public.carreau_couverture_complete() is null
     and c.fonction_md5 = public.paver_cercles_md5()
     -- sql/341 (I-1) : le minimum de ménages compté est celui du réglage COURANT (règle de sql/339) ; un refus
     -- géométrique n'en porte pas et n'en dépend pas.
     and (c.resultat ? 'refus'
          or (c.resultat->>'min_menages')::numeric is not distinct from public.min_menages_de_cible(c.cible))
$fn$;

comment on function public.pavage_cercles_en_cache(uuid, uuid, text, integer, numeric, integer, integer) is
  'Pavage en cercles en cache (|| {cache: true, zone_maj}) s''il est encore valide — zone de l''espace, forme, base, '
  'definitions (paver_cercles_md5) et minimum de menages de la cible inchanges, base certifiee — sinon NULL. Lecture '
  'seule. sql/338 (D33), sql/341.';

revoke all on function public.pavage_cercles_en_cache(uuid, uuid, text, integer, numeric, integer, integer) from public, anon, authenticated;
grant execute on function public.pavage_cercles_en_cache(uuid, uuid, text, integer, numeric, integer, integer) to service_role;

-- ── 2. La mesure du polygone : morceaux retirés = morceaux sous le minimum (corps de sql/340, lignes « sql/341 ») ────
create or replace function public.simplification_polygone_plateforme(
  p_zone_id uuid, p_org_id uuid, p_cible text, p_plateforme text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  -- Borne de SÉCURITÉ des carreaux lus dans la bande : celle de `couverture_geometrie` (400 000).
  c_max_carreaux constant integer := 400000;
  v_geom     geometry;
  v_simple   geometry;
  v_geom_m   geometry;
  v_simple_m geometry;
  v_tol      numeric;
  v_min_km2  numeric;
  v_smax     integer;
  v_mmax     integer;
  v_n0       integer;
  v_m0       integer;
  v_sous     boolean;
  v_rang     integer;
  v_rang_men integer;
  v_min      numeric;
  v_n_lus    bigint := 0;
  v_perdue   numeric := 0;
  v_gagnee   numeric := 0;
  v_retires  integer := 0;
begin
  select g.geometry into v_geom from public.custom_geo_zones g where g.id = p_zone_id and g.org_id = p_org_id;
  if v_geom is null then
    return jsonb_build_object('refus', 'zone_introuvable');
  end if;
  select ce.rang_pop into v_rang from public.cibles_exposition ce
   where ce.code = p_cible and ce.actif and ce.rang_pop is not null;
  if v_rang is null then
    return jsonb_build_object('refus', 'cible_inconnue');
  end if;
  -- A5 : le minimum de ménages de la cible, la règle de `couverture_geometrie` (0 pour la population totale).
  v_min := public.min_menages_de_cible(p_cible);
  select ce.rang_pop into v_rang_men from public.cibles_exposition ce where ce.code = 'men' and ce.rang_pop is not null;
  if v_min > 0 and v_rang_men is null then
    raise exception 'cible men (menages) absente de cibles_exposition : le minimum ne peut pas se lire' using errcode = '55000';
  end if;

  -- Les bornes de la plateforme (NULL = aucune limite connue) ; sans plateforme : aucune borne.
  if p_plateforme is not null then
    select pg.polygone_sommets_max, pg.polygone_morceaux_max into v_smax, v_mmax
      from public.plateformes_geo pg where pg.plateforme = p_plateforme and pg.maille = 'polygone';
    if not found then
      return jsonb_build_object('refus', 'regle_introuvable');
    end if;
  end if;

  -- D37 : les deux réglages, lus UNE fois ici et rendus dans la mesure (l'écriture les relit dans le résumé).
  v_tol := public.reglage_conversion('simplification_polygone_m');
  v_min_km2 := public.reglage_conversion('polygone_morceau_min_km2');

  v_n0 := ST_NPoints(v_geom);
  v_m0 := ST_NumGeometries(v_geom);
  v_simple := public.forme_extraction_polygone(v_geom, v_tol, v_min_km2);
  if v_simple is null then
    return jsonb_build_object('refus', 'morceaux_tous_retires', 'morceaux_avant', v_m0, 'morceau_min_km2', v_min_km2);
  end if;
  -- Relecture lot 4 (sql/341) : `morceaux_retires` compte les seuls morceaux SOUS le minimum, jamais un morceau
  -- fusionné par la réparation de `forme_simplifiee` (`ST_MakeValid`) ; relu seulement si le nombre a changé.
  if ST_NumGeometries(v_simple) <> v_m0 then
    select count(*) into v_retires
      from ST_Dump(public.forme_simplifiee(v_geom, v_tol)) d
     where ST_Area(d.geom::geography) < v_min_km2 * 1e6;
  end if;
  v_sous := (v_smax is null or ST_NPoints(v_simple) <= v_smax) and (v_mmax is null or ST_NumGeometries(v_simple) <= v_mmax);

  -- La bande (morceaux retirés compris), lue seulement si la forme envoyée passe (un refus n'a pas de perte à dire).
  if v_sous and v_simple is distinct from v_geom then
    v_geom_m := ST_Transform(v_geom, 3857);
    v_simple_m := ST_Transform(v_simple, 3857);
    with b as materialized (
      select f.pop,
             ST_Intersects(f.centroide_3857, v_geom_m)   as dans_zone,
             ST_Intersects(f.centroide_3857, v_simple_m) as dans_simple
        from public.carreaux_de_forme_menages(ST_SymDifference(v_geom, v_simple), v_rang, coalesce(v_rang_men, v_rang)) f
       where v_min = 0 or f.men >= v_min
       limit c_max_carreaux + 1
    )
    select count(*),
           coalesce(sum(b.pop) filter (where b.dans_zone and not b.dans_simple), 0),
           coalesce(sum(b.pop) filter (where b.dans_simple and not b.dans_zone), 0)
      into v_n_lus, v_perdue, v_gagnee
      from b;
    if v_n_lus > c_max_carreaux then
      return jsonb_build_object('refus', 'trop_de_carreaux', 'plafond', c_max_carreaux);
    end if;
  end if;

  return jsonb_build_object(
    'tolerance_m', v_tol,
    'morceau_min_km2', v_min_km2,
    'simplifiee', v_simple is distinct from v_geom,
    'sous_bornes', v_sous,
    'sommets_max', v_smax,
    'morceaux_max', v_mmax,
    'sommets_avant', v_n0,
    'morceaux_avant', v_m0,
    'sommets', ST_NPoints(v_simple),
    'morceaux', ST_NumGeometries(v_simple),
    'morceaux_retires', v_retires,
    'carreaux_bande', v_n_lus,
    'perdue', round(v_perdue),
    'gagnee', round(v_gagnee),
    'min_menages', v_min,
    'seuil_perte_affichee', public.reglage_conversion('perte_simplification_affichee')
  );
end
$fn$;
comment on function public.simplification_polygone_plateforme(uuid, uuid, text, text) is
  'Extraction en maille polygone (D37) : forme envoyee = forme_extraction_polygone(zone, simplification_polygone_m, '
  'polygone_morceau_min_km2) — 50 m toujours, morceaux sous 0,04 km2 retires ; sommets / morceaux contre les bornes de '
  'plateformes_geo (sous_bornes) ; population perdue / gagnee sur la seule bande (carreaux_de_forme_menages, minimum de '
  'menages), morceaux retires compris ; morceaux_retires = morceaux sous le minimum seulement. Refus '
  'morceaux_tous_retires. sql/313, sql/340, sql/341.';
revoke all on function public.simplification_polygone_plateforme(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.simplification_polygone_plateforme(uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
