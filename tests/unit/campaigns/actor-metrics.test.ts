import { describe, it, expect } from 'vitest';
import { actorKindLabel, actorDisplayName } from '@/lib/campaigns/actor-metrics';

describe('actor-metrics', () => {
  it('label du kind en sentence case', () => {
    expect(actorKindLabel('dsp')).toBe('DSP');
    expect(actorKindLabel('social')).toBe('Social');
    expect(actorKindLabel('régie')).toBe('Régie');
  });
  it('nom affiché : fallback pour acteur vide', () => {
    expect(actorDisplayName('dv360')).toBe('dv360');
    expect(actorDisplayName('')).toBe('Non attribué');
  });
});
