import { formaterDecimal, formaterNombre, formaterNombreAbrege } from './nombre';

// Les espaces de fr-FR sont insécables : on compare après normalisation.
const n = (s: string) => s.replace(/\s/g, ' ');

describe('format des nombres (parité lib/format/nombre.ts)', () => {
  it('formaterNombre : milliers français, absent en tiret', () => {
    expect(n(formaterNombre(13841288))).toBe('13 841 288');
    expect(formaterNombre(null)).toBe('—');
  });
  it('formaterNombreAbrege : paliers avec point décimal, comme React', () => {
    expect(formaterNombreAbrege(12300)).toBe('12.3k');
    expect(formaterNombreAbrege(13841288)).toBe('13.8M');
    expect(formaterNombreAbrege(1.2e9)).toBe('1.2G');
    expect(formaterNombreAbrege(950)).toBe('950');
    expect(formaterNombreAbrege(NaN)).toBe('—');
  });
  it('formaterDecimal : une décimale par défaut, virgule française', () => {
    expect(formaterDecimal(5)).toBe('5,0');
    expect(n(formaterDecimal(1234.56, 2))).toBe('1 234,56');
    expect(formaterDecimal(null)).toBe('—');
  });
});
