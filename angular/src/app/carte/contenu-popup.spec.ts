import { contenuPopup, elementTexte } from './contenu-popup';

describe('elementTexte', () => {
  it('pose la balise, le style en ligne et le texte', () => {
    const el = elementTexte(document, 'strong', { color: 'var(--text-primary)', fontSize: '13px' }, 'Site A');
    expect(el.tagName).toBe('STRONG');
    expect(el.style.color).toBe('var(--text-primary)');
    expect(el.style.fontSize).toBe('13px');
    expect(el.textContent).toBe('Site A');
  });
  it('sans texte : un conteneur vide, auquel on ajoute des enfants', () => {
    const el = elementTexte(document, 'div', { display: 'flex' });
    expect(el.childNodes).toHaveLength(0);
    expect(el.style.display).toBe('flex');
  });
  it('n\'interprète jamais le texte comme du HTML', () => {
    const el = elementTexte(document, 'span', {}, '<img src=x onerror=alert(1)>');
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe('<img src=x onerror=alert(1)>');
  });
  it('construit dans le document fourni (celui de la carte)', () => {
    const autre = document.implementation.createHTMLDocument('autre');
    expect(elementTexte(autre, 'div', {}, 'x').ownerDocument).toBe(autre);
  });
});

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
