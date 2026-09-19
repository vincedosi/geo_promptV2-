-- ============================================================================
-- sql/169_codes_postaux_du_perimetre_enveloppe.sql — 2026-09-15
--
-- Ruling FF-1 : codes_postaux_du_perimetre (RETURNS TABLE, sql/146 puis
-- sql/167) et codes_postaux_du_perimetre_jsonb (sql/168) portaient les SIX
-- MÊMES branches (cp / departement / region / commune / zone / france),
-- recopiées mot pour mot. Rien ne forçait la jumelle jsonb à suivre un
-- correctif apporté à l'originale — une duplication que rien ne vérifiait.
--
-- Correction : supprime la duplication plutôt que de la tester (contrairement
-- au Fix 1 de ce lot, verrouillé par un test). La version RETURNS TABLE
-- devient une ENVELOPPE MINCE de la version jsonb — un seul corps porte
-- désormais les six branches, deux formes de retour, dérive impossible par
-- construction.
--
-- `CREATE OR REPLACE`, MÊME signature (text, text) et MÊME type de retour
-- (TABLE(code_postal text)) : jamais de DROP — interdit en production sur ce
-- projet, et d'autres appelants dépendent de cette forme TABLE.
--
-- Ordre préservé : chaque branche de codes_postaux_du_perimetre_jsonb
-- agrège déjà `ORDER BY 1` avant `jsonb_agg`, et `jsonb_agg`/
-- `jsonb_array_elements_text` préservent l'ordre des éléments du tableau
-- JSON — le tri visible en sortie de codes_postaux_du_perimetre est donc
-- inchangé.
--
-- Vérifié après application (les 6 branches, TABLE vs jsonb, mêmes comptes
-- qu'avant migration) : cp 1/1, departement 23/23, region 30/30, commune
-- 1/1, zone 58/58, france 6187/6187. Coût mesuré sur la branche
-- departement (EXPLAIN ANALYZE BUFFERS) : ~1,7-1,9 ms / 343 buffers avant
-- comme après — l'enveloppe n'a rien dégradé.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.codes_postaux_du_perimetre(
  p_type text,   -- 'region' | 'departement' | 'commune' | 'cp' | 'zone' | 'france'
  p_code text    -- code INSEE, code postal, uuid de custom_geo_zones, ou ignoré pour 'france'
) RETURNS TABLE (code_postal text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN QUERY
  SELECT jsonb_array_elements_text(public.codes_postaux_du_perimetre_jsonb(p_type, p_code));
END $fn$;

COMMENT ON FUNCTION public.codes_postaux_du_perimetre(text, text) IS
  'Codes postaux d un perimetre de carte (FiltreActif) — Tache 12, sql/146, branche france sql/167. Enveloppe MINCE de codes_postaux_du_perimetre_jsonb (sql/168) depuis sql/169 (2026-09-15, ruling FF-1) : un seul corps pour les six branches, deux formes de retour — derive impossible par construction. RETOURNE TABLE (troncature PostgREST a 5000 lignes au-dela) ; utiliser la jumelle _jsonb pour un perimetre susceptible de depasser 5000 CP (seule la branche france l y expose a ce jour, 6187 CP).';

REVOKE ALL ON FUNCTION public.codes_postaux_du_perimetre(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.codes_postaux_du_perimetre(text, text) TO service_role;
