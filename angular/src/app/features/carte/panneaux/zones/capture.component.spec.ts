import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { type RouteSourceCapture, ZonesCustomApi } from '../../data/zones-custom.api';
import { ZonesApi } from '../../data/zones.api';
import { AnnonceService } from '../../etat/annonce.service';
import { CaptureService, type SourceCapture } from '../../etat/capture.service';
import { CreationZoneService } from '../../etat/creation-zone.service';
import { CaptureComponent } from './capture.component';

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    value: vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); }), configurable: true, writable: true,
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    value: vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); }), configurable: true, writable: true,
  });
});

const CARRE: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[5, 43], [6, 43], [6, 44], [5, 43]]] };
const attendre = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const source = (id: string, sourceType: string, label: string, route: RouteSourceCapture): SourceCapture => ({
  id, sourceType, label, metadata: { m: id }, obtenir: { route, corps: () => ({ c: id }) },
});

function monter(o: { sources?: SourceCapture[]; source?: unknown; capturer?: unknown; organisation?: string | null } = {}) {
  const api = {
    source: o.source ?? vi.fn(() => of({ geometry: CARRE })),
    capturer: o.capturer ?? vi.fn(() => of({ count_iris: 12, count_cp: 3 })),
  };
  TestBed.configureTestingModule({
    providers: [
      CaptureService, CreationZoneService, AnnonceService,
      { provide: ZonesCustomApi, useValue: api },
      { provide: ZonesApi, useValue: {} },
      { provide: AuthService, useValue: { lireProfil: async () => ({ role: null, nom: null, organisation: o.organisation === undefined ? 'org-1' : o.organisation }) } },
    ],
  });
  const capture = TestBed.inject(CaptureService);
  for (const s of o.sources ?? [source('map-carreaux-filosofi', 'carreaux_filosofi', 'Carreaux 200m population_totale', 'carreaux')]) {
    capture.declarer(signal(s));
  }
  const fixture = TestBed.createComponent(CaptureComponent);
  const el = fixture.nativeElement as HTMLElement;
  const fermer = vi.fn();
  const cree = vi.fn();
  fixture.componentInstance.fermer.subscribe(fermer);
  fixture.componentInstance.cree.subscribe(cree);
  const stable = async () => { for (let i = 0; i < 3; i++) { await attendre(); await fixture.whenStable(); } };
  return { fixture, el, api, stable, fermer, cree, annonce: TestBed.inject(AnnonceService) };
}

const nommer = (el: HTMLElement, nom: string) => {
  const champ = el.querySelector<HTMLInputElement>('[data-nom]')!;
  champ.value = nom;
  champ.dispatchEvent(new Event('input'));
};

describe('CaptureComponent (CustomGeoCaptureModal.tsx)', () => {
  it('résout chaque couche par sa route, puis l’aperçu : couches, sommets, transformation, emprise', async () => {
    const { el, api, stable } = monter();
    await stable();
    expect(api.source).toHaveBeenCalledWith('carreaux', { c: 'map-carreaux-filosofi' });
    const lignes = [...el.querySelectorAll('[data-apercu] > div')].map((d) => d.textContent!.replace(/\s+/g, ' ').trim());
    expect(lignes).toEqual(['Layers : 1 · Vertices : 4', 'Transformation : union', 'Bbox : 5.000, 43.000 → 6.000, 44.000']);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
    expect([...el.querySelectorAll('[data-couche] > span')].map((c) => c.textContent!.trim()))
      .toEqual(['Carreaux 200m population_totale', 'carreaux_filosofi']);
    expect(el.querySelector('[data-source-type]')!.textContent).toContain('carreaux_filosofi');
  });

  it('une couche en échec n’empêche pas les autres : listée à part, annoncée, source_type « composite » sinon', async () => {
    const { el, stable, annonce } = monter({
      sources: [
        source('map-carreaux-filosofi', 'carreaux_filosofi', 'Carreaux 200m population_totale', 'carreaux'),
        source('map-iris-selection', 'iris_selection', 'IRIS 132010101', 'iris'),
      ],
      source: vi.fn((route: string) => (route === 'iris'
        ? throwError(() => new HttpErrorResponse({ status: 500, error: { error: 'iris_failed' } }))
        : of({ geometry: CARRE }))),
    });
    await stable();
    expect(el.querySelector('[data-echecs]')!.textContent!.replace(/\s+/g, ' ').trim())
      .toBe('1 layer non capture : IRIS 132010101 (HTTP 500 {"error":"iris_failed"})');
    expect(annonce.annonces().map((a) => a.texte)).toEqual(['1 layer indisponible — Capture possible avec les autres. Non récupérés : IRIS 132010101.']);
    expect(el.querySelectorAll('[data-couche]')).toHaveLength(1);
  });

  it('Sauvegarder : inactif sans nom ; puis le corps de React, « Zone sauvegardee — 12 IRIS, 3 CP resolus », fermeture à 2 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { el, api, stable, fermer, cree } = monter();
      await stable();
      const sauver = el.querySelector<HTMLButtonElement>('[data-sauver]')!;
      expect(sauver.disabled).toBe(true);
      nommer(el, '[ESSAI lot 4] capture');
      await stable();
      el.querySelector<HTMLButtonElement>('[data-transformation="convex_hull"]')!.click();
      await stable();
      sauver.click();
      await stable();
      expect(api.capturer).toHaveBeenCalledWith({
        name: '[ESSAI lot 4] capture', description: null, org_id: 'org-1', source_type: 'carreaux_filosofi',
        source_metadata: { contributing_layers: [{ id: 'map-carreaux-filosofi', source_type: 'carreaux_filosofi', label: 'Carreaux 200m population_totale', metadata: { m: 'map-carreaux-filosofi' } }] },
        geometries: [CARRE], transformation: 'convex_hull',
      });
      expect(el.querySelector('[data-succes]')!.textContent!.trim()).toBe('Zone sauvegardee — 12 IRIS, 3 CP resolus');
      expect(cree).toHaveBeenCalledTimes(1);
      expect(fermer).not.toHaveBeenCalled();
      vi.advanceTimersByTime(2000);
      expect(fermer).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refus de la route : son message dans le dialogue', async () => {
    const { el, stable } = monter({
      capturer: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'invalid_body', message: 'Corps invalide' } }))),
    });
    await stable();
    nommer(el, 'x');
    await stable();
    el.querySelector<HTMLButtonElement>('[data-sauver]')!.click();
    await stable();
    expect(el.querySelector('[data-erreur]')!.textContent!.trim()).toBe('Corps invalide');
  });

  it('sans organisation : l’avertissement de React, sauvegarde impossible', async () => {
    const { el, stable } = monter({ organisation: null });
    await stable();
    nommer(el, 'x');
    await stable();
    expect(el.textContent).toContain('Organisation non configurée');
    expect(el.querySelector<HTMLButtonElement>('[data-sauver]')!.disabled).toBe(true);
  });
});
