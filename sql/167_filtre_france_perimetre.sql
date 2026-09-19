-- ============================================================================
-- sql/167_filtre_france_perimetre.sql — filtre « France entière » (2026-09-15)
--
-- Spec : .superpowers/sdd/2026-09-14-suivi-v2-alignement-geographique/spec-filtre-france.md
--
-- Ajoute la branche `p_type = 'france'` à `codes_postaux_du_perimetre`
-- (sql/146) : l'ensemble du référentiel `ref_codes_postaux`, 6 187 lignes.
--
-- BRANCHE SÉPARÉE (nouveau `ELSIF`), jamais un `CASE` dans le `WHERE` — même
-- règle que les branches existantes, dont la note mesure 835 ms contre 6,5 ms
-- selon la forme (idx_ref_cp_dept inutilisable sous un CASE). Ici la branche
-- ne filtre même pas : un scan complet de la table de référentiel (6 187
-- lignes, pas les 51k IRIS ni les 2,3M carreaux — hors du périmètre des
-- interdictions CLAUDE.md sur ces tables volumineuses).
--
-- `CREATE OR REPLACE`, signature inchangée (text, text) : pas de DROP.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.codes_postaux_du_perimetre(
  p_type text,   -- 'region' | 'departement' | 'commune' | 'cp' | 'zone' | 'france'
  p_code text    -- code INSEE, code postal, uuid de custom_geo_zones, ou ignoré pour 'france'
) RETURNS TABLE (code_postal text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_communes text[];
BEGIN
  IF p_type = 'cp' THEN
    RETURN QUERY SELECT r.code_postal FROM public.ref_codes_postaux r WHERE r.code_postal = p_code;

  ELSIF p_type = 'departement' THEN
    RETURN QUERY SELECT r.code_postal FROM public.ref_codes_postaux r
      WHERE r.code_dept = p_code ORDER BY 1;

  ELSIF p_type = 'region' THEN
    RETURN QUERY SELECT r.code_postal FROM public.ref_codes_postaux r
      JOIN public.ref_departements d ON d.code_dept = r.code_dept
      WHERE d.code_region = p_code ORDER BY 1;

  ELSIF p_type = 'commune' THEN
    -- La commune demandée PLUS ses arrondissements, s'il y en a (voir ci-dessus).
    SELECT array_agg(c) INTO v_communes FROM (
      SELECT p_code AS c
      UNION
      SELECT a.code_arrondissement FROM public.communes_arrondissements a
       WHERE a.code_commune_mere = p_code
    ) s;
    RETURN QUERY SELECT DISTINCT pcc.code_postal FROM public.postal_code_commune pcc
      WHERE pcc.code_commune = ANY(v_communes) ORDER BY 1;

  ELSIF p_type = 'zone' AND p_code ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    -- Centroïde du CP dans la zone — index GIST `idx_ref_codes_postaux_centroid`,
    -- même règle que `codes_postaux_dans_bbox` (sql/144).
    RETURN QUERY SELECT r.code_postal FROM public.ref_codes_postaux r
      JOIN public.custom_geo_zones z ON z.id = p_code::uuid
      WHERE z.geometry IS NOT NULL AND r.centroid IS NOT NULL
        AND ST_Intersects(z.geometry, r.centroid)
      ORDER BY 1;

  ELSIF p_type = 'france' THEN
    -- Filtre « France entière » (spec-filtre-france.md, 2026-09-15) : une
    -- intention explicite de périmètre national, PAS une bbox — voir
    -- lib/carte/bbox-requete.ts pour le piège inverse (BBOX_METRO envoyée à
    -- chaque requête de couche, qui masquerait l'outre-mer). Ici, le
    -- périmètre EST le référentiel complet : p_code ignoré.
    RETURN QUERY SELECT r.code_postal FROM public.ref_codes_postaux r ORDER BY 1;
  END IF;

  RETURN;
END $fn$;

COMMENT ON FUNCTION public.codes_postaux_du_perimetre(text, text) IS
  'Codes postaux d un perimetre de carte (FiltreActif) — Tache 12, sql/146. Branches SEPAREES et non un CASE dans le WHERE : le CASE rendait idx_ref_cp_dept inutilisable (835 ms pour un departement, mesure du 2026-09-13). Le palier commune passe par communes_arrondissements. Branche france (sql/167, 2026-09-15) : l ensemble du referentiel, p_code ignore.';

REVOKE ALL ON FUNCTION public.codes_postaux_du_perimetre(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.codes_postaux_du_perimetre(text, text) TO service_role;
