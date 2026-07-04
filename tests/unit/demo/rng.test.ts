import { describe, it, expect } from 'vitest';
import { mulberry32, rngFor } from '@/lib/demo/rng';

describe('rng', () => {
  it('mulberry32 est déterministe pour un même seed', () => {
    const a = mulberry32(42); const b = mulberry32(42);
    const seqA = [a(), a(), a()]; const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA[0]).toBeGreaterThanOrEqual(0);
    expect(seqA[0]).toBeLessThan(1);
  });

  it('des seeds différents divergent', () => {
    expect(mulberry32(1)()).not.toEqual(mulberry32(2)());
  });

  it('rngFor est stable par (seed, clé) et varie selon la clé', () => {
    expect(rngFor(42, '75001')).toEqual(rngFor(42, '75001'));
    expect(rngFor(42, '75001')).not.toEqual(rngFor(42, '75002'));
  });
});
