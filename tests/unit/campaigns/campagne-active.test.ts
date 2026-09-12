import { describe, it, expect } from 'vitest';
import { deriveCampagneActive } from '@/lib/campaigns/campagne-active';

const campaigns = [
  { id: 'a', name: 'Campagne A', advertiser: 'Annonceur A' },
  { id: 'b', name: 'Campagne B', advertiser: null },
];

describe('deriveCampagneActive', () => {
  it('suivi/apercu suivent selectedId', () => {
    expect(deriveCampagneActive('suivi', null, 'a', campaigns))
      .toEqual({ id: 'a', nom: 'Campagne A', annonceur: 'Annonceur A' });
    expect(deriveCampagneActive('apercu', null, 'b', campaigns))
      .toEqual({ id: 'b', nom: 'Campagne B', annonceur: null });
  });

  it('strategie suit creationCampaignId, ignore selectedId', () => {
    expect(deriveCampagneActive('strategie', 'b', 'a', campaigns))
      .toEqual({ id: 'b', nom: 'Campagne B', annonceur: null });
  });

  it("aucun id pour l'onglet courant : null", () => {
    expect(deriveCampagneActive('suivi', null, null, campaigns)).toBeNull();
    expect(deriveCampagneActive('strategie', null, 'a', campaigns)).toBeNull();
  });

  it("id absent de la liste : null, jamais une entrée partielle", () => {
    expect(deriveCampagneActive('suivi', null, 'zzz', campaigns)).toBeNull();
  });

  it('liste pas encore chargée (campaigns === null) : null, jamais une exception (piège round 1)', () => {
    expect(deriveCampagneActive('suivi', null, 'a', null)).toBeNull();
    expect(deriveCampagneActive('strategie', 'a', null, null)).toBeNull();
  });
});
