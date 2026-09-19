-- sql/144_codes_postaux_dans_bbox.sql
-- Les CP d'une bbox. centroid_lat / centroid_lon sont NULL sur les 6187 lignes
-- (regenerate_ref_codes_postaux.sql les exclut explicitement) : la colonne qui
-- porte reellement l'information est `centroid`, de type geometry, indexee GIST.
CREATE OR REPLACE FUNCTION public.codes_postaux_dans_bbox(
  p_ouest numeric, p_sud numeric, p_est numeric, p_nord numeric
) RETURNS TABLE (code_postal text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT r.code_postal
  FROM public.ref_codes_postaux r
  WHERE r.centroid && ST_MakeEnvelope(p_ouest, p_sud, p_est, p_nord, 4326);
$fn$;

REVOKE ALL ON FUNCTION public.codes_postaux_dans_bbox(numeric, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.codes_postaux_dans_bbox(numeric, numeric, numeric, numeric)
  TO service_role;
