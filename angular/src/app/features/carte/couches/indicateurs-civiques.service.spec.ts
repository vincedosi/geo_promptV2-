import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { Subject } from 'rxjs';
import { FABRIQUE_POPUP } from '../../../carte/fabrique-carte';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CiviqueApi, type DetailCp } from '../data/civique.api';
import { AnnonceService } from '../etat/annonce.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { COUCHE_CIVIQUE_FOND, COUCHE_CIVIQUE_TRAIT, SOURCE_CIVIQUE } from './couche-civique';
import { IndicateursCiviquesService } from './indicateurs-civiques.service';
import { IrisService } from './iris.service';
import { IrisApi } from '../data/iris.api';
import { DELAI_DEPLACEMENT_MS } from './radio.service';

class PopupFactice {
  contenu: HTMLElement | null = null;
  retiree = false;
  constructor(readonly options: maplibregl.PopupOptions) {}
  setLngLat() { return this; }
  setDOMContent(n: HTMLElement) { this.contenu = n; return this; }
  addTo() { return this; }
  remove() { this.retiree = true; return this; }
}

const fc = (...props: Record<string, unknown>[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: props.map((p) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: p })),
});

function monter() {
  const bboxes: string[] = [];
  const reponses: Subject<GeoJSON.FeatureCollection>[] = [];
  const details: string[] = [];
  const reponsesDetail: Subject<DetailCp>[] = [];
  const popups: PopupFactice[] = [];
  const annonces: string[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), IndicateursCiviquesService, CouchesCarteService, EtatCarteService, IrisService,
      { provide: AnnonceService, useValue: { annoncer: (m: string) => annonces.push(m) } },
      { provide: IrisApi, useValue: {} },
      {
        provide: CiviqueApi,
        useValue: {
          geojsonVariable: (_c: string, b: string) => { bboxes.push(b); const s = new Subject<GeoJSON.FeatureCollection>(); reponses.push(s); return s; },
          detailCp: (cp: string) => { details.push(cp); const s = new Subject<DetailCp>(); reponsesDetail.push(s); return s; },
        },
      },
      { provide: CouleursService, useValue: { palette: () => signal({ absente: '#9aa0a6', trait: '#4292c6' }) } },
      { provide: FABRIQUE_POPUP, useValue: (o: maplibregl.PopupOptions) => { const p = new PopupFactice(o); popups.push(p); return p; } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  carte.cadre = [4.2, 43.1, 5.9, 43.95];
  const couches = TestBed.inject(CouchesCarteService);
  couches.publier(carte as unknown as maplibregl.Map);
  return {
    civique: TestBed.inject(IndicateursCiviquesService), etat: TestBed.inject(EtatCarteService), iris: TestBed.inject(IrisService),
    couches, carte, bboxes, reponses, details, reponsesDetail, popups, annonces,
  };
}

describe('IndicateursCiviquesService', () => {
  afterEach(() => vi.useRealTimers());

  it('aucune variable : aucune requête, rien de posé', () => {
    const { bboxes, carte } = monter();
    TestBed.tick();
    expect(bboxes).toEqual([]);
    expect(carte.sources.size).toBe(0);
  });

  it('choisir l’abstention : la bbox VISIBLE (jamais le monde), puis source + aplat + trait au sommet', () => {
    const { civique, bboxes, reponses, carte } = monter();
    civique.choisir('abstention_pres_2022');
    TestBed.tick();
    expect(bboxes).toEqual(['4.2000,43.1000,5.9000,43.9500']);
    expect(civique.chargement()).toBe(true);
    reponses[0].next(fc({ code_postal: '13001', value: 30 }));
    expect(civique.chargement()).toBe(false);
    expect(carte.sources.has(SOURCE_CIVIQUE)).toBe(true);
    expect(carte.ordreRendu()).toEqual([COUCHE_CIVIQUE_FOND, COUCHE_CIVIQUE_TRAIT]);
    const fond = carte.getLayer(COUCHE_CIVIQUE_FOND)!['paint'] as Record<string, unknown>;
    expect(fond['fill-color']).toEqual(['interpolate', ['linear'], ['coalesce', ['to-number', ['get', 'value']], 25],
      10, '#16a34a', 20, '#84cc16', 25, '#eab308', 30, '#f97316', 40, '#dc2626', 60, '#7f1d1d']);
    expect(fond['fill-opacity']).toBe(0.65);
    expect(carte.getLayer(COUCHE_CIVIQUE_TRAIT)!['paint']).toEqual({ 'line-color': '#ffffff', 'line-width': 0.3, 'line-opacity': 0.4 });
    expect(JSON.stringify(carte.couches)).not.toContain('var(');
  });

  it('un indicateur civique ÉVINCE IRIS (un seul dégradé), et l’annonce le nomme', () => {
    const { civique, etat, iris, annonces } = monter();
    iris.basculer(true);
    expect(etat.degradeActif()).toBe('iris');
    civique.choisir('abstention_pres_2022');
    expect(etat.degradeActif()).toBe('civic-indicateurs');
    expect(iris.visible()).toBe(false);
    expect(annonces).toEqual(['IRIS a été masqué — un seul dégradé de couleur à la fois']);
  });

  it('évincé par un autre dégradé : la variable retombe, couches et source retirées', () => {
    const { civique, etat, reponses, carte } = monter();
    civique.choisir('abstention_pres_2022');
    TestBed.tick();
    reponses[0].next(fc({ code_postal: '13001', value: 30 }));
    etat.basculerDegrade('iris', true);
    TestBed.tick();
    expect(civique.variable()).toBeNull();
    expect(carte.getLayer(COUCHE_CIVIQUE_FOND)).toBeUndefined();
    expect(carte.sources.has(SOURCE_CIVIQUE)).toBe(false);
  });

  it('déplacement DANS la bbox déjà lue : aucune relecture ; hors d’elle : relue 600 ms après', () => {
    vi.useFakeTimers();
    const { civique, bboxes, reponses, carte } = monter();
    civique.choisir('abstention_pres_2022');
    TestBed.tick();
    reponses[0].next(fc());
    carte.cadre = [4.5, 43.2, 5.5, 43.8];
    carte.emettre('moveend');
    vi.advanceTimersByTime(DELAI_DEPLACEMENT_MS);
    expect(bboxes).toHaveLength(1);
    carte.cadre = [2, 48, 3, 49];
    carte.emettre('moveend');
    vi.advanceTimersByTime(DELAI_DEPLACEMENT_MS - 1);
    expect(bboxes).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(bboxes).toEqual(['4.2000,43.1000,5.9000,43.9500', '2.0000,48.0000,3.0000,49.0000']);
  });

  it('clic sur un code postal : la commune lue UNE fois (cache), popup en DOM avec les textes de React', () => {
    const { civique, reponses, carte, details, reponsesDetail, popups } = monter();
    civique.choisir('abstention_pres_2022');
    TestBed.tick();
    reponses[0].next(fc());
    const evt = {
      lngLat: { lng: 5.4, lat: 43.3 },
      features: [{ properties: { code_postal: '13001', value: 31.24, inscrits: 23456, code_dept: '13' } }],
    };
    carte.emettreSurCouche('click', COUCHE_CIVIQUE_FOND, evt);
    expect(details).toEqual(['13001']);
    reponsesDetail[0].next({ code_postal: '13001', commune_principale: 'Marseille', nb_communes: 3 });
    expect(popups).toHaveLength(1);
    const t = popups[0].contenu!.textContent;
    expect(t).toContain('13001');
    expect(t).toContain('DÉPT 13');
    expect(t).toContain('Marseille');
    expect(t).toContain('+ 2 autres');
    expect(popups[0].contenu!.querySelector('[data-valeur]')!.textContent).toBe('31.2%');
    expect(t).toContain('Abstention élevée');
    expect(t).toContain('Inscrits sur les listes');
    expect(t).toContain((23456).toLocaleString('fr-FR'));
    carte.emettreSurCouche('click', COUCHE_CIVIQUE_FOND, evt);
    expect(details).toEqual(['13001']);
    expect(popups[0].retiree).toBe(true);
    expect(popups).toHaveLength(2);
  });

  it('échec de lecture : dit, jamais une carte vide muette', () => {
    const { civique, reponses } = monter();
    civique.choisir('abstention_pres_2022');
    TestBed.tick();
    reponses[0].error(new HttpErrorResponse({ status: 500, error: { error: 'boum' } }));
    expect(civique.erreur()).toBe('boum');
    expect(civique.chargement()).toBe(false);
  });

  it('carte recréée (changement de fond) : re-posée avec les données gardées, SANS requête en double', () => {
    const { civique, bboxes, reponses, couches } = monter();
    civique.choisir('abstention_pres_2022');
    TestBed.tick();
    reponses[0].next(fc({ code_postal: '13001', value: 30 }));
    couches.publier(null);
    TestBed.tick();
    const nouvelle = new CarteFactice();
    nouvelle.styleCharge = true;
    nouvelle.cadre = [4.2, 43.1, 5.9, 43.95];
    couches.publier(nouvelle as unknown as maplibregl.Map);
    TestBed.tick();
    expect(bboxes).toHaveLength(1);
    expect(nouvelle.getLayer(COUCHE_CIVIQUE_FOND)).toBeDefined();
    expect(nouvelle.sources.get(SOURCE_CIVIQUE)!.spec).toMatchObject({ data: { features: [{ properties: { code_postal: '13001' } }] } });
  });

  it('« Tout effacer » : variable à null, couches retirées, popup fermée — sans annonce', () => {
    const { civique, reponses, couches, carte, annonces } = monter();
    civique.choisir('abstention_pres_2022');
    TestBed.tick();
    reponses[0].next(fc());
    couches.toutEffacer();
    TestBed.tick();
    expect(civique.variable()).toBeNull();
    expect(carte.getLayer(COUCHE_CIVIQUE_FOND)).toBeUndefined();
    expect(annonces).toEqual([]);
  });
});
