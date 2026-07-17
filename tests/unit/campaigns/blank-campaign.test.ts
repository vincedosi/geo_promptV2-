import { describe, it, expect } from 'vitest';
import { defaultCampaignName } from '@/lib/campaigns/blank-campaign';

describe('defaultCampaignName', () => {
  it('format « Nouvelle campagne — JJ/MM/AAAA »', () => {
    expect(defaultCampaignName(new Date('2026-07-16T10:00:00Z'))).toBe('Nouvelle campagne — 16/07/2026');
  });

  it('épinglé Europe/Paris — date de la veille UTC devient jour suivant Paris', () => {
    // 2026-07-15T22:30:00Z = 2026-07-16T00:30:00 Paris
    expect(defaultCampaignName(new Date('2026-07-15T22:30:00Z'))).toBe('Nouvelle campagne — 16/07/2026');
  });
});
