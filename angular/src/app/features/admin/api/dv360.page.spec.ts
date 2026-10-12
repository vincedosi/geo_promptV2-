import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { BASE_RESSOURCES } from '../../../core/ressources/ressource-distante';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import type { DspConnectionPublic } from '../logique/types/dsp';
import { DspApi, type ConfigDv360 } from './data/dsp.api';
import { Dv360Page } from './dv360.page';
import { NAVIGUER_HORS_APPLICATION } from './naviguer-hors-application';

const CONFIG: ConfigDv360 = {
  env: { enc_key: true, oauth_client_id: false, oauth_client_secret: false, oauth_redirect_uri: true, redirect_uri_value: 'http://localhost:3000/api/admin/dsp/dv360/oauth/callback' },
  ready: { service_account: true, oauth: false },
};

/** La connexion de la base locale (1 ligne, relevé du 2026-10-12) : OAuth, client saisi, sans refresh token. */
const CONNEXION: DspConnectionPublic = {
  provider: 'dv360', auth_method: 'oauth', status: 'error', partner_id: '123456', oauth_client_id: 'client.apps.googleusercontent.com',
  has_credentials: false, advertiser_ids: [], token_expires_at: null, last_error: 'invalid_grant', updated_at: null,
};

const LOG = {
  id: 'l1', provider: 'dv360', category: 'api_call', level: 'error', action: 'list_advertisers',
  status_code: 403, duration_ms: 812, message: 'Permission denied', created_at: '2026-10-12T10:11:12Z',
};

/** Polyfill jsdom : `<dialog>` sans showModal/close. */
function doublerDialog() {
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
}

async function monter(url = '/hote/app/dv360', options: { connexions?: DspConnectionPublic[] } = {}) {
  doublerDialog();
  const naviguer = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), DspApi, NotificationsService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      { provide: BASE_RESSOURCES, useValue: 'http://distante.test/remotes/magelian/main.js' },
      { provide: NAVIGUER_HORS_APPLICATION, useValue: naviguer },
      provideRouter([{ path: 'hote/app/dv360', component: Dv360Page }]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  const http = TestBed.inject(HttpTestingController);
  const stable = async () => {
    for (let i = 0; i < 3; i++) { await Promise.resolve(); await harness.fixture.whenStable(); }
  };
  const el = harness.fixture.nativeElement as HTMLElement;
  return {
    harness, http, naviguer, el, stable,
    router: TestBed.inject(Router),
    notifications: TestBed.inject(NotificationsService),
    titres: () => TestBed.inject(NotificationsService).notifications().map((n) => [n.variante, n.titre]),
    bouton: (action: string) => el.querySelector<HTMLButtonElement>(`mg-dv360 [data-action="${action}"]`)!,
    /** Répond aux trois lectures du montage. */
    async repondre(connexions = options.connexions ?? [CONNEXION]) {
      http.expectOne('/api/admin/dsp/connections').flush({ connections: connexions });
      http.expectOne('/api/admin/dsp/dv360/config').flush(CONFIG);
      http.expectOne('/api/admin/dsp/logs?provider=dv360&limit=20').flush({ logs: [LOG] });
      await stable();
    },
  };
}

const methodes = (reqs: TestRequest[]) => reqs.map((r) => `${r.request.method} ${r.request.urlWithParams}`);

describe('Dv360Page — app/admin/api/dv360/page.tsx porté (lot 6, T9)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('montage : TROIS lectures (connexion, diagnostic, 20 derniers logs), puis l’état de la connexion de l’organisation', async () => {
    const { http, el, stable } = await monter();
    const enVol = http.match(() => true);
    expect(methodes(enVol)).toEqual([
      'GET /api/admin/dsp/connections', 'GET /api/admin/dsp/dv360/config', 'GET /api/admin/dsp/logs?provider=dv360&limit=20',
    ]);
    enVol[0].flush({ connections: [CONNEXION] });
    enVol[1].flush(CONFIG);
    enVol[2].flush({ logs: [LOG] });
    await stable();
    const t = (s: string) => el.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim();
    expect(t('[data-statut]')).toBe('Erreur');
    expect(el.querySelector('[data-statut]')?.getAttribute('data-etat')).toBe('error');
    expect(el.querySelector('mg-dv360 img')?.getAttribute('src')).toBe('http://distante.test/remotes/magelian/logos/dv360.svg');
    expect(el.querySelector('mg-dv360 img')?.getAttribute('alt')).toBe('DV360');
    // Diagnostic : 5 lignes, la redirect URI et le client de l'organisation en clair, les deux pastilles.
    expect(el.querySelectorAll('[data-config]').length).toBe(5);
    expect(t('[data-config="oauth_redirect_uri"]')).toContain('http://localhost:3000/api/admin/dsp/dv360/oauth/callback');
    expect(t('[data-config="client_organisation"]')).toContain('client.apps.googleusercontent.com');
    expect(t('[data-prete="service_account"]')).toBe('Service Account : prête');
    expect(t('[data-prete="oauth"]')).toBe('OAuth Google : prête'); // client saisi par formulaire
    expect(t('[data-derniere-erreur]')).toBe('Dernière erreur : invalid_grant');
    // Méthode, Partner ID et Client ID repris de la connexion (`page.tsx:45-47`).
    expect(el.querySelector<HTMLInputElement>('[data-methode="oauth"]')!.checked).toBe(true);
    expect(el.querySelector<HTMLInputElement>('[data-champ="partner"]')!.value).toBe('123456');
    expect(el.querySelector<HTMLInputElement>('[data-champ="client-id"]')!.value).toBe('client.apps.googleusercontent.com');
    expect(el.querySelector<HTMLInputElement>('[data-champ="client-secret"]')!.type).toBe('password');
    // Journal : heure fr-FR, niveau, action, message, « statut · durée ».
    const log = el.querySelector('[data-log]')!;
    expect([...log.children].map((c) => c.textContent!.trim())).toEqual([
      new Date(LOG.created_at).toLocaleTimeString('fr-FR'), 'error', 'list_advertisers', 'Permission denied', '403 · 812ms',
    ]);
    // Pas de credentials : « Tester » désactivé, avec l'infobulle OAuth de React.
    expect(el.querySelector<HTMLButtonElement>('[data-action="tester"]')!.disabled).toBe(true);
    expect(el.querySelector('[data-action="tester"]')!.getAttribute('title'))
      .toBe('Termine d’abord la connexion Google (bouton « Se connecter avec Google »).');
  });

  it('aucune connexion : « Déconnecté », ni Déconnecter ni purge, journal vide, méthode Service Account par défaut', async () => {
    const { http, el, stable } = await monter();
    http.expectOne('/api/admin/dsp/connections').flush({ connections: [] });
    http.expectOne('/api/admin/dsp/dv360/config').flush(CONFIG);
    http.expectOne('/api/admin/dsp/logs?provider=dv360&limit=20').flush({ logs: [] });
    await stable();
    expect(el.querySelector('[data-statut]')?.textContent?.trim()).toBe('Déconnecté');
    expect(el.querySelector('[data-action="deconnecter"]')).toBeNull();
    expect(el.querySelector('[data-action="purger"]')).toBeNull();
    expect(el.querySelector('[data-journal]')?.textContent?.trim()).toBe('Aucun log pour l\'instant.');
    expect(el.querySelector<HTMLInputElement>('[data-methode="service_account"]')!.checked).toBe(true);
    expect(el.querySelector('[data-action="tester"]')!.getAttribute('title')).toBe('Enregistre d’abord une clé Service Account.');
  });

  it('diagnostic en échec → « Diagnostic indisponible. » ; connexion en échec réseau → notification de React', async () => {
    const { http, el, stable, titres } = await monter();
    http.expectOne('/api/admin/dsp/connections').error(new ProgressEvent('error'));
    http.expectOne('/api/admin/dsp/dv360/config').flush({ error: 'x' }, { status: 500, statusText: 'KO' });
    http.expectOne('/api/admin/dsp/logs?provider=dv360&limit=20').flush({ logs: [] });
    await stable();
    expect(el.querySelector('[data-diagnostic]')?.textContent?.trim()).toBe('Diagnostic indisponible.');
    expect(titres()).toEqual([['error', 'Impossible de charger la connexion DV360.']]);
  });

  it('« Tester la connexion » : POST test, notification « Connexion OK — n advertisers. », puis connexion et journal relus', async () => {
    const { http, bouton, stable, titres, repondre } = await monter();
    await repondre([{ ...CONNEXION, has_credentials: true, status: 'connected' }]);
    expect(bouton('tester').disabled).toBe(false);
    bouton('tester').click();
    await stable();
    expect(bouton('tester').disabled).toBe(true); // busy
    const test = http.expectOne('/api/admin/dsp/dv360/test');
    expect([test.request.method, test.request.body]).toEqual(['POST', null]);
    test.flush({ ok: true, advertisers: [{ id: '1', name: 'a' }, { id: '2', name: 'b' }] });
    await stable();
    http.expectOne('/api/admin/dsp/connections').flush({ connections: [CONNEXION] });
    await stable();
    http.expectOne('/api/admin/dsp/logs?provider=dv360&limit=20').flush({ logs: [] });
    await stable();
    expect(titres()).toEqual([['success', 'Connexion OK — 2 advertisers.']]);
  });

  it('« Tester » en échec : le `error` du corps du serveur (502 DV360), puis le journal relu', async () => {
    const { http, bouton, stable, titres, repondre } = await monter();
    await repondre([{ ...CONNEXION, has_credentials: true }]);
    bouton('tester').click();
    await stable();
    http.expectOne('/api/admin/dsp/dv360/test').flush({ error: 'Request had insufficient authentication scopes.' }, { status: 502, statusText: 'Bad Gateway' });
    await stable();
    http.expectOne('/api/admin/dsp/logs?provider=dv360&limit=20').flush({ logs: [] });
    expect(titres()).toEqual([['error', 'Request had insufficient authentication scopes.']]);
  });

  it('« Se connecter avec Google » sans Partner ID : bouton désactivé ; forcé, notification de React et AUCUNE requête', async () => {
    const { http, el, bouton, stable, titres, naviguer, harness, repondre } = await monter();
    await repondre([{ ...CONNEXION, partner_id: null }]);
    expect(bouton('oauth').disabled).toBe(true);
    const page = harness.routeDebugElement!.componentInstance as { demarrerOAuth(): Promise<void> };
    await page.demarrerOAuth();
    await stable();
    expect(titres()).toEqual([['error', 'Renseigne le Partner ID avant de connecter Google.']]);
    http.expectNone(() => true);
    expect(naviguer).not.toHaveBeenCalled();
    expect(el).toBeTruthy();
  });

  it('« Se connecter avec Google » : POST oauth/start { partner_id }, puis navigation HORS application vers l’URL rendue', async () => {
    const { http, bouton, stable, naviguer, repondre } = await monter();
    await repondre();
    expect(bouton('oauth').disabled).toBe(false);
    bouton('oauth').click();
    await stable();
    const start = http.expectOne('/api/admin/dsp/dv360/oauth/start');
    expect(start.request.body).toEqual({ partner_id: '123456' });
    start.flush({ url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x' });
    await stable();
    expect(naviguer).toHaveBeenCalledExactlyOnceWith('https://accounts.google.com/o/oauth2/v2/auth?client_id=x');
    expect(bouton('oauth').disabled).toBe(true); // on quitte la page : busy reste levé, comme React
    http.expectNone(() => true);
  });

  it('« Enregistrer la config OAuth » : corps exact, secret EFFACÉ après envoi (jamais relu)', async () => {
    const { http, el, bouton, stable, titres, repondre } = await monter();
    await repondre();
    const secret = el.querySelector<HTMLInputElement>('[data-champ="client-secret"]')!;
    secret.value = 'GOCSPX-secret';
    secret.dispatchEvent(new Event('input'));
    await stable();
    bouton('config-oauth').click();
    await stable();
    const req = http.expectOne('/api/admin/dsp/dv360/oauth/config');
    expect(req.request.body).toEqual({ partner_id: '123456', oauth_client_id: 'client.apps.googleusercontent.com', oauth_client_secret: 'GOCSPX-secret' });
    req.flush({ ok: true });
    await stable();
    http.expectOne('/api/admin/dsp/connections').flush({ connections: [CONNEXION] });
    await stable();
    http.expectOne('/api/admin/dsp/logs?provider=dv360&limit=20').flush({ logs: [] });
    await stable();
    expect(titres()).toEqual([['success', 'Config OAuth enregistrée.']]);
    expect(secret.value).toBe('');
  });

  it('Service Account : « Enregistrer » envoie le corps de React et vide la clé JSON', async () => {
    const { http, el, bouton, stable, titres, repondre } = await monter();
    await repondre([]);
    const saisir = async (sel: string, v: string) => {
      const c = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel)!;
      c.value = v;
      c.dispatchEvent(new Event('input'));
      await stable();
    };
    expect(bouton('enregistrer').disabled).toBe(true);
    await saisir('[data-champ="partner"]', '42');
    await saisir('[data-champ="sa"]', '{"client_email":"a"}');
    bouton('enregistrer').click();
    await stable();
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/admin/dsp/dv360/connect');
    expect(req.request.body).toEqual({ auth_method: 'service_account', partner_id: '42', service_account_json: '{"client_email":"a"}' });
    req.flush({ ok: true });
    await stable();
    http.expectOne('/api/admin/dsp/connections').flush({ connections: [] });
    await stable();
    http.expectOne('/api/admin/dsp/logs?provider=dv360&limit=20').flush({ logs: [] });
    await stable();
    expect(titres()).toEqual([['success', 'Connexion enregistrée.']]);
    expect(el.querySelector<HTMLTextAreaElement>('[data-champ="sa"]')!.value).toBe('');
  });

  it('purge : `mg-confirmation` (texte de React) puis DELETE `?scope=full`, champs remis à zéro, dialogue refermé', async () => {
    const { http, el, bouton, stable, titres, repondre } = await monter();
    await repondre();
    const dialog = el.querySelector('mg-dv360 mg-confirmation dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(false);
    bouton('purger').click();
    await stable();
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('Effacer les données d\'authentification');
    expect(dialog.textContent).toContain('Supprime définitivement le client OAuth (Client ID + Secret), le refresh token, la clé Service Account et le Partner ID de cette organisation. Il faudra tout ressaisir.');
    const confirmer = dialog.querySelector<HTMLButtonElement>('button.confirmer')!;
    expect(confirmer.textContent?.trim()).toBe('Tout effacer');
    http.expectNone(() => true);
    confirmer.click();
    await stable();
    expect(confirmer.textContent?.trim()).toBe('En cours...');
    const del = http.expectOne((r) => r.method === 'DELETE');
    expect(del.request.urlWithParams).toBe('/api/admin/dsp/dv360/connect?scope=full');
    del.flush({ ok: true });
    await stable();
    http.expectOne('/api/admin/dsp/connections').flush({ connections: [] });
    await stable();
    http.expectOne('/api/admin/dsp/logs?provider=dv360&limit=20').flush({ logs: [] });
    await stable();
    expect(titres()).toEqual([['success', 'Données d\'authentification effacées.']]);
    expect(dialog.open).toBe(false);
    expect(el.querySelector<HTMLInputElement>('[data-champ="partner"]')!.value).toBe('');
  });

  it('retour `?oauth=success` : notification « DV360 connecté via Google. », puis paramètres RETIRÉS de l’URL (sans entrée d’historique)', async () => {
    const { router, stable, titres, repondre } = await monter('/hote/app/dv360?oauth=success&autre=1');
    await repondre();
    await stable();
    expect(titres()).toEqual([['success', 'DV360 connecté via Google.']]);
    expect(router.url).toBe('/hote/app/dv360?autre=1');
  });

  it('retour `?oauth=error&reason=access_denied` : « Échec OAuth : access_denied », paramètres retirés', async () => {
    const { router, stable, titres, repondre } = await monter('/hote/app/dv360?oauth=error&reason=access_denied');
    await repondre();
    await stable();
    expect(titres()).toEqual([['error', 'Échec OAuth : access_denied']]);
    expect(router.url).toBe('/hote/app/dv360');
  });

  it('retour `?oauth=error` sans raison : « Échec OAuth : inconnu »', async () => {
    const { stable, titres, repondre } = await monter('/hote/app/dv360?oauth=error');
    await repondre();
    await stable();
    expect(titres()).toEqual([['error', 'Échec OAuth : inconnu']]);
  });

  it('écran quitté pendant les lectures : elles sont ANNULÉES (aucune réponse attendue)', async () => {
    const { http, harness } = await monter();
    const enVol = http.match(() => true);
    expect(enVol.length).toBe(3);
    harness.fixture.destroy();
    expect(enVol.every((r) => r.cancelled)).toBe(true);
  });
});
