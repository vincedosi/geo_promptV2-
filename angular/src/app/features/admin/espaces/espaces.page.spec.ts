import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfigService } from '../../../core/config/config.service';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { EspacesApi } from './data/espaces.api';
import { EspacesPage } from './espaces.page';
import type { EspaceResume, ReponseEspaces } from './logique/types';
import { texte } from '../testing/dom';

@Component({ selector: 'mg-fiche-factice', template: '<p data-fiche>fiche</p>' })
class FicheFactice {}

const ROUTES_DE_TEST: Routes = [
  {
    path: 'admin',
    children: [
      {
        path: 'acces',
        component: EspacesPage,
        children: [
          { path: '', component: FicheFactice },
          { path: 'socle', component: FicheFactice },
          { path: 'comptes', component: FicheFactice },
          { path: ':id', component: FicheFactice },
        ],
      },
    ],
  },
];

const URL = '/api/admin/espaces';

function espace(p: Partial<EspaceResume> & { id: string; nom_affiche: string }): EspaceResume {
  return { nom: p.nom_affiche, slug: p.id, actif: true, interne: false, nb_membres: 0, nb_jeux_prives: 0, ...p };
}

/** Les espaces de la base locale (relevé SQL du 2026-10-09), tri du serveur : internes en dernier. */
function reponse(): ReponseEspaces {
  return {
    socle: { nb_jeux: 3 },
    espaces: [
      espace({ id: 'org-bmw', nom_affiche: 'BMW GROUP', nb_membres: 1, nb_jeux_prives: 2 }),
      espace({ id: 'org-drhat', nom_affiche: 'DRHAT', nb_membres: 0, nb_jeux_prives: 0, actif: false }),
      espace({ id: 'org-marine', nom_affiche: 'MARINE', nb_membres: 3, nb_jeux_prives: 1 }),
      espace({ id: 'org-int', nom: 'GENESIS (Global)', nom_affiche: 'dentsu.explore (interne)', slug: 'genesis-global', interne: true, nb_membres: 2 }),
    ],
    nb_comptes: 7,
  };
}

/** jsdom n'implémente ni `showModal` ni `close`. */
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); }, configurable: true, writable: true,
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    value: function (this: HTMLDialogElement) { this.removeAttribute('open'); }, configurable: true, writable: true,
  });
});

async function monter(url = '/admin/acces') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), EspacesApi, NotificationsService,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      provideRouter(ROUTES_DE_TEST),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  const http = TestBed.inject(HttpTestingController);
  const el = harness.fixture.nativeElement as HTMLElement;
  const stable = () => harness.fixture.whenStable();
  const charger = async (corps: ReponseEspaces = reponse()) => {
    http.expectOne(URL).flush(corps);
    await stable();
  };
  return { harness, http, el, stable, charger };
}

const liens = (el: HTMLElement) => [...el.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Accès"] a')];

describe('EspacesPage', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('montage → UN GET admin/espaces, aucun autre appel ; trois lignes squelettes pendant', async () => {
    const { http, el, stable } = await monter();
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.body).toBeNull();
    expect(el.querySelectorAll('[data-squelette]')).toHaveLength(3);
    req.flush(reponse());
    await stable();
    expect(el.querySelectorAll('[data-squelette]')).toHaveLength(0);
    // Passer d'une fiche à l'autre ne relit PAS la liste (la page, et son état, restent montés).
    await TestBed.inject(Router).navigateByUrl('/admin/acces/org-marine');
    await stable();
    http.expectNone(() => true);
  });

  it('rend « Socle dentsu.explore » en premier, « Tous les comptes » ensuite, « dentsu.explore (interne) » en dernier, et « {membres} · {jeux privés} »', async () => {
    const { el, charger } = await monter();
    await charger();
    const l = liens(el);
    expect(l).toHaveLength(6);
    expect(texte(l[0].querySelector('[data-nom]'))).toBe('Socle dentsu.explore');
    expect(texte(l[0].querySelector('[data-sous-ligne]'))).toBe('visible de tous · 3 jeux');
    expect(texte(l[5].querySelector('[data-nom]'))).toBe('dentsu.explore (interne)');
    const marine = l.find((a) => texte(a.querySelector('[data-nom]')) === 'MARINE')!;
    const compteurs = marine.querySelector('[data-compteurs]')!;
    expect(texte(compteurs)).toBe('3 · 1');
    expect(compteurs.getAttribute('title')).toBe('3 membres · 1 jeux privés');
    expect(texte(l[2].querySelector('[data-compteurs]'))).toBe('1 · 2');
  });

  it('la page s\'appelle « Accès » : titre et colonne', async () => {
    const { el, charger } = await monter();
    await charger();
    expect(texte(el.querySelector('h1'))).toBe('Accès');
    expect(el.querySelector('nav')!.getAttribute('aria-label')).toBe('Accès');
    expect(el.textContent).not.toContain('Espaces de travail');
  });

  it('« Tous les comptes » : sous le socle, avec le nombre de comptes (`nb_comptes`), lien RELATIF `comptes`', async () => {
    const { el, charger } = await monter();
    await charger();
    const comptes = liens(el)[1];
    expect(texte(comptes.querySelector('[data-nom]'))).toBe('Tous les comptes');
    expect(texte(comptes.querySelector('[data-compteurs]'))).toBe('7');
    expect(comptes.querySelector('[data-compteurs]')!.getAttribute('title')).toBe('7 comptes');
    expect(comptes.getAttribute('href')).toBe('/admin/acces/comptes');
  });

  it('sur `…/acces/comptes`, l\'entrée « Tous les comptes » est active (et elle seule)', async () => {
    const { el, charger } = await monter('/admin/acces/comptes');
    await charger();
    const actifs = liens(el).filter((a) => a.classList.contains('actif'));
    expect(actifs.map((a) => texte(a.querySelector('[data-nom]')))).toEqual(['Tous les comptes']);
  });

  it('un espace inactif porte la pastille « Inactif », les autres non', async () => {
    const { el, charger } = await monter();
    await charger();
    const l = liens(el);
    expect(texte(l[3].querySelector('[data-inactif]'))).toBe('Inactif');
    expect(l.filter((a) => a.querySelector('[data-inactif]'))).toHaveLength(1);
  });

  it('jamais « MAGELIAN » ni « GENESIS » dans le DOM', async () => {
    const { el, charger } = await monter();
    await charger();
    expect(el.textContent).not.toMatch(/MAGELIAN|GENESIS/);
  });

  it('flèche bas sur le socle → « Tous les comptes » → premier espace ; flèche haut sur le premier → reste ; bas sur le dernier → reste', async () => {
    const { el, charger } = await monter();
    await charger();
    const l = liens(el);
    l[0].focus();
    l[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(l[1]);
    l[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(l[2]);
    l[0].focus();
    const haut = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
    l[0].dispatchEvent(haut);
    expect(document.activeElement).toBe(l[0]);
    l[5].focus();
    l[5].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(l[5]);
    l[4].focus();
    const remonte = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
    l[4].dispatchEvent(remonte);
    expect(document.activeElement).toBe(l[3]);
    expect(remonte.defaultPrevented).toBe(true);
  });

  it('les liens sont RELATIFS à la route : `/admin/acces/socle` et `/admin/acces/<id>`', async () => {
    const { el, charger } = await monter();
    await charger();
    const l = liens(el);
    expect(l[0].getAttribute('href')).toBe('/admin/acces/socle');
    expect(l[2].getAttribute('href')).toMatch(/\/acces\/org-bmw$/);
  });

  it('sur `…/acces/<id-marine>`, la ligne MARINE est active (et elle seule)', async () => {
    const { el, charger } = await monter('/admin/acces/org-marine');
    await charger();
    const actifs = liens(el).filter((a) => a.classList.contains('actif'));
    expect(actifs.map((a) => texte(a.querySelector('[data-nom]')))).toEqual(['MARINE']);
    expect(actifs[0].getAttribute('aria-current')).toBe('page');
  });

  it('GET en 500 → message d\'erreur + « Réessayer » qui relance le GET', async () => {
    const { el, http, stable, charger } = await monter();
    http.expectOne(URL).flush({ error: 'Base indisponible' }, { status: 500, statusText: 'Server Error' });
    await stable();
    const alerte = el.querySelector('[role="alert"]')!;
    expect(texte(alerte)).toContain('Base indisponible');
    expect(liens(el)).toHaveLength(0);
    const bouton = [...alerte.querySelectorAll('button')].find((b) => texte(b) === 'Réessayer')!;
    bouton.click();
    await stable();
    await charger();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(liens(el)).toHaveLength(6);
  });

  it('« + Nouvel espace » ouvre le dialogue ; création → notification « Espace créé », liste relue, navigation vers l\'espace, dialogue fermé', async () => {
    const { el, http, stable, charger } = await monter();
    await charger();
    const nouvel = el.querySelector<HTMLButtonElement>('[data-nouvel-espace]')!;
    expect(texte(nouvel)).toBe('+ Nouvel espace');
    expect(el.querySelector('mg-dialogue-nouvel-espace')).toBeNull();
    nouvel.click();
    await stable();
    expect(el.querySelector('mg-dialogue-nouvel-espace dialog[open]')).not.toBeNull();
    const nom = el.querySelector<HTMLInputElement>('mg-dialogue-nouvel-espace [data-nom]')!;
    nom.value = 'Nouvel espace';
    nom.dispatchEvent(new Event('input'));
    await stable();
    el.querySelector('mg-dialogue-nouvel-espace form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    http.expectOne('/api/admin/organizations').flush({ success: true, organization: { id: 'org-neuf' } });
    await stable();
    const corps = reponse();
    corps.espaces.unshift(espace({ id: 'org-neuf', nom_affiche: 'Nouvel espace' }));
    await charger(corps);
    expect(TestBed.inject(Router).url).toBe('/admin/acces/org-neuf');
    expect(el.querySelector('mg-dialogue-nouvel-espace')).toBeNull();
    expect(TestBed.inject(NotificationsService).notifications().map((n) => n.titre)).toEqual(['Espace créé']);
    expect(liens(el).find((a) => a.classList.contains('actif'))?.getAttribute('href')).toBe('/admin/acces/org-neuf');
  });

  it('description non enregistrée → l\'espace est créé, la page le dit et relit la liste', async () => {
    const { el, http, stable, charger } = await monter();
    await charger();
    el.querySelector<HTMLButtonElement>('[data-nouvel-espace]')!.click();
    await stable();
    const nom = el.querySelector<HTMLInputElement>('mg-dialogue-nouvel-espace [data-nom]')!;
    nom.value = 'Nouvel espace';
    nom.dispatchEvent(new Event('input'));
    const desc = el.querySelector<HTMLTextAreaElement>('mg-dialogue-nouvel-espace [data-description]')!;
    desc.value = 'Texte';
    desc.dispatchEvent(new Event('input'));
    await stable();
    el.querySelector('mg-dialogue-nouvel-espace form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    http.expectOne('/api/admin/organizations').flush({ success: true, organization: { id: 'org-neuf' } });
    http.expectOne('/api/admin/organizations/org-neuf').flush({ error: 'boum' }, { status: 500, statusText: 'Server Error' });
    await stable();
    await charger();
    const n = TestBed.inject(NotificationsService).notifications();
    expect(n.map((x) => [x.titre, x.variante])).toEqual([['Espace créé, mais la description n\'a pas été enregistrée', 'warning']]);
    expect(TestBed.inject(Router).url).toBe('/admin/acces/org-neuf');
  });
});
