import { describe, it, expect } from 'vitest';
import { computeForecast } from '@/components/campaign/wizard/steps/ForecastStrip';

describe('computeForecast', () => {
  it('impressions = budget / CPM × 1000', () => {
    expect(computeForecast(52000, 7.1, []).impressions).toBe(Math.round((52000 / 7.1) * 1000));
  });
  it('audience = somme des populations connues ; null si aucune', () => {
    expect(computeForecast(1000, 5, [1200, 800]).audience).toBe(2000);
    expect(computeForecast(1000, 5, []).audience).toBeNull();
  });
  it('coût / 1000 habitants ; null sans budget, CPM ou audience', () => {
    expect(computeForecast(2000, 5, [1000000]).costPerThousandPeople).toBe(2);
    expect(computeForecast(null, 5, [100]).impressions).toBeNull();
    expect(computeForecast(2000, null, [100]).impressions).toBeNull();
    expect(computeForecast(2000, 0, [100]).impressions).toBeNull();
  });
});
