/**
 * @file tests/unit/custom-geo/composition.test.ts — composition lisible d'une
 * zone (Tâche 15, 2026-09-13).
 *
 * Les cinq premiers cas sont VERBATIM du plan. Les suivants portent sur les
 * formes de `source_metadata` RÉELLEMENT présentes en base — mesurées le
 * 2026-09-13 : `composite` porte `{kind, member_zone_ids}`,
 * `indicator_threshold` porte `{indicator, operator, threshold, unit, scale}`,
 * `isochrone_battle` porte `{category, mode, paliers, poi_count}`. Le plan ne
 * décrivait aucune d'elles.
 */
import { describe, it, expect } from 'vitest';
import { decrireComposition } from '@/lib/custom-geo/composition';

describe('composition lisible d une zone', () => {
  it('decrit une capture IRIS', () => {
    expect(decrireComposition('iris', { feature_count: 992 })).toBe('992 IRIS sélectionnés');
  });
  it('decrit une difference de zones administratives', () => {
    expect(decrireComposition('composite', {
      kind: 'difference', base_label: '3 départements', retires_labels: ['Paris'],
    })).toBe('3 départements moins Paris');
  });
  it('decrit une capture mixte', () => {
    expect(decrireComposition('composite', {
      kind: 'union', member_labels: ['412 IRIS', 'isochrone 15 min'],
    })).toBe('412 IRIS et isochrone 15 min');
  });
  it('retombe sur le type quand la metadata est muette', () => {
    expect(decrireComposition('battle', {})).toBe('Bataille isochrone');
  });
  it('ne jette jamais sur une metadata inattendue', () => {
    expect(() => decrireComposition('iris', { feature_count: null })).not.toThrow();
  });

  // ── Les formes réellement présentes en base ─────────────────────────────
  it('decrit un seuil d indicateur avec son operateur et son unite', () => {
    expect(decrireComposition('indicator_threshold', {
      indicator: 'Revenu médian', operator: '>=', threshold: 27500, unit: '€',
      // Espace fine insécable (U+202F) : c'est ce que rend `formaterNombre`,
      // source unique de la mise en forme des nombres du projet (CLAUDE.md).
    })).toBe('Revenu médian ≥ 27 500 €');
  });
  it('decrit une bataille isochrone avec sa categorie et ses paliers', () => {
    expect(decrireComposition('isochrone_battle', {
      category: 'CIRFA', mode: 'driving-car', paliers: [10, 20, 30], poi_count: 95,
    })).toBe('Bataille isochrone — 95 POI CIRFA, paliers 10/20/30 min');
  });
  it('decrit un composite sans libelles, par le nombre de membres', () => {
    // C'est la forme qui existe VRAIMENT en base : ni member_labels, ni
    // base_label — seulement les identifiants.
    expect(decrireComposition('composite', {
      kind: 'union', member_zone_ids: ['a', 'b', 'c'],
    })).toBe('Union de 3 zones');
  });
  it('decrit les operations booleennes de la tache 14', () => {
    expect(decrireComposition('intersection', {
      operation: 'intersection', member_zone_names: ['Bretagne', 'Jeunes'],
    })).toBe('Bretagne et Jeunes en commun');
    expect(decrireComposition('difference', {
      operation: 'difference', member_zone_names: ['Jeunes', 'Riches'],
    })).toBe('Jeunes moins Riches');
  });
  it('decrit un score composite par ses indicateurs et son seuil', () => {
    expect(decrireComposition('score_composite', {
      seuil: 70, indicateurs: [{ code: 'rev_median' }, { code: 'taux_chomage' }],
    })).toBe('Score composite ≥ 70 sur 2 indicateurs');
  });

  // ── Robustesse : la metadata vient de la base, jamais de code ───────────
  it('ne jette sur aucune forme aberrante', () => {
    const aberrations: unknown[] = [
      null, undefined, [], 'texte', 42,
      { member_zone_ids: 'pas un tableau' },
      { paliers: null, poi_count: 'beaucoup' },
      { indicator: { imbrique: true }, threshold: NaN },
    ];
    for (const m of aberrations) {
      expect(() => decrireComposition('composite', m as Record<string, unknown>)).not.toThrow();
      expect(typeof decrireComposition('composite', m as Record<string, unknown>)).toBe('string');
    }
  });
  it('rend toujours une chaine non vide', () => {
    expect(decrireComposition('type_jamais_vu', {}).length).toBeGreaterThan(0);
  });
});
