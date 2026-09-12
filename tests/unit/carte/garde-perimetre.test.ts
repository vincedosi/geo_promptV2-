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

  it('messageGardePerimetre rend le message exact (verbatim) de la spec quand rien n est choisi', () => {
    expect(messageGardePerimetre(null)).toBe(MESSAGE_PERIMETRE_MANQUANT);
    expect(messageGardePerimetre(null)).toBe('Choisissez un périmètre (filtre ou zone) avant de lancer un calcul');
  });

  it('le message verbatim ne porte pas de point final (la spec n en portait pas)', () => {
    expect(MESSAGE_PERIMETRE_MANQUANT.endsWith('.')).toBe(false);
  });
});

// Le cablage reel de cette garde sur les cinq outils du panneau Analyse est
// verifie structurellement par tests/unit/carte/panneau-analyse-garde.test.ts
// (round 2 de correction, Tache 7) — voir l'en-tete de garde-perimetre.ts
// pour pourquoi une fonction "lancementsAutorises" testee ici a ete retiree :
// elle n'etait appelee nulle part en production.
