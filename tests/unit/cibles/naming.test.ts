import { describe, it, expect } from 'vitest';
import { buildCibleName, buildCibleMetadata } from '@/lib/cibles/naming';
import type { CibleIndicator } from '@/lib/cibles/naming';

const IND: CibleIndicator = {
  indicator_code: 'part_15_29', label: 'Part des 15-29 ans', famille: 'audience',
  unit: '%', slider_min: 0, slider_max: 60, slider_step: 0.5,
  default_operator: '>=', scale: 'iris', dynamic: false,
};

describe('buildCibleName', () => {
  it('format lisible avec opérateur, seuil, unité et mois', () => {
    const name = buildCibleName(IND.label, '>=', 22, '%', new Date('2026-07-07'));
    expect(name).toBe('Part des 15-29 ans ≥ 22 % — juil. 2026');
  });
  it('opérateur ≤ et unité € sans espace superflu', () => {
    const name = buildCibleName('Revenu médian', '<=', 18000, '€', new Date('2026-01-15'));
    expect(name).toBe('Revenu médian ≤ 18000 € — janv. 2026');
  });
});

describe('buildCibleMetadata', () => {
  it('porte la définition complète + date ISO', () => {
    const meta = buildCibleMetadata(IND, '>=', 22, new Date('2026-07-07T10:00:00Z'));
    expect(meta).toEqual({
      kind: 'indicator_threshold',
      indicator: 'part_15_29',
      operator: '>=',
      threshold: 22,
      unit: '%',
      scale: 'iris',
      materialized_at: '2026-07-07T10:00:00.000Z',
    });
  });
});
