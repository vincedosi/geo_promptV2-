/**
 * Tests AtmoFranceProvider — fetch mocké, on vérifie la transformation
 * GeoJSON → HealthIndicator et le comportement d'erreur.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AtmoFranceProvider, _resetTokenCache } from '@/lib/civic-health/atmofrance-client';

const realFetch = global.fetch;

function todayIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function makeFeature(props: Record<string, unknown>) {
  return { properties: props };
}

describe('AtmoFranceProvider', () => {
  beforeEach(() => {
    _resetTokenCache();
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('throws on missing creds', () => {
    expect(() => new AtmoFranceProvider('', '')).toThrow();
  });

  it('logs in once then fetches both ATMO + pollen and merges', async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/api/login')) {
        return new Response(JSON.stringify({ token: 'tok-abc' }), { status: 200 });
      }
      if (url.includes('/api/data/112/')) {
        return new Response(JSON.stringify({
          features: [
            makeFeature({
              code_zone: '75056', lib_zone: 'Paris', date_ech: todayIso(0), date_maj: todayIso(0),
              code_qual: 3, code_no2: 2, code_o3: 4, code_pm10: 2, code_pm25: 3, code_so2: 1,
            }),
            makeFeature({ date_ech: todayIso(1), code_qual: 2 }),
          ],
        }), { status: 200 });
      }
      if (url.includes('/api/data/122/')) {
        return new Response(JSON.stringify({
          features: [
            makeFeature({
              code_zone: '75056', lib_zone: 'Paris', date_ech: todayIso(0),
              code_qual: 4, code_ambr: 0, code_arm: 1, code_aul: 0,
              code_boul: 4, code_gram: 3, code_oliv: 0,
            }),
            makeFeature({ date_ech: todayIso(1), code_qual: 3 }),
            makeFeature({ date_ech: todayIso(2), code_qual: 2 }),
          ],
        }), { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;

    const p = new AtmoFranceProvider('user', 'pass');
    const r = await p.fetchHealth('75056');
    expect(r).not.toBeNull();
    expect(r!.commune).toBe('Paris');
    expect(r!.air?.indice).toBe(3);
    expect(r!.air?.qualificatif).toBe('dégradé');
    expect(r!.air?.sous_indices.no2).toBe(2);
    expect(r!.air?.previsionJ1?.indice).toBe(2);
    expect(r!.pollen?.indice_global).toBe(4);
    expect(r!.pollen?.especes.bouleau).toBe(4);
    expect(r!.pollen?.previsionJ1?.indice).toBe(3);
    expect(r!.pollen?.previsionJ2?.indice).toBe(2);
    // 1 login + 2 data calls
    expect(calls.filter(u => u.includes('/api/login'))).toHaveLength(1);
    expect(calls.filter(u => u.includes('/api/data/'))).toHaveLength(2);
  });

  it('returns null when both ATMO and pollen are empty', async () => {
    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/login')) {
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      }
      return new Response(JSON.stringify({ features: [] }), { status: 200 });
    }) as typeof fetch;

    const p = new AtmoFranceProvider('user', 'pass');
    const r = await p.fetchHealth('99999');
    expect(r).toBeNull();
  });

  it('returns partial payload when only one dataset has data', async () => {
    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/login')) {
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      }
      if (url.includes('/api/data/112/')) {
        return new Response(JSON.stringify({
          features: [makeFeature({ date_ech: todayIso(0), code_qual: 2, lib_zone: 'X' })],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ features: [] }), { status: 200 });
    }) as typeof fetch;

    const p = new AtmoFranceProvider('user', 'pass');
    const r = await p.fetchHealth('75056');
    expect(r).not.toBeNull();
    expect(r!.air).not.toBeNull();
    expect(r!.pollen).toBeNull();
  });

  it('throws on auth failure', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'bad creds' }), { status: 401 }),
    ) as typeof fetch;

    const p = new AtmoFranceProvider('user', 'pass');
    await expect(p.fetchHealth('75056')).rejects.toThrow(/atmo_login_failed/);
  });
});
