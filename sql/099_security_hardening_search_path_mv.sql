-- 099 — Durcissement sécurité (advisors Supabase du 07/07/2026)
-- Appliquée via MCP Supabase le 07/07/2026.
--
-- 1) search_path figé sur les 9 routines récentes qui ne l'avaient pas
--    (vecteur théorique d'escalade via schéma malveillant).
--    NB : les populate_carreaux_* sont des PROCÉDURES (prokind='p').
alter procedure public.populate_carreaux_20km() set search_path = public;
alter procedure public.populate_carreaux_preaggregate() set search_path = public;
alter procedure public.populate_carreaux_1km() set search_path = public;
alter function public.get_campaign_last_data_dates(p_ids uuid[]) set search_path = public;
alter function public.get_national_population_totals() set search_path = public;
alter function public.get_campaign_pacing(p_campaign_id uuid, p_metric_field text, p_version integer) set search_path = public;
alter function public.set_dsp_connections_updated_at() set search_path = public;
alter function public.get_zone_radius_targets(p_zone_id uuid) set search_path = public;
alter function public.get_dept_representative_communes() set search_path = public;

-- 2) Vues matérialisées : plus lisibles via PostgREST par anon/authenticated
--    (aucun consommateur client — vérifié par grep ; les RPC service_role suffisent).
revoke select on public.carreaux_20km from anon, authenticated;
revoke select on public.iris_metrics_mv from anon, authenticated;
revoke select on public.radio_couvertures_agg from anon, authenticated;
grant select on public.carreaux_20km to service_role;
grant select on public.iris_metrics_mv to service_role;
grant select on public.radio_couvertures_agg to service_role;
