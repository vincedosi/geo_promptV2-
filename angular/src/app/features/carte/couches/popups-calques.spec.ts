import type { POI } from '../data/carte.api';
import { VARIABLES_CIVIQUES } from '../logique/palettes-donnees-carte';
import { contenuPopupCivique } from './couche-civique';
import { contenuPopupCercle, contenuPopupMarqueur } from './couche-pois';
import { contenuPopupRadio } from './couche-radio';

/**
 * Les popups DOM des POI, de la radio et des indicateurs civiques, après la factorisation de leur fabrique d'éléments
 * dans `elementTexte` (revue 1 de T12) : mêmes balises, mêmes styles, mêmes textes qu'avant ; jamais d'HTML interprété.
 */
describe('popups des calques (fabrique commune elementTexte)', () => {
  it('marqueur POI : rang, nom en <strong>, catégorie dans la couleur de l’épingle, sous-catégorie, adresse en <span>', () => {
    const p = { id: '1', nom: '<i>Lycée</i>', lat: 0, lng: 0, categorie: 'lycee', sous_categorie: 'public', adresse: '1 rue', rank: 3 } as POI;
    const el = contenuPopupMarqueur(p, '#123456', document);
    expect(el.querySelector('i')).toBeNull();
    const nom = el.querySelector('strong') as HTMLElement;
    expect(nom.textContent).toBe('<i>Lycée</i>');
    expect(nom.style.fontSize).toBe('13px');
    const spans = [...el.querySelectorAll('span')] as HTMLElement[];
    expect(spans.map((s) => s.textContent)).toEqual(['#3', 'lycee', '· public', '1 rue']);
    expect(spans[0].style.color).toBe('var(--warning)');
    expect(spans[1].style.color).toBe('rgb(18, 52, 86)');
    expect(spans[1].style.textTransform).toBe('uppercase');
  });

  it('cercle POI : nom en <strong>, catégorie en <span> (repli « POI »)', () => {
    const el = contenuPopupCercle({ categorie: 'panneaux', sous_categorie: 'abribus', adresse: 'Quai' }, document);
    expect(el.querySelector('strong')!.textContent).toBe('POI');
    expect([...el.querySelectorAll('span')].map((s) => s.textContent)).toEqual(['panneaux', '· abribus', '📍 Quai']);
  });

  it('émetteur radio : blocs <div>, « Radio non associée » estompée sans radio', () => {
    const el = contenuPopupRadio({ systeme: 'FM', commune: 'MONT JULY', departement: '01', rayon_couverture_m: 21000 }, document);
    const divs = [...el.querySelectorAll('div')] as HTMLElement[];
    expect(divs[0].textContent).toBe('Radio non associée');
    expect(divs[0].style.color).toBe('var(--text-tertiary)');
    expect(el.textContent).toContain('Couverture : ~21 km');
    expect(el.textContent).toContain('MONT JULY · Dept 01');
  });

  it('code postal civique : code et département en <span> mono, commune « + n autres », valeur et inscrits', () => {
    const el = contenuPopupCivique(
      { cp: '13001', dept: '13', valeur: 35.35, inscrits: 12000, commune: 'Marseille', nbCommunes: 3 },
      VARIABLES_CIVIQUES.abstention_pres_2022, document,
    );
    const tete = [...el.firstElementChild!.children] as HTMLElement[];
    expect(tete.map((s) => [s.tagName, s.textContent])).toEqual([['SPAN', '13001'], ['SPAN', 'DÉPT 13']]);
    expect(el.querySelector('[data-commune]')!.textContent).toBe('Marseille + 2 autres');
    expect(el.querySelector('[data-valeur]')!.textContent).toBe('35.4%');
    expect(el.textContent).toContain('12 000');
  });
});
