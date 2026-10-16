-- 250 — Suppression de l'historique de chat de l'agent d'enchères (2026-10-12)
--
-- ── Pourquoi ─────────────────────────────────────────────────────────────────
--
-- Chantier « suppression de toute l'IA », lot 2 : l'agent d'enchères
-- (`lib/agent/**`, `/api/agent/*`, le panneau `AgentPanel`) et son cron de
-- purge hebdomadaire (`agentChatPurgeWeekly`) sont retirés du code. Plus rien
-- n'écrit ni ne lit `agent_chat_messages`, et plus rien n'appelle
-- `purge_old_agent_chat_messages()`. Décision du propriétaire (2026-10-12) :
-- « tu peux sup les tables historiques de chat ».
--
-- ── Ce qui part, et seulement ça ─────────────────────────────────────────────
--
--   - la fonction `purge_old_agent_chat_messages()` (sans argument, rend un
--     integer) — sa seule raison d'être était cette table ;
--   - la table `agent_chat_messages` (0 ligne en local le 2026-10-12), avec ses
--     3 politiques RLS, sa clé primaire et ses index, qui tombent avec elle.
--
-- Mesuré avant suppression : aucune vue, aucune clé étrangère entrante, et
-- aucune autre fonction ne la nomme (`pg_proc.prosrc`). Rien d'autre ne
-- dépend d'elle : pas de CASCADE, pour qu'une dépendance inattendue fasse
-- ÉCHOUER la migration plutôt que d'emporter un objet en silence.
--
-- Les AUTRES tables de l'agent (`agent_autonomy_settings`,
-- `agent_recommendations`, `adaptive_model_state`, `bidding_agent_actions`,
-- `bidding_drift_events`, …) RESTENT en base : leur sort est remis au
-- propriétaire en fin de chantier.
--
-- ── Rejouable ────────────────────────────────────────────────────────────────
--
-- `IF EXISTS` partout : un second passage ne fait rien. Sauvegarde prise
-- avant application : `C:/GENESIS/_sauvegarde_locale/local-2026-10-12.dump`.

begin;

drop function if exists public.purge_old_agent_chat_messages();
drop table if exists public.agent_chat_messages;

notify pgrst, 'reload schema';

commit;
