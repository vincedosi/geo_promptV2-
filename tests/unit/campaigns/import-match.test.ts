import { describe, it, expect } from 'vitest';
import { findMatchingCampaign } from '@/lib/campaigns/import-match';

const camp = (id: string, name: string, links?: Record<string, Record<string, string>>) => ({
  id, name, dsp_source: 'magelian',
  geo_strategy: links ? { channels: { links } } : {},
});

describe('findMatchingCampaign', () => {
  it('match par liaison : links.<dspSource>.campaign_id == nom de campagne du fichier', () => {
    const c = camp('1', 'Ma campagne', { adform: { campaign_id: '886641' } });
    expect(findMatchingCampaign([c], 'adform', '886641')).toMatchObject({ id: '1', matchedBy: 'link' });
  });
  it('match par liaison sur campaign_name (trim + insensible à la casse)', () => {
    const c = camp('1', 'Interne', { adform: { campaign_name: ' Vague Été ' } });
    expect(findMatchingCampaign([c], 'adform', 'vague été')).toMatchObject({ id: '1', matchedBy: 'link' });
  });
  it('match par nom de campagne à défaut de liaison', () => {
    const c = camp('2', 'Vague été');
    expect(findMatchingCampaign([c], 'adform', 'VAGUE ÉTÉ ')).toMatchObject({ id: '2', matchedBy: 'name' });
  });
  it('la liaison prime sur le nom ; aucun match → null', () => {
    const byLink = camp('1', 'autre', { adform: { campaign_id: 'X1' } });
    const byName = camp('2', 'X1');
    expect(findMatchingCampaign([byLink, byName], 'adform', 'X1')?.id).toBe('1');
    expect(findMatchingCampaign([byName], 'tiktok', 'zzz')).toBeNull();
  });
});
