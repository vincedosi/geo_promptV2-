import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { formaterNombre } from '../../../core/format/nombre';
import { ConfigService } from '../../../core/config/config.service';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { EspacesApi } from './data/espaces.api';
import { EspacesEtatService } from './etat/espaces-etat.service';
import { FicheSocleComponent } from './fiche-socle.component';
import type { EspaceResume, JeuDeDonnees, ReponseSocle } from './logique/types';

const URL_SOCLE = '/api/admin/espaces/socle';

function jeu(p: Partial<JeuDeDonnees> & { id: string; nom: string }): JeuDeDonnees {
  return {
    type: 'poi', categorie: null, nb_lignes: 1234, visibilite: 'privee',
    proprietaire: { id: 'o1', nom_affiche: 'Espace Un' }, partage_avec: [], ...p,
  };
}

function reponse(): ReponseSocle {
  return {
    nb_espaces_clients: 4,
    jeux: [
      jeu({ id: 'lycee', nom: 'LYCEEE', visibilite: 'socle', nb_lignes: 12345 }),
      jeu({ id: 'orphelin', nom: 'ORPHELIN', visibilite: 'socle', proprietaire: null }),
      jeu({ id: 'cirfa', nom: 'CIRFA', type: 'panneaux', visibilite: 'privee', proprietaire: { id: 'o2', nom_affiche: 'dentsu.explore (interne)' } }),
    ],
  };
}

const ESPACES: EspaceResume[] = [
  { id: 'o1', nom: 'Espace Un', nom_affiche: 'Espace Un', slug: 'un', actif: true, interne: false, nb_membres: 1, nb_jeux_prives: 1 },
  { id: 'o2', nom: 'genesis', nom_affiche: 'dentsu.explore (interne)', slug: 'genesis-global', actif: true, interne: true, nb_membres: 1, nb_jeux_prives: 1 },
];

/** jsdom n'implémente ni `showModal` ni `close` (patron de `dialogue-nouvel-espace.component.spec.ts`). */
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

async function monter(r: ReponseSocle = reponse()) {
  const recharger = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), EspacesApi, NotificationsService,
      { provide: EspacesEtatService, useValue: { espaces: signal(ESPACES), recharger } },
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
    ],
  });
  const f = TestBed.createComponent(FicheSocleComponent);
  const http = TestBed.inject(HttpTestingController);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  http.expectOne(URL_SOCLE).flush(r);
  await f.whenStable();
  return {
    f, el, http, recharger,
    section: (id: string) => el.querySelector<HTMLElement>(`[data-section="${id}"]`)!,
    bouton: (jeuId: string) => el.querySelector<HTMLButtonElement>(`[data-action="${jeuId}"]`)!,
    dialogue: () => el.querySelector('mg-confirmation')!,
    confirmer: () => el.querySelector<HTMLButtonElement>('mg-confirmation button.confirmer')!,
    notifs: TestBed.inject(NotificationsService),
  };
}

describe('FicheSocleComponent', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('un seul GET au montage ; LYCEEE sous « Dans le socle », CIRFA sous « Jeux privés »', async () => {
    const { el, section } = await monter();
    expect(el.textContent).toContain('Socle dentsu.explore');
    expect(el.textContent).toContain('Les jeux du socle sont visibles de tous les espaces, sans action.');
    expect(section('socle').textContent).toContain('Dans le socle (2)');
    expect(section('socle').textContent).toContain('LYCEEE');
    expect(section('socle').textContent).toContain('POI');
    expect(section('socle').textContent).toContain('Espace Un');
    expect(section('socle').textContent).toContain(formaterNombre(12345));
    expect(section('socle').textContent).not.toContain('CIRFA');
    expect(section('prives').textContent).toContain('Jeux privés (1)');
    expect(section('prives').textContent).toContain('CIRFA');
    expect(section('prives').textContent).toContain('Panneaux');
    expect(section('prives').textContent).toContain('dentsu.explore (interne)');
  });

  it('référentiels système : deux lignes en lecture seule', async () => {
    const { section } = await monter();
    const t = section('systeme').textContent!;
    expect(t).toContain('Référentiels système');
    expect(t).toContain('Arrêts de transport');
    expect(t).toContain('Installations classées (ICPE)');
    expect(t.match(/Référentiel système, toujours visible/g)).toHaveLength(2);
    expect(section('systeme').querySelector('button')).toBeNull();
  });

  it('« Retirer du socle » : confirmation citant les espaces clients (4 moins 1, le propriétaire en étant un), PATCH exact, relecture', async () => {
    const { f, el, http, recharger, bouton, dialogue, confirmer } = await monter();
    expect(el.querySelector('dialog')!.hasAttribute('open')).toBe(false);
    bouton('lycee').click();
    await f.whenStable();
    expect(dialogue().textContent).toContain('Retirer « LYCEEE » du socle ?');
    expect(dialogue().textContent).toContain('Il redeviendra privé à Espace Un. 3 espaces clients ne le verront plus.');
    expect(el.querySelector('dialog')!.hasAttribute('open')).toBe(true);
    confirmer().click();
    await f.whenStable();
    const req = http.expectOne('/api/admin/sources/lycee');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ visibilite: 'privee' });
    expect(dialogue().textContent).toContain('En cours...');
    req.flush({ success: true });
    await f.whenStable();
    http.expectOne(URL_SOCLE).flush({ ...reponse(), jeux: reponse().jeux.slice(1) });
    await f.whenStable();
    expect(recharger).toHaveBeenCalledTimes(1);
    expect(el.querySelector('dialog')!.hasAttribute('open')).toBe(false);
  });

  it('propriétaire interne : le décompte reste à 4 espaces clients', async () => {
    const r = reponse();
    r.jeux[0] = { ...r.jeux[0], proprietaire: { id: 'o2', nom_affiche: 'dentsu.explore (interne)' } };
    const { f, bouton, dialogue } = await monter(r);
    bouton('lycee').click();
    await f.whenStable();
    expect(dialogue().textContent).toContain('4 espaces clients ne le verront plus.');
  });

  it('« Mettre au socle » : confirmation par défaut, PATCH socle, notification de succès', async () => {
    const { f, http, bouton, dialogue, confirmer, notifs } = await monter();
    bouton('cirfa').click();
    await f.whenStable();
    expect(dialogue().textContent).toContain('Mettre « CIRFA » au socle ?');
    expect(dialogue().textContent).toContain('Il sera visible de tous les espaces clients.');
    confirmer().click();
    await f.whenStable();
    const req = http.expectOne('/api/admin/sources/cirfa');
    expect(req.request.body).toEqual({ visibilite: 'socle' });
    req.flush({ success: true });
    await f.whenStable();
    http.expectOne(URL_SOCLE).flush(reponse());
    expect(notifs.notifications()[0]).toMatchObject({ titre: 'Jeu mis au socle', variante: 'success' });
  });

  it('PATCH en 500 : notification d\'erreur « Refusé », aucune relecture, tableau inchangé, confirmation fermée', async () => {
    const { f, el, http, recharger, bouton, confirmer, section, notifs } = await monter();
    bouton('lycee').click();
    await f.whenStable();
    confirmer().click();
    await f.whenStable();
    http.expectOne('/api/admin/sources/lycee').flush({ error: 'Refusé' }, { status: 500, statusText: 'Server Error' });
    await f.whenStable();
    expect(notifs.notifications()[0]).toMatchObject({ titre: 'Refusé', variante: 'error' });
    http.expectNone(URL_SOCLE);
    expect(recharger).not.toHaveBeenCalled();
    expect(section('socle').textContent).toContain('LYCEEE');
    expect(el.querySelector('dialog')!.hasAttribute('open')).toBe(false);
  });

  it('jeu sans propriétaire : « Retirer du socle » désactivé avec son explication', async () => {
    const { bouton } = await monter();
    const b = bouton('orphelin');
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('title')).toBe('Ce jeu n\'a pas de propriétaire : il ne peut redevenir privé.');
    expect(bouton('lycee').disabled).toBe(false);
  });

  it('échec de la lecture : message du serveur et « Réessayer »', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), EspacesApi, NotificationsService,
        { provide: EspacesEtatService, useValue: { espaces: signal(ESPACES), recharger: vi.fn() } },
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      ],
    });
    const f = TestBed.createComponent(FicheSocleComponent);
    const http = TestBed.inject(HttpTestingController);
    await f.whenStable();
    http.expectOne(URL_SOCLE).flush({ error: 'Indisponible' }, { status: 500, statusText: 'x' });
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Indisponible');
    el.querySelector<HTMLButtonElement>('[data-reessayer]')!.click();
    await f.whenStable();
    http.expectOne(URL_SOCLE).flush(reponse());
  });
});
