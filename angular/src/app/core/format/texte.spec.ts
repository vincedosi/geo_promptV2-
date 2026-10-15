import { plierTexte } from './texte';

describe('plierTexte — recherche sans casse ni accents', () => {
  it('minuscules, sans accents ni espaces de bord (repris de comptes.spec « normaliser »)', () => {
    expect(plierTexte('  Hélène ÉLYSÉE  ')).toBe('helene elysee');
  });

  it('cédille, tréma, circonflexe ; les espaces intérieurs restent', () => {
    expect(plierTexte('Météo — Français Noël Côte')).toBe('meteo — francais noel cote');
  });

  it('vide et blanc → chaîne vide', () => {
    expect(plierTexte('')).toBe('');
    expect(plierTexte('   ')).toBe('');
  });
});
