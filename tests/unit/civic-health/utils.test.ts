import { describe, it, expect } from 'vitest';
import { isoDate } from '@/lib/civic-health/utils';

/**
 * `isoDate` rend le jour civil FRANÇAIS. Atmo publie par `date_ech` en heure
 * de Paris : lire la date UTC rendait la veille entre 22 h/23 h et minuit,
 * heure de Paris — un rejeu manuel du soir demandait le mauvais jour au WFS.
 */
describe('isoDate — jour civil en heure de Paris', () => {
  it('à 23 h 30 heure de Paris (été), rend le jour de Paris, pas la date UTC', () => {
    const now = new Date('2026-07-03T21:30:00Z'); // 23:30 à Paris (UTC+2)
    expect(now.toISOString().slice(0, 10)).toBe('2026-07-03');
    expect(isoDate(0, now)).toBe('2026-07-03');
    const apresMinuitParis = new Date('2026-07-03T22:30:00Z'); // 00:30 le 4 à Paris
    expect(apresMinuitParis.toISOString().slice(0, 10)).toBe('2026-07-03'); // UTC dit encore le 3
    expect(isoDate(0, apresMinuitParis)).toBe('2026-07-04');            // Paris dit le 4
  });

  it('applique le décalage en jours sur le jour de Paris, sans surprise de mois', () => {
    const now = new Date('2026-08-01T00:30:00+02:00');
    expect(isoDate(0, now)).toBe('2026-08-01');
    expect(isoDate(-1, now)).toBe('2026-07-31');
    expect(isoDate(2, now)).toBe('2026-08-03');
  });

  it('en hiver (UTC+1), même contrat', () => {
    const now = new Date('2026-01-15T23:20:00Z'); // 00:20 le 16 à Paris
    expect(isoDate(0, now)).toBe('2026-01-16');
    expect(isoDate(-1, now)).toBe('2026-01-15');
  });
});
