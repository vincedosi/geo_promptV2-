import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../../core/config/config.service';
import { DspApi } from './dsp.api';

function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), DspApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  return { api: TestBed.inject(DspApi), http: TestBed.inject(HttpTestingController) };
}

describe('DspApi — routes app/api/admin/dsp/** (lot 6, T9)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('lectures : connexions, diagnostic DV360, journal filtré par fournisseur (paramètres EXACTS de React)', () => {
    const { api, http } = monter();
    api.connexions().subscribe();
    api.configDv360().subscribe();
    api.journal({ provider: 'dv360', limit: 20 }).subscribe();
    expect(http.expectOne('/api/admin/dsp/connections').request.method).toBe('GET');
    expect(http.expectOne('/api/admin/dsp/dv360/config').request.method).toBe('GET');
    const journal = http.expectOne((r) => r.url === '/api/admin/dsp/logs');
    // Même chaîne que `dv360/page.tsx:64` : `?provider=dv360&limit=20`.
    expect(journal.request.urlWithParams).toBe('/api/admin/dsp/logs?provider=dv360&limit=20');
    for (const r of [journal]) r.flush({ logs: [] });
    http.match(() => true).forEach((r) => r.flush({}));
  });

  it('écritures : connect (POST), déconnexion simple, purge `?scope=full`, config OAuth, démarrage OAuth, test', () => {
    const { api, http } = monter();
    api.connecter('dv360', { auth_method: 'service_account', partner_id: '1', service_account_json: '{}' }).subscribe();
    api.deconnecter('dv360').subscribe();
    api.deconnecter('dv360', true).subscribe();
    api.configurerOAuthDv360({ partner_id: '1', oauth_client_id: 'c', oauth_client_secret: 's' }).subscribe();
    api.demarrerOAuth('dv360', { partner_id: '1' }).subscribe();
    api.tester('tiktok').subscribe();

    const connect = http.match((r) => r.url === '/api/admin/dsp/dv360/connect');
    expect(connect.map((r) => [r.request.method, r.request.urlWithParams])).toEqual([
      ['POST', '/api/admin/dsp/dv360/connect'],
      ['DELETE', '/api/admin/dsp/dv360/connect'],
      ['DELETE', '/api/admin/dsp/dv360/connect?scope=full'],
    ]);
    expect(connect[0].request.body).toEqual({ auth_method: 'service_account', partner_id: '1', service_account_json: '{}' });
    const oauth = http.expectOne('/api/admin/dsp/dv360/oauth/config');
    expect(oauth.request.body).toEqual({ partner_id: '1', oauth_client_id: 'c', oauth_client_secret: 's' });
    const start = http.expectOne('/api/admin/dsp/dv360/oauth/start');
    expect([start.request.method, start.request.body]).toEqual(['POST', { partner_id: '1' }]);
    const test = http.expectOne('/api/admin/dsp/tiktok/test');
    expect([test.request.method, test.request.body]).toEqual(['POST', null]);
    [...connect, oauth, start, test].forEach((r) => r.flush({ ok: true }));
  });
});
