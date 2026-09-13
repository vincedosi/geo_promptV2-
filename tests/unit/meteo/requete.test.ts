import { describe, it, expect } from 'vitest';
import {
  validerPeriode, pickHost, buildOpenMeteoUrl, sampleZonePoints,
  arrondirBboxExterieur, dansBbox, cleCache, parseBbox,
  MAX_POINTS_PER_BATCH, MAX_HISTORY_DAYS, MAX_FORECAST_DAYS,
} from '@/lib/meteo/requete';

const TODAY = '2026-09-13';

describe('validerPeriode', () => {
  it('accepte une prévision de 7 jours et un historique de 30 jours', () => {
    expect(validerPeriode('2026-09-13', '2026-09-20', TODAY)).toBeNull();
    expect(validerPeriode('2026-08-13', '2026-09-12', TODAY)).toBeNull();
  });

  it('refuse début > fin', () => {
    expect(validerPeriode('2026-09-20', '2026-09-13', TODAY)).toMatch(/startDate/);
  });

  it(`refuse une prévision au-delà de ${MAX_FORECAST_DAYS} jours`, () => {
    expect(validerPeriode('2026-09-13', '2026-10-13', TODAY)).toMatch(/Forecast/);
  });

  it(`refuse un historique de plus de ${MAX_HISTORY_DAYS} jours`, () => {
    expect(validerPeriode('2026-05-01', '2026-09-12', TODAY)).toMatch(/History/);
  });

  it('refuse une « prévision » qui remonte deux ans en arrière — le défaut corrigé', () => {
    // Avant : seule la distance aujourd'hui → fin était bornée, ceci passait.
    expect(validerPeriode('2024-01-01', '2026-09-14', TODAY)).not.toBeNull();
  });
});

describe('pickHost', () => {
  it('prévision si la fin est aujourd’hui ou après', () => {
    expect(pickHost('2026-09-10', '2026-09-13', TODAY)).toBe('api.open-meteo.com');
  });
  it('archive ERA5 avant 2022, historique-prévision sinon', () => {
    expect(pickHost('2021-06-01', '2021-06-30', TODAY)).toBe('archive-api.open-meteo.com');
    expect(pickHost('2026-08-01', '2026-08-31', TODAY)).toBe('historical-forecast-api.open-meteo.com');
  });
});

describe('buildOpenMeteoUrl', () => {
  it('n’encode pas les virgules des listes (414 sinon) et prend le bon endpoint', () => {
    const url = buildOpenMeteoUrl('archive-api.open-meteo.com', [
      { lat: 48.8566, lon: 2.3522 }, { lat: 45.764, lon: 4.8357 },
    ], 'precipitation', '2021-06-01', '2021-06-30');
    expect(url).toContain('/v1/archive?latitude=48.857,45.764&longitude=2.352,4.836');
    expect(url).toContain('&daily=precipitation_sum');
    expect(url).toContain('&timezone=Europe%2FParis');
    expect(url).not.toContain('%2C');
  });
});

describe('sampleZonePoints', () => {
  it('rend les zones telles quelles sous le plafond', () => {
    const zones = [{ code: 'a', nom: 'A', lat: 48, lon: 2 }, { code: 'b', nom: 'B', lat: 45, lon: 4 }];
    const { points, assign } = sampleZonePoints(zones, MAX_POINTS_PER_BATCH);
    expect(points).toHaveLength(2);
    expect(assign).toEqual([0, 1]);
  });

  it('regroupe 6 000 zones sous 500 points et assigne chaque zone à un point existant', () => {
    const zones = Array.from({ length: 6_000 }, (_, i) => ({
      code: String(i), nom: '', lat: 41.5 + (i % 100) * 0.09, lon: -5 + Math.floor(i / 100) * 0.24,
    }));
    const { points, assign } = sampleZonePoints(zones, 500);
    expect(points.length).toBeLessThanOrEqual(500);
    expect(points.length).toBeGreaterThan(100);
    expect(assign).toHaveLength(6_000);
    for (const p of assign) expect(p).toBeLessThan(points.length);
  });

  it('est déterministe', () => {
    const zones = Array.from({ length: 1_200 }, (_, i) => ({ code: String(i), nom: '', lat: 43 + (i % 40) * 0.1, lon: i * 0.01 }));
    expect(sampleZonePoints(zones, 300)).toEqual(sampleZonePoints(zones, 300));
  });
});

describe('arrondirBboxExterieur / dansBbox / cleCache', () => {
  it('arrondit vers l’extérieur : la bbox rendue contient la bbox demandée', () => {
    const b = arrondirBboxExterieur([2.1, 48.3, 2.4, 48.9]);
    expect(b).toEqual([2, 48, 2.5, 49]);
    const c = arrondirBboxExterieur([-0.2, 47.51, 0.01, 47.99]);
    expect(c).toEqual([-0.5, 47.5, 0.5, 48]);
  });

  it('deux viewports voisins partagent une clé ET le même jeu de zones — le défaut corrigé', () => {
    const a = arrondirBboxExterieur([2.1, 48.3, 2.4, 48.9]);
    const b = arrondirBboxExterieur([2.2, 48.4, 2.45, 48.95]);
    expect(cleCache('cp', 'precipitation', '2026-09-13', '2026-09-20', a))
      .toBe(cleCache('cp', 'precipitation', '2026-09-13', '2026-09-20', b));
    const zone = { lat: 48.35, lon: 2.15 }; // dans a, hors de b brut — mais dans les deux arrondies
    expect(dansBbox(zone, a)).toBe(true);
    expect(dansBbox(zone, b)).toBe(true);
  });

  it('parseBbox lit west,south,east,north', () => {
    expect(parseBbox('-1.5,47,0.25,48.5')).toEqual([-1.5, 47, 0.25, 48.5]);
  });

  it('la clé change avec chaque paramètre', () => {
    const base = cleCache('cp', 'precipitation', '2026-09-13', '2026-09-20', [2, 48, 2.5, 49]);
    expect(cleCache('departement', 'precipitation', '2026-09-13', '2026-09-20', [2, 48, 2.5, 49])).not.toBe(base);
    expect(cleCache('cp', 'temperature_2m', '2026-09-13', '2026-09-20', [2, 48, 2.5, 49])).not.toBe(base);
    expect(cleCache('cp', 'precipitation', '2026-09-12', '2026-09-20', [2, 48, 2.5, 49])).not.toBe(base);
    expect(cleCache('cp', 'precipitation', '2026-09-13', '2026-09-20')).not.toBe(base);
  });
});
