import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CarteApi } from '../data/carte.api';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { COUCHE_TMJA, FILTRE_TRAFIC_FAIBLE, SOURCE_TMJA_ID, TmjaService } from './tmja.service';

const URL_TUILES = 'http://hote/api/tmja-tiles/{z}/{x}/{y}?v=v10';

function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), TmjaService, CouchesCarteService,
      { provide: CarteApi, useValue: { urlTuilesTmja: () => URL_TUILES } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  return { tmja: TestBed.inject(TmjaService), couches: TestBed.inject(CouchesCarteService), carte };
}

const carteMl = (c: CarteFactice) => c as unknown as maplibregl.Map;

describe('TmjaService', () => {
  it('éteint : rien n’est posé (aucune tuile demandée)', () => {
    const { couches, carte } = monter();
    couches.publier(carteMl(carte));
    TestBed.tick();
    expect(carte.sources.size).toBe(0);
  });

  it('allumer → source posée UNE fois (minzoom 5, ?v=v10), couche visible avec le filtre ≥ 5 000 coché par défaut', () => {
    const { tmja, couches, carte } = monter();
    couches.publier(carteMl(carte));
    tmja.afficher();
    TestBed.tick();
    tmja.afficher(); // « Actualiser » : rien de neuf
    TestBed.tick();
    expect([...carte.sources.keys()]).toEqual([SOURCE_TMJA_ID]);
    expect(carte.sources.get(SOURCE_TMJA_ID)!.spec).toEqual({ type: 'vector', tiles: [URL_TUILES], minzoom: 5, maxzoom: 14 });
    expect(carte.couches.filter((c) => c.couche['id'] === COUCHE_TMJA)).toHaveLength(1);
    const couche = carte.getLayer(COUCHE_TMJA)!;
    expect(couche['source-layer']).toBe('tmja');
    expect((couche['paint'] as Record<string, unknown>)['line-color']).toEqual(
      ['step', ['get', 'tmja'], '#4292C6', 5000, '#f6d543', 15000, '#f97316', 40000, '#ef4444'],
    );
    expect((couche['layout'] as Record<string, unknown>)['visibility']).toBe('visible');
    expect(FILTRE_TRAFIC_FAIBLE).toEqual(['>=', ['get', 'tmja'], 5000]);
    expect(carte.filtres.at(-1)).toEqual({ couche: COUCHE_TMJA, filtre: FILTRE_TRAFIC_FAIBLE });
  });

  it('décocher « Masquer le trafic faible » → filtre null ; recocher → ≥ 5 000', () => {
    const { tmja, couches, carte } = monter();
    couches.publier(carteMl(carte));
    tmja.afficher();
    TestBed.tick();
    tmja.masquerFaible.set(false);
    TestBed.tick();
    expect(carte.filtres.at(-1)).toEqual({ couche: COUCHE_TMJA, filtre: null });
    tmja.masquerFaible.set(true);
    TestBed.tick();
    expect(carte.filtres.at(-1)).toEqual({ couche: COUCHE_TMJA, filtre: FILTRE_TRAFIC_FAIBLE });
  });

  it('« Masquer » et « Tout effacer » masquent la couche sans la retirer ; le filtre reste choisi', () => {
    const { tmja, couches, carte } = monter();
    couches.publier(carteMl(carte));
    tmja.afficher();
    tmja.masquerFaible.set(false);
    TestBed.tick();
    tmja.masquer();
    TestBed.tick();
    expect((carte.getLayer(COUCHE_TMJA)!['layout'] as Record<string, unknown>)['visibility']).toBe('none');
    tmja.afficher();
    TestBed.tick();
    couches.toutEffacer();
    TestBed.tick();
    expect(tmja.visible()).toBe(false);
    expect(tmja.masquerFaible()).toBe(false);
  });

  it('carte recréée (changement de fond, B11) : re-posée une fois, avec son filtre', () => {
    const { tmja, couches, carte } = monter();
    couches.publier(carteMl(carte));
    tmja.afficher();
    TestBed.tick();
    couches.publier(null);
    TestBed.tick();
    const nouvelle = new CarteFactice();
    couches.publier(carteMl(nouvelle));
    TestBed.tick();
    expect(nouvelle.couches).toHaveLength(0); // style pas encore chargé
    nouvelle.emettre('load');
    TestBed.tick();
    expect(nouvelle.couches.map((c) => c.couche['id'])).toEqual([COUCHE_TMJA]);
    expect(nouvelle.filtres.at(-1)).toEqual({ couche: COUCHE_TMJA, filtre: FILTRE_TRAFIC_FAIBLE });
  });
});
