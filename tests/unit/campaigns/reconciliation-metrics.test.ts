import { describe, it, expect } from 'vitest';
import { measureRateTone } from '@/lib/campaigns/reconciliation-metrics';

describe('measureRateTone', () => {
  it('≥95 ok · 90 warn · 80 bad · null warn', () => {
    expect(measureRateTone(97)).toBe('ok');
    expect(measureRateTone(95)).toBe('ok');
    expect(measureRateTone(90)).toBe('warn');
    expect(measureRateTone(85)).toBe('warn');
    expect(measureRateTone(80)).toBe('bad');
    expect(measureRateTone(null)).toBe('warn');
  });
});
