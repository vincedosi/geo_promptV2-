import { estNationaleMoins, phraseSansObjet } from './sans-objet';
import type { PlateformeGeo } from './plateformes';
import type { Recette, ZoneConnue } from '../zones/recette';

const ligne = (p: Partial<PlateformeGeo> & Pick<PlateformeGeo, 'plateforme' | 'maille'>): PlateformeGeo => ({
  libelle: p.maille, natif: true, disponible: true, limites: {}, doc_url: null, releve_le: '2026-10-14', a_verifier: false,
  note: null, ordre: 0, ...p,
});
const METRO: Recette = { v: 1, type: 'pays', code: 'METRO' };
const MOINS: Recette = { v: 1, type: 'combinaison', operation: 'difference', zones: ['a', 'b'] };
const TIKTOK = [
  ligne({ plateforme: 'tiktok', maille: 'departement', ordre: 1 }), ligne({ plateforme: 'tiktok', maille: 'commune', ordre: 2 }),
  ligne({ plateforme: 'tiktok', maille: 'cercle', disponible: false, ordre: 3 }), ligne({ plateforme: 'tiktok', maille: 'cp', disponible: false, ordre: 4 }),
  ligne({ plateforme: 'tiktok', maille: 'pays', ordre: 5 }),
];
const META = [ligne({ plateforme: 'meta', maille: 'cercle' }), ligne({ plateforme: 'meta', maille: 'cp' }), ligne({ plateforme: 'meta', maille: 'pays' })];

describe('phraseSansObjet — le conseil d’une maille sans objet nomme les mailles qui restent (revue T6, I-1, I-2)', () => {
  it('TikTok sur la France métropolitaine : communes trop fines → le département ou le pays, jamais le code postal', () => {
    expect(phraseSansObjet('commune', TIKTOK, METRO, false))
      .toBe('Sur une zone nationale, le découpage par commune (34 918) est trop fin : choisissez le département ou le pays.');
  });
  it('Meta sur la France métropolitaine : cercles → le code postal ou le pays', () => {
    expect(phraseSansObjet('cercle', META, METRO, false)).toBe('Sur une zone nationale, le ciblage par cercles n’a pas de sens : choisissez le code postal ou le pays.');
  });
  it('nationale moins des zones locales : le pays n’est pas proposé, il est sans objet', () => {
    expect(phraseSansObjet('cercle', META, MOINS, true)).toBe('Sur une zone nationale, le ciblage par cercles n’a pas de sens : choisissez le code postal.');
    expect(phraseSansObjet('commune', TIKTOK, MOINS, true))
      .toBe('Sur une zone nationale, le découpage par commune (34 918) est trop fin : choisissez le département.');
  });
  it('aucune maille restante : dit tel quel ; une maille qui a un sens : null', () => {
    expect(phraseSansObjet('cercle', [META[0]], METRO, false)).toBe('Sur une zone nationale, le ciblage par cercles n’a pas de sens : aucune autre maille de cette plateforme ne convient.');
    expect(phraseSansObjet('cp', META, METRO, false)).toBeNull();
    expect(phraseSansObjet('cercle', META, MOINS, false)).toBeNull();
  });
});

describe('estNationaleMoins — C21 : une différence dont la première zone est une zone pays', () => {
  const sources = (r: Recette | null) => new Map<string, ZoneConnue>([['a', { name: 'France', recette: r }]]);
  it('vrai pour « France moins Lyon », faux sinon', () => {
    expect(estNationaleMoins(MOINS, sources(METRO))).toBe(true);
    expect(estNationaleMoins(MOINS, sources({ v: 1, type: 'dessin' }))).toBe(false);
    expect(estNationaleMoins(MOINS, new Map())).toBe(false);
    expect(estNationaleMoins({ ...MOINS, operation: 'union' } as Recette, sources(METRO))).toBe(false);
    expect(estNationaleMoins(METRO, sources(METRO))).toBe(false);
  });
});
