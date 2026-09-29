import { agregerChargement, estPerime } from './chargement';

describe('agregerChargement', () => {
  it('inactif sans piste active', () => {
    expect(agregerChargement([{ cle: 'a', libelle: 'Calcul', actif: false }]))
      .toEqual({ actif: false, libelles: [], texte: null });
  });
  it('un seul libellé : le texte est ce libellé', () => {
    expect(agregerChargement([{ cle: 'a', libelle: 'Calcul des classes', actif: true }]).texte)
      .toBe('Calcul des classes');
  });
  it('plusieurs : le premier, plus le nombre des autres', () => {
    const c = agregerChargement([
      { cle: 'a', libelle: 'Calcul', actif: true },
      { cle: 'b', libelle: 'Courbe', actif: true },
      { cle: 'c', libelle: 'Sites', actif: true },
    ]);
    expect(c.texte).toBe('Calcul (+2)');
  });
  it('dédoublonne deux pistes au même libellé', () => {
    const c = agregerChargement([
      { cle: 'a', libelle: 'Calcul', actif: true },
      { cle: 'b', libelle: 'Calcul', actif: true },
    ]);
    expect(c.libelles).toEqual(['Calcul']);
    expect(c.texte).toBe('Calcul');
  });
});

describe('estPerime', () => {
  it('seulement quand on recharge ET qu\'une valeur est déjà à l\'écran', () => {
    expect(estPerime(true, true)).toBe(true);
    expect(estPerime(true, false)).toBe(false);
    expect(estPerime(false, true)).toBe(false);
  });
});
