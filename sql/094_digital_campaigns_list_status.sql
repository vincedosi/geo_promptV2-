-- ============================================================
-- 094 — get_digital_campaigns_list expose status_override
-- ============================================================
-- Appliquée le 2026-07-04 via MCP Supabase (migration digital_campaigns_list_status).
--
-- La CampaignCard digitale (app/map/analyse/digital) a besoin de status_override
-- pour calculer le statut effectif (lib/campaigns/status.ts) au même titre que
-- la liste admin. last_data_date n'est pas ajouté ici : il est fusionné côté
-- route (/api/digital/campaigns) via get_campaign_last_data_dates, comme pour
-- /api/admin/campaigns, pour éviter un sous-select supplémentaire par ligne
-- dans cette RPC déjà agrégée.

CREATE OR REPLACE FUNCTION public.get_digital_campaigns_list(p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT dc.id, dc.name, dc.dsp_source, dc.date_start, dc.date_end,
      dc.total_tracked_ads, dc.organization_id, dc.status_override,
      (SELECT COALESCE(json_agg(json_build_object('id', o.id, 'name', o.name, 'slug', o.slug)), '[]'::json)
       FROM campaign_organizations co
       JOIN organizations o ON o.id = co.organization_id
       WHERE co.campaign_id = dc.id
      ) as organizations,
      (SELECT COUNT(DISTINCT media) FROM dsp_campaign_data WHERE campaign_id=dc.id AND media IS NOT NULL AND media!='')::int as nb_medias,
      (SELECT COUNT(DISTINCT postal_code) FROM dsp_campaign_data WHERE campaign_id=dc.id)::int as nb_postal_codes,
      (SELECT COALESCE(SUM(unique_impressions),0) FROM dsp_campaign_data WHERE campaign_id=dc.id) as total_unique_impressions
    FROM dsp_campaigns dc
    WHERE (
      p_organization_id IS NULL
      OR EXISTS (
        SELECT 1 FROM campaign_organizations co
        WHERE co.campaign_id = dc.id
        AND co.organization_id = p_organization_id
      )
    )
    ORDER BY dc.created_at DESC
  ) t;
$function$;
