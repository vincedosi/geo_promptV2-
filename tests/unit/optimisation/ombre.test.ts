/**
 * Mode ombre (tâche 1.6) : comparaison feuille à feuille, journal d'UNE ligne JSON par appel, et une panne de Python
 * qui n'interrompt jamais le TS.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ErreurOptimisation } from '@/lib/optimisation/client';
import {
  algoAFiger, calculerSousDrapeau, comparer, DELAI_OMBRE_MS, versJson, type CalculSousDrapeau,
} from '@/lib/optimisation/ombre';
import type { Algo } from '@/lib/optimisation/schemas';

const ALGO: Algo = { moteur: 'python', version: '0.1.0', entrees_sha256: 'b'.repeat(64) };

afterEach(() => vi.restoreAllMocks());

describe('comparer', () => {
  it('identiques (ordre des clés d’objet indifférent, -0 = 0) : 0 écart', () => {
    expect(comparer({ a: 1, b: [1, { c: -0 }] }, { b: [1, { c: 0 }], a: 1 })).toEqual({ ecarts: 0, premier: null });
  });

  it('compte chaque feuille et cite la première dans l’ordre de visite', () => {
    const r = comparer({ l: [{ m: 1.214 }, { m: 0.848 }], n: 2 }, { l: [{ m: 1.2140000000000002 }, { m: 0.8 }], n: 2 });
    expect(r.ecarts).toBe(2);
    expect(r.premier).toEqual({ chemin: 'l.0.m', ts: 1.214, python: 1.2140000000000002 });
  });

  it('clé absente d’un côté, longueurs différentes, types différents', () => {
    const r = comparer({ a: 1, t: [1, 2, 3], x: null }, { t: [1, 2], x: 0, z: 'nouveau' });
    expect(r.ecarts).toBe(4); // a absent, t.length, x null≠0, z absent côté TS
    expect(r.premier).toEqual({ chemin: 'a', ts: 1, python: '(absent)' });
  });

  it('une valeur longue est tronquée dans la citation', () => {
    const grand = { lignes: Array.from({ length: 100 }, (_, i) => ({ i })) };
    const r = comparer(grand, 'autre');
    expect(String(r.premier?.ts)).toMatch(/…$/);
  });

  it('versJson : ce que le TS écrit (undefined retiré, Map vidée comme JSON.stringify)', () => {
    expect(versJson({ a: undefined, b: 1 })).toEqual({ b: 1 });
  });
});

function calcul(
  source: 'ts' | 'ombre' | 'python', python: (d: number) => Promise<{ v: number; algo: Algo }>,
): CalculSousDrapeau<{ v: number }, { v: number; algo: Algo }> & { ts: ReturnType<typeof vi.fn> } {
  return {
    appelant: 'essai',
    source,
    ts: vi.fn(() => ({ v: 1 })),
    python,
    comparableTs: (x) => x,
    comparablePython: ({ algo: _a, ...reste }) => reste,
    versTs: ({ v }) => ({ v }),
    algo: (p) => p.algo,
  };
}

describe('calculerSousDrapeau', () => {
  it('ts : le TS seul — aucun appel au service, aucun journal', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const python = vi.fn(async () => ({ v: 1, algo: ALGO }));
    const r = await calculerSousDrapeau(calcul('ts', python));
    expect(r).toEqual({ valeur: { v: 1 } });
    expect(python).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('ombre, identique : le TS rendu, une ligne JSON « 0 écart » avec l’empreinte, délai court', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const python = vi.fn(async (_d: number) => ({ v: 1, algo: ALGO }));
    const r = await calculerSousDrapeau(calcul('ombre', python));
    expect(r.valeur).toEqual({ v: 1 });
    expect(r.ombre).toEqual({ ecarts: 0, algo: ALGO, erreur: null });
    expect(python.mock.calls[0][0]).toBe(DELAI_OMBRE_MS);
    expect(DELAI_OMBRE_MS).toBe(10_000);
    expect(info).toHaveBeenCalledTimes(1);
    const ligne = JSON.parse(info.mock.calls[0][0] as string);
    expect(ligne).toMatchObject({
      evenement: 'optimisation_ombre', appelant: 'essai', ecarts: 0, premier_ecart: null, entrees_sha256: ALGO.entrees_sha256,
    });
    expect(typeof ligne.duree_python_ms).toBe('number');
  });

  it('ombre, en écart : le TS reste la valeur ; nombre d’écarts et premier écart journalisés', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const r = await calculerSousDrapeau(calcul('ombre', async () => ({ v: 2, algo: ALGO })));
    expect(r.valeur).toEqual({ v: 1 });
    expect(r.ombre?.ecarts).toBe(1);
    expect(JSON.parse(info.mock.calls[0][0] as string)).toMatchObject({
      ecarts: 1, premier_ecart: { chemin: 'v', ts: 1, python: 2 },
    });
  });

  it('ombre, Python indisponible : le TS rendu quand même, l’erreur journalisée (motif et message)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const r = await calculerSousDrapeau(calcul('ombre', async () => {
      throw new ErreurOptimisation("Le service d'optimisation est injoignable.", 'reseau');
    }));
    expect(r.valeur).toEqual({ v: 1 });
    expect(r.ombre).toEqual({ ecarts: null, algo: null, erreur: "Le service d'optimisation est injoignable." });
    expect(JSON.parse(info.mock.calls[0][0] as string)).toMatchObject({
      appelant: 'essai', ecarts: null, erreur: { motif: 'reseau' },
    });
  });

  it('ombre, défaut de la comparaison elle-même : avalé aussi', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const c = calcul('ombre', async () => ({ v: 1, algo: ALGO }));
    c.comparablePython = () => { throw new Error('bogue'); };
    const r = await calculerSousDrapeau(c);
    expect(r.valeur).toEqual({ v: 1 });
    expect(r.ombre?.erreur).toBe('bogue');
  });

  it('ombre : une erreur du TS remonte telle quelle (le comportement d’avant), Python non appelé', async () => {
    const python = vi.fn(async () => ({ v: 1, algo: ALGO }));
    const c = calcul('ombre', python);
    c.ts = vi.fn(() => { throw new Error('TS'); });
    await expect(calculerSousDrapeau(c)).rejects.toThrow('TS');
    expect(python).not.toHaveBeenCalled();
  });

  it('python : la valeur du service, délai 30 s, le TS jamais calculé ; une panne remonte (aucun repli)', async () => {
    const python = vi.fn(async (_d: number) => ({ v: 7, algo: ALGO }));
    const c = calcul('python', python);
    expect(await calculerSousDrapeau(c)).toEqual({ valeur: { v: 7 }, algo: ALGO });
    expect(python.mock.calls[0][0]).toBe(30_000);
    expect(c.ts).not.toHaveBeenCalled();
    const panne = calcul('python', async () => { throw new ErreurOptimisation('x', 'delai'); });
    await expect(calculerSousDrapeau(panne)).rejects.toBeInstanceOf(ErreurOptimisation);
  });
});

describe('algoAFiger (resume_plan.algo, sql/344)', () => {
  it('ts : rien', () => expect(algoAFiger({ valeur: 1 })).toBeUndefined());
  it('python : l’algo du service', () => expect(algoAFiger({ valeur: 1, algo: ALGO })).toEqual(ALGO));
  it('ombre : moteur ts, et ce que l’ombre a constaté', () => {
    expect(algoAFiger({ valeur: 1, ombre: { ecarts: 0, algo: ALGO, erreur: null } }))
      .toEqual({ moteur: 'ts', ombre: { ...ALGO, ecarts: 0 } });
    expect(algoAFiger({ valeur: 1, ombre: { ecarts: null, algo: null, erreur: 'injoignable' } }))
      .toEqual({ moteur: 'ts', ombre: { moteur: 'python', ecarts: null, erreur: 'injoignable' } });
  });
});
