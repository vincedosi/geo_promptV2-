-- ============================================================================
-- sql/307_part_disque_retenue.sql — A3 : le cercle d'un « rayon autour d'un point » n'est exact que si le disque
-- est ENTIÈREMENT en France (plan de corrections du découpage des zones, lot 1, 2026-10-31).
--
-- LE DÉFAUT. `zone_rayon` (sql/155) découpe le disque sur `france_borders` et rend `part_retenue` à la création, mais
-- ce chiffre n'était gardé nulle part : ⑤ déclarait le cercle « exact : aucune perte » pour tout `rayon_point` dans
-- les bornes de la plateforme. Or la plateforme achète le disque ENTIER, mer et étranger compris — à Strasbourg,
-- 20 km : 65,9 % du disque en France, le reste en Allemagne, une population achetée absente du bilan.
--
-- LE CORRECTIF. Le trigger d'écriture de `custom_geo_zones` (sql d'origine : `custom_geo_zones_before_write`) pose
-- `recette.part_retenue` pour toute recette `rayon_point`, à chaque écriture : création (`creer_zone_recette`),
-- recalcul (`remplacer_geometrie_zone`), duplication (`dupliquer_zone`), écriture directe. Un seul endroit, donc
-- aucune route qui l'oublie ; une valeur envoyée par le client est ÉCRASÉE (le client ne décide pas de l'exactitude).
--
-- LA MESURE : surface géodésique de la zone ÷ surface du disque `ST_Buffer(point::geography, rayon)` — le disque
-- même de `zone_rayon` (sql/155), recalculé ici sans relire `france_borders` (la zone stockée EST le disque découpé).
-- Coût : deux `ST_Area` en mémoire sur la ligne écrite, aucune table lue.
--   - Rapport ≥ 1 − 1e-6 → 1 (disque entier). La tolérance absorbe l'aller-retour GeoJSON de la forme (9 décimales) :
--     mesuré +3,5e-10 sur Clermont-Ferrand 5 km, disque entier (`ST_CoveredBy` vrai). 1e-6 d'un disque de 20 km,
--     c'est 0,001 km².
--   - Sinon, arrondi à 4 décimales et plafonné à 0,9999 : un disque qui perd 0,004 % ne s'affiche pas « 1 », et
--     l'exactitude (`exactitude`, lib/zones/conversion.ts) lit `part_retenue === 1`.
-- Mesures (31/10) : Strasbourg 20 km → 0,6586 ; Clermont-Ferrand 5 km → 1.
--
-- MER OU ÉTRANGER : NON DISTINGUÉS. `france_borders` est un unique contour terrestre (254 polygones) ; la base n'a
-- ni trait de côte séparé ni contour des pays voisins. Le message dit donc « en mer ou à l'étranger », sans ventiler.
--
-- RATTRAPAGE : les zones `rayon_point` sans `part_retenue` sont réécrites (`set recette = recette`, le trigger
-- calcule). Rejouable : la seconde passe ne trouve plus de ligne. ⚠ `updated_at` change sur ces lignes (le trigger le
-- pose), donc leur couverture en cache se relit une fois — 0 ligne en base locale le 31/10.
--
-- Rejouable (`create or replace`, aucun DROP, le trigger existant appelle déjà cette fonction). Appliquer par `psql -1`.
-- ============================================================================

create or replace function public.custom_geo_zones_before_write()
returns trigger
language plpgsql
-- Le réglage d'origine de la fonction, conservé (un `create or replace` sans lui l'effacerait).
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_part numeric;
begin
  if GeometryType(NEW.geometry) = 'POLYGON' then
    NEW.geometry := ST_Multi(NEW.geometry);
  end if;
  NEW.bbox := ST_Envelope(NEW.geometry);
  NEW.updated_at := now();

  -- A3 (sql/307) : la part du disque retenue sur le territoire, posée par la base, jamais par le client.
  if NEW.recette->>'type' = 'rayon_point'
     and jsonb_typeof(NEW.recette->'lon') = 'number' and jsonb_typeof(NEW.recette->'lat') = 'number'
     and jsonb_typeof(NEW.recette->'rayon_m') = 'number' and (NEW.recette->>'rayon_m')::numeric > 0 then
    v_part := ST_Area(NEW.geometry::geography) / nullif(ST_Area(ST_Buffer(
                ST_SetSRID(ST_MakePoint((NEW.recette->>'lon')::float8, (NEW.recette->>'lat')::float8), 4326)::geography,
                (NEW.recette->>'rayon_m')::float8)), 0);
    if v_part is not null then
      NEW.recette := NEW.recette || jsonb_build_object('part_retenue',
        case when v_part >= 1 - 1e-6 then 1 else least(round(v_part::numeric, 4), 0.9999) end);
    end if;
  end if;
  return NEW;
end
$fn$;

comment on function public.custom_geo_zones_before_write() is
  'Avant ecriture de custom_geo_zones : MultiPolygon, bbox, updated_at ; et, pour une recette rayon_point, '
  'recette.part_retenue = surface de la zone / surface du disque (1 si disque entier, a 1e-6 pres ; sinon <= 0,9999). '
  'Le cercle n''est exact que si part_retenue = 1 (A3, sql/307).';

-- Rattrapage des zones écrites avant cette migration (le trigger calcule).
update public.custom_geo_zones
   set recette = recette
 where recette->>'type' = 'rayon_point'
   and not (recette ? 'part_retenue');
