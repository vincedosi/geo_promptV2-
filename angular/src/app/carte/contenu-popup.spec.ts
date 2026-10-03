import { contenuPopup } from './contenu-popup';

describe('contenuPopup', () => {
  it('affiche le titre puis une seule ligne de détails jointe par « · »', () => {
    const el = contenuPopup('Site A', ['Seveso seuil haut', 'Martigues', 'Toxiques']);
    expect(el.children).toHaveLength(2);
    expect(el.children[0].textContent).toBe('Site A');
    expect(el.children[1].textContent).toBe('Seveso seuil haut · Martigues · Toxiques');
  });
  it('écarte les détails vides, comme le filtre de React', () => {
    const el = contenuPopup('Site A', ['Seveso seuil bas', null, '', 'Inflammables']);
    expect(el.children[1].textContent).toBe('Seveso seuil bas · Inflammables');
  });
  it('n\'emploie jamais la police mono : le texte n\'est pas une donnée numérique', () => {
    const el = contenuPopup('Site A', ['Martigues']);
    expect(el.querySelector('.font-mono')).toBeNull();
  });
  it('n\'interprète jamais une valeur comme du HTML', () => {
    const el = contenuPopup('<img src=x onerror=alert(1)>', ['<b>gras</b>']);
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain('<b>gras</b>');
  });
});
