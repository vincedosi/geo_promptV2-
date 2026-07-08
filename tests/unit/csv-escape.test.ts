import { describe, it, expect } from 'vitest';
import { csvEscapeCell } from '@/lib/csv/escape';

describe('csvEscapeCell', () => {
  it('laisse une valeur normale inchangée', () => {
    expect(csvEscapeCell('Boulangerie du centre')).toBe('Boulangerie du centre');
  });

  it("neutralise un préfixe de formule '='", () => {
    expect(csvEscapeCell('=HYPERLINK("http://evil.test","clique")')).toBe(
      '"\'=HYPERLINK(""http://evil.test"",""clique"")"',
    );
  });

  it.each(['+1+1', '-1+1', '@SUM(A1:A2)', '\tcmd', '\rcmd'])(
    'neutralise le préfixe de formule %j',
    (val) => {
      const out = csvEscapeCell(val);
      // La cellule échappée (avec ou sans guillemets) doit porter l'apostrophe
      // protectrice juste après une éventuelle ouverture de guillemet.
      expect(out.replace(/^"/, '')).toMatch(/^'/);
    },
  );

  it('échappe les guillemets internes en les doublant', () => {
    expect(csvEscapeCell('Le "meilleur" spot')).toBe('"Le ""meilleur"" spot"');
  });

  it('encadre de guillemets si le séparateur est présent', () => {
    expect(csvEscapeCell('Paris;Lyon', ';')).toBe('"Paris;Lyon"');
    expect(csvEscapeCell('Paris,Lyon', ',')).toBe('"Paris,Lyon"');
  });

  it('encadre de guillemets sur retour à la ligne', () => {
    expect(csvEscapeCell('ligne1\nligne2')).toBe('"ligne1\nligne2"');
  });

  it('ne casse pas une valeur légitime commençant par un tiret négatif dans un nombre formaté', () => {
    // Les nombres sont toujours passés en string par l'appelant : on vérifie
    // juste que l'échappement reste réversible (apostrophe ajoutée, valeur visible).
    expect(csvEscapeCell('-42')).toBe("'-42");
  });
});
