import { describe, expect, it } from 'vitest';
import { validateDV360Code } from '@/lib/prompting/code-generation/dv360';
import { validateAdformJSON } from '@/lib/prompting/code-generation/adform';
import { validateTTDJSON } from '@/lib/prompting/code-generation/ttd';

describe('validateDV360Code', () => {
  it('passes a valid sample', () => {
    const code = `
def calculate_bid(req):
  COEFFICIENTS = {1001: 1.5}
  return COEFFICIENTS.get(req.geo_id, 1.0)
`;
    expect(validateDV360Code(code).ok).toBe(true);
  });

  it('reports missing function and dict', () => {
    const out = validateDV360Code('print("hello")');
    expect(out.ok).toBe(false);
    expect(out.missing).toContain('fonction calculate_bid()');
    expect(out.missing).toContain('dictionnaire COEFFICIENTS');
  });
});

describe('validateAdformJSON', () => {
  it('passes a valid rules array', () => {
    const json = JSON.stringify({
      rules: [
        { targeting: { geo: { code: 'FR-11' } }, bid_modifier: 1.5 },
        { targeting: { geo: { code: 'FR-32' } }, bid_modifier: 0.8 },
      ],
    });
    expect(validateAdformJSON(json).ok).toBe(true);
  });

  it('rejects bid_modifier out of [0.1, 3.0]', () => {
    const json = JSON.stringify({
      rules: [{ targeting: { geo: { code: 'FR-11' } }, bid_modifier: 5.0 }],
    });
    const out = validateAdformJSON(json);
    expect(out.ok).toBe(false);
    expect(out.errors[0]).toMatch(/hors \[0.1, 3.0\]/);
  });

  it('rejects missing rules array', () => {
    expect(validateAdformJSON('{}').ok).toBe(false);
  });

  it('rejects invalid JSON', () => {
    expect(validateAdformJSON('not json').ok).toBe(false);
  });
});

describe('validateTTDJSON', () => {
  it('passes a valid Lines array', () => {
    const json = JSON.stringify({
      Lines: [
        { Dimension: 'Country', Value: 'FR', BidLine: { BidLineMultiplier: 1.2 } },
        { Dimension: 'PostalCode', Value: '75001', BidLine: { BidLineMultiplier: 2.5 } },
      ],
    });
    expect(validateTTDJSON(json).ok).toBe(true);
  });

  it('rejects multiplier out of bounds', () => {
    const json = JSON.stringify({
      Lines: [{ Dimension: 'Country', Value: 'FR', BidLine: { BidLineMultiplier: 0.05 } }],
    });
    const out = validateTTDJSON(json);
    expect(out.ok).toBe(false);
    expect(out.errors[0]).toMatch(/hors/);
  });

  it('rejects missing Lines', () => {
    expect(validateTTDJSON('{}').ok).toBe(false);
  });
});
