import { describe, it, expect } from 'vitest';
import { CARREAUX_INDICATEURS } from '@/components/CarreauxPMTilesLayer';
import { bornesDe, BORNES_NATIONALES } from '@/lib/carreaux/bornes';

describe('bornes nationales', () => {
  it('couvre tous les indicateurs du catalogue', () => {
    const manquants = CARREAUX_INDICATEURS.map(i => i.id).filter(id => !(id in BORNES_NATIONALES));
    expect(manquants).toEqual([]);
  });

  it('a des bornes strictement croissantes — MapLibre rejette le contraire en silence', () => {
    for (const [id, b] of Object.entries(BORNES_NATIONALES)) {
      expect(b.p95, `${id} : p95 doit etre > p5`).toBeGreaterThan(b.p5);
    }
  });

  it('n’a que des bornes finies et positives', () => {
    for (const [id, b] of Object.entries(BORNES_NATIONALES)) {
      expect(Number.isFinite(b.p5), `${id} : p5 fini`).toBe(true);
      expect(Number.isFinite(b.p95), `${id} : p95 fini`).toBe(true);
      expect(b.p5, `${id} : p5 >= 0`).toBeGreaterThanOrEqual(0);
    }
  });

  it('retourne un repli exploitable pour un indicateur inconnu', () => {
    const b = bornesDe('indicateur_inexistant');
    expect(b.p95).toBeGreaterThan(b.p5);
  });

  it('resiste a la chaine de prototype', () => {
    const b = bornesDe('constructor');
    expect(b.p95).toBeGreaterThan(b.p5);
    const t = bornesDe('toString');
    expect(t.p95).toBeGreaterThan(t.p5);
  });

  it('rend les bornes d’un indicateur connu', () => {
    expect(bornesDe('population_totale')).toEqual(BORNES_NATIONALES.population_totale);
  });
});
