import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouchesCarteService } from './couches-carte.service';

function monter() {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), CouchesCarteService] });
  return TestBed.inject(CouchesCarteService);
}

describe('CouchesCarteService', () => {
  it('publie la carte courante, puis null à la destruction', () => {
    const couches = monter();
    expect(couches.carteCourante()).toBeNull();
    const carte = new CarteFactice() as unknown as maplibregl.Map;
    couches.publier(carte);
    expect(couches.carteCourante()).toBe(carte);
    couches.publier(null);
    expect(couches.carteCourante()).toBeNull();
  });

  it('« Tout effacer » appelle chaque fonction inscrite une fois ; ré-inscrire un id remplace sa fonction', () => {
    const couches = monter();
    const a = vi.fn();
    const b1 = vi.fn();
    const b2 = vi.fn();
    couches.inscrireEffacement('a', a);
    couches.inscrireEffacement('b', b1);
    couches.inscrireEffacement('b', b2);
    couches.toutEffacer();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b1).not.toHaveBeenCalled();
    expect(b2).toHaveBeenCalledTimes(1);
  });
});
