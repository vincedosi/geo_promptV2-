import { describe, it, expect } from 'vitest';
import { linksSelectionHash } from '@/components/campaign/wizard/steps/types';

const sel = { dsps: ['dv360'], socials: [], ad_server: 'adform' as string | null };

describe('linksSelectionHash', () => {
  it('stable pour un contenu identique (ordre des clés indifférent)', () => {
    expect(linksSelectionHash(sel, { dv360: { advertiser_id: '1', campaign_id: '2' } }))
      .toBe(linksSelectionHash({ ...sel }, { dv360: { campaign_id: '2', advertiser_id: '1' } }));
  });
  it("change si un canal, l'ad server ou une liaison change", () => {
    const h = linksSelectionHash(sel, {});
    expect(linksSelectionHash({ ...sel, dsps: ['dv360', 'ttd'] }, {})).not.toBe(h);
    expect(linksSelectionHash({ ...sel, ad_server: 'cm360' }, {})).not.toBe(h);
    expect(linksSelectionHash(sel, { dv360: { advertiser_id: '9' } })).not.toBe(h);
  });
  it('ignore les entrées de liaison vides', () => {
    expect(linksSelectionHash(sel, { dv360: {} })).toBe(linksSelectionHash(sel, {}));
  });
});
