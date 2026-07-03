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
-- ❌ DECIDED KEEP — decision Vincent 2026-05
-- =============================================================

-- ----------- 4. Table : laposte_hexasmal ----------------------
-- Decision Vincent — 2026-05 : 4 RPCs actives, KEEP. Comment ajoute
-- sur la table (migration `comment_laposte_hexasmal_keep`) pour eviter
-- qu'un futur cleanup la reflagge :
--
--   COMMENT ON TABLE public.laposte_hexasmal IS
--     'Referentiel La Poste hexasmal — consomme par
--      get_digital_cp_iris_detail et 3 autres RPCs (cf.
--      sql/cleanup/DROPS_PROPOSED.sql). NE PAS DROP sans audit
--      pg_proc prealable. Audit du 2026-05 : table active.';
--
-- Statut : 0 ligne, 0 ecriture (pg_stat_user_tables), mais referencee
-- par 4 RPCs PostgreSQL :
--
--   Fonction PostgreSQL                  | Statut applicatif
--   -------------------------------------+----------------------------------
--   build_ref_codes_postaux              | Orphan en code TS (route
--                                        | /api/admin/import-laposte
--                                        | supprimee dans 66e7c5c)
--   truncate_laposte_hexasmal            | Idem (orphan en code TS)
--   update_laposte_centroids             | Idem (orphan en code TS)
--   get_digital_cp_iris_detail           | ENCORE APPELEE par
--                                        | app/api/digital/[campaignId]/
--                                        | cp-detail/route.ts:25
--
-- ⛔  NE PAS DROP. La table est marquee active.


-- =============================================================
-- ❌ KEEP — usage actif detecte (ne PAS drop)
-- =============================================================

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
