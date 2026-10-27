import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, Subscription } from 'rxjs';
import { BatailleService } from '../couches/bataille.service';
import { IsochronesApi, type EvenementFlux } from '../data/isochrones.api';
import type { ContexteBataille } from '../logique/bataille/parametres';
import { BatailleV1Service } from './bataille-v1.service';
import { ContexteBatailleService } from './contexte-bataille.service';
import { CouchesCarteService } from './couches-carte.service';

const CTX: ContexteBataille = { categorie: 'cirfa', mode: 'drive', territoire: { ville: '', regions: [], depts: ['13'] }, nbRegionsRef: 18 };
const anneau = (id: string, palier: number): GeoJSON.Feature => ({
  type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43]]] },
  properties: { feature_type: 'ring', id, cirfa_id: id, nom: `CIRFA ${id}`, lat: 43.3, lng: 5.4, palier },
});

function monter() {
  const flux = { bataille: new Subject<EvenementFlux>(), appliquer: new Subject<EvenementFlux>() };
  const corps: Record<string, unknown[]> = { bataille: [], appliquer: [], verifierCache: [] };
  const cache = new Subject<unknown>();
  const api = {
    bataille: (c: unknown) => { corps['bataille'].push(c); return flux.bataille; },
    appliquer: (r: unknown) => { corps['appliquer'].push(r); return flux.appliquer; },
    verifierCache: (c: unknown) => { corps['verifierCache'].push(c); return cache; },
  };
  const bataille = { viderPartiels: vi.fn(), ajouterPartiels: vi.fn(), peindre: vi.fn(), retenir: vi.fn() };
  const contexte = {
    contexte: signal(CTX), unPoi: signal(true), regions: signal([]), afficherPois: vi.fn(), oublierRefus: vi.fn(),
    // La capacité en direct (T4) : par défaut, le calcul peut partir ; un test la remplace pour refuser.
    sousBorne: vi.fn((_c: unknown, _p: unknown, _n: (l: string) => void, suite: () => void) => { suite(); return Subscription.EMPTY; }),
  };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), BatailleV1Service, CouchesCarteService,
      { provide: IsochronesApi, useValue: api }, { provide: BatailleService, useValue: bataille },
      { provide: ContexteBatailleService, useValue: contexte },
    ],
  });
  return { v1: TestBed.inject(BatailleV1Service), flux, corps, cache, bataille, contexte, couches: TestBed.inject(CouchesCarteService) };
}

describe('BatailleV1Service (use-isochrone-battle.ts handleBattle / handleCheckORS + handleApplyBattle)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('vérifier le cache : le corps du territoire dérivé, le statut affiché', () => {
    const { v1, corps, cache } = monter();
    v1.verifierCache();
    expect(v1.verification()).toBe(true);
    expect(corps['verifierCache'][0]).toMatchObject({ category: 'cirfa', mode: 'drive', paliers: [10, 30], filtre_depts: ['13'] });
    cache.next({ total_pois: 2, total_combos: 4, cached_combos: 4, missing_combos: 0, missing_pois: 0, cached_pois: 2 });
    cache.complete();
    expect(v1.cache()).toMatchObject({ cached_combos: 4 });
    expect(v1.verification()).toBe(false);
  });

  it('lancer : corps exact, anneaux bruts sur la carte au fil du flux, journal, puis anneaux prêts pour la découpe', () => {
    const { v1, flux, corps, bataille, contexte } = monter();
    v1.lancer(false);
    expect(corps['bataille'][0]).toEqual({
      category: 'cirfa', mode: 'drive', max_minutes: 30, durations: [10, 30], filtre_ville: null, filtre_regions: null,
      filtre_depts: ['13'], metropolitaine: true, force_recalculate: false,
    });
    expect(bataille.viderPartiels).toHaveBeenCalled();
    expect(v1.journal().slice(0, 4)).toEqual(['> catégorie : cirfa', '> mode : drive | max : 30 min', '> territoire : 1 dept(s)', '> [1/3] vérification cache isochrones...']);
    flux.bataille.next({ type: 'pois_loaded', total: 2 });
    flux.bataille.next({ type: 'progress', completed: 1, total: 2 });
    expect(v1.total()).toBe(2);
    expect(v1.termines()).toBe(1);
    expect(v1.journal().filter((l) => l.includes('POIs'))).toEqual(['> 1/2 POIs traités — 50%']);
    flux.bataille.next({ type: 'partial_rings', rings: [{ cirfa_id: 'a', nom: 'A', lat: 1, lng: 2, palier: 10, geojson: {} }] });
    expect(bataille.ajouterPartiels).toHaveBeenCalledTimes(1);
    flux.bataille.next({ type: 'result', data: {
      battleGeoJSON: { type: 'FeatureCollection', features: [anneau('a', 10), anneau('b', 10)] },
      poisForMap: [{ id: 'a', nom: 'A', lat: 43, lng: 5 }, { id: 'b', nom: 'B', lat: 43.2, lng: 5.2 }], nb_pois: 2, battleCacheKey: 'battle_full__x',
    } });
    flux.bataille.complete();
    expect(v1.chargement()).toBe(false);
    expect(v1.progression()).toBe(100);
    expect(v1.anneauxDecoupe()).toHaveLength(2);
    expect(v1.meta()).toEqual({ categorie: 'cirfa', mode: 'drive' });
    expect(bataille.retenir).toHaveBeenCalledWith([{ id: 'a', nom: 'A', lat: 43, lng: 5, categorie: 'cirfa' }, { id: 'b', nom: 'B', lat: 43.2, lng: 5.2, categorie: 'cirfa' }], 'battle_full__x');
    expect(contexte.afficherPois).toHaveBeenCalledTimes(1);
    expect(v1.journal().at(-1)).toMatch(/^> ✓ 2 POIs — isochrones affichés \(\d+\.\ds\)$/);
  });

  it('erreur dans le flux : « > ✕ message », chargement rendu, ticker arrêté', () => {
    const { v1, flux } = monter();
    v1.lancer(false);
    vi.advanceTimersByTime(3000);
    expect(v1.journal()).toContain('> [2/3] appel ORS (peut prendre 30-120s)...');
    // L'API change l'événement `error` du flux en erreur de l'Observable (spec de `IsochronesApi`).
    flux.bataille.error(new Error('Moins de 2 POIs trouvés pour "cirfa"'));
    expect(v1.journal().at(-1)).toBe('> ✕ Moins de 2 POIs trouvés pour "cirfa"');
    expect(v1.chargement()).toBe(false);
    const n = v1.journal().length;
    vi.advanceTimersByTime(5000);
    expect(v1.journal().length).toBe(n);
  });

  it('appliquer : POST des anneaux, progression par étape, résultat peint avec ses bordures, ligne de succès', () => {
    const { v1, flux, corps, bataille } = monter();
    v1.lancer(false);
    flux.bataille.next({ type: 'result', data: { battleGeoJSON: { type: 'FeatureCollection', features: [anneau('a', 10)] }, poisForMap: [], nb_pois: 1 } });
    flux.bataille.complete();
    v1.appliquer();
    expect(corps['appliquer'][0]).toHaveLength(1);
    expect(v1.journal().at(-1)).toBe('> [BATAILLE] ST_Difference en cours…');
    flux.appliquer.next({ type: 'progress', step: 'battle', message: 'ST_Difference PostGIS (1 anneaux)…' });
    expect(v1.applicationPct()).toBe(50);
    expect(v1.journal().at(-1)).toBe('> ST_Difference PostGIS (1 anneaux)…');
    const bordures = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: { feature_type: 'border' } }] };
    flux.appliquer.next({ type: 'result', battleGeoJSON: { type: 'FeatureCollection', features: [anneau('a', 10)] }, battleBorders: bordures, nb_rings: 1, nb_borders: 1 });
    flux.appliquer.complete();
    expect(bataille.peindre).toHaveBeenCalledWith({ anneaux: [anneau('a', 10)], bordures: bordures.features, categorie: 'cirfa' });
    expect(v1.journal().slice(-2)).toEqual(['> 1 zones, 1 bordures', '> ✓ Territoires découpés sans chevauchement']);
    expect(v1.application()).toBe(false);
    expect(v1.applicationPct()).toBe(100);
  });

  /** Une bataille terminée puis une découpe en cours (revue 1). */
  function decoupeEnCours(m: ReturnType<typeof monter>) {
    m.v1.lancer(false);
    m.flux.bataille.next({ type: 'result', data: { battleGeoJSON: { type: 'FeatureCollection', features: [anneau('a', 10)] }, poisForMap: [], nb_pois: 1 } });
    m.flux.bataille.complete();
    m.v1.appliquer();
    expect(m.flux.appliquer.observed).toBe(true);
  }

  it('« Tout effacer » pendant une découpe : le flux de la découpe est annulé, rien n’est repeint (revue 1)', () => {
    const m = monter();
    decoupeEnCours(m);
    m.couches.toutEffacer();
    expect(m.flux.appliquer.observed).toBe(false);
    expect(m.v1.application()).toBe(false);
  });

  it('destruction de la page pendant une découpe : le flux est annulé (revue 1)', () => {
    const m = monter();
    decoupeEnCours(m);
    TestBed.resetTestingModule();
    expect(m.flux.appliquer.observed).toBe(false);
  });

  it('LANCER pendant une découpe annule la découpe : elle ne repeint pas la nouvelle bataille (revue 1)', () => {
    const m = monter();
    decoupeEnCours(m);
    m.flux.bataille = new Subject<EvenementFlux>();
    m.v1.lancer(false);
    expect(m.flux.appliquer.observed).toBe(false);
    expect(m.v1.application()).toBe(false);
  });

  it('« Tout effacer » annule le flux en cours et vide l’outil', () => {
    const { v1, flux, couches } = monter();
    v1.lancer(false);
    couches.toutEffacer();
    expect(flux.bataille.observed).toBe(false);
    expect(v1.chargement()).toBe(false);
    expect(v1.journal()).toEqual([]);
    expect(v1.anneauxDecoupe()).toEqual([]);
  });
});

const refuser = (contexte: { sousBorne: ReturnType<typeof vi.fn> }) => contexte.sousBorne.mockImplementation(
  (_c: unknown, _p: unknown, noter: (l: string) => void) => { noter('> ✕ Ce calcul dépasse'); return Subscription.EMPTY; });

describe('BatailleV1Service — capacité en direct sur la métropole (retours 26/10, T4)', () => {
  it('lancer passe par sousBorne ; un refus ne lance pas la bataille V1 (route protégée), noté au journal', () => {
    const { v1, corps, contexte } = monter();
    refuser(contexte);
    v1.lancer(false);
    expect(contexte.sousBorne).toHaveBeenCalledWith(CTX, [10, 30], expect.any(Function), expect.any(Function));
    expect(corps['bataille']).toEqual([]);
    expect(v1.journal()).toEqual(['> ✕ Ce calcul dépasse']);
    expect(v1.chargement()).toBe(false);
  });
});
