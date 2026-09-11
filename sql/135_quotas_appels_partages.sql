-- =============================================================================
-- 135 — Quotas d'appels partagés entre instances (ECH-004)
-- Appliqué le 2026-09-11 via MCP Supabase (apply_migration).
-- =============================================================================
--
-- ── Le défaut ───────────────────────────────────────────────────────────────
--
-- Les trois limiteurs du projet comptaient dans la mémoire du PROCESSUS :
-- `checkImportRateLimit` (une `Map`), le repli de `createRateLimiter`, et une
-- troisième copie dans `app/api/chat/route.ts`. Sur Vercel, chaque invocation
-- peut être servie par une instance différente : chacune repart de zéro, et la
-- limite « 3 imports par 60 s » ne limite rien.
--
-- Upstash devait couvrir ce cas, mais `UPSTASH_REDIS_REST_URL` et son jeton sont
-- VIDES en production (l'installation marketplace attend une acceptation de
-- conditions). Le repli mémoire est donc le chemin réel, en permanence.
--
-- Ce garde-fou n'est pas décoratif : c'est lui qui protège le budget d'I/O de
-- l'instance Nano, dont l'épuisement a mis l'application à terre TROIS fois
-- (CLAUDE.md, incidents du 28/03 et du 08/04).
--
-- ── Le remède ───────────────────────────────────────────────────────────────
--
-- Postgres est la seule ressource partagée dont l'application dispose à coup
-- sûr. Un compteur en base, incrémenté par une seule instruction atomique, vaut
-- pour toutes les instances à la fois.
--
-- Le coût est d'un `INSERT … ON CONFLICT` sur une table minuscule, indexée par
-- sa clé primaire — sans commune mesure avec l'import qu'il empêche de partir en
-- double.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.quotas_appels (
  cle          text PRIMARY KEY,
  compte       integer     NOT NULL DEFAULT 0,
  fenetre_fin  timestamptz NOT NULL
);

COMMENT ON TABLE public.quotas_appels IS
  'Compteurs de quota partages entre instances (ECH-004). Une ligne par cle = prefixe de route + identifiant appelant. Purgee au fil de l''eau par consommer_quota.';

-- La purge balaie par date : sans cet index elle scannerait la table entière.
CREATE INDEX IF NOT EXISTS idx_quotas_appels_fenetre ON public.quotas_appels (fenetre_fin);

-- Aucune policy : seules les routes `service_role` y touchent, comme les
-- rollups de campagne. RLS active et deny-all par défaut.
ALTER TABLE public.quotas_appels ENABLE ROW LEVEL SECURITY;

/**
 * Consomme une unité de quota et dit si l'appel passe.
 *
 * Tout tient dans UNE instruction `INSERT … ON CONFLICT DO UPDATE … RETURNING` :
 * c'est ce qui rend le compteur exact quand deux instances appellent en même
 * temps. Un `SELECT` suivi d'un `UPDATE` aurait la même faille que la `Map` en
 * mémoire qu'il remplace, à l'échelle de la transaction près.
 *
 * Le rendu est `{ ok, retry_s }`, la même forme que le limiteur Upstash, pour
 * que l'appelant n'ait pas à savoir quel moteur a répondu.
 */
CREATE OR REPLACE FUNCTION public.consommer_quota(
  p_cle       text,
  p_max       integer,
  p_fenetre_s integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_maintenant timestamptz := now();
  v_compte     integer;
  v_fin        timestamptz;
BEGIN
  INSERT INTO public.quotas_appels AS q (cle, compte, fenetre_fin)
  VALUES (p_cle, 1, v_maintenant + make_interval(secs => p_fenetre_s))
  ON CONFLICT (cle) DO UPDATE
    SET compte = CASE WHEN q.fenetre_fin <= v_maintenant THEN 1 ELSE q.compte + 1 END,
        fenetre_fin = CASE WHEN q.fenetre_fin <= v_maintenant
                           THEN v_maintenant + make_interval(secs => p_fenetre_s)
                           ELSE q.fenetre_fin END
  RETURNING q.compte, q.fenetre_fin INTO v_compte, v_fin;

  -- Purge déterministe : uniquement quand CETTE clé vient de repartir à zéro,
  -- donc au plus une fois par fenêtre et par clé. Les lignes d'un jour sont
  -- éteintes depuis longtemps ; l'index les retrouve sans balayer la table.
  IF v_compte = 1 THEN
    DELETE FROM public.quotas_appels
     WHERE fenetre_fin < v_maintenant - interval '1 day';
  END IF;

  RETURN jsonb_build_object(
    'ok', v_compte <= p_max,
    'retry_s', CASE WHEN v_compte <= p_max THEN 0
               ELSE GREATEST(1, CEIL(EXTRACT(epoch FROM (v_fin - v_maintenant))))::int END
  );
END;
$$;

-- Durcissement, comme les 67 autres fonctions (sql/099) : service_role seul.
REVOKE ALL ON FUNCTION public.consommer_quota(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consommer_quota(text, integer, integer) TO service_role;
