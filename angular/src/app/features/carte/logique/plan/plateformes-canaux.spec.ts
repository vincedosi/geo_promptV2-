import type { ResolvedChannel } from './canaux';
import { CANAL_DE_PLATEFORME, preselectionDepuisExtraction } from './plateformes-canaux';

const canal = (code: string, category: ResolvedChannel['category'], available = true): ResolvedChannel => ({
  code, label: code, category, connection_provider: null, active: true, available, connected: false,
});
const CATALOGUE = [canal('dv360', 'dsp'), canal('ttd', 'dsp', false), canal('meta', 'social'), canal('tiktok', 'social'), canal('cm360', 'adserver')];

describe('CANAL_DE_PLATEFORME — plateformes_geo.plateforme → code de canal (A-5)', () => {
  it('les quatre plateformes de ⑤ ont leur canal', () => {
    expect(CANAL_DE_PLATEFORME).toEqual({ dv360: 'dv360', ttd: 'ttd', meta: 'meta', tiktok: 'tiktok' });
  });
});

describe('preselectionDepuisExtraction', () => {
  const avant = { dsps: ['ttd'], socials: ['tiktok'], ad_server: 'cm360' };

  it('coche les plateformes du résumé selon leur catégorie, garde l’ad server, remplace dsps et socials', () => {
    const r = preselectionDepuisExtraction([{ plateforme: 'dv360' }, { plateforme: 'meta' }], CATALOGUE, avant);
    expect(r).toEqual({ channels: { dsps: ['dv360'], socials: ['meta'], ad_server: 'cm360' }, nonRelies: [], indisponibles: [] });
  });

  it('un code sans correspondance ou absent du catalogue : « non relié », jamais coché', () => {
    const r = preselectionDepuisExtraction([{ plateforme: 'dv360' }, { plateforme: 'xandr' }], [canal('dv360', 'dsp')], avant);
    expect(r.channels.dsps).toEqual(['dv360']);
    expect(r.nonRelies).toEqual(['xandr']);
    const sansCanal = preselectionDepuisExtraction([{ plateforme: 'meta' }], [canal('dv360', 'dsp')], avant);
    expect(sansCanal).toMatchObject({ channels: { socials: [] }, nonRelies: ['meta'] });
  });

  it('un canal non disponible (ni connecté ni démo) n’est pas coché, et il est dit', () => {
    const r = preselectionDepuisExtraction([{ plateforme: 'ttd' }], CATALOGUE, avant);
    expect(r).toEqual({ channels: { dsps: [], socials: [], ad_server: 'cm360' }, nonRelies: [], indisponibles: ['ttd'] });
  });

  it('une extraction sans résumé (jeu risque) : la sélection est gardée telle quelle', () => {
    expect(preselectionDepuisExtraction(null, CATALOGUE, avant)).toEqual({ channels: avant, nonRelies: [], indisponibles: [] });
  });
});
