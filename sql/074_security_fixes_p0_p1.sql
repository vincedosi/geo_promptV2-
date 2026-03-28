-- ════════════════════════════════════════════════════════════════════════════
-- GENESIS — Migration 074 — Security Fixes P0/P1
-- 2026-03-28
-- Audit OWASP : correction des vulnérabilités V1→V7
-- ════════════════════════════════════════════════════════════════════════════

-- ── V1 🔴 REVOKE fonctions SECURITY DEFINER destructives ────────────────────
-- drop_carreaux_table et create_carreaux_table étaient accessibles via
-- PostgREST (contournement de la protection app-level requireAdmin)
-- NOTE: fonctions créées avec grant PUBLIC (=X/postgres) → REVOKE FROM PUBLIC requis
REVOKE EXECUTE ON FUNCTION public.drop_carreaux_table(text)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_carreaux_table(text) FROM PUBLIC;
-- Résultat attendu proacl: {postgres=X/postgres,service_role=X/postgres} uniquement

-- ── V4 🟠 Fix organizations INSERT policy ────────────────────────────────────
-- Avant : WITH CHECK = true → tout utilisateur authentifié pouvait créer une org
-- Après : réservé aux super_admin (cohérent avec orgs_all)
DROP POLICY IF EXISTS "orgs_insert" ON public.organizations;
CREATE POLICY "orgs_insert" ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'super_admin');

-- ── V5 🟡 Scope smart_prompt_feedback ────────────────────────────────────────
-- Avant : politique ALL qual=true → tout auth user voyait tous les feedbacks
-- Après : chaque user voit ses propres lignes ; super_admin voit tout
ALTER TABLE public.smart_prompt_feedback
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS "authenticated_rw" ON public.smart_prompt_feedback;

-- Tout utilisateur authentifié peut soumettre du feedback
CREATE POLICY "spf_insert" ON public.smart_prompt_feedback
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Utilisateur voit ses propres lignes (+ lignes legacy sans user_id)
CREATE POLICY "spf_select" ON public.smart_prompt_feedback
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Super admin : accès complet
CREATE POLICY "spf_admin_all" ON public.smart_prompt_feedback
  FOR ALL TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

-- ── V6 🟡 Enable RLS sur les tables non protégées ─────────────────────────────
-- iris_metadata : données de référence — lecture libre pour authentifiés
ALTER TABLE public.iris_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "iris_metadata_read" ON public.iris_metadata
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "iris_metadata_admin" ON public.iris_metadata
  FOR ALL TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

-- poi_accessibility_config : config applicative — lecture authentifiés, écriture super_admin
ALTER TABLE public.poi_accessibility_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "poi_accessibility_config_read" ON public.poi_accessibility_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "poi_accessibility_config_admin" ON public.poi_accessibility_config
  FOR ALL TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

-- ════════════════════════════════════════════════════════════════════════════
-- Corrections code (hors SQL) — voir git diff pour les détails :
-- V2 🟠 Open Redirect : lib/auth-client.ts:108
--   window.location.href = safeRedirect  (validation regex /^\/[^/\\]/)
-- V3 🟠 XSS dangerouslySetInnerHTML : SmartPromptResults.tsx:114,127
--   Remplacé par renderInlineMarkdown() → React nodes, pas de HTML brut
-- V8 🟡 bodySizeLimit : next.config.js
--   10gb → 50mb
-- ════════════════════════════════════════════════════════════════════════════
