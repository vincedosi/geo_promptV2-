import { type Signal, computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { Subject, of, throwError } from 'rxjs';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarteApi } from '../data/carte.api';
import { CouchesCarteService } from '../etat/couches-carte.service';
import type { DetailCampagneOoh, ReponseCampagnesOoh } from '../logique/campagnes-ooh';
import { DETAIL_ESSAI } from '../testing/campagnes-ooh.fixture';
import { CampagneOohService } from './campagne-ooh.service';
import { COUCHE_CAMPAGNE_OOH_POINTS, SOURCE_CAMPAGNE_OOH, expressionCouleurLigne } from './couche-campagne-ooh';
import { PoisService } from './pois.service';

const TEINTES = {
  l1: '#e8a33d', l2: '#4f9fe0', l3: '#d9667f', l4: '#5cc08a', l5: '#e0d05a', l6: '#5d7fc4', l7: '#e58a6b', l8: '#8bb84a', contour: '#ffffff',
};
const LISTE: ReponseCampagnesOoh = { campagnes: [{ id: 'c1', nom: 'Campagne essai', annonceur: null, vague: 'V1', date_debut: '2026-09-20', date_fin: '2026-10-02', lignes: [] }], tronque: false };

function monter(
  api: { campagnesOoh?: () => unknown; campagneOoh?: (id: string) => unknown },
  paletteFournie?: Signal<typeof TEINTES>,
) {
  const palette = signal(TEINTES);
  const panneauSelectionne = signal<unknown>(null);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), CampagneOohService, CouchesCarteService,
      { provide: CarteApi, useValue: api },
      { provide: CouleursService, useValue: { palette: () => paletteFournie ?? palette } },
      { provide: PoisService, useValue: { panneauSelectionne } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  const couches = TestBed.inject(CouchesCarteService);
  couches.publier(carte as unknown as maplibregl.Map);
  const service = TestBed.inject(CampagneOohService);
  TestBed.tick();
  return { service, carte, couches, palette, panneauSelectionne };
}

const donneesPosees = (c: CarteFactice) => {
  const s = c.sources.get(SOURCE_CAMPAGNE_OOH);
  if (!s) return null;
  const derniere = (s.donnees.at(-1) ?? (s.spec as { data: unknown }).data) as GeoJSON.FeatureCollection;
  return derniere.features.map((f) => f.properties?.['id']);
};

describe('CampagneOohService', () => {
  it('lireCampagnes : une seule lecture, même rappelée', () => {
    const campagnesOoh = vi.fn(() => of(LISTE));
    const { service } = monter({ campagnesOoh });
    service.lireCampagnes();
    service.lireCampagnes();
    expect(campagnesOoh).toHaveBeenCalledTimes(1);
    expect(service.campagnes()).toEqual(LISTE.campagnes);
    expect(service.listeTronquee()).toBe(false);
  });

  it('échec de la liste : le message, puis une nouvelle tentative possible', () => {
    let essai = 0;
    const campagnesOoh = vi.fn(() => (++essai === 1 ? throwError(() => ({ status: 500 })) : of(LISTE)));
    const { service } = monter({ campagnesOoh });
    service.lireCampagnes();
    expect(service.erreurListe()).toBe('HTTP 500');
    expect(service.chargementListe()).toBe(false);
    service.lireCampagnes();
    expect(campagnesOoh).toHaveBeenCalledTimes(2);
    expect(service.campagnes()).toEqual(LISTE.campagnes);
  });

  it('choisir : la couche est posée, ses points colorés par ligne, la carte recadrée sur l emprise', () => {
    const { service, carte } = monter({ campagneOoh: () => of(DETAIL_ESSAI) });
    service.choisir('c1');
    TestBed.tick();
    expect(service.detail()).toBe(DETAIL_ESSAI);
    expect(donneesPosees(carte)).toEqual(['p1', 'p2']);
    expect(carte.getLayer(COUCHE_CAMPAGNE_OOH_POINTS)!['paint']).toMatchObject({ 'circle-color': expressionCouleurLigne(Object.values(TEINTES).slice(0, 8)) });
    expect(carte.cadrages.at(-1)).toEqual({ cadre: [[2.1, 48.1], [2.3, 48.3]], options: { padding: 50, duration: 800, maxZoom: 14 } });
  });

  it('masquer une ligne retire ses points ; la réafficher les rend', () => {
    const { service, carte } = monter({ campagneOoh: () => of(DETAIL_ESSAI) });
    service.choisir('c1');
    TestBed.tick();
    service.basculerLigne('l1');
    TestBed.tick();
    expect(donneesPosees(carte)).toEqual([]);
    service.basculerLigne('l1');
    TestBed.tick();
    expect(donneesPosees(carte)).toEqual(['p1', 'p2']);
  });

  it('clic sur un point : la fiche s ouvre et le tiroir Street View des POI se ferme', () => {
    const { service, carte, panneauSelectionne } = monter({ campagneOoh: () => of(DETAIL_ESSAI) });
    service.choisir('c1');
    TestBed.tick();
    panneauSelectionne.set({ id: 'poi' });
    TestBed.tick();
    carte.emettreSurCouche('click', COUCHE_CAMPAGNE_OOH_POINTS, { features: [{ properties: { id: 'p2' } }] });
    TestBed.tick();
    expect(service.emplacementSelectionne()?.properties.id).toBe('p2');
    expect(panneauSelectionne()).toBeNull();
  });

  it('un panneau de POI choisi ferme la fiche ; masquer la ligne du point choisi aussi', () => {
    const { service, panneauSelectionne } = monter({ campagneOoh: () => of(DETAIL_ESSAI) });
    service.choisir('c1');
    service.selectionner('p1');
    TestBed.tick();
    panneauSelectionne.set({ id: 'poi' });
    TestBed.tick();
    expect(service.emplacementSelectionne()).toBeNull();
    panneauSelectionne.set(null);
    service.selectionner('p1');
    service.basculerLigne('l1');
    expect(service.emplacementSelectionne()).toBeNull();
  });

  it('Tout effacer retire la couche et vide la campagne, la liste reste', () => {
    const { service, carte, couches } = monter({ campagnesOoh: () => of(LISTE), campagneOoh: () => of(DETAIL_ESSAI) });
    service.lireCampagnes();
    service.choisir('c1');
    TestBed.tick();
    couches.toutEffacer();
    TestBed.tick();
    expect(service.detail()).toBeNull();
    expect(carte.retraits).toContain(`couche:${COUCHE_CAMPAGNE_OOH_POINTS}`);
    expect(carte.retraits).toContain(`source:${SOURCE_CAMPAGNE_OOH}`);
    expect(service.campagnes()).toEqual(LISTE.campagnes);
  });

  it('une réponse en vol après fermer() est ignorée ; choisir une autre campagne abandonne la première', () => {
    const reponses = [new Subject<DetailCampagneOoh>(), new Subject<DetailCampagneOoh>(), new Subject<DetailCampagneOoh>()];
    let n = 0;
    const { service, carte } = monter({ campagneOoh: () => reponses[n++] });
    service.choisir('c1');
    service.fermer();
    reponses[0].next(DETAIL_ESSAI);
    TestBed.tick();
    expect(service.detail()).toBeNull();
    expect(carte.sources.has(SOURCE_CAMPAGNE_OOH)).toBe(false);
    service.choisir('c1');
    service.choisir('c2');
    expect(reponses[1].observed).toBe(false);
  });

  it('changement de thème : les teintes sont repeintes', () => {
    const { service, carte, palette } = monter({ campagneOoh: () => of(DETAIL_ESSAI) });
    service.choisir('c1');
    TestBed.tick();
    palette.set({ ...TEINTES, l1: '#b9770f' });
    TestBed.tick();
    expect(carte.peintures).toContainEqual({
      couche: COUCHE_CAMPAGNE_OOH_POINTS, propriete: 'circle-color',
      valeur: expressionCouleurLigne(['#b9770f', ...Object.values(TEINTES).slice(1, 8)]),
    });
  });

  it('monté avec une palette qui lève : aucune erreur tant qu aucune campagne n est choisie (pré-vol P1)', () => {
    // Sans feuille de style (specs de la page), `CouleursService.palette` lève « Jeton de couleur inconnu » : l'effet de
    // réconciliation ne doit lire la palette que lorsqu'une campagne est affichée — patron de `radio.service.ts`.
    const lecture = vi.fn(() => { throw new Error('Jeton de couleur inconnu : --ligne-media-1'); });
    const palette = computed(lecture) as unknown as Signal<typeof TEINTES>;
    const { service, couches } = monter({ campagnesOoh: () => of(LISTE) }, palette);
    service.lireCampagnes();
    TestBed.tick();
    couches.toutEffacer();
    TestBed.tick();
    expect(lecture).not.toHaveBeenCalled();
    expect(service.campagnes()).toEqual(LISTE.campagnes);
  });

  it('n est pas fourni à la racine : il vit et meurt avec la page carte', () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    expect(() => TestBed.inject(CampagneOohService)).toThrow();
  });
});
