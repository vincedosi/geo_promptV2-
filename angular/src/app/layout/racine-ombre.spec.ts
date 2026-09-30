import { Component, ViewEncapsulation, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DemarrageService } from '../core/demarrage/demarrage.service';
import { feuillesFactices } from '../core/ressources/testing/feuilles-factices';
import { monterRacineOmbre } from './racine-ombre';

@Component({ selector: 'mg-sans-ombre', template: '<p>x</p>' })
class SansOmbre {
  constructor() {
    monterRacineOmbre();
  }
}

function preparer(feuillePresente: boolean) {
  const feuilles = feuillesFactices();
  const feuille = signal<CSSStyleSheet | null>(feuillePresente ? feuilles.feuille : null);
  TestBed.configureTestingModule({
    providers: [
      ...feuilles.providers,
      { provide: DemarrageService, useValue: { erreur: signal(null), feuille } },
    ],
  });
  return { ...feuilles, feuilleDemarrage: feuille };
}

@Component({ selector: 'mg-ombre-vide', template: '<p>x</p>', encapsulation: ViewEncapsulation.ShadowDom })
class OmbreVide {
  constructor() {
    monterRacineOmbre();
  }
}

describe('monterRacineOmbre', () => {
  it("LÈVE, en le disant, quand le composant n'a pas de racine d'ombre : sa feuille n'aurait nulle part où aller", () => {
    preparer(true);
    expect(() => TestBed.createComponent(SansOmbre)).toThrow(
      /MAGELIAN : <[a-z-]+> doit être déclaré en ViewEncapsulation\.ShadowDom/,
    );
  });

  it("sans feuille (démarrage en échec sur elle), ne lève pas : le message d'erreur doit pouvoir s'afficher", () => {
    const feuilles = preparer(false);
    expect(() => TestBed.createComponent(OmbreVide)).not.toThrow();
    expect(feuilles.adoptions).toEqual([]);
  });

  it("une racine créée PENDANT l'échec adopte la feuille quand elle arrive (relance réussie), une seule fois", () => {
    const feuilles = preparer(false);
    const fixture = TestBed.createComponent(OmbreVide);
    TestBed.tick();
    expect(feuilles.adoptions).toEqual([]);
    feuilles.feuilleDemarrage.set(feuilles.feuille);
    TestBed.tick();
    const racine = (fixture.nativeElement as HTMLElement).shadowRoot!;
    expect(feuilles.adoptions).toEqual([{ racine, feuille: feuilles.feuille }]);
    TestBed.tick();
    expect(feuilles.adoptions.length).toBe(1);
  });
});
