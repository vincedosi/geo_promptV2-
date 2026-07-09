-- 103 — Ajuster : duplication serveur du dernier snapshot de plan en v+1
-- (évite un aller-retour de milliers de lignes CP sur Nano).
-- p_budgets : jsonb {"dv360": 30000, "tiktok": 15000} — budget par dsp du snapshot ;
-- clé absente = budget inchangé. p_cpm/p_period_* : null = inchangé.
create or replace function public.duplicate_plan_snapshot(
  p_campaign_id uuid,
  p_created_by uuid,
  p_budgets jsonb default '{}'::jsonb,
  p_cpm numeric default null,
  p_period_start date default null,
  p_period_end date default null
) returns table (new_version int, rows_inserted int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last int;
  v_new int;
  v_count int;
begin
  select max(version) into v_last from campaign_plan_snapshot where campaign_id = p_campaign_id;
  if v_last is null then
    return query select null::int, 0;
    return;
  end if;
  v_new := v_last + 1;
  insert into campaign_plan_snapshot (
    campaign_id, version, created_by, dsp, budget, cpm, cible,
    zone_id, zone_name, item_id, item_name, item_weight, expected_share,
    postal_code, period_start, period_end
  )
  select
    campaign_id, v_new, p_created_by, dsp,
    coalesce((p_budgets ->> dsp)::numeric, budget),
    coalesce(p_cpm, cpm), cible,
    zone_id, zone_name, item_id, item_name, item_weight, expected_share,
    postal_code,
    coalesce(p_period_start, period_start),
    coalesce(p_period_end, period_end)
  from campaign_plan_snapshot
  where campaign_id = p_campaign_id and version = v_last;
  get diagnostics v_count = row_count;
  return query select v_new, v_count;
end;
$$;

-- Durcissement (pattern projet : SECURITY DEFINER verrouillé service_role)
revoke all on function public.duplicate_plan_snapshot(uuid, uuid, jsonb, numeric, date, date) from public, anon, authenticated;
grant execute on function public.duplicate_plan_snapshot(uuid, uuid, jsonb, numeric, date, date) to service_role;
