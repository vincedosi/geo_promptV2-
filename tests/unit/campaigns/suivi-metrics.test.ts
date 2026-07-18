import { describe, it, expect } from 'vitest';
import { pacingTone, cpmTone, holdTone, alignmentTone, toneColor, fmtPct, fmtCpm, fmtInt } from '@/lib/campaigns/suivi-metrics';

describe('suivi-metrics tones', () => {
  it('pacing : 1,0 ok · 0,8 warn · 0,6 bad · null warn', () => {
    expect(pacingTone(1.0)).toBe('ok');
    expect(pacingTone(0.8)).toBe('warn');
    expect(pacingTone(1.2)).toBe('warn');
    expect(pacingTone(0.6)).toBe('bad');
    expect(pacingTone(1.3)).toBe('bad');
    expect(pacingTone(null)).toBe('warn');
  });
  it('cpm : sous prévu ok · +20 % warn · +30 % bad · sans prévu ok', () => {
    expect(cpmTone(6.2, 7.1)).toBe('ok');
    expect(cpmTone(8.2, 7.1)).toBe('warn');
    expect(cpmTone(9.5, 7.1)).toBe('bad');
    expect(cpmTone(6.2, null)).toBe('ok');
    expect(cpmTone(null, 7.1)).toBe('ok');
  });
  it('hold : 100 ok · 70 warn · 50 bad · null warn', () => {
    expect(holdTone(100)).toBe('ok');
    expect(holdTone(70)).toBe('warn');
    expect(holdTone(50)).toBe('bad');
    expect(holdTone(null)).toBe('warn');
  });
  it('toneColor renvoie des tokens CSS', () => {
    expect(toneColor('ok')).toBe('var(--success)');
    expect(toneColor('warn')).toBe('var(--warning)');
    expect(toneColor('bad')).toBe('var(--danger)');
  });
});

describe('alignmentTone (divergent autour de 100)', () => {
  it('ok 90-110 · warn 70-90/110-130 · bad ailleurs · null warn', () => {
    expect(alignmentTone(100)).toBe('ok');
    expect(alignmentTone(90)).toBe('ok');
    expect(alignmentTone(110)).toBe('ok');
    expect(alignmentTone(80)).toBe('warn');
    expect(alignmentTone(120)).toBe('warn');
    expect(alignmentTone(50)).toBe('bad');
    expect(alignmentTone(140)).toBe('bad');
    expect(alignmentTone(null)).toBe('warn');
  });
});

describe('suivi-metrics formats', () => {
  it('fmtPct fr-FR et null', () => {
    expect(fmtPct(50.9)).toBe('50,9 %');
    expect(fmtPct(null)).toBe('—');
  });
  it('fmtCpm avec € et 2 décimales', () => {
    expect(fmtCpm(6.2)).toBe('6,20 €');
    expect(fmtCpm(null)).toBe('—');
  });
  it('fmtInt séparateurs fr-FR', () => {
    expect(fmtInt(49239022)).toBe('49 239 022');
    expect(fmtInt(null)).toBe('—');
  });
});
