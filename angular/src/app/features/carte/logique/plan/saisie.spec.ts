import { DEFAULT_PROG_DRAFT, type ProgDraft } from './brouillon';
import { basculerPlateforme, lireMontant, poserMontant } from './saisie';

const avec = (p: Partial<ProgDraft>): ProgDraft => ({ ...DEFAULT_PROG_DRAFT, ...p });

describe('saisie du plan (T5)', () => {
  it('cocher ajoute la plateforme à sa liste, sans toucher aux montants', () => {
    const d = basculerPlateforme(avec({ channelBudgets: { meta: 10 } }), 'dsps', 'dv360');
    expect(d.channels.dsps).toEqual(['dv360']);
    expect(d.channelBudgets).toEqual({ meta: 10 });
  });

  it('décocher une plateforme retire son budget ET son CPM prévu, pas ceux des autres', () => {
    const d = avec({
      channels: { dsps: ['dv360', 'ttd'], socials: [], ad_server: null },
      channelBudgets: { dv360: 1000, ttd: 500 }, cpmPrevus: { dv360: 4, ttd: 3 },
    });
    const apres = basculerPlateforme(d, 'dsps', 'dv360');
    expect(apres.channels.dsps).toEqual(['ttd']);
    expect(apres.channelBudgets).toEqual({ ttd: 500 });
    expect(apres.cpmPrevus).toEqual({ ttd: 3 });
    expect(d.channelBudgets).toEqual({ dv360: 1000, ttd: 500 });
  });

  it('poser puis retirer un montant (null)', () => {
    const d = poserMontant(avec({}), 'cpmPrevus', 'meta', 3.5);
    expect(d.cpmPrevus).toEqual({ meta: 3.5 });
    expect(poserMontant(d, 'cpmPrevus', 'meta', null).cpmPrevus).toEqual({});
  });

  it('lireMontant : vide, illisible ou négatif → null', () => {
    expect(lireMontant('')).toBeNull();
    expect(lireMontant('abc')).toBeNull();
    expect(lireMontant('-1')).toBeNull();
    expect(lireMontant('0')).toBe(0);
    expect(lireMontant('4.25')).toBe(4.25);
  });
});
