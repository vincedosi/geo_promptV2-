import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `enrichMissingGeo` — l'enrichissement région/département après import.
 *
 * Avant : 500 appels BAN unitaires + 500 UPDATE d'une ligne, lancés 5 à la
 * fois (au-delà des 3 requêtes Supabase simultanées tolérées par Nano).
 * Après : UN appel BAN CSV, puis un UPDATE par couple (région, département),
 * par lots de 50 identifiants, séquentiels. Ces tests comptent les requêtes.
 */

interface Update { region: string; departement: string | null; ids: string[] }
const updates: Update[] = [];
let enVol = 0;
let maxEnVol = 0;
let pois: { id: string; lat: number; lng: number }[] = [];

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ is: () => ({ not: () => ({ not: () => ({ limit: async () => ({ data: pois, error: null }) }) }) }) }),
      }),
      update: (valeurs: { region: string; departement: string | null }) => ({
        in: async (_col: string, ids: string[]) => {
          enVol++; maxEnVol = Math.max(maxEnVol, enVol);
          await new Promise((r) => setTimeout(r, 1));
          enVol--;
          updates.push({ ...valeurs, ids });
          return { error: null };
        },
      }),
    }),
  }),
}));

const appelsReverse: number[] = [];
vi.mock('@/lib/import/geocoder', () => ({
  reverseGeocodeRows: async (points: { index: number; lat: number; lng: number }[]) => {
    appelsReverse.push(points.length);
    // Deux départements : index pair → Calvados, impair → Manche ; index 7 → sans région
    return points.map((p) => ({
      index: p.index,
      dept_code: p.index % 2 === 0 ? '14' : '50',
      dept_nom: p.index % 2 === 0 ? 'Calvados' : 'Manche',
      region: p.index === 7 ? null : 'Normandie',
      ville: null,
      code_postal: null,
    }));
  },
}));

const { enrichMissingGeo } = await import('@/lib/import/geo-enricher');

beforeEach(() => { updates.length = 0; appelsReverse.length = 0; enVol = 0; maxEnVol = 0; });

describe('enrichMissingGeo', () => {
  it('UN appel BAN pour tous les POI, un UPDATE par (région, département), jamais plus de 50 ids', async () => {
    pois = Array.from({ length: 130 }, (_, i) => ({ id: `poi-${i}`, lat: 49 + i * 0.001, lng: -0.3 }));
    const journal: string[] = [];

    await enrichMissingGeo('source-1', (_lvl, msg) => journal.push(msg));

    expect(appelsReverse).toEqual([130]);
    // 129 POI résolus (l'index 7 est sans région) : 65 Calvados + 64 Manche
    // → lots de 50 : Calvados 50+15, Manche 50+14 = 4 UPDATE
    expect(updates).toHaveLength(4);
    for (const u of updates) expect(u.ids.length).toBeLessThanOrEqual(50);
    const parDept = new Map<string | null, number>();
    for (const u of updates) parDept.set(u.departement, (parDept.get(u.departement) ?? 0) + u.ids.length);
    expect(parDept.get('Calvados')).toBe(65);
    expect(parDept.get('Manche')).toBe(64);
    expect(updates.every((u) => u.region === 'Normandie')).toBe(true);
    // Le POI sans région n'est touché par aucun UPDATE
    expect(updates.some((u) => u.ids.includes('poi-7'))).toBe(false);
    expect(journal.at(-1)).toMatch(/129\/130 POIs enrichis/);
  });

  it('les UPDATE sont séquentiels — jamais deux écritures Supabase en vol', async () => {
    pois = Array.from({ length: 120 }, (_, i) => ({ id: `p${i}`, lat: 48, lng: 2 }));
    await enrichMissingGeo('source-2');
    expect(maxEnVol).toBe(1);
  });

  it('ne fait rien sans POI à enrichir', async () => {
    pois = [];
    await enrichMissingGeo('source-3');
    expect(appelsReverse).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
