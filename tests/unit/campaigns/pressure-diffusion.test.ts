import { describe, it, expect } from 'vitest';
import {
  pressureCurve, diffusionOutZoneWeights, diffusionCurveFloor,
} from '@/components/campaign/wizard/steps/types';

describe('pressureCurve', () => {
  it('sans floor : courbe 1/M → 1 → M (zones strictes)', () => {
    expect(pressureCurve(2)).toEqual([
      { x: 20, y: 0.5 },
      { x: 30, y: 1.0 },
      { x: 45, y: 2 },
    ]);
  });

  it('floor=1 : borne le bas à ×1 (national avec surpression)', () => {
    expect(pressureCurve(2.2, 1).map((pt) => pt.y)).toEqual([1, 1, 2.2]);
  });

  it('M=1 avec floor : courbe uniforme ×1', () => {
    expect(pressureCurve(1, 1).map((pt) => pt.y)).toEqual([1, 1, 1]);
  });
});

describe('diffusionOutZoneWeights', () => {
  it('zones strictes → exclusion (×0 hors zone)', () => {
    expect(diffusionOutZoneWeights('zones_only', true)).toEqual({ mode: 'exclusion' });
  });

  it('national avec surpression → uniform ×1 hors zone', () => {
    expect(diffusionOutZoneWeights('national_boost', true)).toEqual({ mode: 'uniform', value: 1.0 });
  });

  it('sans zone cible : {} quel que soit le choix (national pur)', () => {
    expect(diffusionOutZoneWeights('zones_only', false)).toEqual({});
    expect(diffusionOutZoneWeights('national_boost', false)).toEqual({});
  });
});

describe('diffusionCurveFloor', () => {
  it('floor ×1 seulement en national_boost avec zones', () => {
    expect(diffusionCurveFloor('national_boost', true)).toBe(1.0);
    expect(diffusionCurveFloor('zones_only', true)).toBeUndefined();
    expect(diffusionCurveFloor('national_boost', false)).toBeUndefined();
  });
});
