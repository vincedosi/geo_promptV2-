-- Migration 072 — Calcul densite_pop via ST_Area (one-shot post-import)
-- Exécuter après chaque import de géométries ou de population.
-- ST_Area(geom::geography) retourne la surface en m² — diviser par 1e6 pour km².

UPDATE public.iris
SET densite_pop = ROUND(
  population::NUMERIC / NULLIF(ST_Area(geom::geography) / 1000000.0, 0)
)
WHERE population IS NOT NULL
  AND geom IS NOT NULL
  AND ST_IsValid(geom)
  AND ST_Area(geom::geography) > 0;
