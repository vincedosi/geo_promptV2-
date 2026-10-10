import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarreauxApi } from '../data/carreaux.api';
import { AnnonceService } from '../etat/annonce.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { bornesDe } from '../logique/carreaux/bornes';
import { CARREAUX_PALETTES } from '../logique/palettes-donnees-carte';
import { CarreauxService, PITCH_RELIEF } from './carreaux.service';
import { COUCHE_CARREAUX_FOND, COUCHE_CARREAUX_RELIEF, COUCHE_CARREAUX_TRAIT, SOURCE_CARREAUX } from './couche-carreaux';
import { CaptureService } from '../etat/capture.service';

const URL_TUILES = 'http://localhost/api/tiles/{z}/{x}/{y}?v=19';

function monter() {
  const theme = signal({ absente: '#9aa0a6', trait: '#555555' });
  TestBed.configureTestingModule({
    providers: [CaptureService, 
      provideZonelessChangeDetection(), CarreauxService, EtatCarteService, CouchesCarteService, AnnonceService,
      { provide: CarreauxApi, useValue: { urlTuiles: () => URL_TUILES } },
      { provide: CouleursService, useValue: { palette: () => theme } },
    ],
  });
  return {
    service: TestBed.inject(CarreauxService),
    etat: TestBed.inject(EtatCarteService),
    couches: TestBed.inject(CouchesCarteService),
    theme,
  };
}

/** Une carte au style chargé, publiée comme la page le fait au `load`. */
function carteChargee(couches: CouchesCarteService): CarteFactice {
  const carte = new CarteFactice();
  carte.styleCharge = true;
  couches.publier(carte as unknown as maplibregl.Map);
  return carte;
}

const flush = () => TestBed.tick();
const peinturesDe = (c: CarteFactice, couche: string, prop: string) =>
  c.peintures.filter((p) => p.couche === couche && p.propriete === prop);
const visibilite = (c: CarteFactice, couche: string) => (c.getLayer(couche)?.['layout'] as { visibility?: string })?.visibility;

describe('CarreauxService', () => {
  it('rien n’est posé tant que la couche est masquée (aucune tuile demandée)', () => {
    const { couches } = monter();
    const carte = carteChargee(couches);
    flush();
    expect(carte.sources.size).toBe(0);
    expect(carte.couches).toEqual([]);
  });

  it('visible → la source carreaux-mvt (adresse absolue, version) et ses trois couches, aplat visible', () => {
    const { service, couches } = monter();
    const carte = carteChargee(couches);
    service.basculer(true);
    flush();
    const source = carte.sources.get(SOURCE_CARREAUX)!.spec as Record<string, unknown>;
    expect(source).toEqual({ type: 'vector', tiles: [URL_TUILES], minzoom: 4, maxzoom: 14, attribution: 'INSEE, Filosofi 2019' });
    expect(carte.couches.map((c) => c.couche['id'])).toEqual([COUCHE_CARREAUX_FOND, COUCHE_CARREAUX_RELIEF, COUCHE_CARREAUX_TRAIT]);
    expect(visibilite(carte, COUCHE_CARREAUX_FOND)).toBe('visible');
    expect(visibilite(carte, COUCHE_CARREAUX_TRAIT)).toBe('visible');
    expect(visibilite(carte, COUCHE_CARREAUX_RELIEF)).toBe('none');
    // Couleurs d'interface lues dans les jetons, données dans la palette — jamais de var().
    expect(JSON.stringify(carte.couches)).not.toContain('var(');
    expect((carte.getLayer(COUCHE_CARREAUX_TRAIT)!['paint'] as Record<string, unknown>)['line-color']).toBe('#555555');
  });

  it('basculer(true) réclame le dégradé ; un autre dégradé l’évince → visibility: none', () => {
    const { service, etat, couches } = monter();
    const carte = carteChargee(couches);
    service.basculer(true);
    flush();
    expect(etat.degradeActif()).toBe('carreaux');
    etat.basculerDegrade('iris', true);
    flush();
    expect(service.visible()).toBe(false);
    expect(visibilite(carte, COUCHE_CARREAUX_FOND)).toBe('none');
    expect(visibilite(carte, COUCHE_CARREAUX_TRAIT)).toBe('none');
  });

  it('changer d’indicateur ou de palette : setPaintProperty seulement, la source n’est jamais recréée', () => {
    const { service, couches } = monter();
    const carte = carteChargee(couches);
    const ajouts = vi.spyOn(carte, 'addSource');
    service.basculer(true);
    flush();
    expect(ajouts).toHaveBeenCalledTimes(1);
    service.indicateur.set('revenu_median');
    flush();
    service.palette.set('bleu');
    flush();
    expect(ajouts).toHaveBeenCalledTimes(1);
    const couleurs = peinturesDe(carte, COUCHE_CARREAUX_FOND, 'fill-color');
    const derniere = JSON.stringify(couleurs.at(-1)!.valeur);
    expect(derniere).toContain('revenu_median');
    for (const arret of CARREAUX_PALETTES.find((p) => p.id === 'bleu')!.stops) expect(derniere).toContain(arret);
    expect(peinturesDe(carte, COUCHE_CARREAUX_RELIEF, 'fill-extrusion-color').at(-1)!.valeur)
      .toEqual(couleurs.at(-1)!.valeur);
    // La donnée absente : le gris du jeton.
    expect(derniere).toContain('#9aa0a6');
  });

  it('changer d’indicateur remet le palier sélectionné à null ; un palier filtre l’opacité par un case', () => {
    const { service, couches } = monter();
    const carte = carteChargee(couches);
    service.basculer(true);
    flush();
    service.seauSelectionne.set(2);
    flush();
    const o = peinturesDe(carte, COUCHE_CARREAUX_FOND, 'fill-opacity').at(-1)!.valeur as unknown[];
    expect(o[0]).toBe('case');
    expect(o[2]).toBe(0.72);
    expect(peinturesDe(carte, COUCHE_CARREAUX_TRAIT, 'line-opacity').at(-1)!.valeur).toEqual(['case', o[1], 0.35, 0]);
    service.indicateur.set('menages_total');
    flush();
    expect(service.seauSelectionne()).toBeNull();
    expect(peinturesDe(carte, COUCHE_CARREAUX_FOND, 'fill-opacity').at(-1)!.valeur).toBe(0.72);
  });

  it('relief : couche extrudée visible, aplat masqué, caméra inclinée puis rendue', () => {
    const { service, couches } = monter();
    const carte = carteChargee(couches);
    carte.pitch = 10;
    service.basculer(true);
    flush();
    service.basculerRelief(true);
    flush();
    expect(visibilite(carte, COUCHE_CARREAUX_RELIEF)).toBe('visible');
    expect(visibilite(carte, COUCHE_CARREAUX_FOND)).toBe('none');
    expect(carte.animations.at(-1)).toEqual({ pitch: PITCH_RELIEF, duration: 600 });
    service.hauteur.set(3);
    flush();
    expect(JSON.stringify(peinturesDe(carte, COUCHE_CARREAUX_RELIEF, 'fill-extrusion-height').at(-1)!.valeur)).toContain('superficie_km2');
    service.basculerRelief(false);
    expect(carte.animations.at(-1)).toEqual({ pitch: 10, duration: 600 });
  });

  it('carte recréée (changement de fond) : re-posée sur la nouvelle instance avec ses réglages', () => {
    const { service, couches } = monter();
    const a = carteChargee(couches);
    service.basculer(true);
    service.palette.set('vert');
    flush();
    expect(a.sources.has(SOURCE_CARREAUX)).toBe(true);
    couches.publier(null);
    flush();
    const b = carteChargee(couches);
    flush();
    expect(b.sources.has(SOURCE_CARREAUX)).toBe(true);
    const couleur = JSON.stringify((b.getLayer(COUCHE_CARREAUX_FOND)!['paint'] as Record<string, unknown>)['fill-color']);
    expect(couleur).toContain(CARREAUX_PALETTES.find((p) => p.id === 'vert')!.stops[5]);
    expect(visibilite(b, COUCHE_CARREAUX_FOND)).toBe('visible');
  });

  it('style pas encore chargé : la pose attend le load', () => {
    const { service, couches } = monter();
    const carte = new CarteFactice();
    couches.publier(carte as unknown as maplibregl.Map);
    service.basculer(true);
    flush();
    expect(carte.sources.size).toBe(0);
    carte.emettre('load');
    expect(carte.sources.has(SOURCE_CARREAUX)).toBe(true);
  });

  it('« Tout effacer » masque la couche', () => {
    const { service, couches } = monter();
    const carte = carteChargee(couches);
    service.basculer(true);
    flush();
    couches.toutEffacer();
    flush();
    expect(service.visible()).toBe(false);
    expect(visibilite(carte, COUCHE_CARREAUX_FOND)).toBe('none');
  });

  it('bornes : les bornes NATIONALES de l’indicateur', () => {
    const { service } = monter();
    expect(service.bornes()).toEqual(bornesDe('population_totale'));
    service.indicateur.set('revenu_median');
    expect(service.bornes()).toEqual(bornesDe('revenu_median'));
  });

  it('thème : le trait de grille est repeint, la source n’est pas recréée', () => {
    const { service, couches, theme } = monter();
    const carte = carteChargee(couches);
    service.basculer(true);
    flush();
    theme.set({ absente: '#9aa0a6', trait: '#123456' });
    flush();
    expect(peinturesDe(carte, COUCHE_CARREAUX_TRAIT, 'line-color').at(-1)!.valeur).toBe('#123456');
    expect(carte.sources.size).toBe(1);
  });
});
