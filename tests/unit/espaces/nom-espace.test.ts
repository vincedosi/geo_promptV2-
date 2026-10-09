import { describe, it, expect } from 'vitest';
import { nomAffiche } from '@/lib/espaces/nom-espace';

describe('nomAffiche (E2)', () => {
  it('renomme l\'organisation interne à l\'affichage seulement', () => {
    expect(nomAffiche({ name: 'GENESIS (Global)', slug: 'genesis-global' })).toBe('dentsu.explore (interne)');
  });
  it('laisse les autres noms tels quels', () => {
    expect(nomAffiche({ name: 'MARINE', slug: 'marine' })).toBe('MARINE');
  });
});
