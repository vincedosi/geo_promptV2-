import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BASE_RESSOURCES } from '../ressources/ressource-distante';
import { ConfigService } from './config.service';

/** Base d'une application distante servie AILLEURS que le document hôte. */
const BASE = 'https://distante.exemple/remotes/magelian/chunk-ABC.js';
const URL_CONFIG = 'https://distante.exemple/remotes/magelian/config.local.json';

describe('ConfigService', () => {
  let service: ConfigService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: BASE_RESSOURCES, useValue: BASE }],
    });
    service = TestBed.inject(ConfigService);
    http = TestBed.inject(HttpTestingController);
  });

  it('charge config.local.json depuis l\'application distante, pas depuis le document', async () => {
    const promesse = service.charger();
    http.expectNone('/config.local.json');
    http.expectOne(URL_CONFIG).flush({
      supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: 'cle', apiBaseUrl: '',
    });
    await promesse;
    expect(service.valeur.supabaseUrl).toBe('http://127.0.0.1:54321');
  });

  it('googleMapsKey est FACULTATIVE : absente ou vide, le champ n’existe pas ; présente, il est repris (lot 4, T8)', async () => {
    let promesse = service.charger();
    http.expectOne(URL_CONFIG).flush({ supabaseUrl: 'u', supabaseAnonKey: 'k', apiBaseUrl: '', googleMapsKey: '' });
    await promesse;
    expect('googleMapsKey' in service.valeur).toBe(false);
    promesse = service.charger();
    http.expectOne(URL_CONFIG).flush({ supabaseUrl: 'u', supabaseAnonKey: 'k', apiBaseUrl: '', googleMapsKey: 'cle-g' });
    await promesse;
    expect(service.valeur.googleMapsKey).toBe('cle-g');
  });

  it('nomme la commande à lancer quand le fichier est absent', async () => {
    const promesse = service.charger();
    http.expectOne(URL_CONFIG).flush('', { status: 404, statusText: 'Not Found' });
    await expect(promesse).rejects.toThrow(/npm run config/);
  });

  it('refuse une configuration incomplète', async () => {
    const promesse = service.charger();
    http.expectOne(URL_CONFIG).flush({ supabaseUrl: '', supabaseAnonKey: '' });
    await expect(promesse).rejects.toThrow(/incomplète/);
  });

  it('lève si on lit la valeur avant le chargement', () => {
    expect(() => service.valeur).toThrow(/pas encore chargée/);
  });
});
