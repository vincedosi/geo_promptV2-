import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { Subject } from 'rxjs';
import { FABRIQUE_POPUP } from '../../../carte/fabrique-carte';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CiviqueApi } from '../data/civique.api';
import { AnnonceService } from '../etat/annonce.service';
import { ContoursZonesService } from '../etat/contours-zones.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import type { MeteoScale } from '../logique/meteo/types';
import { OPACITE_SCORE, PALIERS_SCORE, TRAIT_SCORE } from '../logique/palettes-donnees-carte';
import { COUCHE_SCORE_FOND, COUCHE_SCORE_TRAIT, SOURCE_SCORE, type ScoreAffiche } from './couche-score';
import { ScoreService } from './score.service';

class PopupFactice {
  contenu: HTMLElement | null = null;
  constructor(readonly options: maplibregl.PopupOptions) {}
  setLngLat() { return this; }
  setDOMContent(n: HTMLElement) { this.contenu = n; return this; }
  addTo() { return this; }
  remove() { return this; }
}

const TEAL = '#4ecdc4';
const contours = (...codes: string[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: codes.map((code) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { code, nom: `Commune ${code}` } })),
});
const SCORE_13: ScoreAffiche = {
  scores: [{ code: '13001', score: 82.5, n_indicateurs: 2 }, { code: '13002', score: 12, n_indicateurs: 1 }],
  libelle: 'Revenu médian × Part des 15-29 ans',
  nIndicateurs: 2,
};

function monter() {
  const demandes: MeteoScale[] = [];
  const reponses: Subject<GeoJSON.FeatureCollection>[] = [];
  const annonces: string[] = [];
  const popups: PopupFactice[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), ScoreService, CouchesCarteService, EtatCarteService, ContoursZonesService,
      { provide: AnnonceService, useValue: { annoncer: (m: string) => annonces.push(m) } },
      { provide: CiviqueApi, useValue: { zones: (e: MeteoScale) => { demandes.push(e); const s = new Subject<GeoJSON.FeatureCollection>(); reponses.push(s); return s; } } },
      { provide: CouleursService, useValue: { palette: () => signal({ teal: TEAL }) } },
      { provide: FABRIQUE_POPUP, useValue: (o: maplibregl.PopupOptions) => { const p = new PopupFactice(o); popups.push(p); return p; } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  const couches = TestBed.inject(CouchesCarteService);
  couches.publier(carte as unknown as maplibregl.Map);
  const repondre = (fc = contours('13001', '13002', '13003')) => {
    reponses.at(-1)!.next(fc);
    reponses.at(-1)!.complete();
    TestBed.tick();
  };
  return {
    score: TestBed.inject(ScoreService), etat: TestBed.inject(EtatCarteService), couches, carte, demandes, reponses, annonces, popups, repondre,
  };
}

/** Les dernières données de la source : le dernier `setData`, sinon celles de sa création. */
const donnees = (c: CarteFactice) => {
  const s = c.sources.get(SOURCE_SCORE);
  return (s?.donnees.at(-1) ?? (s?.spec as { data?: unknown } | undefined)?.data) as GeoJSON.FeatureCollection | undefined;
};

describe('ScoreService (ScoreMapLayer.tsx)', () => {
  it('rien d’affiché : aucune requête, rien de posé (pas de préchargement des contours)', () => {
    const m = monter();
    TestBed.tick();
    expect(m.demandes).toEqual([]);
    expect(m.carte.getLayer(COUCHE_SCORE_FOND)).toBeUndefined();
  });

  it('afficher : réclame le dégradé `score`, lit les contours CP UNE fois, peint les seuls CP scorés', () => {
    const m = monter();
    m.score.afficher(SCORE_13);
    expect(m.etat.degradeActif()).toBe('score');
    expect(m.demandes).toEqual(['cp']);
    expect(m.score.chargement()).toBe(true);
    m.repondre();
    expect(m.score.chargement()).toBe(false);
    const fc = donnees(m.carte)!;
    expect(fc.features.map((f) => f.properties)).toEqual([
      { code: '13001', nom: 'Commune 13001', score: 82.5, n_indicateurs: 2, partiel: false },
      { code: '13002', nom: 'Commune 13002', score: 12, n_indicateurs: 1, partiel: true },
    ]);
    const fond = m.carte.getLayer(COUCHE_SCORE_FOND)!;
    const paint = fond['paint'] as Record<string, unknown>;
    expect(paint['fill-color']).toEqual([
      'case', ['<', ['coalesce', ['get', 'score'], -1], 0], 'rgba(0,0,0,0)',
      ['interpolate', ['linear'], ['coalesce', ['get', 'score'], -1], ...PALIERS_SCORE.flat(), 100, TEAL],
    ]);
    expect(paint['fill-opacity']).toEqual(['case', ['==', ['get', 'partiel'], true], OPACITE_SCORE.partiel, OPACITE_SCORE.complet]);
    expect(m.carte.getLayer(COUCHE_SCORE_TRAIT)!['paint']).toEqual({ 'line-color': TRAIT_SCORE.couleur, 'line-width': TRAIT_SCORE.largeur });
    expect(m.score.partiels()).toBe(1);
    expect(m.annonces).toEqual([]);

    // Un second score réutilise les contours : aucune nouvelle lecture, et pas de seconde réclamation du dégradé.
    m.score.afficher({ ...SCORE_13, scores: [SCORE_13.scores[0]] });
    TestBed.tick();
    expect(m.demandes).toEqual(['cp']);
    expect(donnees(m.carte)!.features).toHaveLength(1);
  });

  it('le score évince le dégradé actif (annoncé) ; un autre dégradé évince le score et retire sa couche', () => {
    const m = monter();
    m.etat.basculerDegrade('iris', true);
    m.score.afficher(SCORE_13);
    expect(m.annonces).toEqual(['IRIS a été masqué — un seul dégradé de couleur à la fois']);
    m.repondre();
    m.etat.basculerDegrade('carreaux', true);
    TestBed.tick();
    expect(m.annonces.at(-1)).toBe('Score composite a été masqué — un seul dégradé de couleur à la fois');
    expect(m.score.affiche()).toBeNull();
    expect(m.carte.getLayer(COUCHE_SCORE_FOND)).toBeUndefined();
    expect(m.carte.sources.has(SOURCE_SCORE)).toBe(false);
  });

  it('éteindre (croix de la carte flottante) : dégradé rendu par basculerDegrade(\'score\', false), couche retirée', () => {
    const m = monter();
    m.score.afficher(SCORE_13);
    m.repondre();
    m.score.eteindre();
    TestBed.tick();
    expect(m.etat.degradeActif()).toBeNull();
    expect(m.carte.getLayer(COUCHE_SCORE_FOND)).toBeUndefined();
    expect(m.annonces).toEqual([]);
  });

  it('afficher un score VIDE éteint (le `scores: []` de SCORE_MAP_EVENT)', () => {
    const m = monter();
    m.score.afficher(SCORE_13);
    m.score.afficher({ scores: [], libelle: '', nIndicateurs: 0 });
    expect(m.etat.degradeActif()).toBeNull();
    expect(m.score.affiche()).toBeNull();
  });

  it('éteint pendant la lecture des contours : rien n’est peint ensuite (jeton d’annulation de React)', () => {
    const m = monter();
    m.score.afficher(SCORE_13);
    m.score.eteindre();
    m.repondre();
    expect(m.carte.getLayer(COUCHE_SCORE_FOND)).toBeUndefined();
  });

  it('contours indisponibles : `echec`, plus de chargement — le dégradé reste réclamé (React)', () => {
    const m = monter();
    m.score.afficher(SCORE_13);
    m.reponses.at(-1)!.error(new Error('HTTP 500'));
    TestBed.tick();
    expect([m.score.echec(), m.score.chargement(), m.etat.degradeActif()]).toEqual([true, false, 'score']);
    expect(m.carte.getLayer(COUCHE_SCORE_FOND)).toBeUndefined();
    // Un nouvel affichage relit (l'échec n'est pas retenu par le cache) et efface l'échec.
    m.score.afficher(SCORE_13);
    expect(m.demandes).toEqual(['cp', 'cp']);
    expect(m.score.echec()).toBe(false);
  });

  it('« Tout effacer » vide le score', () => {
    const m = monter();
    m.score.afficher(SCORE_13);
    m.repondre();
    m.couches.toutEffacer();
    TestBed.tick();
    expect(m.score.affiche()).toBeNull();
    expect(m.carte.getLayer(COUCHE_SCORE_FOND)).toBeUndefined();
  });

  it('carte recréée (changement de fond) : la couche est re-posée sans relire les contours', () => {
    const m = monter();
    m.score.afficher(SCORE_13);
    m.repondre();
    const autre = new CarteFactice();
    autre.styleCharge = true;
    m.couches.publier(null);
    TestBed.tick();
    m.couches.publier(autre as unknown as maplibregl.Map);
    TestBed.tick();
    expect(autre.getLayer(COUCHE_SCORE_FOND)).toBeDefined();
    expect(donnees(autre)!.features).toHaveLength(2);
    expect(m.demandes).toEqual(['cp']);
  });

  it('clic sur un CP : popup « code — nom », score /100 à une décimale, « sur N indicateurs — partiel, non comparable »', () => {
    const m = monter();
    m.score.afficher(SCORE_13);
    m.repondre();
    m.carte.emettreSurCouche('click', COUCHE_SCORE_FOND, {
      lngLat: { lng: 5.4, lat: 43.3 },
      features: [{ properties: { code: '13002', nom: 'Marseille <b>2e</b>', score: 12, n_indicateurs: 1, partiel: true } }],
    });
    const texte = m.popups.at(-1)!.contenu!.textContent;
    expect(texte).toBe('13002 — Marseille <b>2e</b>12.0/100sur 1 indicateur — partiel, non comparable');
    expect(m.popups.at(-1)!.contenu!.querySelector('b')).toBeNull();
  });
});
