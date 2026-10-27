import { CaptureService } from '../../etat/capture.service';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, Subscription } from 'rxjs';
import { BatailleService } from '../../couches/bataille.service';
import { IsochronesApi, type EvenementFlux } from '../../data/isochrones.api';
import { BatailleV1Service } from '../../etat/bataille-v1.service';
import { ContexteBatailleService } from '../../etat/contexte-bataille.service';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { OutilIsochronesComponent } from './outil-isochrones.component';

const CTX = { categorie: 'cirfa', mode: 'drive', territoire: { ville: '', regions: [], depts: ['13'] }, nbRegionsRef: 18 };
const anneau: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { feature_type: 'ring', id: 'a', nom: 'A', lat: 43, lng: 5, palier: 10 } };

async function monter() {
  const flux = new Subject<EvenementFlux>();
  TestBed.configureTestingModule({
    providers: [CaptureService, 
      BatailleV1Service, BatailleService, CouchesCarteService,
      { provide: IsochronesApi, useValue: {
        bataille: () => flux,
        verifierCache: () => of({ total_pois: 2, total_combos: 4, cached_combos: 4, missing_combos: 0, missing_pois: 0, cached_pois: 2 }),
      } },
      { provide: ContexteBatailleService, useValue: { contexte: signal(CTX), unPoi: signal(true), regions: signal([]), afficherPois: vi.fn(),
        oublierRefus: vi.fn(), sousBorne: (_c: unknown, _p: unknown, _n: unknown, suite: () => void) => { suite(); return Subscription.EMPTY; } } },
    ],
  });
  const fixture = TestBed.createComponent(OutilIsochronesComponent);
  fixture.componentRef.setInput('ouvert', true);
  const emis: string[] = [];
  fixture.componentInstance.basculer.subscribe(() => emis.push('basculer'));
  fixture.componentInstance.verifierCache.subscribe(() => emis.push('verifierCache'));
  fixture.componentInstance.lancer.subscribe((f) => emis.push(`lancer:${f}`));
  fixture.componentInstance.appliquer.subscribe(() => emis.push('appliquer'));
  const el = fixture.nativeElement as HTMLElement;
  await fixture.whenStable();
  return { fixture, el, emis, flux, v1: TestBed.inject(BatailleV1Service), bataille: TestBed.inject(BatailleService) };
}

const bouton = (el: HTMLElement, sel: string) => el.querySelector<HTMLButtonElement>(sel)!;

describe('OutilIsochronesComponent (IsochronesTool.tsx, T17)', () => {
  it('entête « Isochrones routiers (ORS) », durées 5 à 120 min, défaut 10 et 30, textes exacts', async () => {
    const { el } = await monter();
    expect(bouton(el, '[data-entete-outil]').textContent).toContain('Isochrones routiers (ORS)');
    expect([...el.querySelectorAll('[data-duree]')].map((b) => b.textContent!.trim())).toEqual(['5 min', '10 min', '15 min', '20 min', '30 min', '60 min', '90 min', '120 min']);
    expect(el.textContent).toContain('Temps de trajet — 10, 30 min');
    expect(el.textContent).toContain('Anneaux concentriques — calculé via ORS directement, sans IA');
    expect(['VÉRIFIER CACHE', 'LANCER', 'RECALCULER'].map((t) => el.textContent!.includes(t))).toEqual([true, true, true]);
  });

  it('les boutons ÉMETTENT le lancement (le panneau garde) : vérifier, lancer, recalculer', async () => {
    const { el, emis, fixture } = await monter();
    bouton(el, '[data-verifier-cache]').click();
    bouton(el, '[data-lancer]').click();
    bouton(el, '[data-recalculer]').click();
    bouton(el, '[data-entete-outil]').click();
    await fixture.whenStable();
    expect(emis).toEqual(['verifierCache', 'lancer:false', 'lancer:true', 'basculer']);
  });

  it('aucune durée : les trois boutons sont désactivés', async () => {
    const { el, fixture, v1 } = await monter();
    v1.basculerDuree(10);
    v1.basculerDuree(30);
    await fixture.whenStable();
    expect(['[data-verifier-cache]', '[data-lancer]', '[data-recalculer]'].map((s) => bouton(el, s).disabled)).toEqual([true, true, true]);
  });

  it('statut du cache : « 2 POIs · 4 isochrones », « ✓ 100% en cache », « 4/4 en cache »', async () => {
    const { el, fixture, v1 } = await monter();
    v1.verifierCache();
    await fixture.whenStable();
    const s = el.querySelector('[data-statut-cache]')!.textContent!;
    expect(s).toContain('2 POIs · 4 isochrones');
    expect(s).toContain('✓ 100% en cache');
    expect(s).toContain('4/4 en cache');
  });

  it('bataille rendue : bouton « X BATAILLE (ST_Difference) » qui émet ; « Masquer les isochrones » et « Voronoï »', async () => {
    const { el, fixture, v1, flux, emis, bataille } = await monter();
    v1.lancer(false);
    flux.next({ type: 'result', data: { battleGeoJSON: { type: 'FeatureCollection', features: [anneau] }, poisForMap: [], nb_pois: 1 } });
    flux.complete();
    await fixture.whenStable();
    expect(el.querySelector('[data-journal]')!.textContent).toContain('> ✓ 1 POIs — isochrones affichés');
    bouton(el, '[data-appliquer]').click();
    expect(bouton(el, '[data-appliquer]').textContent!.trim()).toBe('X BATAILLE (ST_Difference)');
    expect(emis).toEqual(['appliquer']);
    expect(bataille.visible()).toBe(true);
    bouton(el, '[data-contour]').click();
    await fixture.whenStable();
    expect(bataille.contourVisible()).toBe(true);
    expect(bouton(el, '[data-contour]').textContent!.trim()).toBe('Voronoï ✓');
    bouton(el, '[data-masquer]').click();
    await fixture.whenStable();
    expect(bataille.visible()).toBe(false);
    expect(el.querySelector('[data-journal]')).toBeNull();
  });
});
