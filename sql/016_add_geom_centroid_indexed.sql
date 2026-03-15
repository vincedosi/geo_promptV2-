-- ═══════════════════════════════════════════════════════════════════════════════
-- GENESIS — Migration geom_centroid indexée
--
-- IMPORTANT : exécuter en 4 étapes séparées dans Supabase SQL Editor
--             car l'UPDATE de 2.3M lignes dépasse le timeout HTTP de l'UI.
--             La fonction tourne EN ARRIÈRE-PLAN même si l'UI affiche "timeout".
-- ═══════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════
-- ÉTAPE 1 — Ajouter la colonne + créer la fonction async
--           → Rapide (~1s). Exécuter en premier.
-- ════════════════════════════════════════════════════════
ALTER TABLE carreaux_filosofi
  ADD COLUMN IF NOT EXISTS geom_centroid geometry(Point, 4326);

CREATE OR REPLACE FUNCTION populate_geom_centroid_async()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout TO 0
AS $$
DECLARE v_count bigint;
BEGIN
  UPDATE carreaux_filosofi
  SET geom_centroid = ST_Centroid(geom)
  WHERE geom_centroid IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN 'Done: ' || v_count || ' rows updated';
END;
$$;

GRANT EXECUTE ON FUNCTION populate_geom_centroid_async() TO service_role;


-- ════════════════════════════════════════════════════════
-- ÉTAPE 2 — Lancer la population (exécuter seul)
--           → L'UI dira "upstream timeout" après ~30s
--             mais la fonction CONTINUE en base.
--             Attendre ~10 min puis passer à l'étape 3.
-- ════════════════════════════════════════════════════════
-- SELECT populate_geom_centroid_async();


-- ════════════════════════════════════════════════════════
-- ÉTAPE 3 — Vérifier que c'est terminé
--           → remaining doit être 0 avant de continuer
-- ════════════════════════════════════════════════════════
-- SELECT
--   COUNT(*) FILTER (WHERE geom_centroid IS NOT NULL) AS done,
--   COUNT(*) FILTER (WHERE geom_centroid IS NULL)     AS remaining
-- FROM carreaux_filosofi;


-- ════════════════════════════════════════════════════════
-- ÉTAPE 4 — Créer l'index GiST + VACUUM (après étape 3)
--           CONCURRENTLY : ne bloque pas la table
--           → Peut aussi afficher "timeout" dans l'UI
--             mais se termine en base (~3-5 min)
-- ════════════════════════════════════════════════════════
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_carreaux_filosofi_geom_centroid
--   ON carreaux_filosofi USING GIST (geom_centroid);
--
-- VACUUM ANALYZE carreaux_filosofi;
