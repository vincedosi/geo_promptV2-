import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HealthIndicator, HealthProvider } from '@/lib/civic-health/types';

/**
 * `getHealthEnMasse` — la carte départementale faisait jusqu'à 3 lectures ou
 * écritures PAR commune (104 communes → jusqu'à 312 requêtes vers Nano).
 * Ces tests comptent les requêtes : c'est la propriété qui compte.
 */

interface Appel { table: string; op: 'select' | 'upsert'; codes?: string[]; lignes?: number }
const appels: Appel[] = [];
/** Contenu simulé de civic_health_cache : code → {payload, fetched_at}. */
const base = new Map<string, { payload: HealthIndicator; fetched_at: string }>();

function faux(table: string) {
  let codesIn: string[] = [];
  let cutoff = '';
  const chaine = {
    select: () => chaine,
    in: (_col: string, codes: string[]) => { codesIn = codes; return chaine; },
    gte: (_col: string, v: string) => { cutoff = v; return chaine; },
    returns: () => chaine,
    then: (resolve: (v: unknown) => void) => {
      appels.push({ table, op: 'select', codes: codesIn });
      const data = codesIn
        .filter((c) => base.has(c) && base.get(c)!.fetched_at >= cutoff)
        .map((c) => ({ code_insee: c, payload: base.get(c)!.payload, fetched_at: base.get(c)!.fetched_at, provider: 'mock' }));
      resolve({ data, error: null });
    },
    upsert: async (lignes: { code_insee: string; payload: HealthIndicator; fetched_at: string }[]) => {
      appels.push({ table, op: 'upsert', lignes: lignes.length });
      for (const l of lignes) base.set(l.code_insee, { payload: l.payload, fetched_at: l.fetched_at });
      return { error: null };
    },
  };
  return chaine;
}

vi.mock('@/lib/auth', () => ({ createAdminClient: () => ({ from: (t: string) => faux(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }));

const { getHealthEnMasse } = await import('@/lib/civic-health/get-health');

function payload(code: string, stale = false): HealthIndicator {
  return { code_insee: code, commune: `C${code}`, air: null, pollen: null, fetchedAt: '2026-09-13T00:00:00Z', source: 'Atmo France et AASQA', stale };
}
const ilYA = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

function provider(comportement: (code: string) => HealthIndicator | null | Error): HealthProvider & { appels: string[] } {
  const p = {
    name: 'mock' as const,
    appels: [] as string[],
    async fetchHealth(code: string) {
      p.appels.push(code);
      const r = comportement(code);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return p;
}

beforeEach(() => { appels.length = 0; base.clear(); });

describe('getHealthEnMasse', () => {
  it('cache entièrement frais : UNE lecture, zéro provider, zéro écriture', async () => {
    const codes = Array.from({ length: 104 }, (_, i) => String(10000 + i));
    for (const c of codes) base.set(c, { payload: payload(c), fetched_at: ilYA(2) });
    const p = provider(() => new Error('ne doit pas être appelé'));

    const vus: string[] = [];
    const r = await getHealthEnMasse(codes, { provider: p, surResultat: (c) => vus.push(c) });

    expect(appels).toEqual([{ table: 'civic_health_cache', op: 'select', codes }]);
    expect(p.appels).toHaveLength(0);
    expect(r.size).toBe(104);
    expect(vus).toHaveLength(104);
    expect(r.get('10000')?.stale).toBe(false);
  });

  it('cache froid : 1 lecture + provider sur chaque code + écritures par lots de 50', async () => {
    const codes = Array.from({ length: 104 }, (_, i) => String(20000 + i));
    const p = provider((c) => payload(c));

    const r = await getHealthEnMasse(codes, { provider: p, concurrence: 3 });

    expect(p.appels.sort()).toEqual([...codes].sort());
    const ecritures = appels.filter((a) => a.op === 'upsert');
    expect(ecritures.map((a) => a.lignes)).toEqual([50, 50, 4]);
    expect(appels.filter((a) => a.op === 'select')).toHaveLength(1);
    expect(r.size).toBe(104);
  });

  it("n'interroge le provider QUE pour les manquants", async () => {
    base.set('A', { payload: payload('A'), fetched_at: ilYA(1) });
    const p = provider((c) => payload(c));
    await getHealthEnMasse(['A', 'B', 'C'], { provider: p });
    expect(p.appels.sort()).toEqual(['B', 'C']);
  });

  it('provider en échec : repli groupé sur le cache périmé (< 48 h), marqué stale ; null sinon', async () => {
    base.set('P', { payload: payload('P'), fetched_at: ilYA(30) }); // périmé mais < 48 h
    base.set('V', { payload: payload('V'), fetched_at: ilYA(60) }); // trop vieux
    const p = provider(() => new Error('atmo indisponible'));

    const r = await getHealthEnMasse(['P', 'V', 'X'], { provider: p });

    expect(r.get('P')?.stale).toBe(true);
    expect(r.get('V')).toBeNull();
    expect(r.get('X')).toBeNull();
    // 1 lecture fraîche + 1 lecture périmée, aucune écriture
    expect(appels.filter((a) => a.op === 'select')).toHaveLength(2);
    expect(appels.filter((a) => a.op === 'upsert')).toHaveLength(0);
  });

  it('dédoublonne les codes et ne dépasse jamais la concurrence demandée', async () => {
    let enCours = 0;
    let max = 0;
    const p: HealthProvider = {
      name: 'mock',
      async fetchHealth(code) {
        enCours++; max = Math.max(max, enCours);
        await new Promise((r) => setTimeout(r, 2));
        enCours--;
        return payload(code);
      },
    };
    const codes = Array.from({ length: 20 }, (_, i) => `D${i % 10}`); // 10 uniques, chacun deux fois
    const r = await getHealthEnMasse(codes, { provider: p, concurrence: 3 });
    expect(r.size).toBe(10);
    expect(max).toBeLessThanOrEqual(3);
  });
});
