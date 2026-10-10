import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { Subject } from 'rxjs';
import { FABRIQUE_POPUP } from '../../../carte/fabrique-carte';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import {
  type CollectionSitesRisque, type ExpositionSite, type FiltresCarteRisque, SitesRisqueApi,
} from '../../risques/data/sites-risque.api';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { RisqueCarteService } from '../etat/risque-carte.service';
import {
  COUCHE_RISQUES_HALO, COUCHE_RISQUES_POINT, COUCHE_RISQUES_ZONE, COUCHE_RISQUES_ZONE_CONTOUR,
  SOURCE_RISQUES_POINTS, SOURCE_RISQUES_ZONES,
} from './couche-risques';
import { RisquesIndustrielsService } from './risques-industriels.service';

class PopupFactice {
  contenu: HTMLElement | null = null;
  lieu: unknown = null;
  retiree = false;
  constructor(readonly options: maplibregl.PopupOptions) {}
  setLngLat(l: unknown) { this.lieu = l; return this; }
  setDOMContent(n: HTMLElement) { this.contenu = n; return this; }
  addTo() { return this; }
  remove() { this.retiree = true; return this; }
}

const SOMBRE = {
  toxique: '#e66767', inflammable: '#b88a00', pollution: '#008300', autres: '#3987e5', non_precise: '#9aa0a6',
  contour: 'rgba(255,255,255,0.9)',
};
const CLAIR = {
  toxique: '#e34948', inflammable: '#eda100', pollution: '#008300', autres: '#2a78d6', non_precise: '#9aa0a6',
  contour: 'rgba(26,26,26,0.85)',
};

function collection(n: number, extra: Partial<CollectionSitesRisque> = {}): CollectionSitesRisque {
  return {
    type: 'FeatureCollection',
    features: Array.from({ length: n }, (_, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [5 + i / 100, 43.4] as [number, number] },
      properties: {
        id: `s${i}`, nom: `Site ${i}`, type_risque: 'toxique', gravite: 'seveso_haut', statut_zone: 'pprt',
        natures_risque: ['Toxicité aiguë', 'Explosibles'], rubriques: [{ numero: '4110', nature: 'Toxicité aiguë' }],
        lat: 43.4, lng: 5,
      },
    })),
    n_total: n, n_rendus: n, n_avec_pprt: 1,
    ...extra,
  };
}

function monter() {
  const appels: { bbox: string; f: FiltresCarteRisque }[] = [];
  const reponses: Subject<CollectionSitesRisque>[] = [];
  const expositions: string[] = [];
  const reponsesExpo: Subject<ExpositionSite>[] = [];
  const popups: PopupFactice[] = [];
  const theme = signal<Record<string, string>>(SOMBRE);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), RisquesIndustrielsService, RisqueCarteService, CouchesCarteService,
      {
        provide: SitesRisqueApi,
        useValue: {
          carte: (bbox: string, f: FiltresCarteRisque) => {
            appels.push({ bbox, f }); const s = new Subject<CollectionSitesRisque>(); reponses.push(s); return s;
          },
          exposition: (id: string) => { expositions.push(id); const s = new Subject<ExpositionSite>(); reponsesExpo.push(s); return s; },
        },
      },
      { provide: CouleursService, useValue: { palette: () => theme } },
      { provide: FABRIQUE_POPUP, useValue: (o: maplibregl.PopupOptions) => { const p = new PopupFactice(o); popups.push(p); return p; } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  carte.cadre = [4.9, 43.3, 5.3, 43.6];
  const couches = TestBed.inject(CouchesCarteService);
  couches.publier(carte as unknown as maplibregl.Map);
  return {
    service: TestBed.inject(RisquesIndustrielsService), etat: TestBed.inject(RisqueCarteService),
    couches, carte, appels, reponses, expositions, reponsesExpo, popups, theme,
  };
}

describe('RisquesIndustrielsService', () => {
  afterEach(() => vi.useRealTimers());

  it('éteinte : aucune requête, rien de posé', () => {
    const { appels, carte } = monter();
    TestBed.tick();
    expect(appels).toEqual([]);
    expect(carte.sources.size).toBe(0);
  });

  it('défaut : UNE requête sur la bbox VISIBLE, gravites Seveso, SANS natures ni rayon', () => {
    const { etat, appels } = monter();
    etat.actif.set(true);
    TestBed.tick();
    expect(appels).toHaveLength(1);
    expect(appels[0].bbox).toBe('4.9000,43.3000,5.3000,43.6000');
    expect(appels[0].f).toEqual({ gravites: ['seveso_haut', 'seveso_bas'], natures: [], inclureInactifs: false, rayonM: 0 });
  });

  it('réponse : sources, quatre couches au sommet dans l’ordre de React, couleurs RÉSOLUES, compte remonté', () => {
    const { etat, reponses, carte } = monter();
    etat.actif.set(true);
    TestBed.tick();
    reponses[0].next(collection(3, { n_total: 5, n_avec_pprt: 2 }));
    TestBed.tick();
    expect(carte.sources.has(SOURCE_RISQUES_POINTS)).toBe(true);
    expect(carte.sources.has(SOURCE_RISQUES_ZONES)).toBe(true);
    expect(carte.ordreRendu()).toEqual([COUCHE_RISQUES_ZONE, COUCHE_RISQUES_ZONE_CONTOUR, COUCHE_RISQUES_HALO, COUCHE_RISQUES_POINT]);
    expect(carte.couches.every((c) => c.avant === undefined)).toBe(true);
    const point = carte.getLayer(COUCHE_RISQUES_POINT)!['paint'] as Record<string, unknown>;
    expect(point['circle-color']).toEqual(['match', ['get', 'type_risque'],
      'toxique', '#e66767', 'inflammable', '#b88a00', 'pollution', '#008300', 'autres', '#3987e5', '#9aa0a6']);
    expect(point['circle-stroke-color']).toBe('rgba(255,255,255,0.9)');
    expect((carte.getLayer(COUCHE_RISQUES_ZONE_CONTOUR)!['paint'] as Record<string, unknown>)['line-dasharray']).toEqual([2, 2]);
    expect(JSON.stringify(carte.couches)).not.toContain('var(');
    expect(etat.compte()).toEqual({ rendus: 3, total: 5, avecPprt: 2 });
  });

  it('cocher un type → `natures` = les libellés du type (+ « Nature non précisée » pour non_precise)', () => {
    const { etat, appels } = monter();
    etat.actif.set(true);
    TestBed.tick();
    etat.typesRisque.set(['inflammable']);
    TestBed.tick();
    expect(appels).toHaveLength(2);
    expect(appels[1].f.natures).toEqual(['Explosibles', 'GPL et produits pétroliers', 'Gaz et liquides inflammables',
      'Inflammables (ancienne nomenclature)']);
    etat.typesRisque.set(['toxique', 'non_precise']);
    TestBed.tick();
    expect(appels[2].f.natures).toEqual(['Toxicité aiguë', 'Nature non précisée']);
  });

  it('rayon 500 → `rayonM` 500 en requête ; la zone devient visible', () => {
    const { etat, appels, reponses, carte } = monter();
    etat.actif.set(true);
    TestBed.tick();
    reponses[0].next(collection(1));
    TestBed.tick();
    expect(carte.getLayer(COUCHE_RISQUES_ZONE)!['layout']).toEqual({ visibility: 'none' });
    etat.rayonM.set(500);
    TestBed.tick();
    expect(appels[1].f.rayonM).toBe(500);
    expect(carte.getLayer(COUCHE_RISQUES_ZONE)!['layout']).toEqual({ visibility: 'visible' });
    expect(carte.getLayer(COUCHE_RISQUES_ZONE_CONTOUR)!['layout']).toEqual({ visibility: 'visible' });
  });

  it('deux `moveend` rapprochés → UNE requête après 350 ms de calme, la précédente ANNULÉE', () => {
    vi.useFakeTimers();
    const { etat, appels, reponses, carte } = monter();
    etat.actif.set(true);
    TestBed.tick();
    expect(appels).toHaveLength(1);
    carte.cadre = [5, 43.3, 5.4, 43.6];
    carte.emettre('moveend');
    vi.advanceTimersByTime(200);
    carte.cadre = [5.1, 43.3, 5.5, 43.6];
    carte.emettre('moveend');
    vi.advanceTimersByTime(349);
    expect(appels).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(appels).toHaveLength(2);
    expect(appels[1].bbox).toBe('5.1000,43.3000,5.5000,43.6000');
    expect(reponses[0].observed).toBe(false);
    expect(reponses[1].observed).toBe(true);
  });

  it('`moveend` sans déplacement : aucune relecture', () => {
    vi.useFakeTimers();
    const { etat, appels, reponses, carte } = monter();
    etat.actif.set(true);
    TestBed.tick();
    reponses[0].next(collection(1));
    carte.emettre('moveend');
    vi.advanceTimersByTime(400);
    expect(appels).toHaveLength(1);
  });

  it('halo décoché : visibilité seule, AUCUNE requête (React relisait)', () => {
    const { etat, appels, reponses, carte } = monter();
    etat.actif.set(true);
    TestBed.tick();
    reponses[0].next(collection(1));
    TestBed.tick();
    etat.afficherHalo.set(false);
    TestBed.tick();
    expect(appels).toHaveLength(1);
    expect(carte.getLayer(COUCHE_RISQUES_HALO)!['layout']).toEqual({ visibility: 'none' });
  });

  it('bascule de thème → `setPaintProperty` (couleurs et cerne inversé), aucun `addSource`, aucune requête', () => {
    const { etat, appels, reponses, carte, theme } = monter();
    etat.actif.set(true);
    TestBed.tick();
    reponses[0].next(collection(1));
    TestBed.tick();
    const sources = [...carte.sources.keys()];
    const nCouches = carte.couches.length;
    carte.peintures.length = 0;
    theme.set(CLAIR);
    TestBed.tick();
    expect(appels).toHaveLength(1);
    expect([...carte.sources.keys()]).toEqual(sources);
    expect(carte.couches).toHaveLength(nCouches);
    expect(carte.peintures).toContainEqual({ couche: COUCHE_RISQUES_POINT, propriete: 'circle-stroke-color', valeur: 'rgba(26,26,26,0.85)' });
    expect(carte.peintures).toContainEqual({
      couche: COUCHE_RISQUES_HALO, propriete: 'circle-color',
      valeur: ['match', ['get', 'type_risque'], 'toxique', '#e34948', 'inflammable', '#eda100', 'pollution', '#008300',
        'autres', '#2a78d6', '#9aa0a6'],
    });
  });

  it('éteinte : couches et sources retirées, écouteurs du point retirés, compte REMIS à null (défaut React corrigé)', () => {
    const { etat, reponses, carte } = monter();
    etat.actif.set(true);
    TestBed.tick();
    reponses[0].next(collection(1));
    TestBed.tick();
    expect(carte.nombreEcouteurs(`click:${COUCHE_RISQUES_POINT}`)).toBe(1);
    expect(etat.compte()).not.toBeNull();
    etat.actif.set(false);
    TestBed.tick();
    expect(carte.couches).toHaveLength(0);
    expect(carte.sources.size).toBe(0);
    expect(carte.nombreEcouteurs(`click:${COUCHE_RISQUES_POINT}`)).toBe(0);
    expect(etat.compte()).toBeNull();
  });

  it('décocher / recocher trois fois : UN seul écouteur de clic (défaut R-03 de React)', () => {
    const { etat, reponses, carte } = monter();
    for (let i = 0; i < 3; i++) {
      etat.actif.set(true);
      TestBed.tick();
      reponses[reponses.length - 1].next(collection(1));
      TestBed.tick();
      if (i < 2) { etat.actif.set(false); TestBed.tick(); }
    }
    expect(carte.nombreEcouteurs(`click:${COUCHE_RISQUES_POINT}`)).toBe(1);
  });

  it('carte recréée (changement de fond, B11) : couches re-posées SANS nouvelle requête', () => {
    const { etat, appels, reponses, couches } = monter();
    etat.actif.set(true);
    TestBed.tick();
    reponses[0].next(collection(2));
    TestBed.tick();
    couches.publier(null);
    TestBed.tick();
    const neuve = new CarteFactice();
    neuve.styleCharge = true;
    neuve.cadre = [4.9, 43.3, 5.3, 43.6];
    couches.publier(neuve as unknown as maplibregl.Map);
    TestBed.tick();
    expect(appels).toHaveLength(1);
    expect(neuve.ordreRendu()).toEqual([COUCHE_RISQUES_ZONE, COUCHE_RISQUES_ZONE_CONTOUR, COUCHE_RISQUES_HALO, COUCHE_RISQUES_POINT]);
    expect(neuve.sources.get(SOURCE_RISQUES_POINTS)!.donnees).toHaveLength(1);
  });

  it('échec de lecture : DIT (React se taisait), puis effacé au succès suivant', () => {
    vi.useFakeTimers();
    const { service, etat, reponses, carte } = monter();
    etat.actif.set(true);
    TestBed.tick();
    reponses[0].error(new HttpErrorResponse({ status: 500, error: { error: 'boum' } }));
    expect(service.erreur()).toBe('boum');
    carte.cadre = [5, 43.3, 5.4, 43.6];
    carte.emettre('moveend');
    vi.advanceTimersByTime(350);
    reponses[1].next(collection(1));
    expect(service.erreur()).toBeNull();
  });

  it('clic sur un site : popup TOUT DE SUITE (statut, rubriques), population exposée remplie à l’arrivée', () => {
    const { etat, reponses, carte, popups, expositions, reponsesExpo } = monter();
    etat.actif.set(true);
    TestBed.tick();
    const c = collection(1);
    reponses[0].next(c);
    TestBed.tick();
    carte.emettreSurCouche('click', COUCHE_RISQUES_POINT, {
      features: [{ geometry: c.features[0].geometry, properties: { ...c.features[0].properties, natures_risque: undefined } }],
      lngLat: { lng: 0, lat: 0 },
    });
    expect(popups).toHaveLength(1);
    expect(popups[0].options).toEqual({ offset: 10, maxWidth: '340px' });
    expect(popups[0].lieu).toEqual([5, 43.4]);
    const texte = popups[0].contenu!.textContent!;
    expect(texte).toContain('Site 0');
    expect(texte).toContain('Toxique');
    expect(texte).toContain('Seveso seuil haut');
    expect(texte).toContain('Autres risques');
    expect(texte).toContain('Périmètre PPRT');
    expect(texte).toContain('4110 Toxicité aiguë');
    expect(texte).toContain('Population exposée — calcul…');
    expect(expositions).toEqual(['s0']);
    reponsesExpo[0].next({
      mode: 'buffer', indicatif: true,
      paliers: [{ palier: '500', libelle: '500 m', pop_exposee: 1200, pop_couronne: 1200 },
        { palier: '1000', libelle: '1 km', pop_exposee: 3400, pop_couronne: 2200 }],
    });
    const bloc = popups[0].contenu!.querySelector('[data-exposition]')!;
    expect(bloc.textContent).toContain('Population exposée');
    expect(bloc.textContent).toContain('3 400 (+2 200)');
    expect(bloc.textContent).toContain('aucune valeur réglementaire');
  });

  it('deuxième clic : la population exposée du premier est ANNULÉE', () => {
    const { etat, reponses, carte, popups, reponsesExpo } = monter();
    etat.actif.set(true);
    TestBed.tick();
    const c = collection(2);
    reponses[0].next(c);
    TestBed.tick();
    for (const f of c.features) {
      carte.emettreSurCouche('click', COUCHE_RISQUES_POINT, { features: [f], lngLat: { lng: 0, lat: 0 } });
    }
    expect(popups[0].retiree).toBe(true);
    expect(reponsesExpo[0].observed).toBe(false);
  });
});
