/**
 * Générateur des fixtures de parité TS de la phase 1, lot 1 (plan `2026-11-04-optimisation-python-architecture.md`
 * § 11-12) : 1.1 `clampPressure` / `pressureCurve` (`components/campaign/wizard/steps/types.ts`) et 1.2
 * `impressionsPrevues` / `previsions` / `totauxPrevus` / `repartitionParCp`
 * (`angular/src/app/features/carte/logique/plan/impressions.ts`).
 *
 * Le TS actuel est la référence : chaque appel est écrit `{ fonction, args, sortie }` en JSON gzip dans
 * `fixtures/ts-phase1.json.gz`. Aucune lecture de base : les multiplicateurs de la démo sont relus dans
 * `fixtures/demo-elections.json.gz` (produit par `generer_fixtures_sql.py`, à lancer AVANT). Lancement, depuis la
 * racine du dépôt :
 *
 *   npx vitest run --config services/optimisation/tests/parite/vitest.phase1.config.ts
 *
 * Encodage des nombres non JSON : `{"$nombre": "NaN" | "Infinity" | "-Infinity" | "-0"}`, `undefined` →
 * `{"$undefined": true}` (même encodage que `generer-fixtures.ts`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { clampPressure, pressureCurve } from '@/components/campaign/wizard/steps/types';
import {
  impressionsPrevues,
  previsions,
  repartitionParCp,
  totauxPrevus,
  type CpExtraction,
} from '@/angular/src/app/features/carte/logique/plan/impressions';

const DOSSIER = resolve(__dirname, 'fixtures');

function encoder(v: unknown): unknown {
  if (v === undefined) return { $undefined: true };
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return { $nombre: 'NaN' };
    if (v === Infinity) return { $nombre: 'Infinity' };
    if (v === -Infinity) return { $nombre: '-Infinity' };
    if (Object.is(v, -0)) return { $nombre: '-0' };
    return v;
  }
  if (Array.isArray(v)) return v.map(encoder);
  if (typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) o[k] = encoder(x);
    return o;
  }
  throw new Error(`valeur non encodable (${typeof v})`);
}

interface Cas { fonction: string; args: unknown[]; sortie: unknown }
const cas: Cas[] = [];
function noter(fonction: string, args: unknown[], sortie: unknown): void {
  cas.push({ fonction, args: encoder(args) as unknown[], sortie: encoder(sortie) });
}

const PRESSIONS = [
  NaN, Infinity, -Infinity, 0, -1, 0.5, 1, 1.004, 1.005, 1.0049999999999999, 1.015, 1.05, 1.255, 1.3, 1.5, 1.6,
  1.625, 1.65, 2, 2.345, 2.35, 2.5, 2.999, 3, 3.004, 3.005, 4, 10, 1.234567,
];
const PLANCHERS: Array<number | undefined> = [undefined, 1, 0.8, 0, 2];
const DOMAINES: Array<{ min: number; max: number } | undefined> = [
  undefined, { min: 10, max: 60 }, { min: 0, max: 100 }, { min: 12.15, max: 88.57 }, { min: -5, max: 5 },
  { min: 0.1, max: 0.3 }, { min: 3, max: 3 }, { min: 60, max: 10 },
];

describe('fixtures phase 1 — pression (1.1)', () => {
  it('clampPressure et pressureCurve', () => {
    for (const m of PRESSIONS) noter('clampPressure', [m], clampPressure(m));
    for (const m of PRESSIONS) {
      for (const f of PLANCHERS) for (const d of DOMAINES) noter('pressureCurve', [m, f, d], pressureCurve(m, f, d));
    }
    // La courbe de la démo, telle qu'écrite en base.
    expect(pressureCurve(1.6, undefined, { min: 10, max: 60 })).toEqual([
      { x: 20, y: 0.63 }, { x: 30, y: 1 }, { x: 45, y: 1.6 },
    ]);
  });
});

describe('fixtures phase 1 — impressions (1.2)', () => {
  it('impressionsPrevues, previsions, totauxPrevus', () => {
    const budgets = [null, 0, 65000, 1234.56, 100, 0.01, 1e9, NaN, Infinity, -500, 33333.33];
    const cpms = [null, 0, -1, 6.5, 3, 7.77, 0.333, 6.4999, NaN];
    for (const b of budgets) for (const c of cpms) noter('impressionsPrevues', [b, c], impressionsPrevues(b, c));
    const jeux: Array<[string[], Record<string, number>, Record<string, number>]> = [
      [['dv360'], { dv360: 65000 }, { dv360: 6.5 }],
      [['dv360', 'ttd', 'meta'], { dv360: 30000, ttd: 25000.5, meta: 9999.99 }, { dv360: 6.5, ttd: 4.2, meta: 0 }],
      [['dv360', 'ttd'], { dv360: 0 }, { ttd: 3 }],
      [['a', 'b', 'c'], { a: 0.1, b: 0.2, c: 0.3 }, { a: 3, b: 7, c: 11 }],
      [[], {}, {}],
      [['x'], { x: -10 }, { x: 5 }],
      [['x', 'y'], { x: 1e9, y: 1 }, { x: 0.001, y: 1e-9 }],
    ];
    for (const [codes, budgets2, cpms2] of jeux) {
      const lignes = previsions(codes, budgets2, cpms2);
      noter('previsions', [codes, budgets2, cpms2], lignes);
      noter('totauxPrevus', [lignes], totauxPrevus(lignes));
    }
  });

  it('repartitionParCp (dont la démo : 10 000 000 sur les 11 435 multiplicateurs)', () => {
    const cp = (code_postal: string, multiplicateur: number): CpExtraction => ({ code_postal, multiplicateur });
    const grilles: Array<[number | null, CpExtraction[]]> = [
      [null, [cp('75001', 1)]],
      [0, [cp('75001', 1)]],
      [10, []],
      [10, [cp('75001', 0), cp('75002', -1)]],
      [7, [cp('75003', 1), cp('75001', 1), cp('75002', 1)]],
      [10, [cp('75003', 1), cp('75001', 1), cp('75002', 1)]],
      [100, [cp('13001', 1.214), cp('75011', 0.848), cp('29200', 1.012), cp('2A004', 1.6), cp('20000', 0.63)]],
      [1000003, [cp('a', 0.1), cp('b', 0.2), cp('c', 0.3), cp('d', NaN), cp('e', Infinity)]],
      [10.5, [cp('75001', 1), cp('75002', 2)]],
      [-5, [cp('75001', 1)]],
      [12345, [cp('69001', 1 / 3), cp('69002', 2 / 3), cp('69003', 1 / 7), cp('69004', 0.001)]],
    ];
    const demo = JSON.parse(gunzipSync(readFileSync(join(DOSSIER, 'demo-elections.json.gz'))).toString('utf-8')) as {
      entrees: { bidding_zone_configs: Array<[string, string, string, string | null, boolean]> };
    };
    // Les multiplicateurs comme les lit supabase-js : `numeric` → nombre JS.
    const cpsDemo = demo.entrees.bidding_zone_configs.map(([code, , m]) => cp(code, Number(m)));
    expect(cpsDemo.length).toBe(11_435);
    grilles.push([impressionsPrevues(65000, 6.5), cpsDemo]);
    for (const [n, cps] of grilles) noter('repartitionParCp', [n, cps], repartitionParCp(n, cps));
    expect(impressionsPrevues(65000, 6.5)).toBe(10_000_000);
  });
});

describe('fixtures phase 1 — écriture', () => {
  it('écrit ts-phase1.json.gz', () => {
    const brut = Buffer.from(JSON.stringify({
      format: 1, genere_par: 'services/optimisation/tests/parite/generer-fixtures-phase1.ts', cas,
    }), 'utf-8');
    writeFileSync(join(DOSSIER, 'ts-phase1.json.gz'), gzipSync(brut, { level: 9 }));
    expect(cas.length).toBeGreaterThan(1000);
  });
});
