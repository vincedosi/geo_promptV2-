import { describe, it, expect, vi, afterEach } from 'vitest';
import { ageEnJours } from '@/app/map/_components/filter-panel/CivicHealthSection';

/**
 * `TER-002` — la carte des allergènes affichait des données de dix semaines.
 *
 * Mesuré en base le 2026-09-11 : `pollen_map_daily` et `atmo_map_daily` étaient
 * figées au 3 juillet. Les tables sont pourtant purgées à J-2 : elles ne
 * devraient contenir que le jour et la veille. Le cron Inngest qui les remplit
 * n'a jamais tourné en production, faute de clés.
 *
 * Ce qui rend le défaut dangereux, ce n'est pas l'absence de donnée — l'écran
 * sait déjà le dire — c'est qu'il y en avait une, plausible et fausse. Sur un
 * indicateur saisonnier, l'ambroisie culmine en août et les graminées en juin :
 * une valeur de juillet lue en septembre induit en erreur sans jamais alerter.
 */

afterEach(() => { vi.useRealTimers(); });

/** Fige l'horloge pour que « aujourd'hui » soit une date connue. */
function aujourdHui(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${iso}T12:00:00Z`));
}

describe('ageEnJours', () => {
  it('compte les jours ecoules depuis la date de la donnee', () => {
    aujourdHui('2026-09-11');
    expect(ageEnJours('2026-09-11')).toBe(0);
    expect(ageEnJours('2026-09-10')).toBe(1);
    // Le cas reel constate : 3 juillet lu le 11 septembre.
    expect(ageEnJours('2026-07-03')).toBe(70);
  });

  it('rend null pour une date absente — jamais « perime depuis toujours »', () => {
    // Le piege : traiter l'absence comme un age infini afficherait un
    // avertissement de peremption alors qu'il n'y a simplement aucune donnee,
    // cas que l'ecran signale deja autrement.
    aujourdHui('2026-09-11');
    expect(ageEnJours(null)).toBeNull();
    expect(ageEnJours(undefined)).toBeNull();
    expect(ageEnJours('')).toBeNull();
  });

  it('rend null pour une date illisible plutot qu un NaN', () => {
    aujourdHui('2026-09-11');
    expect(ageEnJours('pas une date')).toBeNull();
  });

  it('ne rend pas d age negatif exploitable pour une date future', () => {
    // Une donnee datee de demain (decalage de fuseau) ne doit pas franchir le
    // seuil de peremption.
    aujourdHui('2026-09-11');
    const age = ageEnJours('2026-09-12');
    expect(age).not.toBeNull();
    expect(age as number).toBeLessThanOrEqual(0);
  });
});
