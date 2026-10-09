import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { formaterNombre } from '../../../core/format/nombre';
import { EspacesApi } from './data/espaces.api';
import { OngletApercuComponent } from './onglet-apercu.component';
import type { ApercuEspace, JeuDeDonnees } from './logique/types';

const A = 'A';
const URL_APERCU = `/api/admin/espaces/${A}/apercu`;

@Component({ imports: [OngletApercuComponent], template: '<mg-onglet-apercu [espaceId]="id" />' })
class Hote { id = A; }

function jeu(id: string, nom: string, p: Partial<JeuDeDonnees> = {}): JeuDeDonnees {
  return { id, nom, type: 'poi', categorie: null, nb_lignes: 12345, visibilite: 'privee', proprietaire: null, partage_avec: [], ...p };
}

function apercu(p: Partial<ApercuEspace> = {}): ApercuEspace {
  return {
    jeux: { socle: [jeu('s1', 'LYCEEE'), jeu('s2', 'FILOSOFI', { type: 'carreaux', nb_lignes: 2324577 })], proprietaire: [jeu('p1', 'CIRFA', { type: 'panneaux' })], partage: [] },
    categories: ['Lycées', 'Brest'],
    nb_campagnes: 7,
    ...p,
  };
}

function monter() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), EspacesApi, { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } }],
  });
  const fixture = TestBed.createComponent(Hote);
  fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController);
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, http, el, recalculer: () => el.querySelector<HTMLButtonElement>('[data-recalculer]')! };
}

describe('OngletApercuComponent', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('un seul GET au montage ; pendant la lecture : « Calcul de l\'aperçu… » et la barre active', async () => {
    const { fixture, http, el } = monter();
    const req = http.expectOne(URL_APERCU);
    await fixture.whenStable();
    expect(el.textContent).toContain("Calcul de l'aperçu…");
    expect(el.querySelector('[role="progressbar"]')!.getAttribute('aria-busy')).toBe('true');
    req.flush(apercu());
    await fixture.whenStable();
    expect(el.textContent).not.toContain("Calcul de l'aperçu…");
    http.expectNone(() => true);
  });

  it('rend l\'encart, les trois groupes, les catégories, le compteur de campagnes', async () => {
    const { fixture, http, el } = monter();
    http.expectOne(URL_APERCU).flush(apercu());
    await fixture.whenStable();
    expect(el.textContent).toContain("Ce que voit un compte client de cet espace, calculé par la même règle que la carte et les exports.");
    expect(el.textContent).toContain('Jeux de données visibles');
    const socle = el.querySelector<HTMLElement>('[data-groupe="socle"]')!;
    expect(socle.textContent).toContain('Du socle');
    expect(socle.textContent).toContain('LYCEEE');
    expect(socle.textContent).toContain('POI');
    expect(socle.textContent).toContain(formaterNombre(2324577));
    expect(el.querySelector('[data-groupe="proprietaire"]')!.textContent).toContain('Propres à l\'espace');
    expect(el.querySelector('[data-groupe="proprietaire"]')!.textContent).toContain('CIRFA');
    const partage = el.querySelector<HTMLElement>('[data-groupe="partage"]')!;
    expect(partage.textContent).toContain('Partagés avec l\'espace');
    expect(partage.textContent).toContain('Aucun');
    expect(el.textContent).toContain('Catégories de POI visibles (2)');
    expect([...el.querySelectorAll('[data-categorie]')].map((c) => c.textContent!.trim())).toEqual(['Lycées', 'Brest']);
    expect(el.textContent).toContain("Sans effectif : compter les POI d'une catégorie coûterait une lecture de la table entière.");
    expect(el.querySelector('[data-campagnes]')!.textContent).toContain('7');
  });

  it('aucune catégorie : « Aucune »', async () => {
    const { fixture, http, el } = monter();
    http.expectOne(URL_APERCU).flush(apercu({ categories: [] }));
    await fixture.whenStable();
    expect(el.textContent).toContain('Catégories de POI visibles (0)');
    expect(el.querySelector('[data-categories]')!.textContent).toContain('Aucune');
  });

  it('« Recalculer » : un second GET, le résultat remplace le premier', async () => {
    const { fixture, http, el, recalculer } = monter();
    http.expectOne(URL_APERCU).flush(apercu());
    await fixture.whenStable();
    recalculer().click();
    await fixture.whenStable();
    http.expectOne(URL_APERCU).flush(apercu({ categories: ['Lycées', 'Brest', 'BMW'] }));
    await fixture.whenStable();
    expect(el.textContent).toContain('Catégories de POI visibles (3)');
  });

  it('« Recalculer » pendant une lecture en vol : la première est annulée, sa réponse tardive ne gagne pas', async () => {
    const { fixture, http, el, recalculer } = monter();
    http.expectOne(URL_APERCU).flush(apercu());
    await fixture.whenStable();
    recalculer().click();
    await fixture.whenStable();
    const premiere = http.expectOne(URL_APERCU);
    recalculer().click();
    await fixture.whenStable();
    expect(premiere.cancelled).toBe(true);
    http.expectOne(URL_APERCU).flush(apercu({ nb_campagnes: 99 }));
    await fixture.whenStable();
    expect(el.querySelector('[data-campagnes]')!.textContent).toContain('99');
  });

  it('GET en 500 : message et « Réessayer », qui relit', async () => {
    const { fixture, http, el } = monter();
    http.expectOne(URL_APERCU).flush({ error: 'Panne' }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    const alerte = el.querySelector('[role="alert"]')!;
    expect(alerte.textContent).toContain('Panne');
    el.querySelector<HTMLButtonElement>('[data-reessayer]')!.click();
    await fixture.whenStable();
    http.expectOne(URL_APERCU).flush(apercu());
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.querySelector('[data-campagnes]')).not.toBeNull();
  });
});
