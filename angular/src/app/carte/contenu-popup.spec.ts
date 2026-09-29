import { contenuPopup } from './contenu-popup';

describe('contenuPopup', () => {
  it('affiche un titre et des lignes libellé / valeur', () => {
    const el = contenuPopup('Site A', [{ libelle: 'Commune', valeur: 'Martigues' }]);
    expect(el.textContent).toContain('Site A');
    expect(el.textContent).toContain('Commune');
    expect(el.textContent).toContain('Martigues');
  });
  it('n\'interprète jamais une valeur comme du HTML', () => {
    const el = contenuPopup('<img src=x onerror=alert(1)>', [{ libelle: 'x', valeur: '<b>gras</b>' }]);
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain('<b>gras</b>');
  });
});
