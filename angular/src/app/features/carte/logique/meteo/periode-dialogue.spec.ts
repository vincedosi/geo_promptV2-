import { PRESETS, ajouterJours, periodeParDefaut, validerPeriodeDialogue } from './periode-dialogue';

const T = '2026-10-10';

describe('periode-dialogue (MeteoGeoPanel.tsx)', () => {
  it('ajouterJours : en jours civils UTC, mois et année franchis', () => {
    expect(ajouterJours(T, 7)).toBe('2026-10-17');
    expect(ajouterJours(T, -10)).toBe('2026-09-30');
    expect(ajouterJours('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('préréglages : libellés et périodes de React, dans l’ordre', () => {
    expect(PRESETS.forecast.map((p) => [p.label, p.periode(T)])).toEqual([
      ["Aujourd'hui", { debut: T, fin: T }],
      ['3 jours', { debut: T, fin: '2026-10-13' }],
      ['7 jours', { debut: T, fin: '2026-10-17' }],
      ['14 jours', { debut: T, fin: '2026-10-24' }],
    ]);
    expect(PRESETS.history.map((p) => [p.label, p.periode(T)])).toEqual([
      ['Hier', { debut: '2026-10-09', fin: '2026-10-09' }],
      ['7 derniers jours', { debut: '2026-10-03', fin: '2026-10-09' }],
      ['30 derniers jours', { debut: '2026-09-10', fin: '2026-10-09' }],
      ['90 derniers jours', { debut: '2026-07-12', fin: '2026-10-09' }],
    ]);
  });

  it('période par défaut d’un mode (applyModeChange)', () => {
    expect(periodeParDefaut('forecast', T)).toEqual({ debut: T, fin: '2026-10-17' });
    expect(periodeParDefaut('history', T)).toEqual({ debut: '2026-10-03', fin: '2026-10-09' });
  });

  it('validation : les cinq messages de React, et null sur une période valide', () => {
    expect(validerPeriodeDialogue('forecast', '2026-10-12', '2026-10-11', T)).toBe('Date de début postérieure à la date de fin');
    expect(validerPeriodeDialogue('forecast', '2026-10-01', '2026-10-09', T)).toBe("En mode prévisions, la date de fin doit être aujourd'hui ou plus tard");
    expect(validerPeriodeDialogue('forecast', T, '2026-10-27', T)).toBe('Prévisions limitées à 16 jours');
    expect(validerPeriodeDialogue('history', '2026-10-01', T, T)).toBe("En mode historique, la date de fin doit être avant aujourd'hui");
    expect(validerPeriodeDialogue('history', '2026-06-01', '2026-10-09', T)).toBe('Historique limité à 90 jours');
    expect(validerPeriodeDialogue('forecast', T, '2026-10-26', T)).toBeNull();
    expect(validerPeriodeDialogue('history', '2026-07-11', '2026-10-09', T)).toBeNull();
  });
});
