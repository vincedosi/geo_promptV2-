import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { Subject } from 'rxjs';
import { FABRIQUE_POPUP } from '../../../carte/fabrique-carte';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import {
  CiviqueApi, type EchelleSante, type JeuSante, type LigneDepartement, type LigneIngestion, type ReponseSanteCp,
} from '../data/civique.api';
import { AnnonceService } from '../etat/annonce.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { BBOX_METRO } from '../logique/filtre';
import { COUCHE_SANTE_FOND, COUCHE_SANTE_TRAIT, SOURCE_SANTE } from './couche-civique';
import { SanteService } from './sante.service';

class PopupFactice {
  contenu: HTMLElement | null = null;
  retiree = false;
  constructor(readonly options: maplibregl.PopupOptions) {}
  setLngLat() { return this; }
  setDOMContent(n: HTMLElement) { this.contenu = n; return this; }
  addTo() { return this; }
  remove() { this.retiree = true; return this; }
}

/** Sept teintes par jeu : le thème courant, résolu (jamais `var()`). */
const POLLEN = { 0: '#555555', 1: '#50f0e6', 2: '#50ccaa', 3: '#f0e641', 4: '#ff5050', 5: '#960032', 6: '#872181' };
const POLLEN_CLAIR = { 0: '#888888', 1: '#2ec4b6', 2: '#2faf91', 3: '#c9b800', 4: '#d63838', 5: '#7a0028', 6: '#6b1968' };

const zones = (...codes: string[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: codes.map((code) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { code, nom: `Zone ${code}` } })),
});
const dept = (code: string, indice: number, especes: Record<string, number> = {}): LigneDepartement => ({
  type: 'dept', code_dept: code, nom_dept: `Dept ${code}`, pollen: { indice_global: indice, especes }, air: null, stale: false,
});

function monter() {
  const zonesDemandees: EchelleSante[] = [];
  const reponsesZones: Subject<GeoJSON.FeatureCollection>[] = [];
  const flux: Subject<LigneDepartement>[] = [];
  const fluxJeux: JeuSante[] = [];
  const cp: { jeu: JeuSante; bbox: string | null }[] = [];
  const reponsesCp: Subject<ReponseSanteCp>[] = [];
  const ingestions: Subject<LigneIngestion>[] = [];
  const popups: PopupFactice[] = [];
  const theme = signal<Record<number, string>>(POLLEN);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), SanteService, CouchesCarteService, EtatCarteService,
      { provide: AnnonceService, useValue: { annoncer: () => undefined } },
      {
        provide: CiviqueApi,
        useValue: {
          zones: (e: EchelleSante) => { zonesDemandees.push(e); const s = new Subject<GeoJSON.FeatureCollection>(); reponsesZones.push(s); return s; },
          santeDepartement: (j: JeuSante) => { fluxJeux.push(j); const s = new Subject<LigneDepartement>(); flux.push(s); return s; },
          santeCp: (jeu: JeuSante, bbox: string | null) => { cp.push({ jeu, bbox }); const s = new Subject<ReponseSanteCp>(); reponsesCp.push(s); return s; },
          ingerer: () => { const s = new Subject<LigneIngestion>(); ingestions.push(s); return s; },
        },
      },
      { provide: CouleursService, useValue: { palette: () => theme } },
      { provide: FABRIQUE_POPUP, useValue: (o: maplibregl.PopupOptions) => { const p = new PopupFactice(o); popups.push(p); return p; } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  const couches = TestBed.inject(CouchesCarteService);
  couches.publier(carte as unknown as maplibregl.Map);
  return {
    sante: TestBed.inject(SanteService), etat: TestBed.inject(EtatCarteService), couches, carte, theme,
    zonesDemandees, reponsesZones, flux, fluxJeux, cp, reponsesCp, ingestions, popups,
  };
}

/** La dernière FeatureCollection posée sur la source santé. */
const derniereDonnee = (c: CarteFactice) => c.sources.get(SOURCE_SANTE)?.donnees.at(-1) as GeoJSON.FeatureCollection | undefined;
const indices = (c: CarteFactice) => derniereDonnee(c)?.features.map((f) => f.properties?.['indice'] ?? null);

describe('SanteService', () => {
  afterEach(() => vi.useRealTimers());

  it('aucun jeu : aucune requête', () => {
    const { zonesDemandees, fluxJeux, cp } = monter();
    TestBed.tick();
    expect([zonesDemandees, fluxJeux, cp]).toEqual([[], [], []]);
  });

  it('département : flux de 3 lignes → progression 1/3, 2/3, 3/3, PUIS la couche peinte', () => {
    const { sante, carte, zonesDemandees, reponsesZones, flux } = monter();
    sante.choisirJeu('pollen');
    TestBed.tick();
    expect(sante.chargement()).toBe(true);
    expect(zonesDemandees).toEqual(['departement']);
    reponsesZones[0].next(zones('13', '83', '84'));
    expect(carte.ordreRendu()).toEqual([COUCHE_SANTE_FOND, COUCHE_SANTE_TRAIT]);
    const fond = carte.getLayer(COUCHE_SANTE_FOND)!['paint'] as Record<string, unknown>;
    expect(fond['fill-color']).toEqual(['match', ['coalesce', ['get', 'indice'], -1],
      1, POLLEN[1], 2, POLLEN[2], 3, POLLEN[3], 4, POLLEN[4], 5, POLLEN[5], 6, POLLEN[6], 'rgba(0,0,0,0)']);
    expect(fond['fill-opacity']).toBe(0.55);
    expect(carte.getLayer(COUCHE_SANTE_TRAIT)!['paint']).toEqual({ 'line-color': POLLEN[0], 'line-width': 0.4, 'line-opacity': 0.5 });

    const progres: string[] = [];
    flux[0].next({ type: 'meta', total: 3 });
    for (const [i, code] of ['13', '83', '84'].entries()) {
      flux[0].next(dept(code, i + 2));
      const p = sante.progression();
      progres.push(`${p?.done}/${p?.total}`);
    }
    expect(progres).toEqual(['1/3', '2/3', '3/3']);
    flux[0].next({ type: 'done' });
    flux[0].complete();
    expect(indices(carte)).toEqual([2, 3, 4]);
    expect(sante.chargement()).toBe(false);
    expect(JSON.stringify(carte.couches)).not.toContain('var(');
  });

  it('seuil et métrique : repeints SANS nouvelle requête ; 0 n’est jamais peint', () => {
    const { sante, carte, reponsesZones, flux, zonesDemandees, fluxJeux } = monter();
    sante.choisirJeu('pollen');
    TestBed.tick();
    reponsesZones[0].next(zones('13', '83'));
    flux[0].next({ type: 'meta', total: 2 });
    flux[0].next(dept('13', 2, { ambroisie: 5 }));
    flux[0].next(dept('83', 4, { ambroisie: 0 }));
    flux[0].complete();
    expect(indices(carte)).toEqual([2, 4]);
    sante.seuil.set(3);
    TestBed.tick();
    expect(indices(carte)).toEqual([null, 4]);
    sante.metrique.set('ambroisie');
    sante.seuil.set(0);
    TestBed.tick();
    expect(indices(carte)).toEqual([5, null]);
    expect(zonesDemandees).toHaveLength(1);
    expect(fluxJeux).toHaveLength(1);
  });

  it('changer de jeu (pollen ↔ air) remet la métrique à « global » et la progression à null', () => {
    const { sante, reponsesZones, flux } = monter();
    sante.choisirJeu('pollen');
    TestBed.tick();
    reponsesZones[0].next(zones('13'));
    flux[0].next({ type: 'meta', total: 1 });
    flux[0].next(dept('13', 2));
    sante.metrique.set('ambroisie');
    expect(sante.progression()).toEqual({ done: 1, total: 1 });
    sante.choisirJeu('atmo');
    expect(sante.metrique()).toBe('global');
    expect(sante.progression()).toBeNull();
    sante.choisirEchelle('cp');
    expect(sante.progression()).toBeNull();
  });

  it('zones lues UNE fois par échelle et par écran (cache avant appel)', () => {
    const { sante, reponsesZones, zonesDemandees, flux } = monter();
    sante.choisirJeu('pollen');
    TestBed.tick();
    reponsesZones[0].next(zones('13'));
    flux[0].complete();
    sante.choisirJeu('atmo');
    TestBed.tick();
    expect(zonesDemandees).toEqual(['departement']);
    expect(flux).toHaveLength(2);
  });

  it('code postal SANS filtre : aucune bbox ; filtre département : bbox = BBOX_METRO ; filtre « france » : aucune', () => {
    const { sante, etat, reponsesZones, cp } = monter();
    sante.choisirJeu('pollen');
    sante.choisirEchelle('cp');
    TestBed.tick();
    reponsesZones[0].next(zones('13001'));
    expect(cp).toEqual([{ jeu: 'pollen', bbox: null }]);
    etat.filtre.set({ type: 'departement', code: '13', label: 'Bouches-du-Rhône' });
    TestBed.tick();
    expect(cp.at(-1)).toEqual({ jeu: 'pollen', bbox: BBOX_METRO.join(',') });
    etat.filtre.set({ type: 'france', code: 'france', label: 'France entière' });
    TestBed.tick();
    expect(cp.at(-1)).toEqual({ jeu: 'pollen', bbox: null });
  });

  it('au département, un changement de filtre ne relit RIEN', () => {
    const { sante, etat, reponsesZones, flux } = monter();
    sante.choisirJeu('pollen');
    TestBed.tick();
    reponsesZones[0].next(zones('13'));
    etat.filtre.set({ type: 'departement', code: '13', label: 'Bouches-du-Rhône' });
    TestBed.tick();
    expect(flux).toHaveLength(1);
  });

  it('code postal : date du 2026-09-17 → statut « ok », la date gardée ; date null → « no_data »', () => {
    const { sante, reponsesZones, reponsesCp, carte } = monter();
    sante.choisirJeu('pollen');
    sante.choisirEchelle('cp');
    TestBed.tick();
    reponsesZones[0].next(zones('13001', '13002'));
    reponsesCp[0].next({ date: '2026-09-17', rows: [{ code_postal: '13001', indice_global: 3, nb_communes: 1, ambroisie: 2 }] });
    expect(sante.statutCp()).toBe('ok');
    expect(sante.dateCp()).toBe('2026-09-17');
    expect(indices(carte)).toEqual([3, null]);
    sante.rafraichir();
    TestBed.tick();
    reponsesCp[1].next({ date: null, rows: [], error: 'no_data' });
    expect(sante.statutCp()).toBe('no_data');
    expect(sante.dateCp()).toBeNull();
  });

  it('thème basculé : les aplats et le trait sont REPEINTS dans les teintes du nouveau thème', () => {
    const { sante, carte, reponsesZones, theme } = monter();
    sante.choisirJeu('pollen');
    TestBed.tick();
    reponsesZones[0].next(zones('13'));
    theme.set(POLLEN_CLAIR);
    TestBed.tick();
    const derniere = (prop: string) => carte.peintures.filter((p) => p.propriete === prop).at(-1)?.valeur as unknown[];
    expect(derniere('fill-color')).toContain(POLLEN_CLAIR[4]);
    expect(derniere('line-color')).toBe(POLLEN_CLAIR[0]);
  });

  it('clic sur une zone : popup DOM — indice global, détail par espèce, mention ODbL', () => {
    const { sante, carte, reponsesZones, flux, popups } = monter();
    sante.choisirJeu('pollen');
    TestBed.tick();
    reponsesZones[0].next(zones('13'));
    flux[0].next({ type: 'meta', total: 1 });
    flux[0].next({ ...dept('13', 4, { ambroisie: 4, graminees: 2 }), pollen: { indice_global: 4, especes: { ambroisie: 4, graminees: 2 }, concentrations: { ambroisie: 12.4 }, alerte: true } });
    flux[0].complete();
    carte.emettreSurCouche('click', COUCHE_SANTE_FOND, { lngLat: { lng: 5, lat: 43 }, features: [{ properties: { code: '13', nom: 'Bouches-du-Rhône' } }] });
    const t = popups[0].contenu!.textContent!;
    expect(t).toContain('Bouches-du-Rhône (13)');
    expect(t).toContain('Indice pollen 4/6 — élevé');
    expect(t).toContain('⚠ Alerte pollen Atmo France');
    expect(t).toContain('Ambroisie');
    expect(t).toContain('4 — élevé · 12 grains/m³');
    expect(t).toContain('Source : Atmo France et les AASQA (ODbL) — échantillon : 1 commune par département');
  });

  it('jeu éteint ou évincé : couches retirées ; « Tout effacer » : jeu et progression à null', () => {
    const { sante, etat, carte, reponsesZones, couches } = monter();
    sante.choisirJeu('pollen');
    TestBed.tick();
    reponsesZones[0].next(zones('13'));
    etat.basculerDegrade('carreaux', true);
    TestBed.tick();
    expect(sante.jeu()).toBeNull();
    expect(carte.getLayer(COUCHE_SANTE_FOND)).toBeUndefined();
    sante.choisirJeu('atmo');
    couches.toutEffacer();
    TestBed.tick();
    expect(sante.jeu()).toBeNull();
    expect(sante.progression()).toBeNull();
  });

  it('carte recréée : re-posée et repeinte SANS relire ni les zones ni le flux', () => {
    const { sante, couches, reponsesZones, flux, zonesDemandees } = monter();
    sante.choisirJeu('pollen');
    TestBed.tick();
    reponsesZones[0].next(zones('13'));
    flux[0].next({ type: 'meta', total: 1 });
    flux[0].next(dept('13', 5));
    flux[0].complete();
    couches.publier(null);
    TestBed.tick();
    const nouvelle = new CarteFactice();
    nouvelle.styleCharge = true;
    couches.publier(nouvelle as unknown as maplibregl.Map);
    TestBed.tick();
    expect(zonesDemandees).toHaveLength(1);
    expect(flux).toHaveLength(1);
    expect(indices(nouvelle)).toEqual([5]);
  });

  it('ingestion : progression, puis « Terminé : … » et la couche relue ; 403 → « Réservé aux administrateurs. »', () => {
    const { sante, ingestions, reponsesZones, cp } = monter();
    sante.choisirJeu('pollen');
    sante.choisirEchelle('cp');
    TestBed.tick();
    reponsesZones[0].next(zones('13001'));
    sante.ingerer();
    expect(sante.ingestion()).toEqual({ running: true, message: 'Démarrage…', error: null });
    ingestions[0].next({ type: 'progress', message: 'Pollen : 3/10' });
    expect(sante.ingestion().message).toBe('Pollen : 3/10');
    ingestions[0].next({ type: 'done', summary: { pollen: { cps_written: 6100 }, atmo: { cps_written: 6050 } } });
    expect(sante.ingestion()).toEqual({ running: false, message: 'Terminé : pollen 6100 CP · air 6050 CP', error: null });
    TestBed.tick();
    expect(cp).toHaveLength(2);

    sante.ingerer();
    ingestions[1].error(new HttpErrorResponse({ status: 403 }));
    expect(sante.ingestion()).toEqual({ running: false, message: null, error: 'Réservé aux administrateurs.' });
    sante.ingerer();
    ingestions[2].next({ type: 'error', message: 'WFS indisponible' });
    expect(sante.ingestion().error).toBe('WFS indisponible');
  });
});
