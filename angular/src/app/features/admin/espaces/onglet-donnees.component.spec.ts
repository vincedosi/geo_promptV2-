import { Component, input, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { formaterNombre } from '../../../core/format/nombre';
import { ConfigService } from '../../../core/config/config.service';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { EspacesApi } from './data/espaces.api';
import { EspacesEtatService } from './etat/espaces-etat.service';
import { JeuxRecommandesComponent } from './jeux-recommandes.component';
import { OngletDonneesComponent } from './onglet-donnees.component';
import type { EspaceResume, JeuPourEspace, ReponseDonneesEspace, StatutJeu } from './logique/types';

const A = 'A';
const B = 'B';
const URL_DONNEES = `/api/admin/espaces/${A}/donnees`;

@Component({ imports: [OngletDonneesComponent], template: '<mg-onglet-donnees [espaceId]="id" />' })
class Hote { id = A; }

/** Le bloc « Sélection recommandée » a sa propre spec : ici, seulement sa présence et l'espace qu'il reçoit. */
@Component({ selector: 'mg-jeux-recommandes', template: '' })
class JeuxRecommandesFactice { readonly espaceId = input.required<string>(); }

function configurer(recharger: () => void) {
  TestBed.configureTestingModule({ providers: fournisseurs(recharger) });
  TestBed.overrideComponent(OngletDonneesComponent, {
    remove: { imports: [JeuxRecommandesComponent] },
    add: { imports: [JeuxRecommandesFactice] },
  });
}

function espace(id: string, nom: string, interne = false, actif = true): EspaceResume {
  return { id, nom, nom_affiche: nom, slug: nom, actif, interne, nb_membres: 1, nb_jeux_prives: 1, groupe_espace: null };
}

function jeu(id: string, nom: string, statut: StatutJeu, p: Partial<JeuPourEspace> = {}): JeuPourEspace {
  return {
    id, nom, statut, type: 'poi', categorie: null, nb_lignes: 12345, visibilite: statut === 'socle' ? 'socle' : 'privee',
    proprietaire: { id: B, nom_affiche: 'Espace B' }, partage_avec: [], ...p,
  };
}

function reponse(): ReponseDonneesEspace {
  return {
    espace: espace(A, 'Espace A'),
    jeux: [
      jeu('prop', 'MARQUEUR', 'proprietaire', { categorie: 'Lycées', type: 'panneaux' }),
      jeu('part', 'PARTAGE', 'partage'),
      jeu('soc', 'SOCLEJEU', 'socle'),
      jeu('nv', 'INVISIBLE', 'non_visible'),
    ],
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

function fournisseurs(recharger: () => void) {
  return [
    provideHttpClient(), provideHttpClientTesting(), EspacesApi, NotificationsService,
    provideRouter([{ path: 'espaces/:id', component: Hote }]),
    {
      provide: EspacesEtatService,
      useValue: { espaces: signal([espace(A, 'Espace A'), espace(B, 'Espace B'), espace('G', 'dentsu.explore (interne)', true), espace('I', 'Dormant', false, false)]), recharger },
    },
    { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
  ];
}

async function monter() {
  const recharger = vi.fn();
  configurer(recharger);
  const harnais = await RouterTestingHarness.create();
  const http = TestBed.inject(HttpTestingController);
  await harnais.navigateByUrl(`/espaces/${A}`, Hote);
  const el = harnais.routeNativeElement as HTMLElement;
  http.expectOne(URL_DONNEES).flush(reponse());
  await harnais.fixture.whenStable();
  return {
    harnais, http, el, recharger,
    ligne: (id: string) => el.querySelector<HTMLElement>(`[data-jeu="${id}"]`)!,
    action: (id: string) => el.querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!,
    confirmer: () => el.querySelector<HTMLButtonElement>('mg-confirmation button.confirmer')!,
    notifs: TestBed.inject(NotificationsService),
  };
}

describe('OngletDonneesComponent', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('un seul GET au montage ; une ligne par statut avec ses colonnes et ses actions', async () => {
    const { el, ligne, action } = await monter();
    const p = ligne('prop').textContent!;
    expect(p).toContain('MARQUEUR');
    expect(p).toContain('Panneaux');
    expect(p).toContain('Lycées');
    expect(p).toContain(formaterNombre(12345));
    expect(p).toContain('Propriétaire');
    expect(ligne('part').textContent).toContain('—');
    expect(ligne('part').textContent).toContain('Partagé');
    expect(ligne('soc').textContent).toContain('Socle');
    expect(ligne('nv').textContent).toContain('Non visible');
    expect(ligne('prop').textContent).toContain('Transférer…');
    expect(ligne('prop').textContent).toContain('Mettre au socle');
    expect(ligne('part').textContent).toContain('Retirer le partage');
    expect(ligne('nv').textContent).toContain('Partager avec cet espace');
    expect(action('soc')).toBeNull();
    expect(ligne('soc').querySelector('button')).toBeNull();
    expect(ligne('soc').textContent).toContain('Se règle dans le socle');
    expect(el.querySelectorAll('[data-jeu]').length).toBe(4);
  });

  it('le lien « Se règle dans le socle » pointe vers …/espaces/socle', async () => {
    const { ligne } = await monter();
    const a = ligne('soc').querySelector<HTMLAnchorElement>('a')!;
    expect(a.getAttribute('href')).toMatch(/\/espaces\/socle$/);
  });

  it('« Partager avec cet espace » : POST sans confirmation, notification, relecture et recharger', async () => {
    const { harnais, http, recharger, notifs, el } = await monter();
    const ok = vi.spyOn(notifs, 'success');
    el.querySelector<HTMLButtonElement>('[data-action="nv"]')!.click();
    await harnais.fixture.whenStable();
    const req = http.expectOne(`/api/admin/organizations/${A}/sources/assign`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ sourceId: 'nv' });
    req.flush({ success: true });
    await harnais.fixture.whenStable();
    expect(ok).toHaveBeenCalled();
    expect(recharger).toHaveBeenCalled();
    http.expectOne(URL_DONNEES).flush(reponse());
  });

  it('« Retirer le partage » : confirmation nommant l\'espace et le jeu, puis DELETE au même corps', async () => {
    const { harnais, el, http, action, confirmer, recharger, notifs } = await monter();
    const ok = vi.spyOn(notifs, 'success');
    action('part').click();
    await harnais.fixture.whenStable();
    expect(el.querySelector('mg-confirmation')!.textContent).toContain('Espace A ne verra plus « PARTAGE ».');
    confirmer().click();
    await harnais.fixture.whenStable();
    const req = http.expectOne(`/api/admin/organizations/${A}/sources/assign`);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toEqual({ sourceId: 'part' });
    req.flush({ success: true });
    await harnais.fixture.whenStable();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(recharger).toHaveBeenCalledTimes(1);
    http.expectOne(URL_DONNEES).flush(reponse());
  });

  it('« Mettre au socle » : confirmation puis PATCH { visibilite: socle }', async () => {
    const { harnais, el, http, confirmer, recharger, notifs } = await monter();
    const ok = vi.spyOn(notifs, 'success');
    el.querySelector<HTMLButtonElement>('[data-socle="prop"]')!.click();
    await harnais.fixture.whenStable();
    expect(el.querySelector('mg-confirmation')!.textContent).toContain('Il sera visible de tous les espaces clients.');
    confirmer().click();
    await harnais.fixture.whenStable();
    const req = http.expectOne('/api/admin/sources/prop');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ visibilite: 'socle' });
    req.flush({ success: true });
    await harnais.fixture.whenStable();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(recharger).toHaveBeenCalledTimes(1);
    http.expectOne(URL_DONNEES).flush(reponse());
  });

  it('« Transférer… » : liste des AUTRES espaces, confirmation nommant les deux, PATCH { organization_id } exact', async () => {
    const { harnais, el, http, action, confirmer, recharger, notifs } = await monter();
    const ok = vi.spyOn(notifs, 'success');
    action('prop').click();
    await harnais.fixture.whenStable();
    const dialogue = el.querySelector('mg-dialogue-transfert')!;
    const choix = [...dialogue.querySelectorAll<HTMLButtonElement>('[data-cible]')];
    expect(choix.map((b) => b.getAttribute('data-cible'))).toEqual([B, 'G', 'I']);
    expect(dialogue.querySelectorAll('[data-inactif]').length).toBe(1);
    expect(dialogue.querySelector('[data-cible="I"] [data-inactif]')!.textContent).toContain('Inactif');
    expect(dialogue.textContent).not.toContain('Espace A');
    expect(dialogue.textContent).toContain('dentsu.explore (interne)');
    choix[0].click();
    await harnais.fixture.whenStable();
    expect(el.querySelector('mg-dialogue-transfert')).toBeNull();
    expect(el.querySelector('mg-confirmation')!.textContent).toContain('« MARQUEUR » passera de Espace A à Espace B. Espace A ne le verra plus, sauf partage.');
    confirmer().click();
    await harnais.fixture.whenStable();
    const req = http.expectOne('/api/admin/sources/prop');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ organization_id: B });
    req.flush({ success: true });
    await harnais.fixture.whenStable();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(recharger).toHaveBeenCalledTimes(1);
    http.expectOne(URL_DONNEES).flush(reponse());
  });

  it('écriture en 500 : notification d erreur PUIS une relecture, sans recharger ; relecture en échec : tableau gardé', async () => {
    const { harnais, http, recharger, notifs, el } = await monter();
    const ko = vi.spyOn(notifs, 'error');
    el.querySelector<HTMLButtonElement>('[data-action="nv"]')!.click();
    await harnais.fixture.whenStable();
    http.expectOne(`/api/admin/organizations/${A}/sources/assign`).flush({ error: 'Refusé' }, { status: 500, statusText: 'x' });
    await harnais.fixture.whenStable();
    expect(ko).toHaveBeenCalledWith('Refusé');
    expect(recharger).not.toHaveBeenCalled();
    http.expectOne(URL_DONNEES).flush({ error: 'Panne' }, { status: 500, statusText: 'x' });
    await harnais.fixture.whenStable();
    expect(ko).toHaveBeenCalledWith('Panne');
    expect(el.querySelectorAll('[data-jeu]').length).toBe(4);
    expect(el.querySelector('[data-action="nv"]')!.hasAttribute('disabled')).toBe(false);
  });

  it('entre l écriture réussie et la fin de la relecture : boutons désactivés, aucun second envoi', async () => {
    const { harnais, http, el, action } = await monter();
    action('prop').click();
    await harnais.fixture.whenStable();
    el.querySelector<HTMLButtonElement>('mg-dialogue-transfert [data-cible="B"]')!.click();
    await harnais.fixture.whenStable();
    el.querySelector<HTMLButtonElement>('mg-confirmation button.confirmer')!.click();
    await harnais.fixture.whenStable();
    http.expectOne('/api/admin/sources/prop').flush({ success: true });
    await harnais.fixture.whenStable();
    const relecture = http.expectOne(URL_DONNEES);
    expect(action('prop').hasAttribute('disabled')).toBe(true);
    expect(el.querySelector('[data-action="nv"]')!.hasAttribute('disabled')).toBe(true);
    action('prop').click();
    el.querySelector<HTMLButtonElement>('[data-action="nv"]')!.click();
    await harnais.fixture.whenStable();
    expect(el.querySelector('mg-dialogue-transfert')).toBeNull();
    http.expectNone(() => true);
    relecture.flush(reponse());
    await harnais.fixture.whenStable();
    expect(action('prop').hasAttribute('disabled')).toBe(false);
  });

  it('lecture en échec : message et « Réessayer »', async () => {
    configurer(vi.fn());
    const harnais = await RouterTestingHarness.create();
    const http = TestBed.inject(HttpTestingController);
    await harnais.navigateByUrl(`/espaces/${A}`, Hote);
    http.expectOne(URL_DONNEES).flush({ error: 'Panne' }, { status: 500, statusText: 'x' });
    await harnais.fixture.whenStable();
    const el = harnais.routeNativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('Panne');
    el.querySelector<HTMLButtonElement>('[data-reessayer]')!.click();
    http.expectOne(URL_DONNEES).flush(reponse());
  });

  it('le bloc « Sélection recommandée » est sous le tableau, avec espaceId', async () => {
    const { harnais, el } = await monter();
    const bloc = harnais.fixture.debugElement.query(By.directive(JeuxRecommandesFactice));
    expect(bloc).not.toBeNull();
    expect((bloc.componentInstance as JeuxRecommandesFactice).espaceId()).toBe(A);
    const cadre = el.querySelector('.cadre')!;
    expect(cadre.compareDocumentPosition(bloc.nativeElement as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('le bloc « Sélection recommandée » reste rendu quand le tableau est en erreur, et pendant le squelette', async () => {
    configurer(vi.fn());
    const harnais = await RouterTestingHarness.create();
    const http = TestBed.inject(HttpTestingController);
    await harnais.navigateByUrl(`/espaces/${A}`, Hote);
    expect(harnais.fixture.debugElement.query(By.directive(JeuxRecommandesFactice))).not.toBeNull();
    http.expectOne(URL_DONNEES).flush({ error: 'Panne' }, { status: 500, statusText: 'x' });
    await harnais.fixture.whenStable();
    const el = harnais.routeNativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    const bloc = harnais.fixture.debugElement.query(By.directive(JeuxRecommandesFactice));
    expect(bloc).not.toBeNull();
    expect((bloc.componentInstance as JeuxRecommandesFactice).espaceId()).toBe(A);
  });
});
