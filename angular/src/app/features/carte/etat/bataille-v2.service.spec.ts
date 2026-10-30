import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, Subscription } from 'rxjs';
import { BatailleService } from '../couches/bataille.service';
import { IsochronesApi, type EvenementFlux } from '../data/isochrones.api';
import type { ContexteBataille } from '../logique/bataille/parametres';
import { BatailleV2Service } from './bataille-v2.service';
import { ContexteBatailleService } from './contexte-bataille.service';
import { CouchesCarteService } from './couches-carte.service';
import { ZoneAnalyseeService } from './zone-analysee.service';

const CTX: ContexteBataille = { categorie: 'cirfa', mode: 'drive', territoire: { ville: '', regions: [], depts: ['13'] }, nbRegionsRef: 18 };
const STATUT_MANQUANT = { total_pois: 2, total_combos: 14, cached_combos: 7, missing_combos: 7, missing_pois: 1, cached_pois: 1 };
const anneau: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { id: 'a', nom: 'A', palier: 10 } };

function monter() {
  const flux = { batailleV2: [] as Subject<EvenementFlux>[], bataille: [] as Subject<EvenementFlux>[] };
  const caches: Subject<unknown>[] = [];
  const corps: Record<string, unknown[]> = { batailleV2: [], bataille: [], verifierCache: [] };
  const api = {
    batailleV2: (c: unknown) => { corps['batailleV2'].push(c); const s = new Subject<EvenementFlux>(); flux.batailleV2.push(s); return s; },
    remplirCache: (c: unknown) => { corps['bataille'].push(c); const s = new Subject<EvenementFlux>(); flux.bataille.push(s); return s; },
    verifierCache: (c: unknown) => { corps['verifierCache'].push(c); const s = new Subject<unknown>(); caches.push(s); return s; },
  };
  const bataille = { viderPartiels: vi.fn(), ajouterPartiels: vi.fn(), appliquer: vi.fn() };
  const contexte = {
    contexte: signal(CTX), unPoi: signal(true), regions: signal([]), afficherPois: vi.fn(), oublierRefus: vi.fn(),
    // La capacité en direct (T4) : par défaut, le calcul peut partir ; un test la remplace pour refuser.
    sousBorne: vi.fn((_c: unknown, _p: unknown, _n: (l: string) => void, suite: () => void) => { suite(); return Subscription.EMPTY; }),
  };
  // ④ finitions (T7) : la zone analysée de ④ ; aucune par défaut — la bataille garde alors son corps d'avant.
  const zoneId = signal<string | null>(null);
  const siIntrouvable = vi.fn((e: unknown) => {
    const oui = (e as { error?: { refus?: string } }).error?.refus === 'zone_introuvable';
    if (oui) zoneId.set(null);
    return oui;
  });
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), BatailleV2Service, CouchesCarteService,
      { provide: IsochronesApi, useValue: api }, { provide: BatailleService, useValue: bataille },
      { provide: ContexteBatailleService, useValue: contexte },
      { provide: ZoneAnalyseeService, useValue: { zoneId, siIntrouvable } },
    ],
  });
  return { v2: TestBed.inject(BatailleV2Service), flux, caches, corps, bataille, contexte, zoneId, siIntrouvable };
}

describe('BatailleV2Service (use-isochrone-battle.ts handleCheckV2 / handleFillMissingV2 / handleBattleV2)', () => {
  it('sept paliers par défaut ; en basculer un oublie le statut du cache', () => {
    const { v2, caches } = monter();
    expect(v2.paliers()).toEqual([10, 20, 30, 40, 50, 60, 90]);
    v2.verifierCache();
    caches[0].next(STATUT_MANQUANT);
    expect(v2.cache()).toEqual(STATUT_MANQUANT);
    v2.basculerPalier(90);
    expect(v2.paliers()).toEqual([10, 20, 30, 40, 50, 60]);
    expect(v2.cache()).toBeNull();
  });

  it('lancer : corps V2 exact, journal, résultat appliqué au créneau (sans clé), POI de la bataille affichés', () => {
    const { v2, flux, corps, bataille, contexte } = monter();
    v2.lancer(false);
    expect(corps['batailleV2'][0]).toEqual({
      category: 'cirfa', mode: 'drive', filtre_ville: undefined, filtre_regions: undefined, filtre_depts: ['13'],
      metropolitaine: true, paliers: [10, 20, 30, 40, 50, 60, 90], force_battle: false,
    });
    expect(v2.journal()).toEqual(['> catégorie : cirfa', '> mode : drive | paliers : 10, 20, 30, 40, 50, 60, 90 min', '> lecture cache isochrones...']);
    flux.batailleV2[0].next({ type: 'rings_loaded', count: 14, missing: 0 });
    const pois = [{ id: 'a', nom: 'A', lat: 43, lng: 5 }];
    flux.batailleV2[0].next({ type: 'result', data: { battleGeoJSON: { type: 'FeatureCollection', features: [anneau] }, poisForMap: pois } });
    flux.batailleV2[0].complete();
    expect(bataille.appliquer).toHaveBeenCalledWith({ anneaux: [anneau], pois: [{ ...pois[0], categorie: 'cirfa' }], cle: null, categorie: 'cirfa' });
    expect(contexte.afficherPois).toHaveBeenCalled();
    expect(v2.journal().slice(-2)).toEqual(['> 14 anneaux en cache (0 manquants)', '> ✓ Bataille v2 affichée sur la carte']);
    expect(v2.chargement()).toBe(false);
  });

  it('③ finitions (T4) : la clé de la route (périmètre de l’appelant) est posée sur le créneau — la capture la lit', () => {
    const { v2, flux, bataille } = monter();
    v2.lancer(false);
    const cle = 'battle_v2_full__cirfa__drive__10-20-30-40-50-60-90min__metro__d13__pabc';
    flux.batailleV2[0].next({ type: 'result', data: { battleGeoJSON: { type: 'FeatureCollection', features: [anneau] }, poisForMap: [], battleCacheKey: cle } });
    flux.batailleV2[0].complete();
    expect(bataille.appliquer).toHaveBeenCalledWith(expect.objectContaining({ cle }));
  });

  it('③ finitions (T4) : une clé vide ou absente pose `null` (rien de capturable)', () => {
    const { v2, flux, bataille } = monter();
    v2.lancer(false);
    flux.batailleV2[0].next({ type: 'result', data: { battleGeoJSON: { type: 'FeatureCollection', features: [anneau] }, poisForMap: [], battleCacheKey: '' } });
    flux.batailleV2[0].complete();
    expect(bataille.appliquer).toHaveBeenCalledWith(expect.objectContaining({ cle: null }));
  });

  it('réponse sans résultat : « > ✕ Réponse incomplète »', () => {
    const { v2, flux } = monter();
    v2.lancer(false);
    flux.batailleV2[0].complete();
    expect(v2.journal().at(-1)).toBe('> ✕ Réponse incomplète');
  });

  it('la V2 enchaînée après le remplissage garde le territoire du LANCEMENT, même si le filtre a changé (revue 1)', () => {
    const { v2, flux, caches, corps, contexte } = monter();
    v2.remplir();
    contexte.contexte.set({ ...CTX, territoire: { ville: '', regions: [], depts: [] } });
    flux.bataille[0].complete();
    caches[0].complete();
    expect(corps['verifierCache'][0]).toMatchObject({ filtre_depts: ['13'] });
    expect(corps['batailleV2'][0]).toMatchObject({ filtre_depts: ['13'] });
  });

  it('remplir : flux ORS lu, cache revérifié, puis bataille V2 lancée d’elle-même', () => {
    const { v2, flux, caches, corps, bataille } = monter();
    v2.verifierCache();
    caches[0].next(STATUT_MANQUANT);
    caches[0].complete();
    v2.remplir();
    expect(v2.cache()).toBeNull();
    expect(bataille.viderPartiels).toHaveBeenCalled();
    expect(corps['bataille'][0]).toMatchObject({ durations: [10, 20, 30, 40, 50, 60, 90], max_minutes: 90, force_recalculate: false, filtre_depts: ['13'] });
    flux.bataille[0].next({ type: 'pois_loaded', total: 2 });
    flux.bataille[0].next({ type: 'partial_rings', rings: [{}, {}, {}] });
    flux.bataille[0].next({ type: 'progress', completed: 1, total: 2 });
    expect(v2.remplissageTotal()).toBe(2);
    expect(v2.remplissageTermines()).toBe(1);
    expect(v2.remplissagePct()).toBe(50);
    expect(v2.remplissageAnneaux()).toBe(3);
    flux.bataille[0].complete();
    expect(v2.journal()).toContain('> ✓ Cache rempli (3 isochrones) — lancement Bataille V2...');
    expect(corps['verifierCache']).toHaveLength(2);
    caches[1].next({ ...STATUT_MANQUANT, missing_combos: 0, missing_pois: 0 });
    caches[1].complete();
    expect(v2.remplissage()).toBe(false);
    expect(corps['batailleV2']).toHaveLength(1);
  });
});

const refuser = (contexte: { sousBorne: ReturnType<typeof vi.fn> }) => contexte.sousBorne.mockImplementation(
  (_c: unknown, _p: unknown, noter: (l: string) => void) => { noter('> ✕ Ce calcul dépasse'); return Subscription.EMPTY; });

describe('BatailleV2Service — capacité en direct sur la métropole (retours 26/10, T4)', () => {
  it('lancer et remplir passent par sousBorne, sur le contexte et les paliers du clic', () => {
    const { v2, contexte } = monter();
    v2.lancer(false);
    expect(contexte.sousBorne).toHaveBeenCalledWith(CTX, [10, 20, 30, 40, 50, 60, 90], expect.any(Function), expect.any(Function));
    v2.remplir();
    expect(contexte.sousBorne).toHaveBeenCalledTimes(2);
  });

  it('un refus ne lance ni la V2 ni le remplissage ORS ; il est noté au journal', () => {
    const { v2, corps, contexte } = monter();
    refuser(contexte);
    v2.lancer(false);
    v2.remplir();
    expect(corps['batailleV2']).toEqual([]);
    expect(corps['bataille']).toEqual([]);
    expect(v2.journal()).toEqual(['> ✕ Ce calcul dépasse', '> ✕ Ce calcul dépasse']);
    expect(v2.chargement()).toBe(false);
    expect(v2.remplissage()).toBe(false);
  });
});

/** ④ finitions (T7, A-6) : « Sur : la zone analysée » — la bataille V2 lit les POI DANS la zone. */
describe('BatailleV2Service — sur la zone analysée', () => {
  const Z = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const CORPS_1 = {
    category: 'cirfa', mode: 'drive', filtre_ville: undefined, filtre_regions: undefined, filtre_depts: ['13'],
    metropolitaine: true, paliers: [10, 20, 30, 40, 50, 60, 90], force_battle: false,
  };

  it('avec une zone, « Sur : la zone » par défaut : zone_id, aucun filtre région, département ou ville, aucun comptage', () => {
    const { v2, corps, contexte, zoneId } = monter();
    zoneId.set(Z);
    expect(v2.zoneBataille()).toBe(Z);
    v2.lancer(true);
    expect(corps['batailleV2'][0]).toEqual({ category: 'cirfa', mode: 'drive', paliers: [10, 20, 30, 40, 50, 60, 90], force_battle: true, zone_id: Z });
    expect(contexte.sousBorne).not.toHaveBeenCalled();
  });

  it('« Sur : le périmètre de ① » : le corps d’aujourd’hui, octet pour octet', () => {
    const { v2, corps, zoneId } = monter();
    zoneId.set(Z);
    v2.surZone.set(false);
    expect(v2.zoneBataille()).toBeNull();
    v2.lancer(false);
    expect(JSON.stringify(corps['batailleV2'][0])).toBe(JSON.stringify(CORPS_1));
  });

  it('une réponse arrivée après un changement de zone est jetée : le flux est désabonné, rien n’est peint', () => {
    const { v2, flux, bataille, zoneId } = monter();
    zoneId.set(Z);
    TestBed.tick();
    v2.lancer(false);
    expect(flux.batailleV2[0].observed).toBe(true);
    zoneId.set('1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed');
    TestBed.tick();
    expect(flux.batailleV2[0].observed).toBe(false);
    expect(v2.chargement()).toBe(false);
    expect(bataille.appliquer).not.toHaveBeenCalled();
  });

  it('404 zone_introuvable (corps texte du flux) : la zone quitte ④, le journal dit la phrase', () => {
    const { v2, flux, zoneId, siIntrouvable } = monter();
    zoneId.set(Z);
    TestBed.tick();
    v2.lancer(false);
    flux.batailleV2[0].error(new HttpErrorResponse({
      status: 404, error: JSON.stringify({ error: 'Zone introuvable dans cet espace.', refus: 'zone_introuvable' }),
    }));
    expect(siIntrouvable).toHaveBeenCalledTimes(1);
    expect(zoneId()).toBeNull();
    expect(v2.journal().at(-1)).toBe('> ✕ Zone introuvable dans cet espace.');
  });

  it('sur la zone, ni vérification du cache ni remplissage ORS (ils travaillent sur ①) : aucun appel', () => {
    const { v2, corps, zoneId } = monter();
    zoneId.set(Z);
    v2.verifierCache();
    v2.remplir();
    expect(corps['verifierCache']).toEqual([]);
    expect(corps['bataille']).toEqual([]);
  });
});
