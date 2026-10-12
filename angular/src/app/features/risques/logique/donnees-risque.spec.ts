import { HttpErrorResponse } from '@angular/common/http';
import type { ReponseRefGeo } from '../data/referentiel.api';
import {
  type RefGeo, aplatirRef, bandesEnEchec, cheminBienForme, corpsErreur, courbeEnEchec, filtresSites, lireElementChemin,
  parametresCourbe, resoudreChemin,
} from './donnees-risque';

const REF: RefGeo = {
  regions: [{ code: '93', nom: 'Provence-Alpes-Côte d’Azur' }],
  departements: [{ code: '13', nom: 'Bouches-du-Rhône' }, { code: '93', nom: 'Seine-Saint-Denis' }],
  deptsParRegion: { '93': ['13'] },
};

describe('chemin', () => {
  it('lireElementChemin : préfixe obligatoire, code non vide', () => {
    expect(lireElementChemin('region:93')).toEqual({ niveau: 'region', code: '93' });
    expect(lireElementChemin('departement:13')).toEqual({ niveau: 'departement', code: '13' });
    expect(lireElementChemin('13')).toBeNull();
    expect(lireElementChemin('commune:13055')).toBeNull();
    expect(lireElementChemin('region:')).toBeNull();
  });

  it('resoudreChemin : le préfixe départage les 18 codes communs (93 région ≠ 93 département)', () => {
    expect(resoudreChemin('region:93|departement:93', 'pret', REF)).toEqual([
      { niveau: 'region', code: '93', nom: 'Provence-Alpes-Côte d’Azur' },
      { niveau: 'departement', code: '93', nom: 'Seine-Saint-Denis' },
    ]);
  });

  it('resoudreChemin : un inconnu est ignoré, sauf référentiel en échec où il garde son code', () => {
    expect(resoudreChemin('region:99|13', 'pret', REF)).toEqual([]);
    expect(resoudreChemin('region:99', 'echec', REF)).toEqual([{ niveau: 'region', code: '99', nom: '99' }]);
    expect(resoudreChemin('', 'echec', REF)).toEqual([]);
  });

  it('cheminBienForme : attendre le référentiel n’a de sens que pour un élément bien formé', () => {
    expect(cheminBienForme('')).toBe(false);
    expect(cheminBienForme('13|commune:13055')).toBe(false);
    expect(cheminBienForme('13|departement:13')).toBe(true);
  });
});

describe('erreurs HTTP', () => {
  const http = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

  it('corpsErreur : le corps JSON, jamais pour un échec réseau ni un corps illisible', () => {
    expect(corpsErreur(http(409, { a_construire: true }))).toEqual({ a_construire: true });
    expect(corpsErreur(http(0, { x: 1 }))).toBeNull();
    expect(corpsErreur(http(500, 'texte'))).toBeNull();
    expect(corpsErreur(new Error('x'))).toBeNull();
  });

  it('bandesEnEchec : « n’a pas répondu » sans corps, message serveur et 409 sinon', () => {
    expect(bandesEnEchec(http(0, null))).toEqual({ etat: 'echec', bandes: null, aConstruire: false, erreur: 'Le calcul des bandes n’a pas répondu.' });
    expect(bandesEnEchec(http(409, { error: 'Pré-calcul absent', a_construire: true })))
      .toEqual({ etat: 'echec', bandes: null, aConstruire: true, erreur: 'Pré-calcul absent' });
    expect(bandesEnEchec(http(500, {})).erreur).toBe('Calcul des bandes indisponible.');
  });

  it('courbeEnEchec : message serveur, sinon « Courbe indisponible. »', () => {
    expect(courbeEnEchec(http(409, { error: 'X', a_construire: true }))).toEqual({ data: null, chargement: false, aConstruire: true, erreur: 'X' });
    expect(courbeEnEchec(http(0, null)).erreur).toBe('Courbe indisponible.');
  });
});

describe('clés de chargement', () => {
  it('parametresCourbe : listes et périmètre décodés', () => {
    expect(parametresCourbe(JSON.stringify(['pop', 'haut,bas', 'Toxique', 'region:93']))).toEqual({
      gravites: 'haut,bas', filtres: { cible: 'pop', natures: ['Toxique'], perimNiveau: 'region', perimCode: '93' },
    });
    expect(parametresCourbe(JSON.stringify(['pop', '', '', ''])).filtres).toEqual({ cible: 'pop', natures: [], perimNiveau: null, perimCode: null });
  });

  it('filtresSites : gravités et natures en listes, France entière sans périmètre', () => {
    expect(filtresSites(JSON.stringify(['haut', 'A,B', 'departement:13']))).toEqual({
      gravites: ['haut'], natures: ['A', 'B'], perimNiveau: 'departement', perimCode: '13',
    });
    expect(filtresSites(JSON.stringify(['', '', '']))).toEqual({ gravites: [], natures: [], perimNiveau: null, perimCode: null });
  });
});

describe('aplatirRef', () => {
  it('aplatit les départements sans perdre leur région', () => {
    const r = { regions: [{ code_region: '93', nom_region: 'PACA', depts: [{ code_dept: '13', nom_dept: 'BdR' }] }] } as unknown as ReponseRefGeo;
    expect(aplatirRef(r)).toEqual({
      regions: [{ code: '93', nom: 'PACA' }], departements: [{ code: '13', nom: 'BdR' }], deptsParRegion: { '93': ['13'] },
    });
  });
});
