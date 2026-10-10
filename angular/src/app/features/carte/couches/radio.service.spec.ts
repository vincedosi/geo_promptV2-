import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { Subject } from 'rxjs';
import { FABRIQUE_POPUP } from '../../../carte/fabrique-carte';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { RadioApi, type ReponseOptionsRadio, type RequeteEmetteurs } from '../data/radio.api';
import { CouchesCarteService } from '../etat/couches-carte.service';
import {
  CADRE_FRANCE, COUCHE_CHALEUR, COUCHE_COMPTE, COUCHE_COUVERTURE_FOND, COUCHE_COUVERTURE_TRAIT, COUCHE_GRAPPES, COUCHE_POINTS,
  COUCHES_RADIO, SOURCE_COUVERTURE, SOURCE_EMETTEURS,
} from './couche-radio';
import { DELAI_DEPLACEMENT_MS, RadioService } from './radio.service';

class PopupFactice {
  contenu: Node | null = null;
  retiree = false;
  constructor(readonly options: maplibregl.PopupOptions) {}
  setLngLat() { return this; }
  setDOMContent(n: Node) { this.contenu = n; return this; }
  addTo() { return this; }
  remove() { this.retiree = true; return this; }
}

const TEAL = '#4ecdc4';
const SOMBRE = '#050505';

function monter() {
  const requetes: RequeteEmetteurs[] = [];
  const reponses: Subject<GeoJSON.FeatureCollection>[] = [];
  let lecturesOptions = 0;
  const options = new Subject<ReponseOptionsRadio>();
  const popups: PopupFactice[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), RadioService, CouchesCarteService,
      {
        provide: RadioApi,
        useValue: {
          emetteurs: (r: RequeteEmetteurs) => { requetes.push(r); const s = new Subject<GeoJSON.FeatureCollection>(); reponses.push(s); return s; },
          optionsFiltre: () => { lecturesOptions++; return options; },
        },
      },
      { provide: CouleursService, useValue: { palette: () => signal({ grappes: TEAL, texteGrappes: SOMBRE, cernes: SOMBRE, choisie: TEAL }) } },
      { provide: FABRIQUE_POPUP, useValue: (o: maplibregl.PopupOptions) => { const p = new PopupFactice(o); popups.push(p); return p; } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  carte.cadre = [5.1, 43.1, 5.6, 43.5];
  const couches = TestBed.inject(CouchesCarteService);
  couches.publier(carte as unknown as maplibregl.Map);
  return {
    radio: TestBed.inject(RadioService), couches, carte, requetes, reponses, options, popups,
    lecturesOptions: () => lecturesOptions,
  };
}

const point = (lng: number, lat: number, props: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: props,
});
const collection = (...f: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: f });
const visibilite = (c: CarteFactice, id: string) => (c.getLayer(id)!['layout'] as Record<string, unknown>)['visibility'];
const derniere = (c: CarteFactice, couche: string, prop: string) =>
  c.peintures.filter((p) => p.couche === couche && p.propriete === prop).at(-1)?.valeur;

describe('RadioService', () => {
  afterEach(() => vi.useRealTimers());

  it('éteint : aucune requête, rien de posé', () => {
    const { requetes, carte, lecturesOptions } = monter();
    TestBed.tick();
    expect(requetes).toEqual([]);
    expect(lecturesOptions()).toBe(0);
    expect(carte.sources.size).toBe(0);
  });

  it('afficher : la carte VISIBLE (jamais la France) ; options lues UNE fois, même après extinction et rallumage', () => {
    const { radio, requetes, options, lecturesOptions } = monter();
    radio.basculer();
    TestBed.tick();
    expect(requetes).toHaveLength(1);
    expect(requetes[0]).toEqual({
      radioId: null, couverture: false, bbox: [5.1, 43.1, 5.6, 43.5], systeme: '', radioIds: [], categoriesExclues: [],
    });
    options.next({ categories: [{ value: 'A', label: 'A' }], radios_with_emetteurs: [{ id: 'r1', nom: 'Radio 1', cat: 'B' }] });
    expect(radio.options()).toEqual({ categories: [{ value: 'A', label: 'A' }], radios: [{ id: 'r1', nom: 'Radio 1', cat: 'B' }] });
    radio.basculer();
    TestBed.tick();
    radio.basculer();
    TestBed.tick();
    expect(lecturesOptions()).toBe(1);
  });

  it('pose les deux sources et les six couches, à leur place ; clusters visibles, chaleur et couverture masquées', () => {
    const { radio, carte } = monter();
    radio.basculer();
    TestBed.tick();
    expect([...carte.sources.keys()]).toEqual([SOURCE_EMETTEURS, SOURCE_COUVERTURE]);
    expect(carte.ordreRendu()).toEqual([...COUCHES_RADIO]);
    expect(visibilite(carte, COUCHE_GRAPPES)).toBe('visible');
    expect(visibilite(carte, COUCHE_POINTS)).toBe('visible');
    expect(visibilite(carte, COUCHE_CHALEUR)).toBe('none');
    expect(visibilite(carte, COUCHE_COUVERTURE_FOND)).toBe('none');
  });

  it('aucune couleur var() n’entre dans MapLibre ; le sombre des cernes est le jeton invariant, le cœur de chaleur aussi', () => {
    const { radio, carte } = monter();
    radio.basculer();
    TestBed.tick();
    expect(JSON.stringify(carte.couches)).not.toContain('var(');
    const grappes = carte.getLayer(COUCHE_GRAPPES)!['paint'] as Record<string, unknown>;
    expect(grappes['circle-color']).toBe(TEAL);
    expect(grappes['circle-stroke-color']).toBe(SOMBRE);
    const chaleur = carte.getLayer(COUCHE_CHALEUR)!['paint'] as Record<string, unknown>;
    expect(chaleur['heatmap-color']).toEqual(['interpolate', ['linear'], ['heatmap-density'],
      0, 'rgba(78,205,196,0)', 0.15, 'rgba(78,205,196,0.15)', 0.35, 'rgba(78,205,196,0.35)', 0.6, 'rgba(78,205,196,0.6)',
      0.85, 'rgba(78,205,196,0.85)', 1, '#f0f0f0']);
  });

  it('la réponse alimente la source ; « N émetteurs » = nombre d’entités', () => {
    const { radio, carte, reponses } = monter();
    radio.basculer();
    TestBed.tick();
    const fc = collection(point(5.2, 43.2), point(5.3, 43.3));
    reponses[0].next(fc);
    TestBed.tick();
    expect(carte.sources.get(SOURCE_EMETTEURS)!.donnees.at(-1)).toBe(fc);
    expect(radio.compte()).toBe(2);
  });

  it('moveend : relu après 600 ms si la carte a bougé, jamais si elle est restée en place', () => {
    vi.useFakeTimers();
    const { radio, carte, requetes } = monter();
    radio.basculer();
    TestBed.tick();
    expect(requetes).toHaveLength(1);
    carte.emettre('moveend');
    vi.advanceTimersByTime(DELAI_DEPLACEMENT_MS);
    expect(requetes).toHaveLength(1);
    carte.cadre = [2.2, 48.8, 2.5, 49];
    carte.emettre('moveend');
    vi.advanceTimersByTime(DELAI_DEPLACEMENT_MS - 1);
    expect(requetes).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(requetes).toHaveLength(2);
    expect(requetes[1].bbox).toEqual([2.2, 48.8, 2.5, 49]);
  });

  it('choisir une radio : visible, tous SES émetteurs (sans bbox), cadrage, teal pour elle et gris pour les autres', () => {
    vi.useFakeTimers();
    const { radio, carte, requetes, reponses } = monter();
    radio.choisirRadio('r9', 'Radio Neuf');
    TestBed.tick();
    expect(radio.visible()).toBe(true);
    expect(requetes.at(-1)!.radioId).toBe('r9');
    reponses.at(-1)!.next(collection(point(1, 45, { radio_id: 'r9' }), point(3, 47, { radio_id: 'r9' })));
    TestBed.tick();
    expect(carte.cadrages.at(-1)).toEqual({ cadre: [[1, 45], [3, 47]], options: { padding: 40, duration: 1000 } });
    expect(derniere(carte, COUCHE_POINTS, 'circle-color')).toEqual(['case', ['==', ['get', 'radio_id'], 'r9'], TEAL, '#4b5563']);
    expect(derniere(carte, COUCHE_POINTS, 'circle-opacity')).toEqual(['case', ['==', ['get', 'radio_id'], 'r9'], 1, 0.35]);
    // une radio choisie : pas de relecture au déplacement
    carte.cadre = [2.2, 48.8, 2.5, 49];
    carte.emettre('moveend');
    vi.advanceTimersByTime(DELAI_DEPLACEMENT_MS);
    expect(requetes).toHaveLength(1);
    radio.oublierSelection();
    TestBed.tick();
    expect(requetes.at(-1)!.radioId).toBeNull();
    expect(derniere(carte, COUCHE_POINTS, 'circle-color')).toEqual(
      ['match', ['get', 'portee'], 'nationale', '#3b82f6', 'locale', '#22c55e', 'autoroute', '#eab308', '#6b7280'],
    );
  });

  it('couverture : lecture GLOBALE, cercles calculés côté client, couches de couverture visibles', () => {
    const { radio, carte, requetes, reponses } = monter();
    radio.basculer();
    radio.couverture.set(true);
    TestBed.tick();
    expect(requetes.at(-1)!.couverture).toBe(true);
    reponses.at(-1)!.next(collection(point(5, 45, { rayon_couverture_m: 20000 }), point(6, 45, { rayon_couverture_m: 50 })));
    TestBed.tick();
    const cercles = carte.sources.get(SOURCE_COUVERTURE)!.donnees.at(-1) as GeoJSON.FeatureCollection;
    expect(cercles.features).toHaveLength(1);
    expect((cercles.features[0].geometry as GeoJSON.Polygon).coordinates[0]).toHaveLength(65);
    expect(visibilite(carte, COUCHE_COUVERTURE_FOND)).toBe('visible');
    expect(visibilite(carte, COUCHE_COUVERTURE_TRAIT)).toBe('visible');
  });

  it('mode densité : grappes, compte et points masqués, carte de chaleur visible — ZÉRO requête', () => {
    const { radio, carte, requetes } = monter();
    radio.basculer();
    TestBed.tick();
    const avant = requetes.length;
    radio.densite.set(true);
    TestBed.tick();
    for (const id of [COUCHE_GRAPPES, COUCHE_COMPTE, COUCHE_POINTS]) expect(visibilite(carte, id), id).toBe('none');
    expect(visibilite(carte, COUCHE_CHALEUR)).toBe('visible');
    expect(requetes).toHaveLength(avant);
  });

  it('réglettes et couleur : setPaintProperty seulement — ZÉRO requête', () => {
    const { radio, carte, requetes } = monter();
    radio.basculer();
    radio.couverture.set(true);
    TestBed.tick();
    const avant = requetes.length;
    radio.opaciteCouverture.set(40);
    radio.contour.set(2);
    radio.taillePoints.set(9);
    radio.couleurCouverture.set('#ef4444');
    TestBed.tick();
    expect(requetes).toHaveLength(avant);
    expect(derniere(carte, COUCHE_COUVERTURE_FOND, 'fill-opacity')).toBe(0.4);
    expect(derniere(carte, COUCHE_COUVERTURE_FOND, 'fill-color')).toBe('#ef4444');
    expect(derniere(carte, COUCHE_COUVERTURE_TRAIT, 'line-opacity')).toBeCloseTo(0.6);
    expect(derniere(carte, COUCHE_COUVERTURE_TRAIT, 'line-width')).toBe(2);
    expect(derniere(carte, COUCHE_POINTS, 'circle-radius')).toBe(9);
  });

  it('un filtre (système, radios, catégories) relit les émetteurs', () => {
    const { radio, requetes } = monter();
    radio.basculer();
    TestBed.tick();
    radio.systeme.set('DAB+');
    radio.radioIds.set(['a']);
    radio.categoriesExclues.set(['D,E,P']);
    TestBed.tick();
    expect(requetes.at(-1)).toMatchObject({ systeme: 'DAB+', radioIds: ['a'], categoriesExclues: ['D,E,P'] });
  });

  it('clic sur une grappe : getClusterExpansionZoom (PROMESSE en MapLibre 5) puis zoom + 1', async () => {
    const { radio, carte } = monter();
    radio.basculer();
    TestBed.tick();
    carte.zoomExpansion = 8;
    carte.emettreSurCouche('click', COUCHE_GRAPPES, { features: [{ properties: { cluster_id: 42 } }], lngLat: { lng: 5, lat: 45 } });
    await Promise.resolve();
    await Promise.resolve();
    expect(carte.grappesDemandees).toEqual([42]);
    expect(carte.animations.at(-1)).toEqual({ center: { lng: 5, lat: 45 }, zoom: 9 });
  });

  it('clic sur un émetteur : popup construite par textContent ; « Tout effacer » la ferme', () => {
    const { radio, carte, couches, popups } = monter();
    radio.basculer();
    TestBed.tick();
    carte.emettreSurCouche('click', COUCHE_POINTS, {
      features: [{ properties: { radio_nom: '<b>NRJ</b>', systeme: 'FM', frequence_mhz: 100.3, puissance_w: 2500, rayon_couverture_m: 31000, commune: 'Marseille', departement: '13', portee: 'nationale', categorie_arcom: 'D' } }],
      lngLat: { lng: 5, lat: 45 },
    });
    const txt = (popups[0].contenu as HTMLElement).textContent;
    expect(txt).toContain('<b>NRJ</b>');
    expect(txt).toContain('Cat. D · Nationale');
    expect(txt).toContain('100.3 MHz');
    expect(txt).toContain('Puissance : 2.5 kW');
    expect(txt).toContain('Couverture : ~31 km');
    expect(txt).toContain('Marseille · Dept 13');
    couches.toutEffacer();
    expect(popups[0].retiree).toBe(true);
  });

  it('« Tout effacer » : éteint, sans densité ni couverture ni radio choisie, sources vidées, compte à 0', () => {
    const { radio, carte, couches, reponses } = monter();
    radio.choisirRadio('r1', 'Radio 1');
    radio.densite.set(true);
    radio.couverture.set(true);
    TestBed.tick();
    reponses.at(-1)!.next(collection(point(5, 45)));
    TestBed.tick();
    couches.toutEffacer();
    TestBed.tick();
    expect([radio.visible(), radio.densite(), radio.couverture(), radio.selection()]).toEqual([false, false, false, null]);
    expect(radio.compte()).toBe(0);
    expect(carte.sources.get(SOURCE_EMETTEURS)!.donnees.at(-1)).toEqual({ type: 'FeatureCollection', features: [] });
    expect(visibilite(carte, COUCHE_GRAPPES)).toBe('none');
  });

  it('un échec est DIT (React le taisait)', () => {
    const { radio, reponses } = monter();
    radio.basculer();
    TestBed.tick();
    reponses[0].error(new HttpErrorResponse({ status: 500, error: { error: 'boum' } }));
    expect(radio.erreur()).toBe('boum');
  });

  it('carte recréée (changement de fond, B11) : couches re-posées et émetteurs relus', () => {
    const { radio, couches, requetes } = monter();
    radio.basculer();
    TestBed.tick();
    couches.publier(null);
    TestBed.tick();
    const nouvelle = new CarteFactice();
    nouvelle.styleCharge = true;
    couches.publier(nouvelle as unknown as maplibregl.Map);
    TestBed.tick();
    expect(nouvelle.ordreRendu()).toEqual([...COUCHES_RADIO]);
    expect(requetes).toHaveLength(2);
  });

  it('« Recentrer France »', () => {
    const { radio, carte } = monter();
    radio.recentrerFrance();
    expect(carte.cadrages.at(-1)).toEqual({ cadre: CADRE_FRANCE, options: { padding: 20, duration: 1000 } });
  });
});
