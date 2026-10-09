import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { EspacesApi } from './data/espaces.api';
import { EspacesEtatService } from './etat/espaces-etat.service';
import { FicheEspaceComponent } from './fiche-espace.component';
import type { EspaceResume } from './logique/types';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const INCONNU = '00000000-0000-4000-8000-0000000000ff';

function espace(id: string, nom: string, nb: number): EspaceResume {
  return { id, nom, nom_affiche: nom, slug: nom.toLowerCase(), actif: true, interne: false, nb_membres: nb, nb_jeux_prives: 0 };
}

/** `'reel'` : le vrai `EspacesEtatService` (lit `GET admin/espaces`) au lieu d'un double. */
async function monter(etat?: Record<string, unknown> | 'reel') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), EspacesApi, NotificationsService,
      provideRouter([{ path: 'espaces/:id', component: FicheEspaceComponent }, { path: 'espaces', children: [] }]),
      etat === 'reel' ? EspacesEtatService : {
        provide: EspacesEtatService,
        useValue: etat ?? {
          espaces: signal([espace(A, 'Espace A', 2), espace(B, 'Espace B', 5)]),
          socle: signal({ nb_jeux: 3 }),
          chargement: signal(false),
          erreur: signal(null),
          recharger: vi.fn(),
        },
      },
      { provide: AuthService, useValue: { session: signal({ user: { id: 'moi' } }) } },
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  const harnais = await RouterTestingHarness.create();
  const http = TestBed.inject(HttpTestingController);
  return { harnais, http, el: () => harnais.routeNativeElement as HTMLElement };
}

describe('FicheEspaceComponent', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it(':id = A → un GET membres de A ; B sans recréer le composant → GET membres de B et onglet remis sur Membres', async () => {
    const { harnais, http, el } = await monter();
    const instanceA = await harnais.navigateByUrl(`/espaces/${A}`, FicheEspaceComponent);
    http.expectOne(`/api/admin/espaces/${A}/membres`).flush({ membres: [] });
    await harnais.fixture.whenStable();
    expect(el().textContent).toContain('Espace A');
    expect(el().querySelector('[data-onglet="membres"]')!.textContent).toContain('Membres (2)');

    el().querySelector<HTMLButtonElement>('[data-onglet="donnees"]')!.click();
    await harnais.fixture.whenStable();
    http.expectOne(`/api/admin/espaces/${A}/donnees`).flush({ espace: espace(A, 'Espace A', 2), jeux: [] });
    expect(el().querySelector('[data-onglet="donnees"]')!.getAttribute('aria-selected')).toBe('true');

    const instanceB = await harnais.navigateByUrl(`/espaces/${B}`, FicheEspaceComponent);
    expect(instanceB).toBe(instanceA);
    http.expectOne(`/api/admin/espaces/${B}/membres`).flush({ membres: [] });
    await harnais.fixture.whenStable();
    expect(el().textContent).toContain('Espace B');
    expect(el().querySelector('[data-onglet="membres"]')!.getAttribute('aria-selected')).toBe('true');
    expect(el().querySelector('[data-onglet="membres"]')!.textContent).toContain('Membres (5)');
  });

  it('changer d\'espace pendant la lecture annule la lecture en vol', async () => {
    const { harnais, http } = await monter();
    await harnais.navigateByUrl(`/espaces/${A}`, FicheEspaceComponent);
    const enVol = http.expectOne(`/api/admin/espaces/${A}/membres`);
    await harnais.navigateByUrl(`/espaces/${B}`, FicheEspaceComponent);
    expect(enVol.cancelled).toBe(true);
    http.expectOne(`/api/admin/espaces/${B}/membres`).flush({ membres: [] });
  });

  it('clic « Données » : un seul GET des données, une fois ; Aperçu et Réglages : un GET chacun, à la première ouverture seulement', async () => {
    const { harnais, http, el } = await monter();
    await harnais.navigateByUrl(`/espaces/${A}`, FicheEspaceComponent);
    http.expectOne(`/api/admin/espaces/${A}/membres`).flush({ membres: [] });
    await harnais.fixture.whenStable();
    el().querySelector<HTMLButtonElement>('[data-onglet="donnees"]')!.click();
    await harnais.fixture.whenStable();
    http.expectOne(`/api/admin/espaces/${A}/donnees`).flush({ espace: espace(A, 'Espace A', 2), jeux: [] });
    await harnais.fixture.whenStable();
    expect(el().querySelector('mg-onglet-donnees')).not.toBeNull();
    for (const o of ['membres', 'donnees']) {
      el().querySelector<HTMLButtonElement>(`[data-onglet="${o}"]`)!.click();
      await harnais.fixture.whenStable();
    }
    // Aperçu (T9) : un seul GET à la première ouverture, aucun aux ouvertures suivantes.
    el().querySelector<HTMLButtonElement>('[data-onglet="apercu"]')!.click();
    await harnais.fixture.whenStable();
    http.expectOne(`/api/admin/espaces/${A}/apercu`).flush({ jeux: { socle: [], proprietaire: [], partage: [] }, categories: [], nb_campagnes: 0 });
    await harnais.fixture.whenStable();
    expect(el().querySelector('mg-onglet-apercu')).not.toBeNull();
    for (const o of ['membres', 'apercu']) {
      el().querySelector<HTMLButtonElement>(`[data-onglet="${o}"]`)!.click();
      await harnais.fixture.whenStable();
    }
    el().querySelector<HTMLButtonElement>('[data-onglet="reglages"]')!.click();
    await harnais.fixture.whenStable();
    // Réglages (T10) : un seul GET de l'organisation, à la première ouverture.
    http.expectOne(`/api/admin/organizations/${A}`).flush({
      organization: { id: A, name: 'Espace A', description: null, active: true, config: {} },
    });
    await harnais.fixture.whenStable();
    expect(el().querySelector('mg-onglet-reglages')).not.toBeNull();
    for (const o of ['membres', 'reglages']) {
      el().querySelector<HTMLButtonElement>(`[data-onglet="${o}"]`)!.click();
      await harnais.fixture.whenStable();
    }
    http.expectNone(() => true);
    expect(el().querySelector('[role="tablist"]')!.textContent).toMatch(/Membres \(2\)\s*Données\s*Aperçu\s*Réglages/);
  });

  it('espace inconnu de la liste chargée : « Espace introuvable » et lien relatif « Retour », aucune lecture', async () => {
    const { harnais, http, el } = await monter();
    await harnais.navigateByUrl(`/espaces/${INCONNU}`, FicheEspaceComponent);
    await harnais.fixture.whenStable();
    expect(el().textContent).toContain('Espace introuvable');
    const retour = el().querySelector<HTMLAnchorElement>('a[data-retour]')!;
    expect(retour.textContent).toContain('Retour');
    expect(retour.getAttribute('href')).toBe('/espaces');
    http.expectNone(() => true);
  });

  it('liste encore en chargement : ni onglets ni lecture des membres, puis lecture dès que l\'espace est connu', async () => {
    const espaces = signal<EspaceResume[]>([]);
    const socle = signal<{ nb_jeux: number } | null>(null);
    const chargement = signal(true);
    const { harnais, http, el } = await monter({ espaces, socle, chargement, erreur: signal(null), recharger: vi.fn() });
    await harnais.navigateByUrl(`/espaces/${A}`, FicheEspaceComponent);
    await harnais.fixture.whenStable();
    expect(el().querySelector('[role="tablist"]')).toBeNull();
    expect(el().textContent).not.toContain('Espace introuvable');
    http.expectNone(`/api/admin/espaces/${A}/membres`);

    espaces.set([espace(A, 'Espace A', 2)]);
    socle.set({ nb_jeux: 3 });
    chargement.set(false);
    await harnais.fixture.whenStable();
    expect(el().querySelector('[role="tablist"]')).not.toBeNull();
    http.expectOne(`/api/admin/espaces/${A}/membres`).flush({ membres: [] });
  });

  it('lecture de la liste en échec : pas d\'onglets, pas de lecture des membres', async () => {
    const { harnais, http, el } = await monter({
      espaces: signal([]), socle: signal(null), chargement: signal(false), erreur: signal('Indisponible'), recharger: vi.fn(),
    });
    await harnais.navigateByUrl(`/espaces/${A}`, FicheEspaceComponent);
    await harnais.fixture.whenStable();
    expect(el().querySelector('[role="tablist"]')).toBeNull();
    http.expectNone(`/api/admin/espaces/${A}/membres`);
  });

  it('« Compte créé » survit à une relecture de la liste en échec : onglets et lien d\'usage unique restent', async () => {
    // jsdom n'implémente ni `showModal` ni `close`.
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      value: vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); }), configurable: true, writable: true,
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      value: vi.fn(function (this: HTMLDialogElement) {
        if (!this.hasAttribute('open')) return;
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      }), configurable: true, writable: true,
    });
    const LIEN = 'https://exemple.test/auth/v1/verify?token=usage-unique';
    const { harnais, http, el } = await monter('reel');
    TestBed.inject(EspacesEtatService).charger();
    http.expectOne('/api/admin/espaces').flush({ socle: { nb_jeux: 3 }, espaces: [espace(A, 'Espace A', 2)] });
    await harnais.navigateByUrl(`/espaces/${A}`, FicheEspaceComponent);
    http.expectOne(`/api/admin/espaces/${A}/membres`).flush({ membres: [] });
    await harnais.fixture.whenStable();

    el().querySelector<HTMLButtonElement>('[data-ajouter]')!.click();
    await harnais.fixture.whenStable();
    http.expectOne((r) => r.url === '/api/admin/users' && r.method === 'GET').flush([]);
    el().querySelector<HTMLButtonElement>('[data-mode="nouveau"]')!.click();
    await harnais.fixture.whenStable();
    const email = el().querySelector<HTMLInputElement>('[data-email]')!;
    email.value = 'nom@exemple.fr';
    email.dispatchEvent(new Event('input'));
    await harnais.fixture.whenStable();
    el().querySelector('form[data-nouveau]')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await harnais.fixture.whenStable();
    http.expectOne((r) => r.url === '/api/admin/users' && r.method === 'POST')
      .flush({ id: 'n1', email: 'nom@exemple.fr', setup_link: LIEN }, { status: 201, statusText: 'Created' });
    await harnais.fixture.whenStable();

    // L'ajout relit les membres et la liste de la page ; la liste échoue une fois.
    http.expectOne(`/api/admin/espaces/${A}/membres`).flush({ membres: [] });
    http.expectOne('/api/admin/espaces').flush({ error: 'Coupure' }, { status: 500, statusText: 'x' });
    await harnais.fixture.whenStable();

    expect(el().querySelector('[role="tablist"]')).not.toBeNull();
    expect(el().textContent).toContain('Compte créé');
    expect(el().querySelector<HTMLInputElement>('input[data-lien-secret]')!.value).toBe(LIEN);
  });
});
