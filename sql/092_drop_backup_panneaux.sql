-- ============================================================
-- 092 — Sécurité : DROP de la table backup panneaux exposée
-- ============================================================
-- Appliquée le 2026-07-03 via MCP Supabase.
--
-- panneaux_affichage_backup_csv_20260702 était un snapshot des anciennes
-- lignes CSV (géocodage défaillant) conservé lors de la consolidation
-- panneaux (sql/082). Table orpheline : RLS désactivée + exposée dans l'API
-- (seule alerte ERROR des advisors Supabase), aucune vue ni fonction ne la
-- référence, données superséedées par l'import ArcGIS. Suppression validée.

DROP TABLE IF EXISTS public.panneaux_affichage_backup_csv_20260702;
