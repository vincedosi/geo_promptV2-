import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { Subject } from 'rxjs';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { IrisApi } from '../data/iris.api';
import { ZonesCustomApi } from '../data/zones-custom.api';
import { ContoursZonesService } from '../etat/contours-zones.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { ZoneAnalyseeService } from '../etat/zone-analysee.service';
import type { ResultatCouverture } from '../logique/analyses/couverture';
import { COUCHES_COUVERTURE, COUCHE_COUVERTURE_CP_FOND, COUCHE_COUVERTURE_CP_SURVOL, COUCHE_COUVERTURE_ZONE, SOURCE_COUVERTURE_CP } from './couche-couverture';
import { CouvertureService } from './couverture.service';

const A = '0f8fad5b-d9cb-469f-a165-70867728950e';
const B = '1f8fad5b-d9cb-469f-a165-70867728950e';
const resultat = (zone_id: string, decoupage: ResultatCouverture['decoupage']): ResultatCouverture => ({
  zone_id, cible: 'ind', decoupage, surface_km2: 10, n_carreaux: 2, population: 30,
  lignes: decoupage === 'forme' ? [] : [{ code: '13100', nom: 'Aix', commune: null, n_carreaux: 2, pop_en_zone: 30, pop_totale: 30, part: 100 }],
  hors_territoire: { n_carreaux: 0, population: 0 }, n_territoires: decoupage === 'forme' ? 0 : 1, motif_vide: null,
  territoires_non_carroyes: [], reference: { source: 's', millesime: 2021, population_france: 63783569, n_carreaux_france: 2324577 },
  base_construite_le: '2026-10-22', calcule_le: '2026-10-22T10:00:00Z', cache: false,
});
const entite = (id: string) => ({ type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: [[[5, 43], [5.5, 43], [5.5, 43.5], [5, 43]]] }, properties: { id } });

function monter() {
  const zoneId = signal<string | null>(A);
  const res = signal<ResultatCouverture | null>(null);
  const geos: Array<{ id: string; s: Subject<ReturnType<typeof entite>> }> = [];
  const cps: Subject<GeoJSON.FeatureCollection>[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), CouvertureService, CouchesCarteService,
      { provide: ZoneAnalyseeService, useValue: { zoneId, resultat: res } },
      { provide: ZonesCustomApi, useValue: { geometrie: (id: string) => { const s = new Subject<ReturnType<typeof entite>>(); geos.push({ id, s }); return s; } } },
      { provide: ContoursZonesService, useValue: { zones: () => { const s = new Subject<GeoJSON.FeatureCollection>(); cps.push(s); return s; } } },
      { provide: IrisApi, useValue: { urlTuiles: () => 'http://h/api/tiles/iris/{z}/{x}/{y}?v=1' } },
      { provide: CouleursService, useValue: { palette: () => signal({ s1: 'a', s2: 'b', s3: 'c', s4: 'd', s5: 'e', absente: 'f', zone: 'g', trait: 'h', survol: 'i' }) } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  const couches = TestBed.inject(CouchesCarteService);
  couches.publier(carte as unknown as maplibregl.Map);
  const service = TestBed.inject(CouvertureService);
  TestBed.tick();
  return { service, carte, couches, zoneId, res, geos, cps };
}

describe('CouvertureService (lot 4, T8)', () => {
  it('sans résultat : rien n’est lu, rien n’est posé (ouvrir ④ ne lit rien)', () => {
    const m = monter();
    expect(m.geos).toEqual([]);
    expect(m.cps).toEqual([]);
    expect(m.carte.couches).toEqual([]);
    expect(m.service.affichee()).toBe(false);
  });

  it('un résultat CP : contour de la zone lu UNE fois et recadré, contours CP lus, couches posées', () => {
    const m = monter();
    m.res.set(resultat(A, 'cp'));
    TestBed.tick();
    expect(m.geos.map((g) => g.id)).toEqual([A]);
    expect(m.cps).toHaveLength(1);
    m.geos[0].s.next(entite(A));
    m.cps[0].next({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null as unknown as GeoJSON.Geometry, properties: { code: '13100' } }] });
    m.cps[0].complete();
    TestBed.tick();
    expect(m.carte.cadrages).toHaveLength(1);
    expect(m.carte.getLayer(COUCHE_COUVERTURE_CP_FOND)).toBeDefined();
    expect(m.carte.getLayer(COUCHE_COUVERTURE_ZONE)).toBeDefined();
    expect(m.service.affichee()).toBe(true);
    // Un second chiffrage de la même zone ne relit ni le contour ni les CP.
    m.res.set({ ...resultat(A, 'cp'), cache: true });
    TestBed.tick();
    expect(m.geos).toHaveLength(1);
    expect(m.cps).toHaveLength(1);
  });

  it('changement de zone : couches de l’ancienne retirées, sa lecture en vol jetée, aucun recadrage sur elle', () => {
    const m = monter();
    m.res.set(resultat(A, 'forme'));
    TestBed.tick();
    // La page efface le résultat en changeant de zone (ZoneAnalyseeService.choisir).
    m.zoneId.set(B);
    m.res.set(null);
    TestBed.tick();
    for (const id of COUCHES_COUVERTURE) expect(m.carte.getLayer(id)).toBeUndefined();
    expect(m.geos[0].s.observed).toBe(false);
    m.res.set(resultat(B, 'forme'));
    TestBed.tick();
    expect(m.geos.map((g) => g.id)).toEqual([A, B]);
    m.geos[1].s.next(entite(B));
    TestBed.tick();
    expect(m.carte.cadrages).toHaveLength(1);
  });

  it('survol : la surbrillance suit le code, et repart de rien à chaque résultat', () => {
    const m = monter();
    m.res.set(resultat(A, 'cp'));
    TestBed.tick();
    m.cps[0].next({ type: 'FeatureCollection', features: [] });
    TestBed.tick();
    m.service.survoler('13100');
    TestBed.tick();
    expect(m.carte.getLayer(COUCHE_COUVERTURE_CP_SURVOL)!['filter']).toEqual(['==', ['get', 'code'], '13100']);
    m.res.set({ ...resultat(A, 'cp') });
    TestBed.tick();
    expect(m.service.survole()).toBeNull();
  });

  it('« Tout effacer » masque la couche ; le chiffrage suivant la ré-affiche', () => {
    const m = monter();
    m.res.set(resultat(A, 'forme'));
    TestBed.tick();
    m.geos[0].s.next(entite(A));
    TestBed.tick();
    m.couches.toutEffacer();
    TestBed.tick();
    expect(m.carte.getLayer(COUCHE_COUVERTURE_ZONE)).toBeUndefined();
    expect(m.service.affichee()).toBe(false);
    m.res.set({ ...resultat(A, 'forme') });
    TestBed.tick();
    expect(m.carte.getLayer(COUCHE_COUVERTURE_ZONE)).toBeDefined();
  });

  it('IRIS sous z9 : « Zoomez » ; au-dessus, non — l’écouteur de zoom est retiré à la destruction', () => {
    const m = monter();
    m.carte.zoom = 7;
    m.carte.emettre('zoomend');
    m.res.set(resultat(A, 'iris'));
    TestBed.tick();
    expect(m.service.irisSousLeZoom()).toBe(true);
    m.carte.zoom = 10;
    m.carte.emettre('zoomend');
    expect(m.service.irisSousLeZoom()).toBe(false);
    expect(m.carte.nombreEcouteurs('zoomend')).toBe(1);
    TestBed.resetTestingModule();
    expect(m.carte.nombreEcouteurs('zoomend')).toBe(0);
    expect(m.carte.sources.has(SOURCE_COUVERTURE_CP)).toBe(false);
  });
});
