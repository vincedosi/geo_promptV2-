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
      .toBe('1 layer non capturé : IRIS 132010101 (HTTP 500 {"error":"iris_failed"})');
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
        recette: { v: 1, type: 'capture', source_type: 'carreaux_filosofi' },
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

  const POIS = [{ poi_id: 'p1', poi_name: 'CIRFA Toulon', lat: 43.1, lng: 5.9 }];
  const anneau = (palier: number): GeoJSON.Feature => ({ type: 'Feature', geometry: CARRE, properties: { poi_id: 'p1', palier } });
  const BATAILLE: SourceCapture = {
    id: 'map-battle-isochrone', sourceType: 'isochrone_battle', label: 'Battle isochrones',
    metadata: {
      cache_key: 'battle_full__cirfa__drive__abc', poi_count: 1, pois: POIS, category: 'cirfa', mode: 'drive',
      battle_features: [anneau(15), anneau(5), anneau(10)],
    },
    obtenir: { route: 'battle', corps: () => ({ cache_keys: ['battle_full__cirfa__drive__abc'] }) },
  };

  it('lot 3 : une bataille capturée envoie une recette `isochrone` FIGÉE — ses paramètres scalaires et ses paliers en chaîne, jamais ses POI', async () => {
    const { el, api, stable } = monter({ sources: [BATAILLE] });
    await stable();
    nommer(el, 'bataille');
    await stable();
    el.querySelector<HTMLButtonElement>('[data-sauver]')!.click();
    await stable();
    const envoye = (api.capturer as ReturnType<typeof vi.fn>).mock.calls[0][0] as { recette: unknown; source_metadata: { pois: unknown } };
    expect(envoye.recette).toEqual({
      v: 1, type: 'isochrone',
      parametres: { cache_key: 'battle_full__cirfa__drive__abc', category: 'cirfa', mode: 'drive', paliers: '5,10,15', poi_count: 1 },
    });
    // Les POI restent dans `source_metadata` (et les sous-zones), pas dans la recette.
    expect(envoye.source_metadata.pois).toEqual(POIS);
  });

  it('lot 3 : une capture MIXTE (bataille + autre couche) envoie une recette `capture` composite — la forme n’est pas que des isochrones', async () => {
    const { el, api, stable } = monter({ sources: [BATAILLE, source('map-tmja-routes', 'tmja_routes', 'Flux routier', 'tmja')] });
    await stable();
    nommer(el, 'mixte');
    await stable();
    el.querySelector<HTMLButtonElement>('[data-sauver]')!.click();
    await stable();
    const envoye = (api.capturer as ReturnType<typeof vi.fn>).mock.calls[0][0] as { recette: unknown; source_type: string; source_metadata: { pois: unknown } };
    expect(envoye.source_type).toBe('composite');
    expect(envoye.recette).toEqual({ v: 1, type: 'capture', source_type: 'composite' });
    // La provenance de la bataille reste dans `source_metadata`.
    expect(envoye.source_metadata.pois).toEqual(POIS);
  });

  it('lot 3 : une bataille SANS POI retombe sur la recette `capture`', async () => {
    const sansPoi: SourceCapture = { ...BATAILLE, metadata: { cache_key: 'k', pois: [], battle_features: [] } };
    const { el, api, stable } = monter({ sources: [sansPoi] });
    await stable();
    nommer(el, 'vide');
    await stable();
    el.querySelector<HTMLButtonElement>('[data-sauver]')!.click();
    await stable();
    expect((api.capturer as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ recette: { v: 1, type: 'capture', source_type: 'isochrone_battle' } });
  });

  it('207 `recette_non_enregistree` : la zone existe (relue), l’avertissement de la route est affiché et le dialogue reste ouvert', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const capturer = vi.fn(() => of({ zone_id: 'z1', warning: 'recette_non_enregistree', message: 'Zone sauvegardée, mais sa recette n’a pas pu être enregistrée.', count_iris: 5, count_cp: 2 }));
      const { el, stable, cree, fermer } = monter({ capturer });
      await stable();
      nommer(el, 'x');
      await stable();
      el.querySelector<HTMLButtonElement>('[data-sauver]')!.click();
      await stable();
      expect(cree).toHaveBeenCalledTimes(1);
      expect(el.querySelector('[data-avertissement]')!.textContent!.trim()).toBe('Zone sauvegardée, mais sa recette n’a pas pu être enregistrée.');
      vi.advanceTimersByTime(5000);
      expect(fermer).not.toHaveBeenCalled();
      expect(el.querySelector<HTMLButtonElement>('[data-sauver]')!.disabled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('207 sans message : un repli selon l’avertissement', async () => {
    const capturer = vi.fn(() => of({ zone_id: 'z1', warning: 'zone_created_but_resolution_failed' }));
    const { el, stable } = monter({ capturer });
    await stable();
    nommer(el, 'x');
    await stable();
    el.querySelector<HTMLButtonElement>('[data-sauver]')!.click();
    await stable();
    expect(el.querySelector('[data-avertissement]')!.textContent!.trim()).toBe('Zone créée ; ses codes postaux n’ont pas pu être résolus.');
  });

  it('lot 3 : une capture de flux routier envoie une recette `capture` qui nomme sa source (Voronoï supprimé le 30/10/2026)', async () => {
    const { el, api, stable } = monter({ sources: [source('map-tmja-routes', 'tmja_routes', 'Flux routier', 'tmja')] });
    await stable();
    nommer(el, 'flux');
    await stable();
    el.querySelector<HTMLButtonElement>('[data-sauver]')!.click();
    await stable();
    expect((api.capturer as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      recette: { v: 1, type: 'capture', source_type: 'tmja_routes' },
    });
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
