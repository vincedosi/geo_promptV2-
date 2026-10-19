import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { BASE_RESSOURCES } from '../../../core/ressources/ressource-distante';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import type { DspConnectionPublic } from '../logique/types/dsp';
import { DspApi, type ConfigTiktok } from './data/dsp.api';
import { NAVIGUER_HORS_APPLICATION } from './naviguer-hors-application';
import { TiktokPage } from './tiktok.page';
import { doublerDialog } from '../testing/dom';

/**
 * Diagnostic de FIXTURE, pas le relevé local : clé de chiffrement présente, identifiants absents, et une redirect
 * URI posée pour exercer l'affichage de sa valeur. Le poste local (relevé du 2026-10-17) montre, lui, la redirect
 * URI en « ✗ » (vague finale G3 : l'ancien commentaire disait le contraire).
 */
const CONFIG: ConfigTiktok = {
  env: { enc_key: true, app_id: false, app_secret: false, redirect_uri: true, redirect_uri_value: 'http://localhost:3000/api/admin/dsp/tiktok/oauth/callback' },
};

const CONNEXION: DspConnectionPublic = {
  provider: 'tiktok', auth_method: 'oauth', status: 'connected', partner_id: null, oauth_client_id: '7412345678901234567',
  has_credentials: true, advertiser_ids: [{ id: 'a1', name: 'A' }, { id: 'a2', name: 'B' }, { id: 'a3', name: 'C' }],
  token_expires_at: null, last_error: null, updated_at: null,
};

const LOG = {
  id: 't1', provider: 'tiktok', category: 'connection', level: 'info', action: 'save_app',
  status_code: null, duration_ms: null, message: 'App TikTok enregistrée (App ID + Secret chiffré)', created_at: '2026-10-12T10:11:12Z',
};

const JOURNAL = '/api/admin/dsp/logs?provider=tiktok&limit=20';

async function monter(url = '/hote/app/tiktok') {
  doublerDialog();
  const naviguer = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), DspApi, NotificationsService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      { provide: BASE_RESSOURCES, useValue: 'http://distante.test/remotes/magelian/main.js' },
      { provide: NAVIGUER_HORS_APPLICATION, useValue: naviguer },
      provideRouter([{ path: 'hote/app/tiktok', component: TiktokPage }]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  const http = TestBed.inject(HttpTestingController);
  const stable = async () => {
    for (let i = 0; i < 3; i++) { await Promise.resolve(); await harness.fixture.whenStable(); }
  };
  const el = harness.fixture.nativeElement as HTMLElement;
  const saisir = async (sel: string, v: string) => {
    const c = el.querySelector<HTMLInputElement>(sel)!;
    c.value = v;
    c.dispatchEvent(new Event('input'));
    await stable();
  };
  return {
    harness, http, naviguer, el, stable, saisir,
    router: TestBed.inject(Router),
    titres: () => TestBed.inject(NotificationsService).notifications().map((n) => [n.variante, n.titre]),
    bouton: (action: string) => el.querySelector<HTMLButtonElement>(`mg-tiktok [data-action="${action}"]`)!,
    t: (s: string) => el.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim(),
    /** Répond aux trois lectures du montage. */
    async repondre(connexions: DspConnectionPublic[] = [], logs: unknown[] = [LOG]) {
      http.expectOne('/api/admin/dsp/connections').flush({ connections: connexions });
      http.expectOne('/api/admin/dsp/tiktok/config').flush(CONFIG);
      http.expectOne(JOURNAL).flush({ logs });
      await stable();
    },
    /** Relectures après une écriture : connexion (si `connexion`), puis journal. */
    async relire(connexions: DspConnectionPublic[] | null) {
      if (connexions) {
        http.expectOne('/api/admin/dsp/connections').flush({ connections: connexions });
        await stable();
      }
      http.expectOne(JOURNAL).flush({ logs: [] });
      await stable();
    },
  };
}

const methodes = (reqs: TestRequest[]) => reqs.map((r) => `${r.request.method} ${r.request.urlWithParams}`);

describe('TiktokPage — app/admin/api/tiktok/page.tsx porté (lot 6, T10)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('montage : TROIS lectures (connexion, diagnostic TikTok, 20 derniers logs TikTok), paramètres EXACTS de React', async () => {
    const { http, stable } = await monter();
    const enVol = http.match(() => true);
    expect(methodes(enVol)).toEqual([
      'GET /api/admin/dsp/connections', 'GET /api/admin/dsp/tiktok/config', `GET ${JOURNAL}`,
    ]);
    enVol[0].flush({ connections: [] });
    enVol[1].flush(CONFIG);
    enVol[2].flush({ logs: [] });
    await stable();
  });

  it('aucune connexion (base locale) : « Déconnecté », diagnostic à 5 lignes, ni Déconnecter ni purge, boutons désactivés', async () => {
    const { el, t, bouton, repondre } = await monter();
    await repondre([]);
    expect(t('[data-statut]')).toBe('Déconnecté');
    expect(el.querySelector('[data-statut]')?.getAttribute('data-etat')).toBe('disconnected');
    expect(el.querySelector('mg-tiktok img')?.getAttribute('src')).toBe('http://distante.test/remotes/magelian/logos/tiktok.svg');
    expect(el.querySelector('mg-tiktok img')?.getAttribute('alt')).toBe('TikTok');
    const ligne = (l: Element) => [...l.children].map((c) => c.textContent!.trim()).join(' ');
    expect([...el.querySelectorAll('[data-config]')].map(ligne)).toEqual([
      '✓ Chiffrement des secrets (DSP_ENC_KEY)',
      '✗ App ID (env TIKTOK_APP_ID — optionnel)',
      '✗ App Secret (env TIKTOK_APP_SECRET — optionnel)',
      '✓ Redirect URI (à déclarer dans l\'app TikTok) http://localhost:3000/api/admin/dsp/tiktok/oauth/callback',
      '✗ App de l\'organisation (formulaire)',
    ]);
    expect(el.querySelector('[data-derniere-erreur]')).toBeNull();
    expect(el.querySelector('[data-action="deconnecter"]')).toBeNull();
    expect(el.querySelector('[data-action="purger"]')).toBeNull();
    expect(el.querySelector('[data-annonceurs]')).toBeNull();
    // Ni app enregistrée ni variable d'env : OAuth et Test désactivés ; Enregistrer aussi (champs vides).
    expect(bouton('enregistrer').disabled).toBe(true);
    expect(bouton('oauth').disabled).toBe(true);
    expect(bouton('tester').disabled).toBe(true);
    expect(bouton('tester').getAttribute('title')).toBe('Termine d\'abord la connexion TikTok.');
    expect(el.querySelector<HTMLInputElement>('[data-champ="app-id"]')!.placeholder).toBe('ex : 7412345678901234567');
    expect(el.querySelector<HTMLInputElement>('[data-champ="app-secret"]')!.type).toBe('password');
    expect(el.querySelector<HTMLInputElement>('[data-champ="app-secret"]')!.placeholder).toBe('secret de l\'app TikTok');
    // Journal : heure fr-FR, niveau, action, message ; ni statut ni durée → pas de méta.
    const log = el.querySelector('[data-log]')!;
    expect([...log.children].map((c) => c.textContent!.trim())).toEqual([
      new Date(LOG.created_at).toLocaleTimeString('fr-FR'), 'info', 'save_app', 'App TikTok enregistrée (App ID + Secret chiffré)',
    ]);
  });

  it('connexion présente : « Connecté », App ID repris, mention « app déjà enregistrée », advertisers détectés, Tester actif', async () => {
    const { el, t, bouton, repondre } = await monter();
    await repondre([CONNEXION], []);
    expect(t('[data-statut]')).toBe('Connecté');
    expect(el.querySelector<HTMLInputElement>('[data-champ="app-id"]')!.value).toBe('7412345678901234567');
    expect([...el.querySelector('[data-config="app_organisation"]')!.children].map((c) => c.textContent!.trim()))
      .toEqual(['✓', 'App de l\'organisation (formulaire)', '7412345678901234567']);
    expect(t('[data-deja-enregistree]')).toBe('— app déjà enregistrée ✓ (re-saisir pour modifier)');
    expect(t('[data-annonceurs]')).toBe('Advertisers détectés : 3');
    expect(bouton('oauth').disabled).toBe(false);
    expect(bouton('tester').disabled).toBe(false);
    expect(bouton('tester').getAttribute('title')).toBeNull();
    expect(bouton('deconnecter')).not.toBeNull();
    expect(bouton('purger')).not.toBeNull();
    expect(t('[data-journal]')).toBe('Aucun log pour l\'instant.');
  });

  it('dernière erreur affichée telle quelle', async () => {
    const { t, repondre } = await monter();
    await repondre([{ ...CONNEXION, status: 'error', last_error: 'Access token expired' }], []);
    expect(t('[data-statut]')).toBe('Erreur');
    expect(t('[data-derniere-erreur]')).toBe('Dernière erreur : Access token expired');
  });

  it('diagnostic en échec → « Diagnostic indisponible. » ; connexion en échec réseau → notification de React', async () => {
    const { http, t, stable, titres } = await monter();
    http.expectOne('/api/admin/dsp/connections').error(new ProgressEvent('error'));
    http.expectOne('/api/admin/dsp/tiktok/config').flush({ error: 'x' }, { status: 500, statusText: 'KO' });
    http.expectOne(JOURNAL).flush({ logs: [] });
    await stable();
    expect(t('[data-diagnostic]')).toBe('Diagnostic indisponible.');
    expect(titres()).toEqual([['error', 'Impossible de charger la connexion TikTok.']]);
  });

  it('« Enregistrer l’app » : POST connect au corps EXACT { app_id, app_secret }, secret vidé, connexion puis journal relus', async () => {
    const { http, el, bouton, stable, saisir, titres, repondre, relire } = await monter();
    await repondre([]);
    await saisir('[data-champ="app-id"]', '7412345678901234567');
    expect(bouton('enregistrer').disabled).toBe(true); // secret manquant
    await saisir('[data-champ="app-secret"]', 's3cr3t');
    expect(bouton('enregistrer').disabled).toBe(false);
    bouton('enregistrer').click();
    await stable();
    expect(bouton('enregistrer').disabled).toBe(true); // busy
    const req = http.expectOne((r) => r.url === '/api/admin/dsp/tiktok/connect');
    expect([req.request.method, req.request.body]).toEqual(['POST', { app_id: '7412345678901234567', app_secret: 's3cr3t' }]);
    req.flush({ ok: true });
    await stable();
    await relire([{ ...CONNEXION, status: 'disconnected', has_credentials: false, advertiser_ids: [] }]);
    expect(titres()).toEqual([['success', 'App TikTok enregistrée.']]);
    expect(el.querySelector<HTMLInputElement>('[data-champ="app-secret"]')!.value).toBe('');
  });

  it('« Enregistrer l’app » en échec : le `error` du serveur, puis le journal relu (pas la connexion)', async () => {
    const { http, bouton, stable, saisir, titres, repondre, relire } = await monter();
    await repondre([]);
    await saisir('[data-champ="app-id"]', '1');
    await saisir('[data-champ="app-secret"]', '2');
    bouton('enregistrer').click();
    await stable();
    http.expectOne('/api/admin/dsp/tiktok/connect').flush({ error: 'App ID et App Secret requis.' }, { status: 400, statusText: 'Bad Request' });
    await stable();
    await relire(null);
    expect(titres()).toEqual([['error', 'App ID et App Secret requis.']]);
  });

  it('« Se connecter avec TikTok » : POST oauth/start SANS corps, puis navigation HORS application vers l’URL rendue (jeton)', async () => {
    const { http, bouton, stable, naviguer, repondre } = await monter();
    await repondre([{ ...CONNEXION, status: 'disconnected', has_credentials: false }], []);
    bouton('oauth').click();
    await stable();
    const start = http.expectOne('/api/admin/dsp/tiktok/oauth/start');
    expect([start.request.method, start.request.body]).toEqual(['POST', null]);
    start.flush({ url: 'https://business-api.tiktok.com/portal/auth?app_id=7412345678901234567&state=s' });
    await stable();
    expect(naviguer).toHaveBeenCalledExactlyOnceWith('https://business-api.tiktok.com/portal/auth?app_id=7412345678901234567&state=s');
    expect(bouton('oauth').disabled).toBe(true); // on quitte la page : busy reste levé, comme React
    http.expectNone(() => true);
  });

  it('« Se connecter avec TikTok » refusé (400) : message du serveur, busy relâché, journal relu, aucune navigation', async () => {
    const { http, bouton, stable, naviguer, titres, repondre, relire } = await monter();
    await repondre([{ ...CONNEXION, status: 'disconnected', has_credentials: false }], []);
    bouton('oauth').click();
    await stable();
    http.expectOne('/api/admin/dsp/tiktok/oauth/start')
      .flush({ error: 'App ID TikTok manquant : enregistre d\'abord l\'app (App ID + Secret).' }, { status: 400, statusText: 'Bad Request' });
    await stable();
    await relire(null);
    expect(titres()).toEqual([['error', 'App ID TikTok manquant : enregistre d\'abord l\'app (App ID + Secret).']]);
    expect(naviguer).not.toHaveBeenCalled();
    expect(bouton('oauth').disabled).toBe(false);
  });

  it('App ID fourni par l’env seulement (aucune connexion) : OAuth actif (`appReady`)', async () => {
    const { http, bouton, stable } = await monter();
    http.expectOne('/api/admin/dsp/connections').flush({ connections: [] });
    http.expectOne('/api/admin/dsp/tiktok/config').flush({ env: { ...CONFIG.env, app_id: true } });
    http.expectOne(JOURNAL).flush({ logs: [] });
    await stable();
    expect(bouton('oauth').disabled).toBe(false);
  });

  it('« Tester la connexion » : POST test sans corps, « Connexion OK — n advertisers. », connexion et journal relus', async () => {
    const { http, bouton, stable, titres, repondre, relire } = await monter();
    await repondre([CONNEXION], []);
    bouton('tester').click();
    await stable();
    const test = http.expectOne('/api/admin/dsp/tiktok/test');
    expect([test.request.method, test.request.body]).toEqual(['POST', null]);
    test.flush({ ok: true, advertisers: [{ id: '1', name: 'a' }] });
    await stable();
    await relire([CONNEXION]);
    expect(titres()).toEqual([['success', 'Connexion OK — 1 advertisers.']]);
  });

  it('« Déconnecter » : DELETE connect (sans scope), « Déconnecté. », connexion et journal relus', async () => {
    const { http, bouton, stable, titres, repondre, relire } = await monter();
    await repondre([CONNEXION], []);
    bouton('deconnecter').click();
    await stable();
    const del = http.expectOne((r) => r.method === 'DELETE');
    expect(del.request.urlWithParams).toBe('/api/admin/dsp/tiktok/connect');
    del.flush({ ok: true });
    await stable();
    await relire([]);
    expect(titres()).toEqual([['success', 'Déconnecté.']]);
  });

  it('purge : `mg-confirmation` (texte de React) puis DELETE `?scope=full`, champs vidés, dialogue refermé', async () => {
    const { http, el, bouton, stable, titres, repondre, relire } = await monter();
    await repondre([CONNEXION], []);
    const dialog = el.querySelector('mg-tiktok mg-confirmation dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(false);
    bouton('purger').click();
    await stable();
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('Effacer les données d\'authentification');
    expect(dialog.textContent).toContain('Supprime définitivement l\'app TikTok (App ID + Secret) et l\'access token de cette organisation. Il faudra tout ressaisir.');
    const confirmer = dialog.querySelector<HTMLButtonElement>('button.confirmer')!;
    expect(confirmer.textContent?.trim()).toBe('Tout effacer');
    http.expectNone(() => true);
    confirmer.click();
    await stable();
    const del = http.expectOne((r) => r.method === 'DELETE');
    expect(del.request.urlWithParams).toBe('/api/admin/dsp/tiktok/connect?scope=full');
    del.flush({ ok: true });
    await stable();
    await relire([]);
    expect(titres()).toEqual([['success', 'Données d\'authentification effacées.']]);
    expect(dialog.open).toBe(false);
    expect(el.querySelector<HTMLInputElement>('[data-champ="app-id"]')!.value).toBe('');
  });

  it('retour `?oauth=success` : notification texte de React, paramètres RETIRÉS de l’URL', async () => {
    const { router, stable, titres, repondre } = await monter('/hote/app/tiktok?oauth=success');
    await repondre([]);
    await stable();
    expect(titres()).toEqual([['success', 'TikTok connecté — lance « Tester la connexion ».']]);
    expect(router.url).toBe('/hote/app/tiktok');
  });

  it('retour `?oauth=error&reason=state_invalide` : « Échec OAuth : state_invalide »', async () => {
    const { router, stable, titres, repondre } = await monter('/hote/app/tiktok?oauth=error&reason=state_invalide');
    await repondre([]);
    await stable();
    expect(titres()).toEqual([['error', 'Échec OAuth : state_invalide']]);
    expect(router.url).toBe('/hote/app/tiktok');
  });

  it('« rafraîchir » relit SEUL le journal TikTok', async () => {
    const { http, bouton, stable, repondre } = await monter();
    await repondre([]);
    bouton('rafraichir').click();
    await stable();
    expect(bouton('rafraichir').textContent?.trim()).toBe('…');
    http.expectOne(JOURNAL).flush({ logs: [] });
    await stable();
    expect(bouton('rafraichir').textContent?.trim()).toBe('rafraîchir');
    http.expectNone(() => true);
  });

  it('écran quitté pendant les lectures : elles sont ANNULÉES', async () => {
    const { http, harness } = await monter();
    const enVol = http.match(() => true);
    expect(enVol.length).toBe(3);
    harness.fixture.destroy();
    expect(enVol.every((r) => r.cancelled)).toBe(true);
  });
});
