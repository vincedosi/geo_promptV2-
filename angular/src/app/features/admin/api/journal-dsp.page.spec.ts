import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { DspApi } from './data/dsp.api';
import { JournalDspPage } from './journal-dsp.page';

const ERREUR = {
  id: 'l1', provider: 'dv360', category: 'api_call', level: 'error', action: 'list_advertisers',
  status_code: 502, duration_ms: 812, message: 'Unsupported state or unable to authenticate data', created_at: '2026-10-12T10:11:12Z',
};
const INFO = {
  id: 'l2', provider: 'tiktok', category: 'connection', level: 'info', action: 'save_app',
  status_code: null, duration_ms: null, message: null, created_at: '2026-10-11T08:00:00Z',
};

async function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), DspApi, NotificationsService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      provideRouter([{ path: 'hote/app/logs', component: JournalDspPage }]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/hote/app/logs');
  const http = TestBed.inject(HttpTestingController);
  const stable = async () => {
    for (let i = 0; i < 3; i++) { await Promise.resolve(); await harness.fixture.whenStable(); }
  };
  const el = harness.fixture.nativeElement as HTMLElement;
  return {
    harness, http, el, stable,
    titres: () => TestBed.inject(NotificationsService).notifications().map((n) => [n.variante, n.titre]),
    t: (s: string) => el.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim(),
    caseErreurs: () => el.querySelector<HTMLInputElement>('mg-journal-dsp input[type="checkbox"]')!,
  };
}

describe('JournalDspPage — app/admin/api/logs/page.tsx porté (lot 6, T10)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('montage : « Chargement… », UNE lecture SANS paramètre (React : `/api/admin/dsp/logs`), puis le tableau de React', async () => {
    const { http, el, t, stable } = await monter();
    expect(t('[data-etat-journal]')).toBe('Chargement…');
    const req = http.expectOne(() => true);
    expect([req.request.method, req.request.urlWithParams]).toEqual(['GET', '/api/admin/dsp/logs']);
    req.flush({ logs: [ERREUR, INFO] });
    await stable();
    expect([...el.querySelectorAll('thead th')].map((th) => th.textContent!.trim()))
      .toEqual(['Date', 'Provider', 'Catégorie', 'Action', 'Statut', 'Durée', 'Message']);
    const lignes = [...el.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent!.trim()));
    expect(lignes).toEqual([
      [new Date(ERREUR.created_at).toLocaleString('fr-FR'), 'dv360', 'api_call', 'list_advertisers', '502', '812 ms', ERREUR.message],
      // Statut absent → le niveau ; durée absente → « — » ; message absent → vide.
      [new Date(INFO.created_at).toLocaleString('fr-FR'), 'tiktok', 'connection', 'save_app', 'info', '—', ''],
    ]);
    expect(el.querySelector('tbody tr td[data-niveau]')?.getAttribute('data-niveau')).toBe('error');
  });

  it('« Erreurs uniquement » cochée → UNE relecture avec `?level=error` (paramètre lu par la route) ; décochée → sans', async () => {
    const { http, stable, caseErreurs, t } = await monter();
    http.expectOne('/api/admin/dsp/logs').flush({ logs: [ERREUR, INFO] });
    await stable();
    const c = caseErreurs();
    expect(c.checked).toBe(false);
    c.checked = true;
    c.dispatchEvent(new Event('change'));
    await stable();
    expect(t('[data-etat-journal]')).toBe('Chargement…');
    const filtree = http.expectOne(() => true);
    expect(filtree.request.urlWithParams).toBe('/api/admin/dsp/logs?level=error');
    filtree.flush({ logs: [ERREUR] });
    await stable();
    c.checked = false;
    c.dispatchEvent(new Event('change'));
    await stable();
    const toutes = http.expectOne(() => true);
    expect(toutes.request.urlWithParams).toBe('/api/admin/dsp/logs');
    toutes.flush({ logs: [] });
    await stable();
    expect(t('[data-etat-journal]')).toBe('Aucun log pour le moment.');
  });

  it('« Rafraîchir » relit avec le filtre courant', async () => {
    const { http, el, stable, caseErreurs } = await monter();
    http.expectOne('/api/admin/dsp/logs').flush({ logs: [] });
    await stable();
    caseErreurs().checked = true;
    caseErreurs().dispatchEvent(new Event('change'));
    await stable();
    http.expectOne('/api/admin/dsp/logs?level=error').flush({ logs: [] });
    await stable();
    el.querySelector<HTMLButtonElement>('[data-action="rafraichir"]')!.click();
    await stable();
    http.expectOne('/api/admin/dsp/logs?level=error').flush({ logs: [] });
    await stable();
  });

  it('lecture en échec : notification du `error` du serveur (React : `json.error ?? \'Erreur\'`)', async () => {
    const { http, stable, titres, t } = await monter();
    http.expectOne('/api/admin/dsp/logs').flush({ error: 'Aucune organisation associée.' }, { status: 400, statusText: 'Bad Request' });
    await stable();
    expect(titres()).toEqual([['error', 'Aucune organisation associée.']]);
    expect(t('[data-etat-journal]')).toBe('Aucun log pour le moment.');
  });

  it('écran quitté pendant la lecture : elle est ANNULÉE', async () => {
    const { http, harness } = await monter();
    const req = http.expectOne('/api/admin/dsp/logs');
    harness.fixture.destroy();
    expect(req.cancelled).toBe(true);
  });
});
