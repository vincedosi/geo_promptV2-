import { describe, it, expect } from 'vitest';
import { partitionCampaigns } from '@/lib/campaigns/overlay-partition';

const camp = (id: string, dsp_source: string | null, tracked: number) =>
  ({ id, name: id, dsp_source, total_tracked_ads: tracked });

describe('partitionCampaigns', () => {
  const campaigns = [
    camp('coquille', 'magelian', 0),          // en création, vierge
    camp('coquille-absorbee', 'magelian', 50), // en création, a absorbé un import
    camp('lancee', 'magelian', 100),           // stratégie active
    camp('import-orphelin', 'adform', 300),    // données sans stratégie
    camp('import-lie', 'adform', 400),         // import avec stratégie (legacy)
  ];
  const strategies = new Set(['lancee', 'import-lie']);
  const p = partitionCampaigns(campaigns, strategies);

  it('consultables = données OU stratégie (jamais les coquilles vierges)', () => {
    expect(p.consultables.map((c) => c.id)).toEqual(
      ['coquille-absorbee', 'lancee', 'import-orphelin', 'import-lie'],
    );
  });

  it('shells = magelian sans stratégie, même avec données absorbées', () => {
    expect(p.shells.map((c) => c.id)).toEqual(['coquille', 'coquille-absorbee']);
  });

  it('launched = toute campagne avec stratégie', () => {
    expect(p.launched.map((c) => c.id)).toEqual(['lancee', 'import-lie']);
  });

  it('total_tracked_ads null traité comme 0', () => {
    const q = partitionCampaigns(
      [{ id: 'x', name: 'x', dsp_source: 'magelian', total_tracked_ads: null }],
      new Set(),
    );
    expect(q.consultables).toEqual([]);
    expect(q.shells.map((c) => c.id)).toEqual(['x']);
  });
});
