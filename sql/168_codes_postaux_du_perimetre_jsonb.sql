-- ============================================================================
-- sql/168_codes_postaux_du_perimetre_jsonb.sql — 2026-09-15
--
-- Découvert en TESTANT LE PARCOURS RÉEL (navigateur, pas seulement l'appel SQL
-- direct) de la Tâche filtre-france : `codes_postaux_du_perimetre('france', …)`
-- rend bien 6 187 lignes en SQL direct (sql/167, mesuré), mais le score
-- composite affichait « 1 462 codes postaux scorés sur **5 000** » — le
-- PIÈGE DÉJÀ DOCUMENTÉ pour `correlation_campagne_indicateur` (sql/154) :
-- PostgREST tronque à 5 000 lignes TOUTE RPC `RETURNS TABLE`, silencieusement,
-- sans erreur ni en-tête exploitable. Aucune branche existante de
-- `codes_postaux_du_perimetre` n'avait jamais dépassé ce plafond (le plus
-- grand département/région reste très en dessous de 5 000 CP) : seule la
-- branche `'france'` (6 187 CP) l'expose.
--
-- Le correctif éprouvé sur ce projet est `RETURNS jsonb` au lieu de
-- `RETURNS TABLE` — PostgREST ne tronque pas un scalaire jsonb. sql/154 l'a
-- fait en DROP + CREATE OR REPLACE (le changement de type de retour l'exige :
-- Postgres refuse un CREATE OR REPLACE qui change le type de retour). Cette
-- tâche est SOUS CONTRAINTE stricte : jamais de DROP en base de production.
--
-- Solution : une fonction JUMELLE, `codes_postaux_du_perimetre_jsonb`, plutôt
-- qu'un DROP + CREATE OR REPLACE de l'existante. `codes_postaux_du_perimetre`
-- (sql/146, branche france ajoutée sql/167) reste en place TELLE QUELLE,
-- inchangée, potentiellement encore appelée ailleurs un jour — seul
-- `app/api/analyses/score/route.ts` bascule vers la jumelle jsonb (ce commit).
-- Un seul appelant existant à cette RPC (vérifié par grep) : pas de régression
-- pour un autre consommateur.
--
-- Vérifié après application : SELECT jsonb_array_length(
--   codes_postaux_du_perimetre_jsonb('france', 'ignore')) = 6187.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.codes_postaux_du_perimetre_jsonb(
  p_type text,   -- 'region' | 'departement' | 'commune' | 'cp' | 'zone' | 'france'
  p_code text    -- code INSEE, code postal, uuid de custom_geo_zones, ou ignoré pour 'france'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
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

  ELSIF p_type = 'france' THEN
    SELECT jsonb_agg(s.code_postal) INTO v_result FROM (
      SELECT r.code_postal FROM public.ref_codes_postaux r ORDER BY 1
    ) s;
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END $fn$;

COMMENT ON FUNCTION public.codes_postaux_du_perimetre_jsonb(text, text) IS
  'Jumelle jsonb de codes_postaux_du_perimetre (sql/146, sql/167) — RETURNS jsonb et non TABLE : PostgREST tronque a 5000 lignes meme les RPC RETURNS TABLE (meme piege que correlation_campagne_indicateur, sql/154). Expose uniquement par la branche france (6187 CP > 5000). sql/168, 2026-09-15.';

REVOKE ALL ON FUNCTION public.codes_postaux_du_perimetre_jsonb(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.codes_postaux_du_perimetre_jsonb(text, text) TO service_role;
