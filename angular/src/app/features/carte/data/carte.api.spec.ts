import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { CarteApi, type CorpsPois } from './carte.api';

function preparer() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), CarteApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(CarteApi), http: TestBed.inject(HttpTestingController) };
}

describe('CarteApi', () => {
  it('fiche d un jeu : GET /api/map/catalogue/fiche, la clé en paramètre encodé', () => {
    const { api, http } = preparer();
    let fiche: unknown;
    api.ficheJeu('poi:lycee').subscribe((r) => (fiche = r));
    const req = http.expectOne((r) => r.url === '/api/map/catalogue/fiche');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('cle')).toBe('poi:lycee');
    req.flush({ cle: 'poi:lycee', referentiel: false, sources: [] });
    expect(fiche).toEqual({ cle: 'poi:lycee', referentiel: false, sources: [] });
    http.verify();
  });

  it('campagnes OOH : GET /api/map/ooh/campagnes, puis une campagne par son identifiant encodé', () => {
    const { api, http } = preparer();
    let liste: unknown;
    api.campagnesOoh().subscribe((r) => (liste = r));
    http.expectOne((r) => r.method === 'GET' && r.url === '/api/map/ooh/campagnes').flush({ campagnes: [], tronque: false });
    expect(liste).toEqual({ campagnes: [], tronque: false });
    api.campagneOoh('a/b').subscribe();
    http.expectOne('/api/map/ooh/campagnes/a%2Fb').flush(null);
    http.verify();
  });

  it('export HTML d une campagne OOH : GET …/export-html en blob, réponse complète (Content-Disposition)', () => {
    const { api, http } = preparer();
    let reponse: { body: Blob | null; headers: { get(n: string): string | null } } | undefined;
    api.exporterCampagneOohHtml('a/b').subscribe((r) => (reponse = r));
    const req = http.expectOne('/api/map/ooh/campagnes/a%2Fb/export-html');
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['<!doctype html>'], { type: 'text/html' }), { headers: { 'Content-Disposition': 'attachment; filename="essai.html"' } });
    expect(reponse!.body).toBeInstanceOf(Blob);
    expect(reponse!.headers.get('content-disposition')).toBe('attachment; filename="essai.html"');
    http.verify();
  });

  it('pprt : bbox seule par défaut (comme React) ; types joints et limite seulement si fournis', () => {
    const { api, http } = preparer();
    api.pprt('4.9000,43.3000,5.3000,43.6000', []).subscribe();
    http.expectOne('/api/map/pprt?bbox=4.9000,43.3000,5.3000,43.6000').flush({ type: 'FeatureCollection', features: [] });
    api.pprt('1,2,3,4', ['enveloppe', 'indetermine'], 300).subscribe();
    http.expectOne('/api/map/pprt?bbox=1,2,3,4&types=enveloppe,indetermine&limite=300').flush({ type: 'FeatureCollection', features: [] });
    http.verify();
  });

  it('pois : POST /api/map/pois (le seul verbe de la route), le corps tel quel', () => {
    const { api, http } = preparer();
    const corps: CorpsPois = {
      poi_types: ['lycee'], scope: 'metro', regions: [], depts: [], ville: '', rayon_poi: null, poi_natures: {}, bbox: [-5.5, 41.2, 9.8, 51.2],
    };
    api.pois(corps).subscribe();
    const req = http.expectOne('/api/map/pois');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(corps);
    req.flush({});
    http.verify();
  });

  it('categories : GET /api/map/categories ; rafraîchir → ?refresh=1', () => {
    const { api, http } = preparer();
    api.categories().subscribe();
    expect(http.expectOne('/api/map/categories').request.method).toBe('GET');
    api.categories(true).subscribe();
    http.expectOne('/api/map/categories?refresh=1');
    http.verify();
  });

  it('categories : l’origine de chaque catégorie (droits sur la carte, T2) arrive telle quelle', () => {
    const { api, http } = preparer();
    let recu: unknown;
    api.categories().subscribe((r) => (recu = r));
    const corps = { categories: [{ id: 'bmw', label: 'BMW', origine: 'espace' }, { id: 'lycee', label: 'Lycées', origine: 'commune' }] };
    http.expectOne('/api/map/categories').flush(corps);
    expect(recu).toEqual(corps);
    http.verify();
  });

  it('transport : bbox de la carte à 4 décimales ; types joints par une virgule, absents sans type', () => {
    const { api, http } = preparer();
    api.transport([5.123456, 43.2, 5.5, 43.40001], ['bus', 'tram']).subscribe();
    const req = http.expectOne('/api/map/transport?west=5.1235&south=43.2000&east=5.5000&north=43.4000&types=bus,tram');
    expect(req.request.method).toBe('GET');
    api.transport([5, 43, 6, 44], []).subscribe();
    http.expectOne('/api/map/transport?west=5.0000&south=43.0000&east=6.0000&north=44.0000');
    http.verify();
  });

  it('poiNatures : GET ?categorie= encodé ; territoryMask : POST { scale, codes }', () => {
    const { api, http } = preparer();
    api.poiNatures('lycée pro').subscribe();
    const n = http.expectOne((r) => r.url === '/api/map/poi-natures');
    expect(n.request.params.get('categorie')).toBe('lycée pro');
    api.territoryMask('departement', ['13']).subscribe();
    const m = http.expectOne('/api/map/territory-mask');
    expect(m.request.body).toEqual({ scale: 'departement', codes: ['13'] });
    http.verify();
  });
});
