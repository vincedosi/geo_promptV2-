-- 098 — RPC get_campaign_stats_by_field : agrégat pays/région/ville/média d'une
-- campagne DSP, GROUP BY côté serveur (remplace le fallback aggregateField qui
-- rapatriait les lignes brutes de dsp_campaign_data côté Next).
-- Clés du JSON dynamiques (p_field) pour rester compatible avec les consommateurs
-- existants ({ country, tracked_ads, row_count } / { region, ... }).
-- Appliquée via MCP Supabase le 2026-07-07. EXPLAIN ANALYZE : Parallel Index Scan
-- sur idx_dsp_data_campaign, ~105 ms sur la plus grosse campagne (185k lignes).
create or replace function public.get_campaign_stats_by_field(p_campaign_id uuid, p_field text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_field not in ('country', 'region', 'city', 'media') then
    raise exception 'get_campaign_stats_by_field: champ non autorisé %', p_field;
  end if;

  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(%L, t.v, ''tracked_ads'', t.ta, ''row_count'', t.rc) order by t.ta desc), ''[]''::jsonb)
       from (
         select coalesce(%I, ''(vide)'') as v,
                coalesce(sum(tracked_ads), 0)::bigint as ta,
                count(*)::bigint as rc
           from dsp_campaign_data
          where campaign_id = $1
          group by 1
       ) t',
    p_field, p_field
  ) into result using p_campaign_id;

  return result;
end;
$$;

-- Durcissement : accès service_role uniquement (cohérent migration 06/07).
revoke all on function public.get_campaign_stats_by_field(uuid, text) from public, anon, authenticated;
grant execute on function public.get_campaign_stats_by_field(uuid, text) to service_role;
