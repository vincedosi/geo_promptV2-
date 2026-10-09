import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { EspacesApi, type OrganisationComplete } from './data/espaces.api';
import { EspacesEtatService } from './etat/espaces-etat.service';
import type { EspaceResume } from './logique/types';
import { OngletReglagesComponent } from './onglet-reglages.component';

const A = 'A';
const URL_ORG = `/api/admin/organizations/${A}`;

@Component({ imports: [OngletReglagesComponent], template: '<mg-onglet-reglages [espaceId]="id" />' })
class Hote { id = A; }

@Component({ template: 'fiche vide' })
class Vide {}

function espace(id: string, nom: string, interne = false): EspaceResume {
  return { id, nom, nom_affiche: nom, slug: nom, actif: true, interne, nb_membres: 3, nb_jeux_prives: 2 };
}

function org(p: Partial<OrganisationComplete> = {}): { organization: OrganisationComplete } {
  return {
    organization: {
      id: A, name: 'Espace A', description: 'Une description', active: true,
      config: { autre: 1, max_poi: 500, max_ai_requests: null, site_centric_url: 'https://exemple.test', site_centric_key: 'cle-secrete' },
      ...p,
    },
  };
}

/** jsdom n'implémente ni `showModal` ni `close`. */
beforeEach(() => {
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
});

async function monter(interne = false, reponse: { organization: OrganisationComplete } | null = org()) {
  const recharger = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), EspacesApi, NotificationsService,
      provideRouter([{ path: 'espaces/:id', component: Hote }, { path: 'espaces', component: Vide }]),
      { provide: EspacesEtatService, useValue: { espaces: signal([espace(A, 'Espace A', interne)]), recharger } },
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  const harnais = await RouterTestingHarness.create();
  const http = TestBed.inject(HttpTestingController);
  await harnais.navigateByUrl(`/espaces/${A}`, Hote);
  const el = harnais.routeNativeElement as HTMLElement;
  if (reponse) {
    http.expectOne(URL_ORG).flush(reponse);
    await harnais.fixture.whenStable();
  }
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const saisir = async (s: string, v: string) => {
    const i = q<HTMLInputElement>(s);
    i.value = v;
    i.dispatchEvent(new Event('input', { bubbles: true }));
    await harnais.fixture.whenStable();
  };
  return {
    harnais, http, el, recharger, q, saisir,
    notifs: TestBed.inject(NotificationsService),
    attendre: () => harnais.fixture.whenStable(),
  };
}

describe('OngletReglagesComponent', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('un seul GET au montage ; les champs sont préremplis ; la clé est un champ mot de passe', async () => {
    const { q } = await monter();
    expect(q<HTMLInputElement>('[data-nom]').value).toBe('Espace A');
    expect(q<HTMLInputElement>('[data-description]').value).toBe('Une description');
    expect(q<HTMLInputElement>('[data-max-poi]').value).toBe('500');
    expect(q<HTMLInputElement>('[data-max-ai]').value).toBe('');
    expect(q<HTMLInputElement>('[data-site-url]').value).toBe('https://exemple.test');
    expect(q<HTMLInputElement>('[data-site-cle]').type).toBe('password');
    expect(q('[data-site-cle]').getAttribute('placeholder')).toBe("Clé d'API");
    expect(q('[data-site-url]').getAttribute('placeholder')).toBe('https://…');
  });

  it('enregistrer : PATCH au corps exact, config FUSIONNÉE (la clé « autre » survit), puis notification, relecture et recharger', async () => {
    const { harnais, http, q, saisir, notifs, recharger } = await monter();
    const ok = vi.spyOn(notifs, 'success');
    await saisir('[data-nom]', '  Nouveau nom ');
    await saisir('[data-description]', '');
    await saisir('[data-max-poi]', '1000');
    await saisir('[data-max-ai]', '12');
    await saisir('[data-site-url]', ' https://autre.test ');
    q<HTMLButtonElement>('[data-enregistrer]').click();
    const req = http.expectOne(URL_ORG);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({
      name: 'Nouveau nom',
      description: null,
      config: { autre: 1, site_centric_url: 'https://autre.test', site_centric_key: 'cle-secrete', max_poi: 1000, max_ai_requests: 12 },
    });
    req.flush({ success: true });
    await harnais.fixture.whenStable();
    expect(ok).toHaveBeenCalled();
    // La notification ne porte jamais la clé.
    expect(JSON.stringify(ok.mock.calls)).not.toContain('cle-secrete');
    expect(recharger).toHaveBeenCalled();
    http.expectOne(URL_ORG).flush(org({ name: 'Nouveau nom' }));
  });

  it('quota vide → null, « 12 » → 12', async () => {
    const { harnais, http, q, saisir } = await monter();
    await saisir('[data-max-poi]', '');
    await saisir('[data-max-ai]', '12');
    q<HTMLButtonElement>('[data-enregistrer]').click();
    const req = http.expectOne(URL_ORG);
    const config = (req.request.body as { config: Record<string, unknown> }).config;
    expect(config['max_poi']).toBeNull();
    expect(config['max_ai_requests']).toBe(12);
    req.flush({ success: true });
    await harnais.fixture.whenStable();
    http.expectOne(URL_ORG).flush(org());
  });

  it.each(['-1', '1.5', 'abc', '1e3', '12 000'])('quota « %s » : refusé en ligne, aucun PATCH', async (valeur) => {
    const { q, saisir, el, attendre } = await monter();
    await saisir('[data-max-poi]', valeur);
    q<HTMLButtonElement>('[data-enregistrer]').click();
    await attendre();
    expect(el.querySelector('[data-erreur-poi]')!.textContent).toContain('entier positif ou nul');
    // `afterEach` vérifie qu'aucune requête n'est partie.
  });

  it('un nom vide est refusé en ligne, aucun PATCH', async () => {
    const { q, saisir, attendre, el } = await monter();
    await saisir('[data-nom]', '   ');
    q<HTMLButtonElement>('[data-enregistrer]').click();
    await attendre();
    expect(el.querySelector('[data-erreur-nom]')!.textContent).toContain('obligatoire');
  });

  it("PATCH en 500 : notification d'erreur, pas de relecture, bouton de nouveau disponible", async () => {
    const { harnais, http, q, notifs, recharger } = await monter();
    const err = vi.spyOn(notifs, 'error');
    q<HTMLButtonElement>('[data-enregistrer]').click();
    http.expectOne(URL_ORG).flush({ error: 'Boom' }, { status: 500, statusText: 'Server Error' });
    await harnais.fixture.whenStable();
    expect(err).toHaveBeenCalledWith('Boom');
    expect(recharger).not.toHaveBeenCalled();
    expect(q<HTMLButtonElement>('[data-enregistrer]').disabled).toBe(false);
  });

  it("double envoi impossible pendant l'écriture", async () => {
    const { harnais, http, q } = await monter();
    const b = q<HTMLButtonElement>('[data-enregistrer]');
    b.click();
    await harnais.fixture.whenStable();
    expect(b.disabled).toBe(true);
    b.click();
    http.expectOne(URL_ORG).flush({ success: true });
    await harnais.fixture.whenStable();
    http.expectOne(URL_ORG).flush(org());
  });

  it('bascule « Espace actif » : PATCH { active: false } seul, puis relecture et recharger', async () => {
    const { harnais, http, q, recharger } = await monter();
    const sw = q<HTMLButtonElement>('[data-actif]');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    sw.click();
    const req = http.expectOne(URL_ORG);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ active: false });
    // Aucune mise à jour optimiste : l'interrupteur n'a pas bougé.
    expect(sw.getAttribute('aria-checked')).toBe('true');
    req.flush({ success: true });
    await harnais.fixture.whenStable();
    expect(recharger).toHaveBeenCalled();
    http.expectOne(URL_ORG).flush(org({ active: false }));
    await harnais.fixture.whenStable();
    expect(q('[data-actif]').getAttribute('aria-checked')).toBe('false');
  });

  it("bascule refusée par le serveur : l'interrupteur reste sur sa valeur, erreur notifiée", async () => {
    const { harnais, http, q, notifs } = await monter();
    const err = vi.spyOn(notifs, 'error');
    q<HTMLButtonElement>('[data-actif]').click();
    http.expectOne(URL_ORG).flush({ error: 'Refusé' }, { status: 500, statusText: 'x' });
    await harnais.fixture.whenStable();
    expect(q('[data-actif]').getAttribute('aria-checked')).toBe('true');
    expect(err).toHaveBeenCalledWith('Refusé');
    expect(q<HTMLButtonElement>('[data-actif]').disabled).toBe(false);
  });

  it('espace interne : aucun bouton de suppression, la mention le dit', async () => {
    const { el, q } = await monter(true);
    expect(el.querySelector('[data-supprimer]')).toBeNull();
    expect(q('[data-interne]').textContent).toContain("L'espace interne porte les données du socle : il ne se supprime pas.");
  });

  it("suppression : confirmation nommant l'espace, ses membres et ses jeux privés, puis DELETE et retour à la fiche vide", async () => {
    const { harnais, http, q, el, recharger, notifs } = await monter();
    const ok = vi.spyOn(notifs, 'success');
    q<HTMLButtonElement>('[data-supprimer]').click();
    await harnais.fixture.whenStable();
    expect(el.querySelector('mg-confirmation')!.textContent).toContain(
      'Supprimer Espace A ? Ses 3 membres en sont retirés ; ses 2 jeux privés deviennent sans propriétaire et ne sont plus visibles que du super-administrateur.',
    );
    el.querySelector<HTMLButtonElement>('mg-confirmation button.confirmer')!.click();
    const req = http.expectOne(URL_ORG);
    expect(req.request.method).toBe('DELETE');
    req.flush({ success: true });
    await harnais.fixture.whenStable();
    expect(ok).toHaveBeenCalled();
    expect(recharger).toHaveBeenCalled();
    expect(TestBed.inject(Router).url).toBe('/espaces');
  });

  it('suppression refusée : erreur notifiée, on reste sur la fiche', async () => {
    const { harnais, http, q, el, notifs } = await monter();
    const err = vi.spyOn(notifs, 'error');
    q<HTMLButtonElement>('[data-supprimer]').click();
    await harnais.fixture.whenStable();
    el.querySelector<HTMLButtonElement>('mg-confirmation button.confirmer')!.click();
    http.expectOne(URL_ORG).flush({ error: 'Non' }, { status: 500, statusText: 'x' });
    await harnais.fixture.whenStable();
    expect(err).toHaveBeenCalledWith('Non');
    expect(TestBed.inject(Router).url).toBe(`/espaces/${A}`);
  });

  it('lecture en échec : message et « Réessayer » qui relit', async () => {
    const { harnais, http, el, q } = await monter(false, null);
    http.expectOne(URL_ORG).flush({ error: 'Panne' }, { status: 500, statusText: 'x' });
    await harnais.fixture.whenStable();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('Panne');
    q<HTMLButtonElement>('[data-reessayer]').click();
    http.expectOne(URL_ORG).flush(org());
    await harnais.fixture.whenStable();
    expect(q<HTMLInputElement>('[data-nom]').value).toBe('Espace A');
  });
});
