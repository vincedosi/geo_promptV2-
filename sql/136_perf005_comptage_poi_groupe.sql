-- =============================================================================
-- 136 — PERF-005 : un comptage groupé, et l'index qui le rend possible
-- Appliqué le 2026-09-11 via MCP Supabase (apply_migration).
-- =============================================================================
--
-- ── Le défaut ───────────────────────────────────────────────────────────────
--
-- `lib/chat/tools/analyseComplete.ts` émettait un `COUNT(exact)` PAR CATÉGORIE,
-- tous lancés ensemble dans un `Promise.all`. Or la liste des catégories vient
-- du LLM : le nombre de requêtes parallèles était piloté par le modèle, sans
-- plafond. C'est la forme exacte de l'incident du 28/03 — 24 colonnes × bbox
-- France, budget d'I/O épuisé, 504 pendant des heures.
--
-- ── Les deux moitiés du remède ──────────────────────────────────────────────
--
-- 1. `compte_poi_par_categorie` rend tous les comptages en UNE requête groupée.
--    `p_champ` n'accepte que 'ville' ou 'region' — les deux seules valeurs que
--    le code produit — et refuse tout le reste : une colonne interpolée serait
--    une injection.
--
-- 2. L'index trigramme sur `ville`. `ILIKE '%valeur%'` ne peut utiliser aucun
--    btree, le joker en tête l'interdit. Mesuré sur la requête groupée :
--
--      avant l'index : balayage séquentiel PARALLÈLE, 18 693 blocs, 736 ms
--      après         : parcours d'index bitmap,          69 blocs,   65 ms
--
--    271 fois moins de blocs lus — et c'était déjà UNE requête au lieu de N.
--    Coût assumé : l'index se maintient à chaque insertion de POI. Les imports
--    écrivent par lots de 50, jamais en continu.
--
-- ── Index en double retirés au passage ──────────────────────────────────────
--
-- Même table, mêmes colonnes, même méthode : chaque exemplaire coûte du temps
-- d'écriture à CHAQUE insertion, sur le chemin d'import.
--   poi_france      : idx_poi_france_org, idx_poi_france_source
--   isochrones_cache: idx_iso_cache_cache_key, idx_isochrones_cache_key
--   radios          : idx_radios_nom
-- Les deux exemplaires adossés à une contrainte UNIQUE
-- (`isochrones_cache_cache_key_key`, `radios_nom_unique`) sont CONSERVÉS : ce
-- sont eux qui portent la contrainte.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.compte_poi_par_categorie(
  p_champ      text,
  p_valeur     text,
  p_categories text[],
  p_sources    uuid[] DEFAULT NULL
) RETURNS TABLE (categorie text, nb bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_champ NOT IN ('ville', 'region') THEN
    RAISE EXCEPTION 'champ geographique non autorise : %', p_champ;
  END IF;

  RETURN QUERY
  SELECT p.categorie, count(*)::bigint
  FROM public.poi_france p
  WHERE p.categorie = ANY(p_categories)
    AND (
      (p_champ = 'ville'  AND p.ville  ILIKE '%' || p_valeur || '%') OR
      (p_champ = 'region' AND p.region ILIKE '%' || p_valeur || '%')
    )
    AND (p_sources IS NULL OR p.data_source_id = ANY(p_sources))
  GROUP BY p.categorie;
END;
$$;

REVOKE ALL ON FUNCTION public.compte_poi_par_categorie(text, text, text[], uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compte_poi_par_categorie(text, text, text[], uuid[]) TO service_role;

DROP INDEX IF EXISTS public.idx_poi_france_org;
DROP INDEX IF EXISTS public.idx_poi_france_source;
DROP INDEX IF EXISTS public.idx_iso_cache_cache_key;
DROP INDEX IF EXISTS public.idx_isochrones_cache_key;
DROP INDEX IF EXISTS public.idx_radios_nom;

CREATE INDEX IF NOT EXISTS idx_poi_france_ville_trgm
  ON public.poi_france USING gin (ville gin_trgm_ops);
