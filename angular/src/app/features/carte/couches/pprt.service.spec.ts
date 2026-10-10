import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { Subject } from 'rxjs';
import { FABRIQUE_POPUP } from '../../../carte/fabrique-carte';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarteApi, type CollectionPprt } from '../data/carte.api';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { RisqueCarteService } from '../etat/risque-carte.service';
import { COUCHE_PPRT_CONTOUR, COUCHE_PPRT_FOND, SOURCE_PPRT } from './couche-risques';
import { PprtService } from './pprt.service';

class PopupFactice {
  contenu: HTMLElement | null = null;
  constructor(readonly options: maplibregl.PopupOptions) {}
  setLngLat() { return this; }
  setDOMContent(n: HTMLElement) { this.contenu = n; return this; }
  addTo() { return this; }
  remove() { return this; }
}

const pprt = (n: number, total = n): CollectionPprt => ({
  type: 'FeatureCollection',
  features: Array.from({ length: n }, (_, i) => ({
    type: 'Feature', geometry: { type: 'Polygon', coordinates: [] },
    properties: { nom: `PPRT ${i}`, type_zone: 'enveloppe', superficie_km2: 1.234, code_departement: '13', nom_departement: 'Bouches-du-Rhône' },
  })),
  n_total: total, n_rendus: n,
});

function monter(zoom = 9) {
  const appels: { bbox: string; types: readonly string[]; limite?: number }[] = [];
  const reponses: Subject<CollectionPprt>[] = [];
  const popups: PopupFactice[] = [];
  const theme = signal({ contour: 'rgba(240,240,240,0.85)', fond: 'rgba(240,240,240,0.10)' });
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), PprtService, RisqueCarteService, CouchesCarteService,
      {
        provide: CarteApi,
        useValue: {
          pprt: (bbox: string, types: readonly string[], limite?: number) => {
            appels.push({ bbox, types, limite }); const s = new Subject<CollectionPprt>(); reponses.push(s); return s;
          },
        },
      },
      { provide: CouleursService, useValue: { palette: () => theme } },
      { provide: FABRIQUE_POPUP, useValue: (o: maplibregl.PopupOptions) => { const p = new PopupFactice(o); popups.push(p); return p; } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  carte.zoom = zoom;
  carte.cadre = [4.9, 43.3, 5.3, 43.6];
  const couches = TestBed.inject(CouchesCarteService);
  couches.publier(carte as unknown as maplibregl.Map);
  return { service: TestBed.inject(PprtService), etat: TestBed.inject(RisqueCarteService), couches, carte, appels, reponses, popups, theme };
}

describe('PprtService', () => {
  afterEach(() => vi.useRealTimers());

  it('éteinte (défaut) : aucune requête', () => {
    const { appels } = monter();
    TestBed.tick();
    expect(appels).toEqual([]);
  });

  it('sous z8 : ZÉRO requête, et l’état dit « sous le plancher » (bandeau du panneau)', () => {
    const { etat, appels } = monter(7.9);
    etat.pprtActif.set(true);
    TestBed.tick();
    expect(appels).toEqual([]);
    expect(etat.pprtEtat()).toEqual({ sousLePlancher: true, rendus: 0, total: 0 });
  });

  it('z8 et plus : bbox VISIBLE, sans `types` ni `limite` (comme React), couches au sommet en couleurs résolues', () => {
    const { etat, appels, reponses, carte } = monter(8);
    etat.pprtActif.set(true);
    TestBed.tick();
    expect(appels).toEqual([{ bbox: '4.9000,43.3000,5.3000,43.6000', types: [], limite: undefined }]);
    reponses[0].next(pprt(126, 130));
    TestBed.tick();
    expect(carte.ordreRendu()).toEqual([COUCHE_PPRT_FOND, COUCHE_PPRT_CONTOUR]);
    expect(carte.getLayer(COUCHE_PPRT_FOND)!['paint']).toEqual({ 'fill-color': 'rgba(240,240,240,0.10)', 'fill-opacity': 1 });
    expect((carte.getLayer(COUCHE_PPRT_CONTOUR)!['paint'] as Record<string, unknown>)['line-width'])
      .toEqual(['interpolate', ['linear'], ['zoom'], 8, 1.2000000000000002, 12, 1.5, 16, 2.0999999999999996]);
    expect(etat.pprtEtat()).toEqual({ sousLePlancher: false, rendus: 126, total: 130 });
  });

  it('natures choisies → `types` ; zoom arrière sous le plancher → source VIDÉE (pas supprimée), aucune requête', () => {
    vi.useFakeTimers();
    const { etat, appels, reponses, carte } = monter(9);
    etat.pprtActif.set(true);
    etat.pprtTypes.set(['enveloppe']);
    TestBed.tick();
    expect(appels[0].types).toEqual(['enveloppe']);
    reponses[0].next(pprt(3));
    carte.zoom = 6;
    carte.emettre('moveend');
    vi.advanceTimersByTime(350);
    expect(appels).toHaveLength(1);
    expect(carte.sources.has(SOURCE_PPRT)).toBe(true);
    expect(carte.sources.get(SOURCE_PPRT)!.donnees.at(-1)).toEqual({ type: 'FeatureCollection', features: [] });
    expect(etat.pprtEtat()!.sousLePlancher).toBe(true);
  });

  it('deux `moveend` rapprochés → une requête, la précédente annulée', () => {
    vi.useFakeTimers();
    const { etat, appels, reponses, carte } = monter(9);
    etat.pprtActif.set(true);
    TestBed.tick();
    carte.cadre = [5, 43.3, 5.4, 43.6];
    carte.emettre('moveend');
    vi.advanceTimersByTime(100);
    carte.emettre('moveend');
    vi.advanceTimersByTime(350);
    expect(appels).toHaveLength(2);
    expect(reponses[0].observed).toBe(false);
  });

  it('bascule de thème → `setPaintProperty`, aucun `addSource`, aucune requête', () => {
    const { etat, appels, reponses, carte, theme } = monter(9);
    etat.pprtActif.set(true);
    TestBed.tick();
    reponses[0].next(pprt(1));
    TestBed.tick();
    const nSources = carte.sources.size;
    carte.peintures.length = 0;
    theme.set({ contour: 'rgba(26,26,26,0.80)', fond: 'rgba(26,26,26,0.08)' });
    TestBed.tick();
    expect(appels).toHaveLength(1);
    expect(carte.sources.size).toBe(nSources);
    expect(carte.peintures).toEqual([
      { couche: COUCHE_PPRT_FOND, propriete: 'fill-color', valeur: 'rgba(26,26,26,0.08)' },
      { couche: COUCHE_PPRT_CONTOUR, propriete: 'line-color', valeur: 'rgba(26,26,26,0.80)' },
    ]);
  });

  it('carte recréée (B11) : re-posée sans nouvelle requête ; éteinte : tout retiré', () => {
    const { etat, appels, reponses, couches } = monter(9);
    etat.pprtActif.set(true);
    TestBed.tick();
    reponses[0].next(pprt(2));
    couches.publier(null);
    TestBed.tick();
    const neuve = new CarteFactice();
    neuve.styleCharge = true;
    neuve.zoom = 9;
    neuve.cadre = [4.9, 43.3, 5.3, 43.6];
    couches.publier(neuve as unknown as maplibregl.Map);
    TestBed.tick();
    expect(appels).toHaveLength(1);
    expect(neuve.ordreRendu()).toEqual([COUCHE_PPRT_FOND, COUCHE_PPRT_CONTOUR]);
    etat.pprtActif.set(false);
    TestBed.tick();
    expect(neuve.couches).toHaveLength(0);
    expect(neuve.sources.size).toBe(0);
    expect(neuve.nombreEcouteurs(`click:${COUCHE_PPRT_FOND}`)).toBe(0);
  });

  it('clic : popup de la servitude, avec la phrase qui empêche la confusion', () => {
    const { etat, reponses, carte, popups } = monter(9);
    etat.pprtActif.set(true);
    TestBed.tick();
    const c = pprt(1);
    reponses[0].next(c);
    TestBed.tick();
    carte.emettreSurCouche('click', COUCHE_PPRT_FOND, { features: [c.features[0]], lngLat: { lng: 5, lat: 43 } });
    const texte = popups[0].contenu!.textContent!;
    expect(texte).toContain('PPRT 0');
    expect(texte).toContain('Périmètre PPRT — servitude PM3');
    expect(texte).toContain('Enveloppe des zonages réglementaires');
    expect(texte).toContain('13 — Bouches-du-Rhône');
    expect(texte).toContain('1,234 km²');
    expect(texte).toContain('Périmètre réglementaire opposable');
  });

  it('échec : dit', () => {
    const { service, etat, reponses } = monter(9);
    etat.pprtActif.set(true);
    TestBed.tick();
    reponses[0].error(new HttpErrorResponse({ status: 400, error: { error: 'bbox invalide' } }));
    expect(service.erreur()).toBe('bbox invalide');
  });
});
