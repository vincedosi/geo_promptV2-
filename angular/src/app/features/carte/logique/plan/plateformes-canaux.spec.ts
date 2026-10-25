import { DEFAULT_PROG_DRAFT } from './brouillon';
import type { ResolvedChannel } from './canaux';
import { CANAL_DE_PLATEFORME, poserExtraction, preselectionDepuisExtraction, resumeDuCanal, utilePlateforme } from './plateformes-canaux';

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

describe('poserExtraction — l’extraction choisie en section Cible (T4, A-3, A-5)', () => {
  const jeu = { id: 'j1', nom: 'Rentrée', version: 3 };
  const x1 = { id: 'x1', version: 1, plateformes: [{ plateforme: 'dv360' }, { plateforme: 'meta' }] };
  const x2 = { id: 'x2', version: 2, plateformes: [{ plateforme: 'dv360' }, { plateforme: 'tiktok' }] };

  it('pose le jeu ET sa version d’extraction, et pré-coche les plateformes de son résumé', () => {
    const d = poserExtraction(DEFAULT_PROG_DRAFT, jeu, x1, CATALOGUE);
    expect(d.jeuZones).toEqual({ id: 'j1', nom: 'Rentrée', version: 3, extraction: { id: 'x1', version: 1 } });
    expect(d.channels).toEqual({ dsps: ['dv360'], socials: ['meta'], ad_server: null });
  });

  it('changer d’extraction RE-pré-coche, sans perdre les budgets ni les CPM saisis des plateformes restantes', () => {
    const saisi = { ...poserExtraction(DEFAULT_PROG_DRAFT, jeu, x1, CATALOGUE), channelBudgets: { dv360: 1200, meta: 800 }, cpmPrevus: { dv360: 4.5 } };
    const d = poserExtraction(saisi, jeu, x2, CATALOGUE);
    expect(d.channels).toEqual({ dsps: ['dv360'], socials: ['tiktok'], ad_server: null });
    expect(d.channelBudgets['dv360']).toBe(1200);
    expect(d.cpmPrevus).toEqual({ dv360: 4.5 });
    expect(d.jeuZones?.extraction).toEqual({ id: 'x2', version: 2 });
  });

  it('sans catalogue (canaux pas encore lus) : la sélection reste, seule l’extraction change', () => {
    const avant = { ...DEFAULT_PROG_DRAFT, channels: { dsps: ['ttd'], socials: [], ad_server: null } };
    expect(poserExtraction(avant, jeu, x1, null).channels).toEqual(avant.channels);
  });
});

describe('resumeDuCanal et utilePlateforme (revue finale, F-3, V-7)', () => {
  const ZONE = {
    n_retenus: 900, taux_utile: 81.2,
    plateformes: [{ plateforme: 'dv360', maille: 'cp' as const, n_unites: 640, taux_utile: 12.34 }, { plateforme: 'meta', maille: 'cercle' as const, n_unites: 12, exacte: true }],
  };
  it('jeu de zone : la ligne de la plateforme du canal ; absente → null', () => {
    expect(resumeDuCanal(ZONE, 'dv360')).toEqual({ maille: 'cp', nUnites: 640, utile: '12,3 %', auCp: true, filtreCp: 'dv360' });
    expect(resumeDuCanal(ZONE, 'meta')).toMatchObject({ maille: 'cercle', utile: 'exacte', auCp: false });
    expect(resumeDuCanal(ZONE, 'ttd')).toBeNull();
    expect(resumeDuCanal(null, 'dv360')).toBeNull();
  });
  it('jeu risque (sans résumé) : tout canal au CP, sur le plan entier', () => {
    expect(resumeDuCanal({ ...ZONE, plateformes: null }, 'ttd')).toEqual({ maille: 'cp', nUnites: 900, utile: '81,2 %', auCp: true, filtreCp: undefined });
  });
  it('utile : exacte, pourcentage, inconnu', () => {
    expect(utilePlateforme({ exacte: true, taux_utile: 3 })).toBe('exacte');
    expect(utilePlateforme({ taux_utile: null })).toBeNull();
  });
});
