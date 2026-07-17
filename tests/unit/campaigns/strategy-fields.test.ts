import { describe, it, expect } from 'vitest';
import { DEFAULT_PROG_DRAFT, strategyFieldsFromDraft } from '@/components/campaign/wizard/steps/types';

describe('strategyFieldsFromDraft', () => {
  it('mappe les champs du draft vers le POST stratégie', () => {
    expect(strategyFieldsFromDraft({
      ...DEFAULT_PROG_DRAFT, objective: 'maximize_impressions', kpiTarget: 500000,
      freqCapImps: 3, freqCapDays: 7, pacing: 'front_loaded',
    })).toEqual({
      objective_code: 'maximize_impressions', kpi_target: 500000,
      frequency_cap_imps: 3, frequency_cap_period_days: 7, pacing_strategy: 'front_loaded',
    });
  });
  it('défauts : maximize_leads, pas de KPI, pas de cap, pacing even', () => {
    expect(strategyFieldsFromDraft(DEFAULT_PROG_DRAFT)).toEqual({
      objective_code: 'maximize_leads', kpi_target: null,
      frequency_cap_imps: null, frequency_cap_period_days: null, pacing_strategy: 'even',
    });
  });
  it("cap incomplet (imps sans jours ou l'inverse) → pas de cap", () => {
    expect(strategyFieldsFromDraft({ ...DEFAULT_PROG_DRAFT, freqCapImps: 3 }).frequency_cap_imps).toBeNull();
    expect(strategyFieldsFromDraft({ ...DEFAULT_PROG_DRAFT, freqCapDays: 7 }).frequency_cap_period_days).toBeNull();
  });
});
