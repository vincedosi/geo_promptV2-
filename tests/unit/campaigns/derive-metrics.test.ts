import { describe, it, expect } from 'vitest';
import { decrocheTone, countDecroche, meshLabel } from '@/lib/campaigns/derive-metrics';

describe('derive-metrics', () => {
  it('decrocheTone : seuil pilote la frontière rouge', () => {
    expect(decrocheTone(52, 80)).toBe('bad');   // sous le seuil
    expect(decrocheTone(85, 80)).toBe('warn');  // entre seuil et 100
    expect(decrocheTone(100, 80)).toBe('ok');
    expect(decrocheTone(130, 80)).toBe('over');
    expect(decrocheTone(85, 90)).toBe('bad');   // même valeur, seuil plus haut => décroche
    expect(decrocheTone(null, 80)).toBe('warn');
  });
  it('countDecroche : compte les zones sous le seuil (null ignoré)', () => {
    expect(countDecroche([{ value: 52 }, { value: 85 }, { value: null }, { value: 40 }], 80)).toBe(2);
  });
  it('meshLabel : sentence case', () => {
    expect(meshLabel('cp')).toBe('CP');
    expect(meshLabel('departement')).toBe('Département');
  });
});
