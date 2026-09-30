import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from './config.service';

describe('ConfigService', () => {
  let service: ConfigService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ConfigService);
    http = TestBed.inject(HttpTestingController);
  });

  it('charge config.local.json', async () => {
    const promesse = service.charger();
    http.expectOne('/config.local.json').flush({
      supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: 'cle', apiBaseUrl: '',
    });
    await promesse;
    expect(service.valeur.supabaseUrl).toBe('http://127.0.0.1:54321');
  });

  it('nomme la commande à lancer quand le fichier est absent', async () => {
    const promesse = service.charger();
    http.expectOne('/config.local.json').flush('', { status: 404, statusText: 'Not Found' });
    await expect(promesse).rejects.toThrow(/npm run config/);
  });

  it('refuse une configuration incomplète', async () => {
    const promesse = service.charger();
    http.expectOne('/config.local.json').flush({ supabaseUrl: '', supabaseAnonKey: '' });
    await expect(promesse).rejects.toThrow(/incomplète/);
  });

  it('lève si on lit la valeur avant le chargement', () => {
    expect(() => service.valeur).toThrow(/pas encore chargée/);
  });
});
