-- sql/176 — Population exposée dans la zone de danger d'un site à risque
--
-- Chantier C de la feuille de route : « combien de personnes vivent dans le
-- périmètre de ce site Seveso ». C'est la finalité produit ; les points et la
-- zone n'étaient que ce qu'il fallait pour y arriver.
--
-- ── DEUX PIÈGES DE PROJECTION, ET POURQUOI LE CALCUL EST EN DEUX TEMPS ────
--
-- 1. Le BUFFER est construit sur `geography`, donc en mètres vrais qui suivent
--    la sphère. Le construire en 3857 (« métrique ») serait faux : à la
--    latitude de Marseille, un mètre de 3857 vaut environ 0,73 m réel — un
--    rayon « 500 m » en couvrirait 685. C'est la même raison qui a dicté
--    `zone_rayon` (sql/155) et `risques_industriels_carte` (sql/175), et la
--    zone affichée à l'écran est EXACTEMENT celle-ci : une seule définition du
--    cercle, pas une pour la carte et une pour le calcul.
-- 2. L'INTERSECTION, elle, se fait en 3857, parce que `carreaux_1km.geom_3857`
--    y est stockée avec son index GIST. On transforme donc le buffer une fois,
--    au lieu de reprojeter 374 511 mailles à chaque appel.
--
-- ── LE NOMBRE EST UNE ESTIMATION, ET LA FONCTION LE DIT ──────────────────
--
-- La population est répartie au prorata de la SURFACE de chaque maille
-- intersectée : une maille d'un kilomètre dont 30 % tombe dans le cercle
-- contribue 30 % de ses habitants. C'est l'hypothèse d'une population
-- uniforme à l'intérieur de la maille — fausse au détail, raisonnable en
-- agrégat, et la seule possible sans palier plus fin.
--
-- Le ratio de surface est calculé en 3857 : la distorsion y est identique pour
-- l'intersection et pour la maille à une même latitude, donc le RATIO reste
-- juste même si les surfaces absolues ne le sont pas.
--
-- ⚠ PRÉCISION BORNÉE PAR LE PALIER. `carreaux_1km` est le plus fin palier
--   COMPLET en base (374 511 mailles). `carreaux_filosofi` (200 m) n'est chargé
--   qu'à 200 000 lignes sur 2 298 582 — un import de test interrompu. Avec des
--   mailles d'un kilomètre, un rayon de 300 ou 500 m tombe à l'intérieur d'une
--   à quatre mailles : le résultat est un ORDRE DE GRANDEUR, pas un comptage.
--   La fonction renvoie `palier`, `n_carreaux` et `fiabilite` pour que le
--   chiffre ne circule jamais sans sa méthode.
--
-- COÛT : un `&&` sur l'index GIST puis une intersection sur quelques mailles.
-- Appelée pour UN site à la fois, au clic. Le calcul pour les 1 327 Seveso
-- d'un coup est un traitement par lots à résultat stocké — pas cette fonction.

create or replace function public.population_exposee_site(
  p_lon     double precision,
  p_lat     double precision,
  p_rayon_m integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_rayon   int := greatest(50, least(coalesce(p_rayon_m, 0), 20000));
  v_zone    geometry;
  v_result  jsonb;
begin
  if p_lon is null or p_lat is null then
    return jsonb_build_object('error', 'coordonnees_absentes', 'calculable', false);
  end if;

  -- Temps 1 : le cercle en mètres vrais, puis transformé UNE fois en 3857.
  v_zone := ST_Transform(
    ST_Buffer(ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
              v_rayon, 'quad_segs=8')::geometry,
    3857);

  -- Temps 2 : intersection avec les mailles, au prorata de la surface.
  with touchees as (
    select c.*,
           ST_Area(ST_Intersection(c.geom_3857, v_zone)) as aire_commune,
           ST_Area(c.geom_3857)                          as aire_maille
      from public.carreaux_1km c
     where c.geom_3857 && v_zone
       and ST_Intersects(c.geom_3857, v_zone)
  ),
  ponderees as (
    select *,
           case when aire_maille > 0
                then least(1.0, aire_commune / aire_maille)
                else 0 end as part
      from touchees
  )
  select jsonb_build_object(
    'calculable', true,
    'rayon_m',    v_rayon,
    'palier',     '1 km',
    'n_carreaux', count(*),
    -- `fiabilite` : un rayon plus petit que la maille ne peut pas donner un
    -- comptage. On le dit, plutot que de laisser lire un chiffre exact.
    'fiabilite',  case when v_rayon < 1000 then 'ordre_de_grandeur' else 'estimation' end,
    'population',          round(coalesce(sum(population_totale * part), 0))::bigint,
    'enfants_0_17',        round(coalesce(sum((coalesce(ind_0_3,0) + coalesce(ind_4_5,0)
                                             + coalesce(ind_6_10,0) + coalesce(ind_11_17,0)) * part), 0))::bigint,
    'seniors_65_plus',     round(coalesce(sum((coalesce(ind_65_79,0) + coalesce(ind_80p,0)) * part), 0))::bigint,
    'menages',             round(coalesce(sum(menages_total * part), 0))::bigint,
    'logements_sociaux',   round(coalesce(sum(logements_sociaux * part), 0))::bigint,
    -- Le revenu median ne s'ADDITIONNE pas : on le pondere par la population
    -- reellement retenue. Additionner des medianes n'aurait aucun sens.
    'revenu_median',       case when coalesce(sum(population_totale * part), 0) > 0
                                then round(sum(coalesce(revenu_median,0) * population_totale * part)
                                           / sum(population_totale * part))::bigint
                                else null end
  )
  into v_result
  from ponderees;

  return coalesce(v_result, jsonb_build_object('calculable', true, 'rayon_m', v_rayon,
                                               'palier', '1 km', 'n_carreaux', 0,
                                               'population', 0));
end;
$function$;

comment on function public.population_exposee_site(double precision, double precision, integer) is
  'Population estimee dans la zone de danger d un site a risque. Buffer sur GEOGRAPHY (metres vrais) puis intersection en 3857 (ou vit l index GIST de carreaux_1km). Population repartie au PRORATA DE LA SURFACE des mailles intersectees : hypothese d une population uniforme dans la maille, fausse au detail, raisonnable en agregat. Precision bornee par le palier : carreaux_1km est le plus fin palier COMPLET en base, donc un rayon < 1 km rend un ordre de grandeur et la fonction le declare (champ fiabilite). Un site a la fois, au clic ; le calcul pour les 1 327 Seveso est un traitement par lots a resultat stocke (sql/176, 2026-09-17).';
