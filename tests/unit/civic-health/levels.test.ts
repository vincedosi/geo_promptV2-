import { describe, expect, it } from 'vitest';
import {
  ATMO_LEVEL_LABELS,
  POLLEN_LEVEL_LABELS,
  atmoLevelToken,
  atmoQualificatif,
  parseAtmoLevel,
  parsePollenLevel,
  pollenLevelToken,
} from '@/lib/civic-health/levels';

describe('parseAtmoLevel', () => {
  it('accepts integers 1-6', () => {
    for (let i = 1; i <= 6; i++) {
      expect(parseAtmoLevel(i)).toBe(i);
      expect(parseAtmoLevel(String(i))).toBe(i);
    }
  });

  it('rejects 0, 7, 8, NaN, undefined, null', () => {
    expect(parseAtmoLevel(0)).toBeNull();
    expect(parseAtmoLevel(7)).toBeNull();
    expect(parseAtmoLevel(8)).toBeNull();
    expect(parseAtmoLevel('abc')).toBeNull();
    expect(parseAtmoLevel(undefined)).toBeNull();
    expect(parseAtmoLevel(null)).toBeNull();
    expect(parseAtmoLevel(2.5)).toBeNull();
  });
});

describe('parsePollenLevel', () => {
  it('accepts integers 0-6', () => {
    for (let i = 0; i <= 6; i++) {
      expect(parsePollenLevel(i)).toBe(i);
    }
  });

  it('rejects -1, 7, NaN', () => {
    expect(parsePollenLevel(-1)).toBeNull();
    expect(parsePollenLevel(7)).toBeNull();
    expect(parsePollenLevel('xx')).toBeNull();
  });
});

describe('tokens', () => {
  it('atmoLevelToken returns var() reference for valid levels', () => {
    expect(atmoLevelToken(1)).toBe('var(--atmo-level-1)');
    expect(atmoLevelToken(6)).toBe('var(--atmo-level-6)');
  });

  it('atmoLevelToken returns na for null/undefined', () => {
    expect(atmoLevelToken(null)).toBe('var(--atmo-level-na)');
    expect(atmoLevelToken(undefined)).toBe('var(--atmo-level-na)');
  });

  it('pollenLevelToken returns level-0 fallback', () => {
    expect(pollenLevelToken(null)).toBe('var(--pollen-level-0)');
    expect(pollenLevelToken(3)).toBe('var(--pollen-level-3)');
  });
});

describe('labels', () => {
  it('all 6 ATMO levels mapped', () => {
    expect(Object.keys(ATMO_LEVEL_LABELS)).toHaveLength(6);
    expect(ATMO_LEVEL_LABELS[1]).toBe('bon');
    expect(ATMO_LEVEL_LABELS[6]).toBe('extrêmement mauvais');
  });

  it('all 7 pollen levels mapped (0-6)', () => {
    expect(Object.keys(POLLEN_LEVEL_LABELS)).toHaveLength(7);
    expect(POLLEN_LEVEL_LABELS[0]).toBe('indisponible');
    expect(POLLEN_LEVEL_LABELS[6]).toBe('extrêmement élevé');
  });

  it('atmoQualificatif matches the label map', () => {
    expect(atmoQualificatif(3)).toBe('dégradé');
  });
});
