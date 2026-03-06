-- ═══════════════════════════════════════════════════════════════════════════════
-- GENESIS — Import Carreaux : prérequis PostgREST
-- À exécuter UNE FOIS dans Supabase SQL Editor AVANT de lancer l'import.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Helper pour recharger le schema cache PostgREST depuis l'API
CREATE OR REPLACE FUNCTION notify_pgrst_reload()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT pg_notify('pgrst', 'reload schema');
$$;

-- 2. Forcer le rechargement maintenant
SELECT pg_notify('pgrst', 'reload schema');
