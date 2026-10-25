/**
 * `get_campaign_expected` (sql/280, lot 6, relecture 3) contre la vraie base locale, dans une transaction ANNULÉE :
 * - une période d'UN jour a un volume attendu (`kpi_target` en fin de journée) — elle rendait NULL (sql/113) ;
 * - une période de deux jours ou plus rend la valeur d'avant, au chiffre près (mi-période, fin, après la fin).
 * Une période à l'envers n'existe pas en base (contrainte `bs_dates_consistent`) : la garde ne change que le cas d'un jour.
 * Rien n'est écrit : chaque cas vit dans un `begin … rollback`.
 */
import { describe, expect, it } from 'vitest';
import { psql } from './_psql';

const ORG = '00000000-0000-0000-0000-000000000001';

/** Le volume attendu d'une campagne éphémère : stratégie `maximize_impressions`, un rollup au jour `asOf`. */
function attendu(debut: string, fin: string, asOf: string, kpi = 3000000): string {
  return psql(`
    begin;
    create temp table t as with c as (insert into public.dsp_campaigns(name, organization_id, is_demo)
      values ('[ESSAI sql/280]', '${ORG}', true) returning id) select id from c;
    insert into public.bidding_strategies(name, campaign_id, algorithm_code, objective_code, granularity, weighting_mode, status,
      in_zone_weights, total_budget, forecast_cpm, kpi_target, start_date, end_date)
      select 'essai', id, 'zone_set', 'maximize_impressions', 'postal_code', 'by_zone_set', 'active', '{}'::jsonb, 13000, 4.33, ${kpi},
             '${debut}', '${fin}' from t;
    insert into public.campaign_daily_rollup(campaign_id, date) select id, '${asOf}' from t;
    select coalesce(public.get_campaign_expected(id)::text, 'NULL') from t;
    rollback;`);
}

describe('get_campaign_expected — période d’un jour (sql/280)', () => {
  it('un jour : le volume prévu entier au rollup de ce jour', () => {
    expect(Number(attendu('2026-11-30', '2026-11-30', '2026-11-30'))).toBe(3000000);
  });

  it('deux jours et plus : inchangé (moitié à mi-période, total en fin et après)', () => {
    expect(Number(attendu('2026-11-29', '2026-11-30', '2026-11-29'))).toBe(1500000);
    expect(Number(attendu('2026-11-01', '2026-11-30', '2026-11-15'))).toBe(1500000);
    expect(Number(attendu('2026-11-01', '2026-11-30', '2026-11-30'))).toBe(3000000);
    expect(Number(attendu('2026-11-01', '2026-11-30', '2026-12-10'))).toBe(3000000);
  });
});
