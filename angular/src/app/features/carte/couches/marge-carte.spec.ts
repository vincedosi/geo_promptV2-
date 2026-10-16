import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { DUREE_RECADRAGE_MARGE, suivreMargeCarte } from './marge-carte';

function monter() {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const carte = signal<CarteFactice | null>(null);
  const gauche = signal(492);
  const droite = signal(10);
  TestBed.runInInjectionContext(() =>
    suivreMargeCarte(() => carte() as unknown as maplibregl.Map | null, gauche, droite));
  const vider = () => TestBed.tick();
  return { carte, gauche, droite, vider };
}

describe('suivreMargeCarte (relecture T4b, I-1)', () => {
  it('pose la marge sur la carte publiée, la suit, et la RE-POSE sur une carte recréée', () => {
    const { carte, gauche, droite, vider } = monter();
    vider();
    const a = new CarteFactice();
    carte.set(a);
    vider();
    expect(a.marges).toEqual([{ top: 0, bottom: 0, left: 492, right: 10 }]);
    gauche.set(0);
    vider();
    droite.set(620);
    vider();
    expect(a.marges.at(-1)).toEqual({ top: 0, bottom: 0, left: 0, right: 620 });
    const b = new CarteFactice();
    carte.set(b);
    vider();
    expect(b.marges).toEqual([{ top: 0, bottom: 0, left: 0, right: 620 }]);
  });

  it('un changement PENDANT un mouvement n’arrête pas le mouvement : attente du moveend, puis recadrage de la partie libre', () => {
    const { carte, droite, vider } = monter();
    const a = new CarteFactice();
    const conteneur = a.getContainer();
    Object.defineProperty(conteneur, 'clientWidth', { value: 1440 });
    Object.defineProperty(conteneur, 'clientHeight', { value: 816 });
    carte.set(a);
    vider();
    // « Afficher » une zone : son fitBounds part, ET le plan média s'ouvre dans le même tour (marge droite 620).
    a.enMouvement = true;
    droite.set(320);
    vider();
    droite.set(620);
    vider();
    expect(a.marges).toHaveLength(1);
    expect(a.cadrages).toHaveLength(0);
    a.enMouvement = false;
    a.emettre('moveend');
    // La dernière marge seulement ; ce que montrait l'ancienne partie libre (x 492 → 1430, y 0 → 816) est recadré.
    expect(a.marges).toEqual([{ top: 0, bottom: 0, left: 492, right: 10 }, { top: 0, bottom: 0, left: 492, right: 620 }]);
    expect(a.cadrages).toEqual([{ cadre: [[492, 816], [1430, 0]], options: { padding: 0, duration: DUREE_RECADRAGE_MARGE } }]);
    // Un second moveend (le recadrage lui-même) ne refait rien.
    a.emettre('moveend');
    expect(a.cadrages).toHaveLength(1);
  });
});
