-- ============================================================================
-- sql/287_codes_postaux_metropole.sql — 2026-10-27 (retours du 26/10, relecture 2, I-2)
--
-- `codes_postaux_du_perimetre_jsonb('france', p_code)` ignorait `p_code` : la
-- pastille « France Metro » (Angular, `FILTRE_METROPOLE`, code `metro`) faisait
-- scorer les 6 187 CP, outre-mer compris, et enregistrait l'analyse sous le nom
-- « Score composite — France métropolitaine ». Branche ajoutée : `code = metro`
-- (casse ignorée) → les CP hors départements 97x / 98x (6 051 en base locale le
-- 27/10). Tout autre code de `france` garde la France entière, comme avant.
--
-- CREATE OR REPLACE, même signature, aucun DROP (base locale partagée). Le
-- reste du corps est celui de sql/168, à l'identique (lu en base par
-- pg_get_functiondef). L'enveloppe RETURNS TABLE `codes_postaux_du_perimetre`
-- (sql/169) l'appelle : elle suit sans retouche.
--
-- Mesuré le 27/10 (base locale, EXPLAIN ANALYZE du SELECT de la branche,
-- cache chaud) : voir le rapport de T4, section « Relecture 2 ».
--
-- Rejouable.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.codes_postaux_du_perimetre_jsonb(p_type text, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_communes text[];
  v_result   jsonb;
BEGIN
  IF p_type = 'cp' THEN
    SELECT jsonb_agg(s.code_postal) INTO v_result FROM (
      SELECT r.code_postal FROM public.ref_codes_postaux r WHERE r.code_postal = p_code
    ) s;

  ELSIF p_type = 'departement' THEN
    SELECT jsonb_agg(s.code_postal) INTO v_result FROM (
      SELECT r.code_postal FROM public.ref_codes_postaux r
        WHERE r.code_dept = p_code ORDER BY 1
    ) s;

  ELSIF p_type = 'region' THEN
    SELECT jsonb_agg(s.code_postal) INTO v_result FROM (
      SELECT r.code_postal FROM public.ref_codes_postaux r
        JOIN public.ref_departements d ON d.code_dept = r.code_dept
        WHERE d.code_region = p_code ORDER BY 1
    ) s;

  ELSIF p_type = 'commune' THEN
    SELECT array_agg(c) INTO v_communes FROM (
      SELECT p_code AS c
      UNION
      SELECT a.code_arrondissement FROM public.communes_arrondissements a
       WHERE a.code_commune_mere = p_code
    ) u;
    SELECT jsonb_agg(s.code_postal) INTO v_result FROM (
      SELECT DISTINCT pcc.code_postal FROM public.postal_code_commune pcc
        WHERE pcc.code_commune = ANY(v_communes) ORDER BY 1
    ) s;

  ELSIF p_type = 'zone' AND p_code ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    SELECT jsonb_agg(s.code_postal) INTO v_result FROM (
      SELECT r.code_postal FROM public.ref_codes_postaux r
        JOIN public.custom_geo_zones z ON z.id = p_code::uuid
        WHERE z.geometry IS NOT NULL AND r.centroid IS NOT NULL
          AND ST_Intersects(z.geometry, r.centroid)
        ORDER BY 1
    ) s;

  ELSIF p_type = 'france' AND lower(p_code) = 'metro' THEN
    -- France métropolitaine (pastille « France Metro », sql/287) : tous les CP
    -- hors départements 97x / 98x. La Corse (2A, 2B) reste dedans.
    SELECT jsonb_agg(s.code_postal) INTO v_result FROM (
      SELECT r.code_postal FROM public.ref_codes_postaux r
        WHERE r.code_dept NOT LIKE '97%' AND r.code_dept NOT LIKE '98%'
        ORDER BY 1
    ) s;

  ELSIF p_type = 'france' THEN
    SELECT jsonb_agg(s.code_postal) INTO v_result FROM (
      SELECT r.code_postal FROM public.ref_codes_postaux r ORDER BY 1
    ) s;
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END $fn$;

COMMENT ON FUNCTION public.codes_postaux_du_perimetre_jsonb(text, text) IS
  'Jumelle jsonb de codes_postaux_du_perimetre (sql/146, sql/167) — RETURNS jsonb et non TABLE : PostgREST tronque les RPC RETURNS TABLE (db-max-rows). Branche france : code metro = hors 97x/98x (sql/287), sinon France entiere. sql/168, sql/287.';

REVOKE ALL ON FUNCTION public.codes_postaux_du_perimetre_jsonb(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.codes_postaux_du_perimetre_jsonb(text, text) TO service_role;
