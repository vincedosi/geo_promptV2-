import { describe, it, expect } from 'vitest';
import { parseMagelianParams } from '@/components/magelian/deep-link';

describe('parseMagelianParams', () => {
  it('retourne null sans param pertinent', () => {
    expect(parseMagelianParams(new URLSearchParams(''))).toBeNull();
    expect(parseMagelianParams(new URLSearchParams('foo=bar'))).toBeNull();
  });

  it('parse campaign seul', () => {
    expect(parseMagelianParams(new URLSearchParams('campaign=abc-123')))
      .toEqual({ campaignId: 'abc-123', tab: undefined });
  });

  it('parse tab valide', () => {
    expect(parseMagelianParams(new URLSearchParams('tab=apercu')))
      .toEqual({ campaignId: undefined, tab: 'apercu' });
  });

  it('ignore un tab invalide (mais garde campaign)', () => {
    expect(parseMagelianParams(new URLSearchParams('campaign=x&tab=zzz')))
      .toEqual({ campaignId: 'x', tab: undefined });
    expect(parseMagelianParams(new URLSearchParams('tab=zzz'))).toBeNull();
  });

  it('parse les deux', () => {
    expect(parseMagelianParams(new URLSearchParams('campaign=x&tab=suivi')))
      .toEqual({ campaignId: 'x', tab: 'suivi' });
  });
});
