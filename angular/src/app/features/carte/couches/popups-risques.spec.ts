import type { CollectionSitesRisque } from '../../risques/data/sites-risque.api';
import type { TeintesRisques } from './couche-risques';
import { contenuPopupPprt, contenuPopupSite, donneesRiches, lignePopup, remplirExposition } from './popups-risques';

const TEINTES: TeintesRisques = {
  toxique: '#e66767', inflammable: '#b88a00', pollution: '#008300', autres: '#3987e5', non_precise: '#9aa0a6',
  contour: 'rgba(255,255,255,0.9)',
};

describe('popups des risques industriels', () => {
  it('lignePopup : null si la valeur est absente ou blanche — jamais « Adresse : — »', () => {
    expect(lignePopup(document, 'Adresse', null)).toBeNull();
    expect(lignePopup(document, 'Adresse', '   ')).toBeNull();
    const l = lignePopup(document, 'Adresse', ' 1 rue ')!;
    expect(l.textContent).toBe('Adresse1 rue');
    expect((l.firstElementChild as HTMLElement).style.flex).toBe('0 0 96px');
  });

  it('site sans périmètre (seuil haut) : statut DIT, trait tireté ; rubriques coupées à 6 ; HTML jamais interprété', () => {
    const rubriques = Array.from({ length: 8 }, (_, i) => ({ numero: `41${i}`, nature: 'Toxicité', quantite: i ? '2' : '', unite: 't' }));
    const { racine, exposition } = contenuPopupSite(
      { nom: '<b>Usine</b>', type_risque: 'inconnu', gravite: 'seveso_haut', statut_zone: 'sans_pprt', lat: 43.4, lng: 5 },
      { natures: ['Toxicité aiguë'], rubriques }, TEINTES, document,
    );
    expect(racine.querySelector('b')).toBeNull();
    expect(racine.textContent).toContain('<b>Usine</b>');
    expect(racine.textContent).toContain('Risque non précisé');
    expect(racine.textContent).toContain('Aucun périmètre PPRT publié');
    expect(racine.textContent).not.toContain('Autres risques');
    expect(racine.textContent).not.toContain('Adresse');
    const trait = racine.querySelector('[data-statut-zone] span') as HTMLElement;
    expect(trait.style.borderTop).toContain('dashed');
    expect(racine.querySelectorAll('li')).toHaveLength(6);
    expect(racine.textContent).toContain('+ 2 autres');
    expect(exposition.textContent).toBe('Population exposée — calcul…');
  });

  it('exposition au périmètre PPRT : « publié par l’État », sans couronne ; erreur et vide dits', () => {
    const bloc = document.createElement('div');
    remplirExposition(bloc, {
      mode: 'pprt', indicatif: false, paliers: [{ palier: 'pprt', libelle: 'Périmètre PPRT', pop_exposee: 8918, pop_couronne: 8918 }],
    }, null);
    expect(bloc.textContent).toContain('8 918');
    expect(bloc.textContent).not.toContain('(+');
    expect(bloc.textContent).toContain('Estimée sur le périmètre PPRT publié par l’État.');
    remplirExposition(bloc, null, 'Calcul indisponible.');
    expect(bloc.textContent).toBe('Calcul indisponible.');
    remplirExposition(bloc, { paliers: [] }, null);
    expect(bloc.textContent).toBe('Population exposée non calculable.');
  });

  it('donneesRiches : natures et rubriques rangées par identifiant', () => {
    const c: CollectionSitesRisque = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [5, 43] }, properties: { id: 7, natures_risque: ['A'] } }],
    };
    expect(donneesRiches(c).get('7')).toEqual({ natures: ['A'], rubriques: [] });
  });

  it('popup PPRT : superficie absente omise, phrase opposable toujours présente', () => {
    const el = contenuPopupPprt({ nom: '', type_zone: 'indetermine', date_source: '2024-03-01T00:00:00Z' }, document);
    expect(el.textContent).toContain('Sans nom');
    expect(el.textContent).toContain('Type non précisé à la source');
    expect(el.textContent).toContain('2024-03-01');
    expect(el.textContent).not.toContain('Superficie');
    expect(el.textContent).toContain('Périmètre réglementaire opposable');
  });
});
