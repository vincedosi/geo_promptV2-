import { describe, it, expect } from 'vitest';
import {
  perimetreChoisi, messageGardePerimetre, MESSAGE_PERIMETRE_MANQUANT,
  lancementsAutorises, type OutilAnalyse,
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

describe('lancementsAutorises — les CINQ outils du panneau Analyse', () => {
  const OUTILS: OutilAnalyse[] = ['voronoi', 'battleV1', 'battleV2', 'appliquerBataille', 'clustering'];

  it('enumere exactement les cinq outils, ni plus ni moins', () => {
    const res = lancementsAutorises(null);
    expect(Object.keys(res).sort()).toEqual([...OUTILS].sort());
  });

  it('sans perimetre, aucun des cinq outils n est autorise', () => {
    const res = lancementsAutorises(null);
    for (const outil of OUTILS) expect(res[outil]).toBe(false);
  });

  it('avec un filtre actif, les cinq outils sont autorises', () => {
    const res = lancementsAutorises(dept);
    for (const outil of OUTILS) expect(res[outil]).toBe(true);
  });

  it('avec une zone selectionnee hors filtre, les cinq outils sont autorises', () => {
    const res = lancementsAutorises(null, 'zone-id');
    for (const outil of OUTILS) expect(res[outil]).toBe(true);
  });

  it('le clustering suit la meme regle que les quatre autres — pas d exception', () => {
    expect(lancementsAutorises(null).clustering).toBe(false);
    expect(lancementsAutorises(dept).clustering).toBe(true);
  });

  it('appliquerBataille (ST_Difference) suit la meme regle — second point de lancement', () => {
    expect(lancementsAutorises(null).appliquerBataille).toBe(false);
    expect(lancementsAutorises(dept).appliquerBataille).toBe(true);
  });
});
