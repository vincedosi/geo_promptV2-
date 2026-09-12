import { describe, it, expect } from 'vitest';
import {
  perimetreChoisi, messageGardePerimetre, MESSAGE_PERIMETRE_MANQUANT,
} from '@/lib/carte/garde-perimetre';
import type { FiltreActif } from '@/lib/carte/filtre';

const dept: FiltreActif = { type: 'departement', code: '13', label: 'Bouches-du-Rhône' };
const zoneFiltre: FiltreActif = { type: 'zone', code: 'z1', label: 'Zone 1' };

describe('garde de perimetre (spec §5)', () => {
  it('aucun filtre et aucune zone : perimetre absent', () => {
    expect(perimetreChoisi(null)).toBe(false);
    expect(perimetreChoisi(null, null)).toBe(false);
    expect(perimetreChoisi(null, undefined)).toBe(false);
  });

  it('un filtre actif (quel que soit son type) suffit', () => {
    expect(perimetreChoisi(dept)).toBe(true);
  });

  it('un filtre de type zone suffit (deja un perimetre)', () => {
    expect(perimetreChoisi(zoneFiltre)).toBe(true);
  });

  it('une zone selectionnee hors filtre suffit', () => {
    expect(perimetreChoisi(null, 'zone-id-123')).toBe(true);
  });

  it('une chaine vide ne compte pas comme une zone selectionnee', () => {
    expect(perimetreChoisi(null, '')).toBe(false);
  });

  it('messageGardePerimetre rend null quand le perimetre est choisi', () => {
    expect(messageGardePerimetre(dept)).toBeNull();
    expect(messageGardePerimetre(null, 'zone-id')).toBeNull();
  });

  it('messageGardePerimetre rend le message exact de la spec quand rien n est choisi', () => {
    expect(messageGardePerimetre(null)).toBe(MESSAGE_PERIMETRE_MANQUANT);
    expect(messageGardePerimetre(null)).toBe('Choisissez un périmètre (filtre ou zone) avant de lancer un calcul.');
  });
});
