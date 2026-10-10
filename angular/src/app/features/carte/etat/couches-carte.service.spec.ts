import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouchesCarteService, quandStyleCharge } from './couches-carte.service';

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

describe('quandStyleCharge', () => {
  it('style chargé : posé tout de suite', () => {
    const carte = new CarteFactice();
    carte.styleCharge = true;
    let n = 0;
    quandStyleCharge(carte, () => n++);
    expect(n).toBe(1);
  });

  it('carte recréée publiée au `load` mais tuiles en cours (isStyleLoaded faux) : posé au premier `idle`, UNE fois', () => {
    const carte = new CarteFactice();
    let n = 0;
    quandStyleCharge(carte, () => n++);
    expect(n).toBe(0);
    carte.emettre('idle');
    expect(n).toBe(1);
    carte.emettre('load');
    carte.emettre('idle');
    expect(n).toBe(1);
  });

  it('`load` d’abord : posé une fois ; écoute retirée avant tout événement : jamais posé', () => {
    const carte = new CarteFactice();
    let n = 0;
    quandStyleCharge(carte, () => n++);
    carte.emettre('load');
    carte.emettre('idle');
    expect(n).toBe(1);
    const autre = new CarteFactice();
    let m = 0;
    const annuler = quandStyleCharge(autre, () => m++);
    annuler();
    autre.emettre('load');
    autre.emettre('idle');
    expect(m).toBe(0);
  });
});
