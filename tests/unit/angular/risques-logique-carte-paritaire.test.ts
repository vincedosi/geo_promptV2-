/**
 * Zones, carte, jeu de zones : la logique copiée dans angular/ (lot 3, T2)
 * rend la MÊME chose que React (gel P5).
 */
import { describe, expect, it } from 'vitest';
import * as Rs from '@/lib/carte/seuils-naturels';
import * as As from '../../../angular/src/app/features/risques/logique/seuils-naturels';
import * as Ro from '@/lib/carte/palette-zones-risque';
import * as Ao from '../../../angular/src/app/features/risques/logique/opacites-zones';
import * as Rn from '@/lib/carte/nature-zone';
import * as An from '../../../angular/src/app/features/risques/logique/nature-zone';
import * as Rv from '@/lib/version';
import * as Av from '../../../angular/src/app/features/risques/logique/zooms';
import { circleGeoJSON } from '@/app/copilote/_lib/constants';
import { cercleGeoJSON } from '../../../angular/src/app/features/risques/logique/cercle';
import { CARREAUX_PALETTES } from '@/lib/carreaux/catalogue';
import { PALETTES_DONNEES } from '../../../angular/src/app/features/risques/logique/palettes-donnees';
import * as Rj from '@/lib/zones/jeu';
import * as Aj from '../../../angular/src/app/features/risques/logique/jeu';
import * as Rd from '@/lib/campagne/palette-divergente';
import * as Ad from '../../../angular/src/app/features/risques/logique/palette-divergente';

/** Tirage reproductible (mulberry32) : la suite ne doit jamais dépendre du hasard. */
function graine(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r1 = graine(7);
const r2 = graine(11);

/** Part de population exposée de 13 régions, en % (ordre de grandeur mesuré le 2026-09-18). */
const PARTS_13_REGIONS = [4.07, 2.11, 1.13, 0.98, 0.75, 0.52, 0.41, 0.33, 0.27, 0.19, 0.11, 0.05, 0.02];

const SERIES: Record<string, number[]> = {
  vide: [],
  constante: [3, 3, 3, 3, 3, 3, 3, 3],
  'une valeur': [2.5],
  'trente aléatoires': Array.from({ length: 30 }, () => Math.round(r1() * 10000) / 100),
  'treize régions': PARTS_13_REGIONS,
  'mille valeurs': Array.from({ length: 1000 }, () => Math.exp(r2() * 5)),
  'zéros, négatifs, NaN': [0, -1, NaN, Infinity, 4, 9, 9, 16, 25, 36, 49],
  'quatre mille (échantillonnage)': Array.from({ length: 4000 }, () => r1() * r1() * 100),
};

describe('seuils naturels : Angular = React', () => {
  for (const [nom, serie] of Object.entries(SERIES)) {
    for (const k of [3, 5]) {
      it(`seuilsNaturels(${nom}, ${k})`, () => {
        expect(As.seuilsNaturels([...serie], k)).toEqual(Rs.seuilsNaturels([...serie], k));
      });
    }
  }

  it('classeDe', () => {
    for (const bornes of [[], [1], [1, 5, 10], [0.5, 1, 2, 4, 8]]) {
      for (const v of [undefined, NaN, Infinity, -1, 0, 0.5, 1, 1.0001, 5, 9.99, 10, 11, 1e9]) {
        expect(As.classeDe(v, bornes), `${v} / ${bornes}`).toBe(Rs.classeDe(v, bornes));
      }
    }
  });
});

describe('opacités et zooms : Angular = React', () => {
  it('opacités de bande', () => {
    expect(Ao.OPACITE_BANDE).toEqual(Ro.OPACITE_BANDE);
    expect(Ao.OPACITE_PPRT).toBe(Ro.OPACITE_PPRT);
    for (const b of [0, 1, 2, 3, 4, 5, 9, -2, 'pprt' as const]) {
      expect(Ao.opaciteDeClasse(b)).toBe(Ro.opaciteDeClasse(b));
    }
  });

  it('expressions MapLibre', () => {
    expect(Ao.expressionOpaciteBande()).toEqual(Ro.expressionOpaciteBande());
    for (const z of [4, 7, 10, 12]) {
      expect(Ao.expressionOpaciteSelonZoom(z)).toEqual(Ro.expressionOpaciteSelonZoom(z));
    }
  });

  it('style du contour', () => {
    expect(An.TIRETE_ZONE_CALCULEE).toEqual(Rn.TIRETE_ZONE_CALCULEE);
    expect(An.LARGEUR_TRAIT_ZONE).toBe(Rn.LARGEUR_TRAIT_ZONE);
  });

  it('les trois zooms', () => {
    expect(Av.ZONES_RISQUE_ZOOM_PLANCHER).toBe(Rv.ZONES_RISQUE_ZOOM_PLANCHER);
    expect(Av.ZONES_RISQUE_ZOOM_LISIBLE).toBe(Rv.ZONES_RISQUE_ZOOM_LISIBLE);
    expect(Av.ZONES_RISQUE_ZOOM_DETAIL).toBe(Rv.ZONES_RISQUE_ZOOM_DETAIL);
    expect([Av.ZONES_RISQUE_ZOOM_PLANCHER, Av.ZONES_RISQUE_ZOOM_LISIBLE, Av.ZONES_RISQUE_ZOOM_DETAIL]).toEqual([4, 7, 10]);
  });
});

describe('cercle et palettes de données', () => {
  it('cercleGeoJSON(5.0, 43.4, 2000), coordonnée par coordonnée', () => {
    const a = cercleGeoJSON(5.0, 43.4, 2000);
    const r = circleGeoJSON(5.0, 43.4, 2000);
    expect(a.geometry.coordinates[0]).toHaveLength(65);
    expect(a.geometry.coordinates[0]).toHaveLength(r.geometry.coordinates[0].length);
    a.geometry.coordinates[0].forEach((c, i) => {
      expect(c[0]).toBe(r.geometry.coordinates[0][i][0]);
      expect(c[1]).toBe(r.geometry.coordinates[0][i][1]);
    });
    expect(a).toEqual(r);
    expect(cercleGeoJSON(-61.5, 16.2, 500, 8)).toEqual(circleGeoJSON(-61.5, 16.2, 500, 8));
  });

  it('PALETTES_DONNEES = CARREAUX_PALETTES', () => {
    expect(PALETTES_DONNEES).toEqual(CARREAUX_PALETTES);
    expect(PALETTES_DONNEES).toHaveLength(6);
  });
});

describe('jeu de zones et échelle divergente', () => {
  it('constantes du jeu', () => {
    expect(Aj.MODES_PLAN).toEqual(Rj.MODES_PLAN);
    expect(Aj.POIDS_MIN).toBe(Rj.POIDS_MIN);
    expect(Aj.POIDS_MAX).toBe(Rj.POIDS_MAX);
    expect(Aj.MOTIF_CLASSE.source).toBe(Rj.MOTIF_CLASSE.source);
    expect(Aj.MOTIF_CLASSE.flags).toBe(Rj.MOTIF_CLASSE.flags);
    expect(Aj.JEU_DEFAUT).toEqual(Rj.JEU_DEFAUT);
  });

  it('JEU_DEFAUT passe le schéma Zod de React (le type écrit à la main ne dérive pas)', () => {
    expect(Rj.JeuDeZonesSchema.safeParse(Aj.JEU_DEFAUT).success).toBe(true);
  });

  it('trancheDivergente', () => {
    for (const v of [-80, -50, -49.9, -25, -10, 0, 9.9, 10, 25, 50, 80, null]) {
      expect(Ad.trancheDivergente(v as number)).toBe(Rd.trancheDivergente(v as number));
    }
    expect(Ad.BORNES_DIVERGENTES).toEqual(Rd.BORNES_DIVERGENTES);
    expect(Ad.RAMPE_CSS).toEqual(Rd.RAMPE_CSS);
    expect(Ad.LIBELLES_TRANCHES).toEqual(Rd.LIBELLES_TRANCHES);
  });
});
