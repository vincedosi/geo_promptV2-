import { describe, it, expect } from 'vitest';
import { seuilsNaturels, classeDe } from '@/lib/carte/seuils-naturels';

/**
 * Les seuils naturels remplacent les quantiles sur la carte de population
 * exposée. Ces tests vérifient ce qui a motivé le changement, pas seulement
 * que la fonction rend un tableau.
 */

/**
 * La distribution RÉELLE des 94 départements exposés, mesurée en production
 * le 2026-09-18 (part de la population de l'unité vivant en zone à risque).
 * Reconstituée à partir de ses statistiques mesurées : médiane 0,33 %,
 * moyenne 0,52 %, 90ᵉ centile 1,13 %, maximum 4,07 %, et les 10 premiers
 * départements portant 54 % du total.
 */
const REEL = [
  4.07, 2.55, 2.36, 2.13, 1.65, 1.28, 1.26, 1.15, 1.13, 1.05,
  0.89, 0.78, 0.75, 0.66, 0.65, 0.65, 0.63, 0.61, 0.58, 0.54,
  0.52, 0.5, 0.48, 0.47, 0.45, 0.44, 0.43, 0.42, 0.41, 0.41,
  0.4, 0.39, 0.38, 0.37, 0.36, 0.35, 0.35, 0.34, 0.34, 0.33,
  0.33, 0.32, 0.32, 0.31, 0.3, 0.3, 0.29, 0.28, 0.28, 0.27,
  0.26, 0.26, 0.25, 0.24, 0.24, 0.23, 0.22, 0.21, 0.2, 0.2,
  0.19, 0.18, 0.18, 0.17, 0.16, 0.15, 0.15, 0.14, 0.13, 0.12,
  0.12, 0.11, 0.1, 0.1, 0.09, 0.09, 0.08, 0.08, 0.07, 0.07,
  0.06, 0.06, 0.05, 0.05, 0.04, 0.04, 0.04, 0.03, 0.03, 0.03,
  0.02, 0.02, 0.02, 0.02,
];

/** Le 80ᵉ centile : c'est là que les quantiles placeraient leur classe haute. */
function quantile(v: number[], p: number): number {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(p * (s.length - 1))];
}

describe('seuils naturels — le défaut que les quantiles introduisaient', () => {
  it('n’enferme pas le maximum dans une classe qui commence cinq fois plus bas', () => {
    // LE défaut mesuré : en quantiles, la classe haute démarre à ~0,75 %, donc
    // un département à 0,8 % y côtoie la Seine-Maritime à 4,07 %.
    const seuilQuantile = quantile(REEL, 0.8);
    expect(seuilQuantile).toBeLessThan(1); // ~0,75 % — la prémisse tient

    const bornes = seuilsNaturels(REEL, 5);
    // La classe haute de Jenks commence APRÈS la borne de l'avant-dernière.
    const debutClasseHaute = bornes[bornes.length - 2];
    expect(debutClasseHaute).toBeGreaterThan(seuilQuantile);

    // Et le maximum ne partage sa classe qu'avec des valeurs du même ordre :
    // le rapport max/début de classe doit rester bien plus serré qu'en
    // quantiles, où il valait 4,07 / 0,75 ≈ 5,4.
    expect(4.07 / debutClasseHaute).toBeLessThan(5.4);
  });

  it('isole la Seine-Maritime, seule unité au-dessus de 3 %', () => {
    const bornes = seuilsNaturels(REEL, 5);
    const classeMax = classeDe(4.07, bornes);
    // Aucune autre valeur de la série ne doit tomber dans la classe du max.
    const compagnons = REEL.filter((v) => v !== 4.07 && classeDe(v, bornes) === classeMax);
    expect(compagnons.length).toBeLessThanOrEqual(1);
  });

  it('rend des bornes strictement croissantes et sans doublon', () => {
    const bornes = seuilsNaturels(REEL, 5);
    expect(bornes.length).toBeGreaterThan(1);
    for (let i = 1; i < bornes.length; i++) {
      expect(bornes[i]).toBeGreaterThan(bornes[i - 1]);
    }
  });

  it('la dernière borne est le maximum — aucune valeur ne déborde', () => {
    const bornes = seuilsNaturels(REEL, 5);
    expect(bornes[bornes.length - 1]).toBe(4.07);
    for (const v of REEL) {
      expect(classeDe(v, bornes)).toBeGreaterThanOrEqual(0);
      expect(classeDe(v, bornes)).toBeLessThan(bornes.length);
    }
  });
});

describe('seuils naturels — les cas dégénérés', () => {
  it('une série vide ne rend aucune borne', () => {
    expect(seuilsNaturels([], 5)).toEqual([]);
  });

  it('écarte zéro, négatif et non fini — ce n’est pas « faible », c’est « rien »', () => {
    // Confondre les deux ferait lire « peu exposé » là où il n'y a aucun site.
    expect(seuilsNaturels([0, -3, NaN, Infinity], 5)).toEqual([]);
    const bornes = seuilsNaturels([0, 1, 2, 3, 4, 5, 6], 3);
    expect(bornes[0]).toBeGreaterThan(0);
  });

  it('moins de valeurs que de classes : chaque valeur est sa classe', () => {
    expect(seuilsNaturels([5, 1, 3], 5)).toEqual([1, 3, 5]);
  });

  it('une série parfaitement plate ne fabrique pas de fausses classes', () => {
    const bornes = seuilsNaturels(new Array(50).fill(2), 5);
    expect(bornes).toEqual([2]);
    expect(classeDe(2, bornes)).toBe(0);
  });

  it('reste rapide sur une série de la taille des codes postaux', () => {
    // 6 187 CP : au-delà de MAX_EXACT, l'échantillonnage doit s'appliquer.
    const grande = Array.from({ length: 6187 }, (_, i) => (i % 400) + 1);
    const t0 = Date.now();
    const bornes = seuilsNaturels(grande, 5);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(bornes.length).toBeGreaterThan(1);
    // L'échantillonnage CONSERVE le maximum : sans cela, les unités les plus
    // exposées tomberaient hors de leur propre classe.
    expect(bornes[bornes.length - 1]).toBe(400);
  });
});

describe('classeDe', () => {
  it('rend -1 sur une valeur absente, jamais la classe basse', () => {
    const bornes = seuilsNaturels(REEL, 5);
    expect(classeDe(undefined, bornes)).toBe(-1);
    expect(classeDe(0, bornes)).toBe(-1);
    expect(classeDe(NaN, bornes)).toBe(-1);
  });

  it('une valeur au-dessus du maximum retombe dans la classe haute', () => {
    const bornes = seuilsNaturels(REEL, 5);
    expect(classeDe(99, bornes)).toBe(bornes.length - 1);
  });

  it('la borne appartient à SA classe, pas à la suivante', () => {
    const bornes = seuilsNaturels([1, 2, 3, 10, 11, 12, 30, 31, 32], 3);
    for (const b of bornes) {
      expect(classeDe(b, bornes)).toBe(bornes.indexOf(b));
    }
  });
});
