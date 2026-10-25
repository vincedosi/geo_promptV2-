import { DEFAULT_PROG_DRAFT } from './brouillon';
import { remplirCanaux, remplirDepuisStrategie, remplirIdentite } from './preremplissage';

const CAMP = { name: 'Rentrée', advertiser: 'Annonceur', product: null, date_start: '2026-11-01T00:00:00Z', date_end: null };

describe('remplirIdentite — ce qui est vide seulement', () => {
  it('remplit un brouillon vierge, dates au jour', () => {
    expect(remplirIdentite(DEFAULT_PROG_DRAFT, CAMP)).toMatchObject({
      name: 'Rentrée', advertiser: 'Annonceur', product: '', startDate: '2026-11-01', endDate: '',
    });
  });
  it('garde ce que le brouillon porte déjà', () => {
    const d = { ...DEFAULT_PROG_DRAFT, name: 'Mon nom', startDate: '2026-12-01' };
    expect(remplirIdentite(d, CAMP)).toMatchObject({ name: 'Mon nom', advertiser: 'Annonceur', startDate: '2026-12-01' });
  });
});

describe('remplirDepuisStrategie', () => {
  it('CPM, dates et mode écrasent ; une valeur absente garde la courante ; pression et cibles intouchées', () => {
    const d = { ...DEFAULT_PROG_DRAFT, startDate: '2026-01-01', pressure: 2.9 };
    const r = remplirDepuisStrategie(d, { forecast_cpm: 4.2, start_date: null, end_date: '2026-03-31', execution_mode: null });
    expect(r).toMatchObject({ forecastCpm: 4.2, startDate: '2026-01-01', endDate: '2026-03-31', executionMode: 'auto', pressure: 2.9 });
  });
});

describe('remplirCanaux — chaque sous-clé vide prend le stocké', () => {
  const stocke = { dsps: ['dv360'], socials: ['meta'], ad_server: null, budgets: { dv360: 1000 }, cpm_prevus: { dv360: 4 }, links: { dv360: { advertiser_id: '1' } } };

  it('brouillon vierge : tout est repris', () => {
    expect(remplirCanaux(DEFAULT_PROG_DRAFT, stocke)).toMatchObject({
      channels: { dsps: ['dv360'], socials: ['meta'], ad_server: null }, channelBudgets: { dv360: 1000 },
      channelLinks: { dv360: { advertiser_id: '1' } }, cpmPrevus: { dv360: 4 },
    });
  });
  it('une sous-clé déjà remplie est gardée ; rien de stocké : brouillon inchangé (même objet)', () => {
    const d = { ...DEFAULT_PROG_DRAFT, channelBudgets: { ttd: 5 } };
    expect(remplirCanaux(d, stocke)).toMatchObject({ channelBudgets: { ttd: 5 }, cpmPrevus: { dv360: 4 } });
    expect(remplirCanaux(d, null)).toBe(d);
    const plein = { ...d, channels: stocke, channelLinks: { x: { a_id: '1' } }, cpmPrevus: { ttd: 1 } };
    expect(remplirCanaux(plein, stocke)).toBe(plein);
  });
});
