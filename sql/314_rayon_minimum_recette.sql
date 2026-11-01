-- 314 — Rayon minimal de la recette « rayon autour d'un point » : 250 m (B8, ARB-5 = A, Vincent, 31/10/2026)
--
-- Le minimum passe de 100 m à 250 m (`RAYON_POINT_MIN_M`, lib/zones/recette.ts) : sous ce rayon le disque est plus
-- petit qu'un carreau Filosofi (200 m de côté), et aucune plateforme ne l'achète exactement (DV360, Meta : 1 km au
-- moins, lus dans `plateformes_geo`). Le minimum d'une NOUVELLE recette se pose côté serveur (`refusPerimetreLocal` →
-- `rayon_sous_minimum`, et la route `/api/custom-geo/source/rayon`) ; la base n'a pas de CHECK de rayon (le CHECK
-- `custom_geo_zones_recette_forme`, sql/253, ne regarde que `v` et `type`) et n'en reçoit pas ici : il refuserait la
-- ligne existante au prochain UPDATE (le recalcul, le trigger de sql/307).
--
-- Les recettes DÉJÀ enregistrées sous 250 m ne sont PAS modifiées (aucun ajustement silencieux, règle 5) :
--   - leur recette et leur forme restent telles quelles (relever le rayon sans recalculer la forme ferait mentir
--     l'une ou l'autre) ;
--   - elles sont MARQUÉES dans `source_metadata.rayon_sous_minimum` = { rayon_m, minimum_m, marque_le, ticket } ;
--   - à la réouverture, l'écran le dit (libellé de la recette « — sous le minimum de 250 m, ne se recalcule plus »)
--     et le recalcul est refusé avec le message `rayon_sous_minimum` (recréer la zone) ;
--   - en ⑤, leur maille cercle n'est jamais exacte (bornes des plateformes) et l'avertissement `rayon_min` le dit.
-- La migration COMPTE avant et après (RAISE NOTICE) : recettes sous le minimum, dont non marquées.
-- Mesuré le 01/11 sur la base locale : 0 recette rayon_point sous 250 m (une seule recette à rayon, un rayon_poi de
-- 5 km) — la migration ne marque rien aujourd'hui ; elle reste le chemin écrit pour une base qui en aurait.
--
-- Coût : un parcours de custom_geo_zones filtré sur `recette->>'type'` (quelques dizaines de lignes, aucune
-- géométrie lue). Rejouable : une ligne déjà marquée n'est pas réécrite (le second passage marque 0 ligne). Aucun DROP.

begin;

do $$
declare
  v_minimum constant integer := 250;  -- RAYON_POINT_MIN_M (lib/zones/recette.ts), verrouillé par tests/unit/zones/recette.test.ts
  v_sous integer;
  v_non_marquees integer;
  v_marquees integer;
begin
  select count(*), count(*) filter (where not coalesce(source_metadata ? 'rayon_sous_minimum', false))
    into v_sous, v_non_marquees
    from public.custom_geo_zones
   where recette->>'type' = 'rayon_point'
     and jsonb_typeof(recette->'rayon_m') = 'number'
     and (recette->>'rayon_m')::numeric < v_minimum;
  raise notice 'B8 avant : % recette(s) rayon_point sous % m, dont % non marquée(s)', v_sous, v_minimum, v_non_marquees;

  update public.custom_geo_zones
     set source_metadata = coalesce(source_metadata, '{}'::jsonb) || jsonb_build_object('rayon_sous_minimum', jsonb_build_object(
           'rayon_m', (recette->>'rayon_m')::numeric, 'minimum_m', v_minimum, 'marque_le', '2026-11-01', 'ticket', 'B8'))
   where recette->>'type' = 'rayon_point'
     and jsonb_typeof(recette->'rayon_m') = 'number'
     and (recette->>'rayon_m')::numeric < v_minimum
     and not coalesce(source_metadata ? 'rayon_sous_minimum', false);
  get diagnostics v_marquees = row_count;

  select count(*), count(*) filter (where not coalesce(source_metadata ? 'rayon_sous_minimum', false))
    into v_sous, v_non_marquees
    from public.custom_geo_zones
   where recette->>'type' = 'rayon_point'
     and jsonb_typeof(recette->'rayon_m') = 'number'
     and (recette->>'rayon_m')::numeric < v_minimum;
  raise notice 'B8 après : % marquée(s) par ce passage ; % recette(s) rayon_point sous % m (rayon inchangé), dont % non marquée(s)',
    v_marquees, v_sous, v_minimum, v_non_marquees;
end $$;

comment on column public.custom_geo_zones.recette is
  'Recette de la zone (lib/zones/recette.ts, v=1) : ce qui la recalcule. NULL = forme figee (zones d avant le 2026-10-14). sql/253. '
  'B8 (sql/314) : une recette rayon_point sous 250 m (minimum du 31/10) n est pas modifiee ; elle est marquee dans '
  'source_metadata.rayon_sous_minimum et ne se recalcule plus.';

commit;
