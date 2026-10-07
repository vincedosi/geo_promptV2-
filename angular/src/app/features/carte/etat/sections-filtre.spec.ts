import { CLE_SECTIONS, SECTION_KEYS, basculerSection, sectionsInitiales } from './sections-filtre';

function stockage(initial: Record<string, string> = {}) {
  const donnees = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((k: string) => donnees.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => { donnees.set(k, v); }),
  };
}

describe('sections-filtre (use-filter-sections.ts)', () => {
  it('mode overlay (panneau Calques) : sections territoriales seules, et le stockage n’est JAMAIS lu', () => {
    const s = stockage({ [CLE_SECTIONS]: JSON.stringify({ poi: true }) });
    const etat = sectionsInitiales(true, () => s);
    expect(etat).toEqual(Object.fromEntries(SECTION_KEYS.map((k) => [k, ['perimetre', 'regions', 'departements'].includes(k)])));
    expect(s.getItem).not.toHaveBeenCalled();
    basculerSection(etat, 'poi', true, () => s);
    expect(s.setItem).not.toHaveBeenCalled();
  });

  it('hors overlay : état relu, complété des sections absentes (civicHealth fermée par défaut)', () => {
    const s = stockage({ [CLE_SECTIONS]: JSON.stringify({ poi: false }) });
    const etat = sectionsInitiales(false, () => s);
    expect(etat['poi']).toBe(false);
    expect(etat['radio']).toBe(true);
    expect(etat['civicHealth']).toBe(false);
    const suivant = basculerSection(etat, 'poi', false, () => s);
    expect(suivant['poi']).toBe(true);
    expect(JSON.parse(s.setItem.mock.calls[0][1])['poi']).toBe(true);
  });

  it('stockage qui lève (ou JSON illisible) : état par défaut, sans lever', () => {
    const leve = () => { throw new Error('SecurityError'); };
    const defaut = Object.fromEntries(SECTION_KEYS.map((k) => [k, k !== 'civicHealth']));
    expect(sectionsInitiales(false, leve)).toEqual(defaut);
    expect(sectionsInitiales(false, () => stockage({ [CLE_SECTIONS]: '{pas du json' }))).toEqual(defaut);
    expect(() => basculerSection(defaut, 'poi', false, leve)).not.toThrow();
  });
});
