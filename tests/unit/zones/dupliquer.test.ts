import { describe, it, expect, vi } from 'vitest';
import { lireCopie, modeDuplication } from '@/lib/zones/dupliquer';

/** « Dupliquer » (③ finitions, T2, arbitrage A-5) : recalculer à neuf ce qui se recalcule, copier en base le reste. */
describe('modeDuplication', () => {
  it.each([
    ['rayon autour d’un point', { v: 1, type: 'rayon_point', lon: 5.4, lat: 43.3, rayon_m: 1000 }],
    ['seuil sur carreaux', { v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: { type: 'departement', code: '13' }, min_menages: 11 }],
    ['codes postaux', { v: 1, type: 'codes_postaux', codes: ['13001'] }],
  ])('recette recalculable (%s) : recalcul, la recette relue par le schéma', (_n, recette) => {
    const m = modeDuplication(recette);
    expect(m.mode).toBe('recalcul');
    expect(m.mode === 'recalcul' && m.recette).toEqual(recette);
  });

  it.each([
    ['dessin', { v: 1, type: 'dessin' }],
    ['capture', { v: 1, type: 'capture', source_type: 'isochrone_battle' }],
    ['combinaison', { v: 1, type: 'combinaison', operation: 'union', zones: ['3f2504e0-4f89-11d3-9a0c-0305e82c3301', '3f2504e0-4f89-11d3-9a0c-0305e82c3302'] }],
    ['zone d’avant le lot 3 (recette NULL)', null],
  ])('forme figée (%s) : copie en base', (_n, recette) => {
    expect(modeDuplication(recette)).toEqual({ mode: 'copie' });
  });

  it('recette stockée illisible : copie (la forme est la vérité), et l’anomalie se journalise', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(modeDuplication({ v: 9, type: 'pluie' })).toEqual({ mode: 'copie' });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('lireCopie', () => {
  it('rétrécit la réponse de dupliquer_zone (sql/294)', () => {
    expect(lireCopie({ id: 'z2', surface_km2: 1.5 })).toEqual({ id: 'z2', surface_km2: 1.5 });
    expect(lireCopie({ id: 'z2', surface_km2: null })).toEqual({ id: 'z2', surface_km2: null });
    expect(lireCopie({ refus: 'zone_introuvable' })).toEqual({ refus: 'zone_introuvable' });
    for (const hors of [null, 'z2', [], {}, { id: '' }, { refus: 'autre' }]) expect(lireCopie(hors)).toBeNull();
  });
});
