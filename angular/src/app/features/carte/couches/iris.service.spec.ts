import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { Subject } from 'rxjs';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarreauxApi } from '../data/carreaux.api';
import { type IrisDetailData, IrisApi } from '../data/iris.api';
import { AnnonceService } from '../etat/annonce.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import type { CatalogueBornesIris } from '../logique/iris-echelle';
import { IRIS_PALETTES } from '../logique/palettes-donnees-carte';
import { IRIS_ZOOM_PLANCHER } from '../logique/versions';
import { CarreauxService } from './carreaux.service';
import { COUCHE_CARREAUX_FOND } from './couche-carreaux';
import { COUCHE_IRIS_FOND, COUCHE_IRIS_RELIEF, COUCHE_IRIS_TRAIT, OPACITE_TRAIT_IRIS, SOURCE_IRIS } from './couche-iris';
import { IrisService } from './iris.service';

const URL_TUILES = 'http://localhost/api/tiles/iris/{z}/{x}/{y}?v=2';
const CATALOGUE: CatalogueBornesIris = {
  pop_15_29: { colonne: 'pop_15_29', classe: 'effectif', log_min: 0.5, log_max: 4.2, val_min: 3, val_max: 15000 },
  rev_median: { colonne: 'rev_median', classe: 'proportion', log_min: 4.1, log_max: 4.6, val_min: 12000, val_max: 40000 },
};

function monter() {
  const theme = signal({ absente: '#9aa0a6', trait: 'rgba(66,146,198,0.7)' });
  const bornes$: Subject<CatalogueBornesIris>[] = [];
  const details$: { code: string; flux: Subject<IrisDetailData> }[] = [];
  const api = {
    urlTuiles: () => URL_TUILES,
    bornes: vi.fn(() => { const s = new Subject<CatalogueBornesIris>(); bornes$.push(s); return s; }),
    detail: vi.fn((code: string) => { const s = new Subject<IrisDetailData>(); details$.push({ code, flux: s }); return s; }),
  };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), IrisService, CarreauxService, EtatCarteService, CouchesCarteService, AnnonceService,
      { provide: IrisApi, useValue: api },
      { provide: CarreauxApi, useValue: { urlTuiles: () => 'http://localhost/api/tiles/{z}/{x}/{y}?v=19' } },
      { provide: CouleursService, useValue: { palette: () => theme } },
    ],
  });
  return {
    service: TestBed.inject(IrisService),
    carreaux: TestBed.inject(CarreauxService),
    etat: TestBed.inject(EtatCarteService),
    couches: TestBed.inject(CouchesCarteService),
    annonce: TestBed.inject(AnnonceService),
    api, bornes$, details$, theme,
  };
}

function carteChargee(couches: CouchesCarteService, zoom = 9): CarteFactice {
  const carte = new CarteFactice();
  carte.styleCharge = true;
  carte.zoom = zoom;
  couches.publier(carte as unknown as maplibregl.Map);
  return carte;
}

const flush = () => TestBed.tick();
const peinturesDe = (c: CarteFactice, couche: string, prop: string) =>
  c.peintures.filter((p) => p.couche === couche && p.propriete === prop);
const visibilite = (c: CarteFactice, couche: string) => (c.getLayer(couche)?.['layout'] as { visibility?: string })?.visibility;

describe('IrisService', () => {
  it('masquée : rien n’est posé et aucune borne n’est demandée', () => {
    const { couches, api } = monter();
    const carte = carteChargee(couches);
    flush();
    expect(carte.sources.size).toBe(0);
    expect(api.bornes).not.toHaveBeenCalled();
  });

  it('visible → source iris-source (plancher, adresse absolue) et trois couches, aplat visible, sans var()', () => {
    const { service, couches } = monter();
    const carte = carteChargee(couches);
    service.basculer(true);
    flush();
    expect(carte.sources.get(SOURCE_IRIS)!.spec).toEqual({
      type: 'vector', tiles: [URL_TUILES], minzoom: IRIS_ZOOM_PLANCHER, maxzoom: 14, attribution: 'IGN — IRIS 2023',
    });
    expect(carte.couches.map((c) => c.couche['id'])).toEqual([COUCHE_IRIS_FOND, COUCHE_IRIS_TRAIT, COUCHE_IRIS_RELIEF]);
    for (const c of carte.couches) expect(c.couche['minzoom']).toBe(IRIS_ZOOM_PLANCHER);
    expect(visibilite(carte, COUCHE_IRIS_FOND)).toBe('visible');
    expect(visibilite(carte, COUCHE_IRIS_TRAIT)).toBe('visible');
    expect(visibilite(carte, COUCHE_IRIS_RELIEF)).toBe('none');
    expect(JSON.stringify(carte.couches)).not.toContain('var(');
    const trait = carte.getLayer(COUCHE_IRIS_TRAIT)!['paint'] as Record<string, unknown>;
    expect(trait['line-color']).toBe('rgba(66,146,198,0.7)');
    expect(trait['line-opacity']).toEqual(OPACITE_TRAIT_IRIS);
    // Avant les bornes : la teinte provisoire de React (#4292C6, quatrième arrêt de la palette bleu).
    expect((carte.getLayer(COUCHE_IRIS_FOND)!['paint'] as Record<string, unknown>)['fill-color']).toBe(IRIS_PALETTES[0].stops[3]);
  });

  it('les bornes sont demandées UNE fois pour trois allumages', () => {
    const { service, couches, api, bornes$ } = monter();
    carteChargee(couches);
    service.basculer(true);
    flush();
    bornes$[0].next(CATALOGUE);
    bornes$[0].complete();
    for (let i = 0; i < 2; i++) {
      service.basculer(false);
      flush();
      service.basculer(true);
      flush();
    }
    expect(api.bornes).toHaveBeenCalledTimes(1);
  });

  it('un échec de lecture des bornes est retenté au prochain allumage ; la carte peint le gris « absente »', () => {
    const { service, couches, api, bornes$ } = monter();
    const carte = carteChargee(couches);
    service.basculer(true);
    flush();
    bornes$[0].error(new Error('500'));
    flush();
    expect(service.bornesEnErreur()).toBe(true);
    expect(peinturesDe(carte, COUCHE_IRIS_FOND, 'fill-color').at(-1)!.valeur).toBe('#9aa0a6');
    service.basculer(false);
    flush();
    service.basculer(true);
    flush();
    expect(api.bornes).toHaveBeenCalledTimes(2);
  });

  it('allumer sous le plancher remonte la caméra au plancher (easeTo, 800 ms), à l’allumage seulement', () => {
    const { service, couches } = monter();
    const carte = carteChargee(couches, IRIS_ZOOM_PLANCHER - 0.5);
    service.basculer(true);
    expect(carte.animations).toEqual([{ zoom: IRIS_ZOOM_PLANCHER, duration: 800 }]);
    carte.zoom = 2;
    service.basculer(false);
    expect(carte.animations).toHaveLength(1);
  });

  it('allumer au-dessus du plancher (z5) : la caméra ne bouge pas', () => {
    const { service, couches } = monter();
    const carte = carteChargee(couches, 5);
    service.basculer(true);
    expect(carte.animations).toEqual([]);
  });

  it('zoomCourant suit zoomend ; niveau = palier de la cascade (floor) ; sousLePlancher seulement couche allumée', () => {
    const { service, couches } = monter();
    const carte = carteChargee(couches, 5.5);
    flush();
    expect(service.zoomCourant()).toBe(5.5);
    expect(service.niveau()).toBe('departement');
    carte.zoom = 8.7;
    carte.emettre('zoomend');
    expect(service.niveau()).toBe('commune');
    carte.zoom = 9;
    carte.emettre('zoomend');
    expect(service.niveau()).toBe('iris');
    carte.zoom = 3.5;
    carte.emettre('zoomend');
    expect(service.sousLePlancher()).toBe(false);
    service.visible.set(true);
    expect(service.sousLePlancher()).toBe(true);
    couches.publier(null);
    flush();
    expect(service.zoomCourant()).toBeNull();
    expect(carte.nombreEcouteurs('zoomend')).toBe(0);
  });

  it('changer d’indicateur ou de palette : nouvelle expression, AUCUNE requête, source jamais recréée', () => {
    const { service, couches, api, bornes$ } = monter();
    const carte = carteChargee(couches);
    const ajouts = vi.spyOn(carte, 'addSource');
    service.basculer(true);
    flush();
    bornes$[0].next(CATALOGUE);
    flush();
    service.indicateur.set('rev_median');
    flush();
    service.palette.set('vert');
    flush();
    expect(api.bornes).toHaveBeenCalledTimes(1);
    expect(api.detail).not.toHaveBeenCalled();
    expect(ajouts).toHaveBeenCalledTimes(1);
    const derniere = peinturesDe(carte, COUCHE_IRIS_FOND, 'fill-color').at(-1)!.valeur as unknown[];
    expect(derniere[0]).toBe('case');
    expect(JSON.stringify(derniere)).toContain('rev_median');
    for (const arret of IRIS_PALETTES.find((p) => p.id === 'vert')!.stops) expect(JSON.stringify(derniere)).toContain(arret);
    expect(derniere[3]).toBe('#9aa0a6');
    expect(peinturesDe(carte, COUCHE_IRIS_RELIEF, 'fill-extrusion-color').at(-1)!.valeur).toEqual(derniere);
  });

  it('une colonne sans bornes (vide en base) : bornes() = null et tout est peint en gris « absente »', () => {
    const { service, couches, bornes$ } = monter();
    const carte = carteChargee(couches);
    service.basculer(true);
    flush();
    expect(service.bornes()).toBeUndefined();
    bornes$[0].next(CATALOGUE);
    flush();
    service.indicateur.set('nb_emplois');
    flush();
    expect(service.bornes()).toBeNull();
    expect(peinturesDe(carte, COUCHE_IRIS_FOND, 'fill-color').at(-1)!.valeur).toBe('#9aa0a6');
  });

  it('vrais IRIS : le filtre EXACT de React sur les trois couches, retiré au décochage', () => {
    const { service, couches } = monter();
    const carte = carteChargee(couches);
    service.basculer(true);
    flush();
    service.vraisSeulement.set(true);
    flush();
    const attendu = ['any', ['!=', ['get', 'niveau'], 'iris'], ['==', ['get', 'is_true_iris'], true]];
    for (const c of [COUCHE_IRIS_FOND, COUCHE_IRIS_TRAIT, COUCHE_IRIS_RELIEF]) expect(carte.getLayer(c)!['filter']).toEqual(attendu);
    service.vraisSeulement.set(false);
    flush();
    expect(carte.getLayer(COUCHE_IRIS_FOND)!['filter']).toBeNull();
  });

  it('opacité réglée : aplat = v, contour = min(v × 0,8 ; 0,6)', () => {
    const { service, couches } = monter();
    const carte = carteChargee(couches);
    service.basculer(true);
    flush();
    service.reglerOpacite(0.5);
    flush();
    expect(peinturesDe(carte, COUCHE_IRIS_FOND, 'fill-opacity').at(-1)!.valeur).toBe(0.5);
    expect(peinturesDe(carte, COUCHE_IRIS_TRAIT, 'line-opacity').at(-1)!.valeur).toBeCloseTo(0.4);
    service.reglerOpacite(1);
    flush();
    expect(peinturesDe(carte, COUCHE_IRIS_TRAIT, 'line-opacity').at(-1)!.valeur).toBe(0.6);
  });

  it('relief : extrusion visible, aplat masqué, hauteur en multiples de maille, caméra inclinée puis rendue', () => {
    const { service, couches, bornes$ } = monter();
    const carte = carteChargee(couches);
    carte.pitch = 10;
    service.basculer(true);
    flush();
    bornes$[0].next(CATALOGUE);
    service.basculerRelief(true);
    flush();
    expect(visibilite(carte, COUCHE_IRIS_RELIEF)).toBe('visible');
    expect(visibilite(carte, COUCHE_IRIS_FOND)).toBe('none');
    expect(carte.animations.at(-1)).toEqual({ pitch: 55, duration: 600 });
    expect(JSON.stringify(peinturesDe(carte, COUCHE_IRIS_RELIEF, 'fill-extrusion-height').at(-1)!.valeur)).toContain('superficie_km2');
    service.basculerRelief(false);
    expect(carte.animations.at(-1)).toEqual({ pitch: 10, duration: 600 });
  });

  it('IRIS allumé alors que les carreaux le sont : carreaux évincés + annonce ; et réciproquement', () => {
    const { service, carreaux, etat, couches, annonce } = monter();
    carteChargee(couches);
    const annoncer = vi.spyOn(annonce, 'annoncer');
    carreaux.basculer(true);
    flush();
    service.basculer(true);
    flush();
    expect(carreaux.visible()).toBe(false);
    expect(etat.degradeActif()).toBe('iris');
    expect(annoncer).toHaveBeenLastCalledWith('Carreaux Filosofi a été masqué — un seul dégradé de couleur à la fois');
    carreaux.basculer(true);
    flush();
    expect(service.visible()).toBe(false);
    expect(annoncer.mock.calls.at(-1)![0]).toContain('IRIS');
  });

  it('posés après les carreaux, les IRIS passent DESSOUS (l’ordre de React)', () => {
    const { service, carreaux, couches } = monter();
    const carte = carteChargee(couches);
    carreaux.basculer(true);
    flush();
    service.basculer(true);
    flush();
    for (const c of carte.couches.filter((x) => String(x.couche['id']).startsWith('iris-'))) expect(c.avant).toBe(COUCHE_CARREAUX_FOND);
  });

  it('clic sur iris-fill → detail(code) puis données ; fermer → vidé ; un clic hors palier IRIS est ignoré', () => {
    const { service, couches, api, details$ } = monter();
    const carte = carteChargee(couches);
    flush();
    carte.emettreSurCouche('click', COUCHE_IRIS_FOND, { features: [{ properties: { code: '13', niveau: 'departement' } }] });
    expect(api.detail).not.toHaveBeenCalled();
    carte.emettreSurCouche('click', COUCHE_IRIS_FOND, { features: [{ properties: { code_iris: '751010101' } }], preventDefault: () => undefined });
    expect(api.detail).toHaveBeenCalledWith('751010101');
    expect(service.chargementDetail()).toBe(true);
    expect(service.codeSelectionne()).toBe('751010101');
    details$[0].flux.next({ code_iris: '751010101', nom_iris: 'Saint-Germain', code_commune: '75101', code_dept: '75', is_true_iris: true });
    expect(service.chargementDetail()).toBe(false);
    expect(service.detail()?.nom_iris).toBe('Saint-Germain');
    service.fermerDetail();
    expect(service.detail()).toBeNull();
    expect(service.codeSelectionne()).toBeNull();
  });

  it('détail en échec : chargement terminé, erreur dite (React refermait sans un mot)', () => {
    const { service, details$ } = monter();
    service.selectionner('751010101');
    details$[0].flux.error(new Error('404'));
    expect(service.chargementDetail()).toBe(false);
    expect(service.erreurDetail()).toBe(true);
    expect(service.codeSelectionne()).toBe('751010101');
  });

  it('une sélection plus récente annule la lecture en cours', () => {
    const { service, details$ } = monter();
    service.selectionner('751010101');
    service.selectionner('751010102');
    expect(details$[0].flux.observed).toBe(false);
    details$[1].flux.next({ code_iris: '751010102', nom_iris: 'B', code_commune: null, code_dept: null, is_true_iris: true });
    expect(service.detail()?.code_iris).toBe('751010102');
  });

  it('changement de fond : re-pose sur la nouvelle instance avec indicateur, filtre et visibilité ; clic re-branché', () => {
    const { service, couches, bornes$ } = monter();
    const carte = carteChargee(couches);
    service.basculer(true);
    flush();
    bornes$[0].next(CATALOGUE);
    service.indicateur.set('rev_median');
    service.vraisSeulement.set(true);
    flush();
    couches.publier(null);
    flush();
    expect(carte.nombreEcouteurs(`click:${COUCHE_IRIS_FOND}`)).toBe(0);
    const neuve = carteChargee(couches);
    flush();
    expect(neuve.sources.has(SOURCE_IRIS)).toBe(true);
    expect(visibilite(neuve, COUCHE_IRIS_FOND)).toBe('visible');
    expect(JSON.stringify(neuve.getLayer(COUCHE_IRIS_FOND)!['paint'])).toContain('rev_median');
    expect(neuve.getLayer(COUCHE_IRIS_FOND)!['filter']).toBeTruthy();
    expect(neuve.nombreEcouteurs(`click:${COUCHE_IRIS_FOND}`)).toBe(1);
  });

  it('Tout effacer → masquée et détail fermé ; la couleur reste', () => {
    const { service, couches } = monter();
    const carte = carteChargee(couches);
    service.basculer(true);
    flush();
    service.selectionner('751010101');
    couches.toutEffacer();
    flush();
    expect(service.visible()).toBe(false);
    expect(service.codeSelectionne()).toBeNull();
    expect(visibilite(carte, COUCHE_IRIS_FOND)).toBe('none');
  });
});
