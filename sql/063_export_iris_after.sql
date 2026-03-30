-- Migration 063 — Fonction RPC export_iris_after pour génération PMTiles IRIS
-- Usage : .github/scripts/export-iris-ndjson.mjs (GitHub Actions)
-- Pagination par keyset sur code_iris (ordre alphabétique)
-- Inclut colonnes démographiques pour choroplèthe MapLibre (applyIrisColor)

CREATE OR REPLACE FUNCTION public.export_iris_after(
  p_last_code_iris text DEFAULT '',
  p_limit          int  DEFAULT 5000
)
RETURNS TABLE (
  code_iris        text,
  nom_iris         text,
  type_iris        text,
  population       bigint,
  pop_0_14         numeric,
  pop_15_29        numeric,
  pop_30_44        numeric,
  pop_45_59        numeric,
  pop_60_74        numeric,
  pop_75_plus      numeric,
  nb_menages       numeric,
  rev_median       numeric,
  rev_d1           numeric,
  rev_d9           numeric,
  taux_pauvrete    numeric,
  indice_gini      numeric,
  taux_chomage     numeric,
  taux_emploi      numeric,
  nb_emplois       numeric,
  taux_proprio     numeric,
  nb_diplome_aucun numeric,
  nb_diplome_bac   numeric,
  nb_diplome_sup   numeric,
  taux_diplome_sup numeric,
  nb_csp_cadre     numeric,
  nb_csp_employe   numeric,
  nb_csp_ouvrier   numeric,
  geom_json        text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    i.code_iris,
    i.nom_iris,
    i.type_iris,
    i.population,
    i.pop_0_14,
    i.pop_15_29,
    i.pop_30_44,
    i.pop_45_59,
    i.pop_60_74,
    i.pop_75_plus,
    i.nb_menages,
    i.rev_median,
    i.rev_d1,
    i.rev_d9,
    i.taux_pauvrete,
    i.indice_gini,
    i.taux_chomage,
    i.taux_emploi,
    i.nb_emplois,
    i.taux_proprio,
    i.nb_diplome_aucun,
    i.nb_diplome_bac,
    i.nb_diplome_sup,
    i.taux_diplome_sup,
    i.nb_csp_cadre,
    i.nb_csp_employe,
    i.nb_csp_ouvrier,
    ST_AsGeoJSON(i.geom) AS geom_json
  FROM public.iris i
  WHERE i.code_iris > p_last_code_iris
  ORDER BY i.code_iris
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.export_iris_after TO service_role;

COMMENT ON FUNCTION public.export_iris_after IS
  'Export paginé des IRIS (keyset sur code_iris) avec géométrie GeoJSON et colonnes démographiques — utilisé par GitHub Actions pour générer le fichier iris.pmtiles.';
