import { describe, it, expect } from 'vitest';
import { addCible, removeCible, cibleScope } from '@/lib/cibles/draft';

const A = { id: 'a1', name: 'Zone A', sourceType: 'indicator_threshold' };
const B = { id: 'b2', name: 'Zone B', sourceType: 'isochrone' };

describe('draft cibles', () => {
  it('addCible dédoublonne par id', () => {
    expect(addCible(addCible([A], B), A)).toEqual([A, B]);
  });
  it('removeCible retire par id', () => {
    expect(removeCible([A, B], 'a1')).toEqual([B]);
  });
  it('cibleScope : vide = national, sinon custom_zone', () => {
    expect(cibleScope([])).toEqual({ scope_type: 'national' });
    expect(cibleScope([A])).toEqual({ scope_type: 'custom_zone' });
  });
});
