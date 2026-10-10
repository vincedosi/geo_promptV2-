import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { Subject } from 'rxjs';
import { FABRIQUE_POPUP } from '../../../carte/fabrique-carte';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CiviqueApi } from '../data/civique.api';
import { MeteoApi } from '../data/meteo.api';
import { AnnonceService } from '../etat/annonce.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { ContoursZonesService } from '../etat/contours-zones.service';
import { buildColorExpression } from '../logique/meteo/palettes';
import type { MeteoParams, MeteoScale, MeteoStats, MeteoZoneChunk, MeteoZoneMeta } from '../logique/meteo/types';
import { OPACITE_METEO, TRAIT_METEO } from '../logique/palettes-donnees-carte';
import { COUCHE_METEO_FOND, COUCHE_METEO_TRAIT, SOURCE_METEO } from './couche-meteo';
import { MeteoService } from './meteo.service';

class PopupFactice {
  contenu: HTMLElement | null = null;
  constructor(readonly options: maplibregl.PopupOptions) {}
  setLngLat() { return this; }
  setDOMContent(n: HTMLElement) { this.contenu = n; return this; }
  addTo() { return this; }
  remove() { return this; }
}

const STATS: MeteoStats = { min: 8, max: 16, mean: 12, p20: 9, p40: 11, p60: 13, p80: 15, unit: '°C' };
const meta = (scale: MeteoScale): MeteoZoneMeta => ({
  variable: 'temperature_2m', unit: '°C', startDate: '2026-10-03', endDate: '2026-10-09', scale, stats: STATS,
  totalZones: 3, batchesTotal: 1, cachedAt: null,
});
const PARAMS: MeteoParams = { variable: 'temperature_2m', startDate: '2026-10-03', endDate: '2026-10-09', scale: 'departement' };
const zones = (...codes: string[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: codes.map((code) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { code, nom: `Zone ${code}` } })),
});
const fini = (scale: MeteoScale): MeteoZoneChunk => ({
  status: 'done', progress: 1, total: 1, meta: meta(scale),
  data: { '13': { value: 15.24, unit: '°C', label: 'Doux' }, '83': { value: 16, unit: '°C', label: 'Doux' } },
});

function monter() {
  const zonesDemandees: MeteoScale[] = [];
  const reponsesZones: Subject<GeoJSON.FeatureCollection>[] = [];
  const appels: { scale: MeteoScale; params: MeteoParams }[] = [];
  const flux: Subject<MeteoZoneChunk>[] = [];
  const popups: PopupFactice[] = [];
  const annonces: string[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), MeteoService, CouchesCarteService, EtatCarteService, ContoursZonesService,
      { provide: AnnonceService, useValue: { annoncer: (m: string) => annonces.push(m) } },
      {
        provide: CiviqueApi,
        useValue: { zones: (e: MeteoScale) => { zonesDemandees.push(e); const s = new Subject<GeoJSON.FeatureCollection>(); reponsesZones.push(s); return s; } },
      },
      {
        provide: MeteoApi,
        useValue: { donnees: (scale: MeteoScale, params: MeteoParams) => { appels.push({ scale, params }); const s = new Subject<MeteoZoneChunk>(); flux.push(s); return s; } },
      },
      { provide: FABRIQUE_POPUP, useValue: (o: maplibregl.PopupOptions) => { const p = new PopupFactice(o); popups.push(p); return p; } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  const couches = TestBed.inject(CouchesCarteService);
  couches.publier(carte as unknown as maplibregl.Map);
  return {
    meteo: TestBed.inject(MeteoService), etat: TestBed.inject(EtatCarteService), couches, carte,
    zonesDemandees, reponsesZones, appels, flux, popups, annonces,
  };
}

/** Applique au département et mène les deux lectures à leur terme. */
function appliquerJusquauBout(m: ReturnType<typeof monter>, scale: MeteoScale = 'departement') {
  m.meteo.ouvrirDialogue();
  m.meteo.appliquer({ ...PARAMS, scale });
  const i = m.flux.length - 1;
  m.flux[i].next(fini(scale));
  m.flux[i].complete();
  m.reponsesZones.at(-1)?.next(zones('13', '83', '84'));
  m.reponsesZones.at(-1)?.complete();
  TestBed.tick();
}

const derniereDonnee = (c: CarteFactice) => c.sources.get(SOURCE_METEO)?.donnees.at(-1) as GeoJSON.FeatureCollection | undefined;
const visibilite = (c: CarteFactice, couche: string) => (c.getLayer(couche)?.['layout'] as { visibility?: string } | undefined)?.visibility;

describe('MeteoService', () => {
  it('rien d’appliqué : aucune requête, rien de posé', () => {
    const m = monter();
    TestBed.tick();
    expect([m.zonesDemandees, m.appels]).toEqual([[], []]);
    expect(m.carte.getLayer(COUCHE_METEO_FOND)).toBeUndefined();
  });

  it('appliquer : polygones ET flux lancés ENSEMBLE ; progression ; couche peinte ; dialogue fermé ; dégradé meteo actif', () => {
    const m = monter();
    m.meteo.ouvrirDialogue();
    m.meteo.appliquer(PARAMS);
    expect(m.zonesDemandees).toEqual(['departement']);
    expect(m.appels).toEqual([{ scale: 'departement', params: { ...PARAMS, bbox: undefined } }]);
    expect(m.meteo.chargement()).toBe(true);

    m.flux[0].next({ status: 'fetching', progress: 0, total: 3 });
    expect(m.meteo.progression()).toEqual({ current: 0, total: 3, etaMs: undefined });
    m.flux[0].next({ status: 'fetching', progress: 2, total: 3, etaMs: 9000 });
    expect(m.meteo.progression()).toEqual({ current: 2, total: 3, etaMs: 9000 });
    m.flux[0].next(fini('departement'));
    m.flux[0].complete();
    // Les polygones ne sont pas encore là : rien n'est conclu, le dialogue reste ouvert.
    expect(m.meteo.dialogueOuvert()).toBe(true);
    expect(m.etat.degradeActif()).toBeNull();

    m.reponsesZones[0].next(zones('13', '83', '84'));
    m.reponsesZones[0].complete();
    TestBed.tick();
    expect(m.meteo.chargement()).toBe(false);
    expect(m.meteo.progression()).toBeNull();
    expect(m.meteo.visible()).toBe(true);
    expect(m.meteo.dialogueOuvert()).toBe(false);
    expect(m.etat.degradeActif()).toBe('meteo');
    expect(m.meteo.libelle()).toBe('Température');

    // Seules les zones qui ont une valeur sont peintes (`useMeteoLayer.ts:143-157`).
    const fc = derniereDonnee(m.carte)!;
    expect(fc.features.map((f) => f.properties?.['code'])).toEqual(['13', '83']);
    expect(fc.features[0].properties).toEqual({ code: '13', nom: 'Zone 13', weather_value: 15.24, label: 'Doux', unit: '°C' });
    const fond = m.carte.getLayer(COUCHE_METEO_FOND)!;
    expect(fond['paint']).toEqual({ 'fill-color': buildColorExpression('temperature_2m', STATS, 'weather_value'), 'fill-opacity': OPACITE_METEO });
    expect(m.carte.getLayer(COUCHE_METEO_TRAIT)!['paint']).toEqual({ 'line-color': TRAIT_METEO.couleur, 'line-width': TRAIT_METEO.largeur });
    expect(visibilite(m.carte, COUCHE_METEO_FOND)).toBe('visible');
    expect(visibilite(m.carte, COUCHE_METEO_TRAIT)).toBe('visible');
  });

  it('les polygones arrivent AVANT la fin du flux : même conclusion', () => {
    const m = monter();
    m.meteo.ouvrirDialogue();
    m.meteo.appliquer(PARAMS);
    m.reponsesZones[0].next(zones('13'));
    m.reponsesZones[0].complete();
    expect(m.meteo.dialogueOuvert()).toBe(true);
    m.flux[0].next(fini('departement'));
    m.flux[0].complete();
    TestBed.tick();
    expect(m.meteo.dialogueOuvert()).toBe(false);
    expect(derniereDonnee(m.carte)!.features).toHaveLength(1);
  });

  it('échec du flux (ligne `error`) : dialogue OUVERT avec le message, rien de peint, aucun dégradé', () => {
    const m = monter();
    m.meteo.ouvrirDialogue();
    m.meteo.appliquer(PARAMS);
    m.reponsesZones[0].next(zones('13'));
    m.reponsesZones[0].complete();
    m.flux[0].next({ status: 'error', error: 'Open-Meteo 503: indisponible' });
    TestBed.tick();
    expect(m.meteo.erreur()).toBe('Open-Meteo 503: indisponible');
    expect(m.meteo.chargement()).toBe(false);
    expect(m.meteo.dialogueOuvert()).toBe(true);
    expect(m.meteo.visible()).toBe(false);
    expect(m.etat.degradeActif()).toBeNull();
    expect(m.carte.getLayer(COUCHE_METEO_FOND)).toBeUndefined();
  });

  it('échec des POLYGONES, flux réussi : dit, dialogue OUVERT, aucun dégradé, flux annulé (revue 1, I1)', () => {
    const m = monter();
    m.meteo.ouvrirDialogue();
    m.meteo.appliquer(PARAMS);
    m.reponsesZones[0].error(new HttpErrorResponse({ status: 500, error: '{"error":"boom"}' }));
    TestBed.tick();
    expect(m.meteo.erreur()).toBe('Contours des zones indisponibles — réessayez dans quelques instants.');
    expect([m.meteo.chargement(), m.meteo.dialogueOuvert(), m.meteo.visible(), m.etat.degradeActif()]).toEqual([false, true, false, null]);
    expect(m.flux[0].observed).toBe(false);
    expect(m.carte.getLayer(COUCHE_METEO_FOND)).toBeUndefined();
  });

  it('échec des polygones APRÈS une application réussie : l’ancien affichage n’est pas présenté comme le nouveau', () => {
    const m = monter();
    appliquerJusquauBout(m);
    m.meteo.ouvrirDialogue();
    m.meteo.appliquer({ ...PARAMS, scale: 'region' });
    m.flux[1].next(fini('region'));
    m.flux[1].complete();
    m.reponsesZones[1].error(new Error('coupure'));
    TestBed.tick();
    expect(m.meteo.dialogueOuvert()).toBe(true);
    expect(m.meteo.libelle()).toBeNull();
    expect(derniereDonnee(m.carte)!.features).toEqual([]);
    expect(visibilite(m.carte, COUCHE_METEO_FOND)).toBe('none');
  });

  it('échec réseau (statut 0) : le message commun de l’application, jamais « HTTP 0 »', () => {
    const m = monter();
    m.meteo.appliquer(PARAMS);
    m.flux[0].error(new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') }));
    expect(m.meteo.erreur()).toBe('L\'API ne répond pas. Le serveur Next.js (npm run dev, port 3000) est-il démarré ?');
  });

  it('échec HTTP (quota 429) : « HTTP 429 » suivi du message de la route, jamais le JSON brut', () => {
    const m = monter();
    m.meteo.ouvrirDialogue();
    m.meteo.appliquer(PARAMS);
    m.flux[0].error(new HttpErrorResponse({ status: 429, error: '{"error":"Trop de requêtes, réessayez dans 42 s"}' }));
    expect(m.meteo.erreur()).toBe('HTTP 429 Trop de requêtes, réessayez dans 42 s');
    expect(m.meteo.dialogueOuvert()).toBe(true);
  });

  it('échec puis données déjà affichées : les valeurs sont VIDÉES (useMeteoData.ts:282-287)', () => {
    const m = monter();
    appliquerJusquauBout(m);
    m.meteo.ouvrirDialogue();
    m.meteo.appliquer(PARAMS);
    m.flux[1].next({ status: 'error', error: 'x' });
    TestBed.tick();
    expect(derniereDonnee(m.carte)!.features).toEqual([]);
    expect(visibilite(m.carte, COUCHE_METEO_FOND)).toBe('none');
  });

  it('bbox : au code postal, celle du FILTRE s’il y en a un, sinon la carte VISIBLE ; jamais ailleurs', () => {
    const m = monter();
    m.carte.cadre = [4.2311, 43.16049, 5.81349, 43.92411];
    m.meteo.appliquer({ ...PARAMS, scale: 'cp' });
    expect(m.appels[0].params.bbox).toBe('4.231,43.160,5.813,43.924');
    m.etat.filtre.set({ type: 'departement', code: '13', label: 'Bouches-du-Rhône', bbox: [4.23, 43.16, 5.81, 43.92] });
    m.meteo.appliquer({ ...PARAMS, scale: 'cp' });
    expect(m.appels[1].params.bbox).toBe('4.230,43.160,5.810,43.920');
    m.meteo.appliquer({ ...PARAMS, scale: 'departement' });
    m.meteo.appliquer({ ...PARAMS, scale: 'region' });
    expect([m.appels[2].params.bbox, m.appels[3].params.bbox]).toEqual([undefined, undefined]);
  });

  it('sans échelle : l’heuristique de React (plus de 30 jours → région)', () => {
    const m = monter();
    m.meteo.appliquer({ variable: 'precipitation', startDate: '2026-07-01', endDate: '2026-09-01' });
    m.meteo.appliquer({ variable: 'precipitation', startDate: '2026-09-01', endDate: '2026-09-08' });
    expect(m.appels.map((a) => a.scale)).toEqual(['region', 'departement']);
  });

  it('déplacer la carte n’appelle JAMAIS la route (quota 20/min)', () => {
    const m = monter();
    appliquerJusquauBout(m, 'cp');
    m.carte.emettre('moveend');
    m.carte.emettre('move');
    TestBed.tick();
    expect(m.appels).toHaveLength(1);
  });

  it('ré-appliquer annule la lecture en cours (abort de React)', () => {
    const m = monter();
    m.meteo.appliquer(PARAMS);
    m.meteo.appliquer({ ...PARAMS, variable: 'precipitation' });
    expect(m.flux[0].observed).toBe(false);
    expect(m.flux[1].observed).toBe(true);
  });

  it('polygones en cache pour l’écran : ré-appliquer à la même échelle ne les relit pas', () => {
    const m = monter();
    appliquerJusquauBout(m);
    m.meteo.appliquer({ ...PARAMS, variable: 'precipitation' });
    expect(m.zonesDemandees).toEqual(['departement']);
  });

  it('changement de fond (carte recréée) : re-posée avec ses valeurs, SANS relire', () => {
    const m = monter();
    appliquerJusquauBout(m);
    m.couches.publier(null);
    TestBed.tick();
    const neuve = new CarteFactice();
    neuve.styleCharge = true;
    m.couches.publier(neuve as unknown as maplibregl.Map);
    TestBed.tick();
    expect(derniereDonnee(neuve)!.features).toHaveLength(2);
    expect(visibilite(neuve, COUCHE_METEO_FOND)).toBe('visible');
    expect([m.appels.length, m.zonesDemandees.length]).toEqual([1, 1]);
  });

  it('posée à sa place dans l’ordre de React : sous le flux routier', () => {
    const m = monter();
    m.carte.addLayer({ id: 'tmja-lines', type: 'line', source: 'tmja-source' });
    appliquerJusquauBout(m);
    expect(m.carte.ordreRendu()).toEqual([COUCHE_METEO_FOND, COUCHE_METEO_TRAIT, 'tmja-lines']);
  });

  it('« Masquer » : dégradé rendu, valeurs vidées, couches masquées', () => {
    const m = monter();
    appliquerJusquauBout(m);
    m.meteo.masquer();
    TestBed.tick();
    expect(m.etat.degradeActif()).toBeNull();
    expect([m.meteo.visible(), m.meteo.libelle()]).toEqual([false, null]);
    expect(derniereDonnee(m.carte)!.features).toEqual([]);
    expect(visibilite(m.carte, COUCHE_METEO_FOND)).toBe('none');
  });

  it('évincée par un autre dégradé (IRIS) : vidée, et l’annonce nomme la météo', () => {
    const m = monter();
    appliquerJusquauBout(m);
    m.etat.basculerDegrade('iris', true);
    TestBed.tick();
    expect(m.meteo.visible()).toBe(false);
    expect(visibilite(m.carte, COUCHE_METEO_FOND)).toBe('none');
    expect(m.annonces.at(-1)).toBe('Météo a été masqué — un seul dégradé de couleur à la fois');
  });

  it('« Tout effacer » : vidée', () => {
    const m = monter();
    appliquerJusquauBout(m);
    m.couches.toutEffacer();
    TestBed.tick();
    expect([m.meteo.visible(), m.meteo.libelle()]).toEqual([false, null]);
  });

  it('clic sur une zone : popup DOM (nom, valeur fr-FR à une décimale, unité, libellé)', () => {
    const m = monter();
    appliquerJusquauBout(m);
    m.carte.emettreSurCouche('click', COUCHE_METEO_FOND, {
      lngLat: { lng: 5, lat: 43.5 },
      features: [{ properties: { nom: 'Bouches-du-Rhône', weather_value: 15.24, unit: '°C', label: 'Doux' } }],
    });
    const p = m.popups.at(-1)!;
    expect(p.options).toMatchObject({ closeButton: false, maxWidth: '240px' });
    expect(p.contenu!.textContent).toBe('Bouches-du-Rhône15,2 °CDoux');
  });

  it('dialogue fermé pendant le chargement : la lecture continue et conclut (React)', () => {
    const m = monter();
    m.meteo.ouvrirDialogue();
    m.meteo.appliquer(PARAMS);
    m.meteo.fermerDialogue();
    m.flux[0].next(fini('departement'));
    m.flux[0].complete();
    m.reponsesZones[0].next(zones('13'));
    m.reponsesZones[0].complete();
    TestBed.tick();
    expect([m.meteo.visible(), m.etat.degradeActif(), m.meteo.dialogueOuvert()]).toEqual([true, 'meteo', false]);
  });
});
