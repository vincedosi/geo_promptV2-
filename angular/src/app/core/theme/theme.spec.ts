import { CLE_THEME, themeInitial, themeSuivant } from './theme';

const stockage = (valeur: string | null) => ({ getItem: (k: string) => (k === CLE_THEME ? valeur : null) });

describe('themeInitial', () => {
  it('sombre par défaut', () => {
    expect(themeInitial(null)).toBe('dark');
    expect(themeInitial(stockage(null))).toBe('dark');
  });
  it('reprend le choix enregistré', () => {
    expect(themeInitial(stockage('light'))).toBe('light');
  });
  it('ignore une valeur inconnue', () => {
    expect(themeInitial(stockage('violet'))).toBe('dark');
  });
  it('ne plante pas si le stockage lève (navigation privée)', () => {
    expect(themeInitial({ getItem: () => { throw new Error('bloqué'); } })).toBe('dark');
  });
});

describe('themeSuivant', () => {
  it('alterne', () => {
    expect(themeSuivant('dark')).toBe('light');
    expect(themeSuivant('light')).toBe('dark');
  });
});
