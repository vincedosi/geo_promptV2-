-- ============================================================
-- 095 — get_campaign_last_data_dates : version BORNÉE (anti full seq scan)
-- ============================================================
-- Appliquée le 2026-07-04 via MCP Supabase.
--
-- La version sans argument de 093 faisait `GROUP BY campaign_id` sur TOUTE la
-- table dsp_campaign_data (~343k lignes) → Parallel Seq Scan (~150 ms, ~1300
-- pages disque), appelé sur les DEUX surfaces de liste en no-store. Profil de
-- l'incident I/O du 08-04. Postgres 15 ne fait pas de skip-scan : un index seul
-- ne suffit pas tant que la requête n'est pas bornée.
--
-- Ici on borne par la liste des campagnes affichées (p_ids). Le prédicat
-- `campaign_id = ANY(p_ids)` s'appuie sur l'index UNIQUE (campaign_id, date,
-- postal_code, city) → index scan borné aux N campagnes, plus de scan intégral.

DROP FUNCTION IF EXISTS public.get_campaign_last_data_dates();

CREATE OR REPLACE FUNCTION public.get_campaign_last_data_dates(p_ids uuid[])
RETURNS TABLE(campaign_id uuid, last_data_date date)
LANGUAGE sql
STABLE
AS $$
  SELECT campaign_id, max(date) AS last_data_date
  FROM public.dsp_campaign_data
  WHERE campaign_id = ANY(p_ids)
  GROUP BY campaign_id;
$$;
