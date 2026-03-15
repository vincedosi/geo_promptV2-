-- =============================================================================
-- GENESIS — Security Hardening
-- Règle tous les warnings Supabase Linter (ERROR + WARN)
-- À exécuter UNE FOIS dans Supabase SQL Editor
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. RLS — Activer sur toutes les tables publiques sans RLS
--    Toutes les routes API utilisent service_role (createAdminClient) qui
--    contourne RLS par défaut. Les policies ci-dessous permettent aussi la
--    lecture aux utilisateurs authentifiés via le client public si besoin.
-- -----------------------------------------------------------------------------

-- saved_maps
ALTER TABLE public.saved_maps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saved_maps_all_service ON public.saved_maps;
CREATE POLICY saved_maps_all_service ON public.saved_maps
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS saved_maps_select_authenticated ON public.saved_maps;
CREATE POLICY saved_maps_select_authenticated ON public.saved_maps
  FOR SELECT TO authenticated USING (true);

-- isochrones_cache
ALTER TABLE public.isochrones_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isochrones_cache_all_service ON public.isochrones_cache;
CREATE POLICY isochrones_cache_all_service ON public.isochrones_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS isochrones_cache_rw_authenticated ON public.isochrones_cache;
CREATE POLICY isochrones_cache_rw_authenticated ON public.isochrones_cache
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- poi_metadata_index  (données de référence — lecture publique)
ALTER TABLE public.poi_metadata_index ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS poi_metadata_index_select ON public.poi_metadata_index;
CREATE POLICY poi_metadata_index_select ON public.poi_metadata_index
  FOR SELECT USING (true);
DROP POLICY IF EXISTS poi_metadata_index_all_service ON public.poi_metadata_index;
CREATE POLICY poi_metadata_index_all_service ON public.poi_metadata_index
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- poi_categories  (données de référence — lecture publique)
ALTER TABLE public.poi_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS poi_categories_select ON public.poi_categories;
CREATE POLICY poi_categories_select ON public.poi_categories
  FOR SELECT USING (true);
DROP POLICY IF EXISTS poi_categories_all_service ON public.poi_categories;
CREATE POLICY poi_categories_all_service ON public.poi_categories
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- panneaux_affichage
ALTER TABLE public.panneaux_affichage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS panneaux_affichage_select_authenticated ON public.panneaux_affichage;
CREATE POLICY panneaux_affichage_select_authenticated ON public.panneaux_affichage
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS panneaux_affichage_all_service ON public.panneaux_affichage;
CREATE POLICY panneaux_affichage_all_service ON public.panneaux_affichage
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- france_borders  (données géo publiques — lecture publique)
ALTER TABLE public.france_borders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS france_borders_select ON public.france_borders;
CREATE POLICY france_borders_select ON public.france_borders
  FOR SELECT USING (true);
DROP POLICY IF EXISTS france_borders_all_service ON public.france_borders;
CREATE POLICY france_borders_all_service ON public.france_borders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- global_ooh
ALTER TABLE public.global_ooh ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS global_ooh_select_authenticated ON public.global_ooh;
CREATE POLICY global_ooh_select_authenticated ON public.global_ooh
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS global_ooh_all_service ON public.global_ooh;
CREATE POLICY global_ooh_all_service ON public.global_ooh
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- import_runs_ooh
ALTER TABLE public.import_runs_ooh ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_runs_ooh_select_authenticated ON public.import_runs_ooh;
CREATE POLICY import_runs_ooh_select_authenticated ON public.import_runs_ooh
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS import_runs_ooh_all_service ON public.import_runs_ooh;
CREATE POLICY import_runs_ooh_all_service ON public.import_runs_ooh
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- spatial_ref_sys (table PostGIS système — lecture publique seulement)
ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spatial_ref_sys_select ON public.spatial_ref_sys;
CREATE POLICY spatial_ref_sys_select ON public.spatial_ref_sys
  FOR SELECT USING (true);

-- -----------------------------------------------------------------------------
-- 2. RLS policy toujours vraie — organizations.orgs_insert
--    Restreindre aux utilisateurs authentifiés seulement.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS orgs_insert ON public.organizations;
CREATE POLICY orgs_insert ON public.organizations
  FOR INSERT TO authenticated WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 3. data_sources_view — retirer SECURITY DEFINER
--    PostgreSQL 15+ : security_invoker = true = la vue utilise les droits
--    de l'appelant, pas du créateur.
-- -----------------------------------------------------------------------------
ALTER VIEW public.data_sources_view SET (security_invoker = true);

-- -----------------------------------------------------------------------------
-- 4. function_search_path_mutable — fixer SET search_path = public
--    sur toutes les fonctions sans search_path fixé.
--    Utilise pg_proc pour retrouver les signatures exactes automatiquement.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT p.oid::regprocedure AS func_sig
    FROM   pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.proname IN (
        'auto_set_geom',
        'count_poi_by_categorie_source',
        'fn_global_ooh_set_geom',
        'handle_new_user',
        'get_voronoi_routier_by_category',
        'create_carreaux_table',
        'get_voronoi_by_category',
        'get_carreaux_for_scoring',
        'update_saved_maps_updated_at',
        'get_user_role',
        'notify_pgrst_reload',
        'get_user_org',
        'panneaux_near_point',
        'get_isochrone_battle',
        'drop_carreaux_table',
        'get_carreaux',
        'get_table_sizes',
        'get_poi_near_panneau'
      )
  )
  LOOP
    EXECUTE 'ALTER FUNCTION ' || r.func_sig || ' SET search_path = public';
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Note : deux warnings non traitables via SQL :
--    - "extension_in_public postgis" : déplacer PostGIS vers extensions schema
--      nécessite une opération Supabase Support (risqué, à ignorer en prod)
--    - "auth_leaked_password_protection" : activer dans
--      Supabase Dashboard > Auth > Password Protection > Enable HIBP check
-- -----------------------------------------------------------------------------

-- Vérification finale
SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'saved_maps','isochrones_cache','poi_metadata_index','poi_categories',
    'panneaux_affichage','france_borders','global_ooh','import_runs_ooh','spatial_ref_sys'
  )
ORDER BY tablename;
