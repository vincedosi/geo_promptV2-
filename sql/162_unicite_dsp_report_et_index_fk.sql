-- ============================================================================
-- sql/162 — unicité vérifiable du rapport DSP, et index de clés étrangères
--           là où une suppression les traverse vraiment (2026-09-13)
--
-- Point 12 de docs/audit/QUICK_WINS.md, exécuté après mesure — et la mesure a
-- fait diverger l'exécution de la consigne sur deux points, dits ici.
--
-- ── 1. `campaign_dsp_report` : un index UNIQUE, pas une clé primaire ────────
--
-- L'audit demandait « une clé primaire ». Impossible en l'état : `date` est
-- NULLABLE et vaut NULL sur 2 041 des 2 131 lignes — c'est le grain « par code
-- postal », par opposition au grain « par jour ». Une clé primaire refuse les
-- NULL ; la rendre possible exigerait de changer le sens de la colonne.
--
-- Le projet a déjà répondu à ce problème exact sur `dsp_campaign_data`, avec un
-- index d'EXPRESSION (`idx_dsp_data_unique`) où `COALESCE` rend deux NULL
-- égaux. On applique le même patron, pour la même raison.
--
-- `source` FAIT PARTIE DE LA CLÉ, et ce n'est pas un détail : les deux chemins
-- d'écriture purgent chacun LEUR source avant d'insérer — `source = 'api'` pour
-- la route de tirage, `source = 'simulated'` pour la RPC de démo. Sans `source`
-- dans la clé, une campagne portant les deux flux violerait la contrainte alors
-- que les deux lignes sont légitimes.
--
-- Vérifié avant pose : 2 131 lignes, 2 131 clés distinctes. L'index passe.
--
-- Ce qu'il apporte : l'idempotence de cette table REPOSE aujourd'hui sur un
-- DELETE ciblé suivi d'un INSERT, et rien ne la vérifie. Si le DELETE échoue ou
-- cible mal, l'INSERT double le rapport DSP — donc le taux de mesure affiché au
-- média planner. Avec cet index, ce doublement devient une ERREUR au lieu d'un
-- chiffre faux.
--
-- ── 2. Index de clés étrangères : 11 sur 19, et pourquoi pas les 19 ─────────
--
-- L'audit compte 19 clés étrangères sans index. Mesure du 2026-09-13 : les 15
-- tables concernées contiennent **au plus 3 lignes**, et huit d'entre elles
-- sont vides et sans écrivain applicatif (`bidding_simulations`,
-- `adaptive_model_state`, `bidding_drift_events` — voir ARCHITECTURE.md).
-- Balayer une table vide est gratuit : le gain annoncé est nul aujourd'hui.
--
-- Poser les 19 créerait donc 19 index à `idx_scan = 0` — exactement ce que le
-- point 6 de la même liste demande de SUPPRIMER. On pose les 11 qui réunissent
-- les deux conditions : la table parente a une route de suppression réelle dans
-- l'application, ET la table enfant grossit avec l'usage normal.
--
-- Les 8 autres restent nues, et c'est écrit dans le plan pour que personne ne
-- croie l'oubli involontaire.
-- ============================================================================

-- ── 1. Unicité du rapport DSP ───────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_dsp_report_unique
  ON public.campaign_dsp_report (
    campaign_id,
    COALESCE(date, '1970-01-01'::date),
    channel,
    postal_code,
    source
  );

COMMENT ON INDEX public.idx_dsp_report_unique IS
  'Cle naturelle du rapport DSP (sql/162). Index d EXPRESSION et non cle primaire : `date` est NULL sur le grain « par code postal » (2 041 lignes sur 2 131), et une PK refuse les NULL. Meme patron que idx_dsp_data_unique sur dsp_campaign_data. `source` fait partie de la cle : les chemins api et simulated purgent chacun LEUR source, et coexistent legitimement. Rend VERIFIABLE l idempotence par DELETE cible + INSERT, dont dependait le taux de mesure affiche au media planner.';

-- ── 2. Clés étrangères traversées par une suppression réelle ────────────────

-- Parent : dsp_campaigns, supprimable par DELETE /api/admin/campaigns/[id]
CREATE INDEX IF NOT EXISTS idx_bidding_drafts_campaign
  ON public.bidding_strategy_drafts (campaign_id);

-- Parent : bidding_strategies, supprimable par DELETE /api/bidding/strategies/[id]
CREATE INDEX IF NOT EXISTS idx_bidding_drafts_strategie
  ON public.bidding_strategy_drafts (resulting_strategy_id);

-- Parent : auth.users, supprimable par DELETE /api/admin/users/[id].
-- Ces cinq tables grossissent avec l'usage normal d'un compte.
CREATE INDEX IF NOT EXISTS idx_saved_maps_user
  ON public.saved_maps (user_id);

CREATE INDEX IF NOT EXISTS idx_agent_chat_messages_user
  ON public.agent_chat_messages (user_id);

CREATE INDEX IF NOT EXISTS idx_smart_prompt_feedback_user
  ON public.smart_prompt_feedback (user_id);

CREATE INDEX IF NOT EXISTS idx_data_sources_imported_by
  ON public.data_sources (imported_by);

CREATE INDEX IF NOT EXISTS idx_iris_import_history_user
  ON public.iris_import_history (user_id);

CREATE INDEX IF NOT EXISTS idx_agent_recommendations_applied_by
  ON public.agent_recommendations (applied_by);

CREATE INDEX IF NOT EXISTS idx_dsp_campaigns_created_by
  ON public.dsp_campaigns (created_by);

CREATE INDEX IF NOT EXISTS idx_campaign_organizations_added_by
  ON public.campaign_organizations (added_by);

-- Parent : profiles, supprime avec l'utilisateur
CREATE INDEX IF NOT EXISTS idx_dsp_connections_created_by
  ON public.dsp_connections (created_by);
