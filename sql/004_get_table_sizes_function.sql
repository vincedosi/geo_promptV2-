-- ============================================================
-- GENESIS — Fonction SQL pour récupérer les tailles des tables
-- ============================================================
-- À exécuter dans Supabase SQL Editor
-- Cette fonction permet d'obtenir la taille de toutes les tables publiques
-- ============================================================

CREATE OR REPLACE FUNCTION get_table_sizes()
RETURNS TABLE (
  table_name text,
  total_size text,
  total_size_bytes bigint,
  table_size text,
  indexes_size text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.tablename::text as table_name,
    pg_size_pretty(pg_total_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.tablename)))::text as total_size,
    pg_total_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.tablename)) as total_size_bytes,
    pg_size_pretty(pg_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.tablename)))::text as table_size,
    pg_size_pretty(
      pg_total_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.tablename)) - 
      pg_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.tablename))
    )::text as indexes_size
  FROM pg_tables t
  WHERE t.schemaname = 'public'
  ORDER BY pg_total_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.tablename)) DESC;
END;
$$;

-- Permet à tous les utilisateurs authentifiés d'appeler cette fonction
GRANT EXECUTE ON FUNCTION get_table_sizes() TO authenticated;
GRANT EXECUTE ON FUNCTION get_table_sizes() TO service_role;

COMMENT ON FUNCTION get_table_sizes() IS 'Retourne les statistiques de taille pour toutes les tables publiques';
