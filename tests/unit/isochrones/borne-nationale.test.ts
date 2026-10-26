import { describe, it, expect } from 'vitest';
import {
  CAPACITE_SYNCHRONE_ANNEAUX, PLAFOND_LECTURE_POI, refusBorneNationale, sansTerritoire,
} from '@/lib/isochrones/borne-nationale';

/** La phrase de Vincent (26/10, Q-1) : jamais « refusé », la tâche de fond est promise. */
const SUITE = ' dépasse ce qu’on peut calculer en direct. Il se lancera en tâche de fond dès le lot « calculs longs » ; '
  + 'en attendant, retirez des paliers ou choisissez une région.';

describe('borne nationale de la bataille', () => {
  it('capacité synchrone mesurée : 700 anneaux ; lecture des POI : 500', () => {
    expect(CAPACITE_SYNCHRONE_ANNEAUX).toBe(700);
    expect(PLAFOND_LECTURE_POI).toBe(500);
  });

  it('aucune borne produit sur le nombre de points : 95 × 7 = 665 anneaux passent, 175 × 4 = 700 aussi', () => {
    expect(refusBorneNationale(95, 7)).toBeNull();
    expect(refusBorneNationale(175, 4)).toBeNull();
    expect(refusBorneNationale(151, 1)).toBeNull();
  });

  it('au-delà de 700 anneaux : le calcul en tâche de fond, chiffré', () => {
    expect(refusBorneNationale(120, 6)).toBe(`Ce calcul (120 POI × 6 paliers = 720 anneaux)${SUITE}`);
  });

  it('500 POI lus : la lecture est plafonnée, on dit « 500 POI ou plus », jamais un compte faux', () => {
    expect(refusBorneNationale(500, 1)).toBe(`Ce calcul (500 POI ou plus × 1 palier = 500 anneaux ou plus)${SUITE}`);
  });

  it('anneaux réellement trouvés en cache : le compte lu, pas le produit', () => {
    expect(refusBorneNationale(95, 8, 706)).toBe(`Ce calcul (95 POI × 8 paliers : 706 anneaux en cache)${SUITE}`);
    expect(refusBorneNationale(95, 8, 285)).toBeNull();
  });

  it('sansTerritoire : vrai seulement sans ville, sans région, sans département', () => {
    expect(sansTerritoire({})).toBe(true);
    expect(sansTerritoire({ filtre_ville: null, filtre_regions: null, filtre_depts: null })).toBe(true);
    expect(sansTerritoire({ filtre_ville: '  ', filtre_regions: [], filtre_depts: [] })).toBe(true);
    expect(sansTerritoire({ filtre_ville: 'Lyon' })).toBe(false);
    expect(sansTerritoire({ filtre_regions: ['93'] })).toBe(false);
    expect(sansTerritoire({ filtre_depts: [13] })).toBe(false);
  });
});
