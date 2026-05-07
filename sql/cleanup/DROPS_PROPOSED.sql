-- =============================================================
-- DROPS PROPOSES APRES CLEANUP MAGELIAN
-- Genere le : 2026-05-07
-- Branche   : chore/cleanup-tech-debt
-- Auteur    : audit automatique (READ-ONLY) via MCP Supabase
--
-- ⚠️  A EXECUTER MANUELLEMENT, par Vincent, apres revue.
-- ⚠️  FAIRE UN BACKUP SUPABASE AVANT (Dashboard -> Database -> Backups).
-- ⚠️  AUCUNE COMMANDE DESTRUCTIVE N'A ETE LANCEE PAR LE CLEANUP.
--
-- Methode : pour chaque candidat,
--   1. SELECT pg_proc / pg_views / information_schema.triggers
--      pour detecter les references SQL
--   2. grep ripgrep recursif sur le code TS pour detecter les appels supabase.rpc()
--   3. SELECT pg_stat_user_tables pour confirmer 0 ecriture
-- =============================================================


-- =============================================================
-- ✅ SAFE TO DROP — 0 reference detectee (SQL + code)
-- =============================================================

-- ----------- 1. Table : isochrone_carreaux_coverage -----------
-- Justification :
--   - 0 fonction PostgreSQL ne reference cette table
--     (pg_proc + pg_get_functiondef ILIKE '%isochrone_carreaux_coverage%')
--   - 0 vue ni trigger ne pointe dessus
--   - 0 ligne en base, jamais d'INSERT/UPDATE/DELETE (pg_stat_user_tables)
--   - 0 reference dans le code TypeScript / Python / SQL applicatif
-- Hypothese : remplacee par le calcul inline via compute_coverage_fast.
DROP TABLE IF EXISTS public.isochrone_carreaux_coverage;


-- ----------- 2. RPC : get_iris_geojson_by_bbox ----------------
-- Justification :
--   - Etait appelee par /api/iris/geojson (route supprimee dans 66e7c5c)
--   - 0 autre fonction PostgreSQL ne la reference
--   - 0 vue ni trigger ne la mentionne
--   - 0 appel `supabase.rpc('get_iris_geojson_by_bbox')` dans le code TS
--   - Les frontend cartes utilisent get_iris_stats_by_bbox + get_iris_dept_stats
DROP FUNCTION IF EXISTS public.get_iris_geojson_by_bbox(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_colonne text,
  p_simplify double precision,
  p_max_rows integer
);


-- ----------- 3. RPC : get_iris_geojson_by_codes ---------------
-- Justification :
--   - Etait appelee par /api/iris/geojson (route supprimee dans 66e7c5c)
--   - 0 autre fonction PostgreSQL ne la reference
--   - 0 vue ni trigger ne la mentionne
--   - 0 appel `supabase.rpc('get_iris_geojson_by_codes')` dans le code TS
DROP FUNCTION IF EXISTS public.get_iris_geojson_by_codes(
  p_codes text[],
  p_simplify_tolerance double precision
);


-- =============================================================
-- ⚠️  REVIEW NEEDED — referencee par d'autres RPCs / code
-- =============================================================

-- ----------- 4. Table : laposte_hexasmal ----------------------
-- Statut : 0 ligne, 0 ecriture, mais referencee par 4 RPCs.
--
-- Detail des references :
--
--   Fonction PostgreSQL                  | Statut applicatif
--   -------------------------------------+----------------------------------
--   build_ref_codes_postaux              | Etait appelee par /api/admin/
--                                        | import-laposte (route supprimee
--                                        | dans 66e7c5c). Orphan en code TS.
--   truncate_laposte_hexasmal            | Idem (orphan en code TS)
--   update_laposte_centroids             | Idem (orphan en code TS)
--   get_digital_cp_iris_detail           | ⚠️  ENCORE APPELEE par
--                                        | app/api/digital/[campaignId]/
--                                        | cp-detail/route.ts:25
--
-- Decision necessaire :
--
--   Option A — Tout drop (table + 4 RPCs) :
--     necessite de refactorer get_digital_cp_iris_detail pour qu'elle lise
--     dans ref_codes_postaux au lieu de laposte_hexasmal. Un audit visuel
--     dans Supabase SQL Editor confirme que ref_codes_postaux contient
--     les memes infos (code postal -> commune INSEE).
--
--   Option B — Garder la table, drop les 3 write RPCs orphan :
--     conservatrice. Drop build_ref_codes_postaux,
--     truncate_laposte_hexasmal, update_laposte_centroids ;
--     garder get_digital_cp_iris_detail telle quelle ; garder la table.
--     Mais la table reste vide donc la route cp-detail renvoie du vide.
--
--   Option C — Restaurer la pipeline d'import laposte :
--     remettre /api/admin/import-laposte (la route a ete supprimee a tort
--     si la pipeline est encore desiree). Repeupler la table.
--
-- ⛔  Tant que la decision n'est pas prise, NE PAS DROP. Decommenter
-- l'option choisie apres revue.
--
-- DROP TABLE IF EXISTS public.laposte_hexasmal;                                  -- Option A
-- DROP FUNCTION IF EXISTS public.build_ref_codes_postaux();                      -- Option A ou B
-- DROP FUNCTION IF EXISTS public.truncate_laposte_hexasmal();                    -- Option A ou B
-- DROP FUNCTION IF EXISTS public.update_laposte_centroids();                     -- Option A ou B
-- (Pour get_digital_cp_iris_detail : NE PAS DROP, route active ; refactorer
--  uniquement si Option A retenue.)


-- =============================================================
-- ❌ KEEP — usage actif detecte (ne PAS drop)
-- =============================================================

-- (Aucun, mais a titre indicatif :)
--
--  - get_digital_cp_iris_detail :
--      appelee par app/api/digital/[campaignId]/cp-detail/route.ts ; conserver.
--
--  - Fonctions PostGIS battle (get_isochrone_battle_v10, etc.),
--    compute_panneau_scores_v2, refresh_ville_stats_chunk :
--      protegees par PROMPT.md — non analysees, non dropees.


-- =============================================================
-- Verification post-drop (a executer apres l'eventuelle execution
-- des DROPs ci-dessus pour confirmer que rien d'autre ne s'est casse) :
-- =============================================================
--
--   -- 1. Re-grep des RPCs : doit revenir 0 ligne
--   SELECT proname FROM pg_proc
--     WHERE proname IN ('get_iris_geojson_by_bbox','get_iris_geojson_by_codes');
--
--   -- 2. Verifier qu'aucune table critique n'a perdu sa structure
--   SELECT relname, n_live_tup FROM pg_stat_user_tables
--     WHERE relname IN ('iris','carreaux_filosofi','dsp_campaigns','dsp_campaign_data');
--
--   -- 3. Tester depuis l'app : /map (charge IRIS), /map/analyse/digital (CP detail).
