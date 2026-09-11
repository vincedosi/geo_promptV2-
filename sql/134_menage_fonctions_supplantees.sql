-- =============================================================================
-- 134 — Ménage : RPC supplantées ou dont la route appelante a été supprimée
-- Appliqué le 2026-09-11 via MCP Supabase (apply_migration).
-- =============================================================================
--
-- Critère, cumulatif, pour chaque fonction retirée :
--   1. aucun `supabase.rpc('<nom>')` dans le dépôt (TS, TSX et Python) ;
--   2. aucune autre fonction de `public` ne la nomme (pg_proc.prosrc) ;
--   3. elle n'est attachée à aucun trigger (pg_trigger) ;
--   4. une remplaçante est en service, ou sa route appelante a été supprimée à
--      une date documentée.
--
-- Les signatures ci-dessous sont RELEVÉES EN BASE (`oid::regprocedure`), pas
-- devinées : une signature approximative fait échouer le DROP en silence quand
-- il porte `IF EXISTS`.
--
-- ── Ce qui N'EST PAS touché, et pourquoi ────────────────────────────────────
--
--   `get_isochrone_battle`, `get_isochrone_battle_v10`, `clip_rings_to_france`,
--   `clip_geojson_to_france` — famille bataille, PROTÉGÉE par CLAUDE.md.
--   `get_isochrone_battle_v10` n'a aucun appelant, et reste : on ne touche pas
--   à cette famille sans demande explicite.
--
--   `get_user_org`, `get_user_orgs`, `get_user_role` — sans appelant applicatif,
--   mais citées par les policies RLS. Les retirer casserait l'autorisation le
--   jour où la clé anon serait branchée.
--
--   `custom_access_token_hook` — appelée par GoTrue, jamais par notre code.
--
--   `releve_empreinte_carreaux`, `fill_carreaux_1km_bande` — outils de
--   construction sans appelant PAR CONSTRUCTION. Ils servent à reconstruire les
--   paliers de la cascade.
--
--   `get_carreaux_by_zoom` — citée par une autre fonction : hors critère n° 2.
-- =============================================================================

-- ── Supplantées par une version v2 en service ───────────────────────────────
-- `app/api/digital/[campaignId]/analysis/route.ts` appelle les `_v2`.
DROP FUNCTION IF EXISTS public.get_digital_analysis_breakdown(uuid, text, text, text[], integer, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.get_digital_media_heatmap(uuid, text, text, text);
-- `app/api/digital/[campaignId]/map/route.ts` appelle get_digital_geography_map_v2.
DROP FUNCTION IF EXISTS public.get_digital_campaign_map(uuid, text, text, text[], double precision, double precision, double precision, double precision, text);

-- ── Tuiles : trois générations mortes derrière `get_tile` et `get_tmja_tile` ─
-- `get_tile` (sql/129) sert les carreaux, `get_tmja_tile` le trafic routier.
-- Les trois `get_tile_mvt*` sont les essais qui les ont précédés.
DROP FUNCTION IF EXISTS public.get_tile_mvt(integer, integer, integer);
DROP FUNCTION IF EXISTS public.get_tile_mvt_optimized(integer, integer, integer, integer);
DROP FUNCTION IF EXISTS public.get_tile_mvt_with_properties(integer, integer, integer, text);
DROP FUNCTION IF EXISTS public.get_tile_tmja(integer, integer, integer);
-- Les IRIS sont servis en PMTiles depuis 09/2026 : plus aucune tuile MVT IRIS.
DROP FUNCTION IF EXISTS public.get_iris_tile(integer, integer, integer, text);

-- ── Route appelante supprimée ───────────────────────────────────────────────
-- /api/iris/geojson, supprimée en 66e7c5c. Déjà proposées le 2026-05-07 dans
-- sql/cleanup/DROPS_PROPOSED.sql, jamais exécutées ; le constat tient toujours.
DROP FUNCTION IF EXISTS public.get_iris_geojson_by_bbox(double precision, double precision, double precision, double precision, text, double precision, integer);
DROP FUNCTION IF EXISTS public.get_iris_geojson_by_codes(text[], double precision);
-- Les cinq routes supprimées le 2026-09-08 (docs/PLAN_SAAS.md §3.A) laissaient
-- leurs RPC derrière elles — ARCHITECTURE.md les signale « orphelines » depuis.
DROP FUNCTION IF EXISTS public.get_abstention_stats();
DROP FUNCTION IF EXISTS public.get_cps_in_bbox(double precision, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.get_codes_postaux_bbox(double precision, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.get_digital_cp_iris_detail(text);
DROP FUNCTION IF EXISTS public.get_radios_for_emetteur(uuid);
-- Route carreaux supprimée en 08/2026, remplacée par les tuiles MVT.
DROP FUNCTION IF EXISTS public.get_carreaux(text, double precision, double precision, double precision, double precision, text, text);

-- NOTE : `dataset_abstention_2022` (6 186 lignes) N'EST PAS retirée avec
-- `get_abstention_stats` — trois fichiers du code la lisent directement.
