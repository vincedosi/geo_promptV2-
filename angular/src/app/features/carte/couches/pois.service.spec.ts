import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { Subject, TimeoutError } from 'rxjs';
import { FABRIQUE_MARQUEUR, FABRIQUE_POPUP } from '../../../carte/fabrique-carte';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarteApi, type CorpsPois, type POI, type ZoneData } from '../data/carte.api';
import { AnnonceService } from '../etat/annonce.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { BBOX_METRO } from '../logique/filtre';
import { CarreauxService } from './carreaux.service';
import { CarreauxApi } from '../data/carreaux.api';
import { COUCHE_CARREAUX_FOND } from './couche-carreaux';
import { COUCHE_POIS_CERCLES, COUCHE_POIS_DENSITE, COUCHE_ZONE_CONTOUR, COUCHE_ZONE_FOND, SOURCE_POIS } from './couche-pois';
import { CLE_MODE_DENSITE, PoisService } from './pois.service';
import { CaptureService } from '../etat/capture.service';

/** Un marqueur factice : il garde son élément, sa position, sa popup, et s'il a été retiré. */
class MarqueurFactice {
  retire = false;
  ajoute = false;
  position: unknown = null;
  popup: unknown = null;
  constructor(readonly options: maplibregl.MarkerOptions) {}
  setLngLat(p: unknown) { this.position = p; return this; }
  setPopup(p: unknown) { this.popup = p; return this; }
  addTo() { this.ajoute = true; return this; }
  remove() { this.retire = true; return this; }
  get element(): HTMLElement { return this.options.element as HTMLElement; }
}

class PopupFactice {
  contenu: Node | null = null;
  ajoutee = false;
  retiree = false;
  constructor(readonly options: maplibregl.PopupOptions) {}
  setLngLat() { return this; }
  setDOMContent(n: Node) { this.contenu = n; return this; }
  addTo() { this.ajoutee = true; return this; }
  remove() { this.retiree = true; return this; }
}

const poi = (i: number, categorie = 'lycee', extra: Partial<POI> = {}): POI =>
  ({ id: `p${i}`, nom: `Lycée ${i}`, lat: 43 + i / 1000, lng: 5 + i / 1000, categorie, ...extra });

const zone = (n: number, categorie = 'lycee', extra: Partial<ZoneData> = {}): ZoneData => ({
  ville: 'France', rayon_metres: null, rayon_poi_metres: null, coordonnees: { lat: 43.3, lng: 5.4 },
  pois: Array.from({ length: n }, (_, i) => poi(i, categorie)), nb_pois: n, categories: { [categorie]: n }, ...extra,
});

function monter() {
  const reponses = new Subject<ZoneData>();
  const corps: CorpsPois[] = [];
  const marqueurs: MarqueurFactice[] = [];
  const popups: PopupFactice[] = [];
  const palette = signal<Record<string, string>>({ contour: '#ffffff', teal: '#4ecdc4', 'brand-teal': '#4ecdc4', 'bg-level-2': '#111111' });
  localStorage.removeItem(CLE_MODE_DENSITE);
  TestBed.configureTestingModule({
    providers: [CaptureService, 
      provideZonelessChangeDetection(), PoisService, EtatCarteService, CouchesCarteService, AnnonceService, CarreauxService,
      { provide: CarreauxApi, useValue: { urlTuiles: () => 'http://localhost/api/tiles/{z}/{x}/{y}' } },
      { provide: CarteApi, useValue: { pois: (c: CorpsPois) => { corps.push(c); return reponses; } } },
      { provide: CouleursService, useValue: { palette: (j: Record<string, string>) => (j['contour'] ? palette : signal({ absente: '#9aa0a6', trait: '#555555' })) } },
      { provide: FABRIQUE_MARQUEUR, useValue: (o: maplibregl.MarkerOptions) => { const m = new MarqueurFactice(o); marqueurs.push(m); return m; } },
      { provide: FABRIQUE_POPUP, useValue: (o: maplibregl.PopupOptions) => { const p = new PopupFactice(o); popups.push(p); return p; } },
    ],
  });
  return {
    service: TestBed.inject(PoisService), etat: TestBed.inject(EtatCarteService), couches: TestBed.inject(CouchesCarteService),
    carreaux: TestBed.inject(CarreauxService), reponses, corps, marqueurs, popups, palette,
  };
}

function carteChargee(couches: CouchesCarteService): CarteFactice {
  const carte = new CarteFactice();
  carte.styleCharge = true;
  couches.publier(carte as unknown as maplibregl.Map);
  return carte;
}

const flush = () => TestBed.tick();
const visibilite = (c: CarteFactice, couche: string) => (c.getLayer(couche)?.['layout'] as { visibility?: string })?.visibility;
const PARAMS = { poi_types: ['lycee'], scope: null, regions: [], depts: [], ville: '', rayon_poi: null, poi_natures: {} };
/** Les marqueurs de POI encore en place (le marqueur de ville mis à part). */
const marqueursPoi = (m: MarqueurFactice[]) => m.filter((x) => !x.retire && x.element.hasAttribute('data-marqueur-poi'));

describe('PoisService — corps de /api/map/pois (bboxPourRequete)', () => {
  afterEach(() => localStorage.removeItem(CLE_MODE_DENSITE));

  it('sans filtre : AUCUNE bbox dans le corps', () => {
    const { service, corps } = monter();
    service.chercher(PARAMS);
    expect(corps[0]).toEqual(PARAMS);
    expect('bbox' in corps[0]).toBe(false);
  });

  it('filtre zone enregistrée avec bbox → la bbox de la zone', () => {
    const { service, etat, corps } = monter();
    etat.filtre.set({ type: 'zone', code: 'z1', label: 'Ma zone', bbox: [5, 43, 6, 44] });
    service.chercher(PARAMS);
    expect(corps[0].bbox).toEqual([5, 43, 6, 44]);
  });

  it('filtre « france » → sans bbox (intention nationale, jamais BBOX_METRO)', () => {
    const { service, etat, corps } = monter();
    etat.filtre.set({ type: 'france', code: 'FR', label: 'France' });
    service.chercher(PARAMS);
    expect('bbox' in corps[0]).toBe(false);
  });

  it('filtre département (sans bbox propre) → BBOX_METRO', () => {
    const { service, etat, corps } = monter();
    etat.filtre.set({ type: 'departement', code: '13', label: 'Bouches-du-Rhône' });
    service.chercher(PARAMS);
    expect(corps[0].bbox).toEqual(BBOX_METRO);
  });

  it('un territoire dans le corps (retours 26/10) : AUCUNE bbox de repli — la Guadeloupe ne serait pas dans BBOX_METRO', () => {
    const { service, etat, corps } = monter();
    etat.filtre.set({ type: 'region', code: '01', label: 'Guadeloupe' });
    service.chercher({ ...PARAMS, regions: ['01'] });
    expect('bbox' in corps[0]).toBe(false);
    etat.filtre.set({ type: 'cp', code: '97110', label: 'CP 97110' });
    service.chercher({ ...PARAMS, code_postal: '97110' });
    expect('bbox' in corps[1]).toBe(false);
  });

  it('réponse sans POI → message de React, zone vide ; délai dépassé → sa phrase ; corps d’erreur → son texte', () => {
    const { service, reponses } = monter();
    service.chercher(PARAMS);
    expect(service.chargement()).toBe(true);
    reponses.next(zone(0));
    expect(service.erreur()).toBe('Aucun POI trouvé pour "lycee"');
    expect(service.zone()).toBeNull();
    expect(service.chargement()).toBe(false);
    service.chercher(PARAMS);
    reponses.error(new TimeoutError());
    expect(service.erreur()).toBe('Base de données lente — réessayez dans quelques instants');
  });

  it('erreur HTTP : le champ `error` du corps, sinon « Erreur <statut> »', () => {
    const r1 = new Subject<ZoneData>();
    const { service } = monter();
    (TestBed.inject(CarteApi) as unknown as { pois: () => Subject<ZoneData> }).pois = () => r1;
    service.chercher(PARAMS);
    r1.error(new HttpErrorResponse({ status: 500, error: { error: 'Base indisponible' } }));
    expect(service.erreur()).toBe('Base indisponible');
  });
});

describe('PoisService — rendu sur la carte', () => {
  afterEach(() => localStorage.removeItem(CLE_MODE_DENSITE));

  it('rien n’est posé avant la première zone', () => {
    const { couches } = monter();
    const carte = carteChargee(couches);
    flush();
    expect(carte.sources.size).toBe(0);
    expect(carte.couches).toEqual([]);
  });

  it('≤ 300 POI → un marqueur DOM par POI (+ ville), nappe et cercles masqués ; jamais var() dans MapLibre', () => {
    const { service, couches, marqueurs } = monter();
    const carte = carteChargee(couches);
    service.definirZone(zone(3));
    flush();
    expect(marqueursPoi(marqueurs)).toHaveLength(3);
    expect(marqueurs.filter((m) => m.element.hasAttribute('data-marqueur-ville'))).toHaveLength(1);
    expect(visibilite(carte, COUCHE_POIS_DENSITE)).toBe('none');
    expect(visibilite(carte, COUCHE_POIS_CERCLES)).toBe('none');
    expect(JSON.stringify(carte.couches)).not.toContain('var(');
    // Le marqueur est créé dans le document de la carte, sa popup par textContent.
    expect(marqueurs[0].element.ownerDocument).toBe(carte.getContainer().ownerDocument);
  });

  it('301 à 500 POI → cercles GPU, aucun marqueur de POI ; cadrage plafonné à z7', () => {
    const { service, couches, marqueurs } = monter();
    const carte = carteChargee(couches);
    service.definirZone(zone(350));
    flush();
    expect(marqueursPoi(marqueurs)).toHaveLength(0);
    expect(visibilite(carte, COUCHE_POIS_CERCLES)).toBe('visible');
    expect(visibilite(carte, COUCHE_POIS_DENSITE)).toBe('none');
    expect((carte.cadrages.at(-1)!.options as { maxZoom: number }).maxZoom).toBe(7);
  });

  it('mode densité → pois-heatmap visible et ZÉRO marqueur de POI ; mémorisé dans localStorage', () => {
    const { service, couches, marqueurs } = monter();
    const carte = carteChargee(couches);
    service.modeDensite.set(true);
    service.definirZone(zone(3));
    flush();
    expect(visibilite(carte, COUCHE_POIS_DENSITE)).toBe('visible');
    expect(marqueursPoi(marqueurs)).toHaveLength(0);
    expect(localStorage.getItem(CLE_MODE_DENSITE)).toBe('true');
    // La nappe prend le teal (aucune épingle) résolu, jamais `var(--brand-teal)`.
    const couleur = carte.peintures.filter((p) => p.couche === COUCHE_POIS_DENSITE && p.propriete === 'heatmap-color').at(-1)!;
    expect(JSON.stringify(couleur.valeur)).toContain('rgba(78,205,196,1)');
  });

  it('changement de zone → les anciens marqueurs sont retirés (remove)', () => {
    const { service, couches, marqueurs } = monter();
    carteChargee(couches);
    service.definirZone(zone(3));
    flush();
    const anciens = [...marqueurs];
    service.definirZone(zone(2, 'college'));
    flush();
    expect(anciens.every((m) => m.retire)).toBe(true);
    expect(marqueursPoi(marqueurs)).toHaveLength(2);
  });

  it('« Tout effacer » → zone vidée, marqueurs retirés, source vidée, tiroir fermé', () => {
    const { service, couches, marqueurs } = monter();
    const carte = carteChargee(couches);
    service.definirZone(zone(3, 'panneaux'));
    service.panneauSelectionne.set({ id: 'x', nom: 'X', lat: 1, lng: 2 });
    flush();
    couches.toutEffacer();
    flush();
    expect(service.zone()).toBeNull();
    expect(service.panneauSelectionne()).toBeNull();
    expect(marqueurs.every((m) => m.retire)).toBe(true);
    const donnees = carte.sources.get(SOURCE_POIS)!.donnees.at(-1) as GeoJSON.FeatureCollection;
    expect(donnees.features).toEqual([]);
  });

  it('épingle « Noir » (var(--bg-level-2)) → résolue avant MapLibre ; changer une épingle ne RE-CADRE pas', () => {
    const { service, couches } = monter();
    const carte = carteChargee(couches);
    service.modeDensite.set(true);
    service.definirZone(zone(3));
    flush();
    const cadrages = carte.cadrages.length;
    service.reglerStyle('lycee', { color: 'var(--bg-level-2)' });
    flush();
    expect(carte.cadrages.length).toBe(cadrages);
    const donnees = carte.sources.get(SOURCE_POIS)!.donnees.at(-1) as GeoJSON.FeatureCollection;
    expect(donnees.features[0].properties!['color']).toBe('#111111');
    expect(JSON.stringify(carte.peintures)).not.toContain('var(');
  });

  it('clic sur un marqueur de panneau → tiroir ; clic sur un cercle de panneau → tiroir avec son format', () => {
    const { service, couches, marqueurs } = monter();
    const carte = carteChargee(couches);
    service.definirZone({ ...zone(0, 'panneaux'), pois: [poi(1, 'panneaux', { sous_categorie: '4x3', adresse: 'DECAUX' })], categories: { panneaux: 1 } });
    flush();
    marqueursPoi(marqueurs)[0].element.click();
    expect(service.panneauSelectionne()).toEqual(expect.objectContaining({ id: 'p1', format: '4x3', regie: 'DECAUX' }));
    service.panneauSelectionne.set(null);
    carte.emettreSurCouche('click', COUCHE_POIS_CERCLES, {
      lngLat: { lat: 1, lng: 2 }, features: [{ properties: { id: 'p9', nom: 'P', categorie: 'panneaux', sous_categorie: '8m2', lat: 3, lng: 4 } }],
    });
    expect(service.panneauSelectionne()).toEqual(expect.objectContaining({ id: 'p9', format: '8m2', lat: 3, lng: 4 }));
  });

  it('« Tout effacer » ferme la popup d’un cercle cliqué (revue 1)', () => {
    const { service, couches, popups } = monter();
    const carte = carteChargee(couches);
    service.definirZone(zone(400));
    flush();
    carte.emettreSurCouche('click', COUCHE_POIS_CERCLES, {
      lngLat: { lat: 1, lng: 2 }, features: [{ properties: { id: 'p9', nom: 'Lycée', categorie: 'lycee' } }],
    });
    const popup = popups.at(-1)!;
    expect(popup.ajoutee).toBe(true);
    couches.toutEffacer();
    flush();
    expect(popup.retiree).toBe(true);
  });

  it('carte recréée (changement de fond) → couches, marqueurs et écoutes re-posés sur la NOUVELLE instance', () => {
    const { service, couches, marqueurs } = monter();
    const a = carteChargee(couches);
    service.definirZone(zone(3));
    flush();
    couches.publier(null);
    flush();
    expect(marqueurs.every((m) => m.retire)).toBe(true);
    const b = carteChargee(couches);
    flush();
    expect(b.getLayer(COUCHE_POIS_DENSITE)).toBeTruthy();
    expect(b.getLayer(COUCHE_ZONE_FOND)).toBeTruthy();
    expect(marqueursPoi(marqueurs)).toHaveLength(3);
    expect(b.cadrages).toHaveLength(1);
    expect(a.getContainer().querySelector('[data-rayons-poi]')).toBeNull();
    expect(b.getContainer().querySelector('[data-rayons-poi]')).not.toBeNull();
  });
});

describe('Ordre des couches (ruling T8 : celui de React, quel que soit l’ordre des gestes)', () => {
  afterEach(() => localStorage.removeItem(CLE_MODE_DENSITE));

  it('carreaux allumés APRÈS les POI → les POI restent SOUS les carreaux, le cercle de zone aussi', () => {
    const { service, couches, carreaux } = monter();
    const carte = carteChargee(couches);
    service.definirZone(zone(3));
    flush();
    carreaux.basculer(true);
    flush();
    const ordre = carte.ordreRendu();
    expect(ordre.indexOf(COUCHE_POIS_DENSITE)).toBeLessThan(ordre.indexOf(COUCHE_POIS_CERCLES));
    expect(ordre.indexOf(COUCHE_POIS_CERCLES)).toBeLessThan(ordre.indexOf(COUCHE_ZONE_FOND));
    expect(ordre.indexOf(COUCHE_ZONE_CONTOUR)).toBeLessThan(ordre.indexOf(COUCHE_CARREAUX_FOND));
  });

  it('POI affichés APRÈS les carreaux → insérés SOUS eux (même ordre), y compris après un changement de fond', () => {
    const { service, couches, carreaux } = monter();
    let carte = carteChargee(couches);
    carreaux.basculer(true);
    flush();
    service.definirZone(zone(3));
    flush();
    const attendu = ['pois-heatmap', 'pois-circles', 'zone-fill', 'zone-outline', 'carreaux-mvt-fill', 'carreaux-mvt-extrusion', 'carreaux-mvt-line'];
    expect(carte.ordreRendu()).toEqual(attendu);
    couches.publier(null);
    flush();
    carte = carteChargee(couches);
    flush();
    expect(carte.ordreRendu()).toEqual(attendu);
  });
});
