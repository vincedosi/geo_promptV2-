/**
 * Générateur des fixtures de parité des formules HISTORIQUES et du simulateur (phase 1.4-1.5, plan
 * `2026-11-04-optimisation-python-architecture.md` § 2.7, § 11 et § 12).
 *
 * Le TS actuel est la référence : `computeRebidWeights` (`lib/pacing/rebid.ts`), `recaler`
 * (`lib/simulation/recalage.ts`), `simulateDelivery` (`lib/demo/simulator.ts`) et le générateur `lib/demo/rng.ts`.
 * Écrit `fixtures/historique.json.gz` ; aucune lecture de base (l'entrée « 4 départements » est FIGÉE ci-dessous).
 * Lancement, depuis la racine du dépôt :
 *
 *   npx vitest run --config services/optimisation/tests/parite/vitest.historique.config.ts
 *
 * Fichier SÉPARÉ de `generer-fixtures.ts` (plan initial) : les deux s'exécutent indépendamment, et régénérer l'un ne
 * réécrit pas les fixtures de l'autre. L'enregistreur (`encoder`, `envelopper`) en est une copie — dette notée au
 * rapport de la phase 1, lot 2.
 *
 * Cinq sources :
 * 1. les tests unitaires `rebid.test.ts`, `simulation.test.ts` (appels à `recaler`), `simulator.test.ts`,
 *    `convergence.test.ts`, IMPORTÉS tels quels — leurs assertions tournent sur les enveloppes ;
 * 2. l'entrée « 4 départements » de la démo, figée (§ 2.7) ;
 * 3. des cas aux limites écrits à la main (zones vides, NaN, −0, doublons, x = −1 dans la saturation…) ;
 * 4. des cas flottants ALÉATOIRES (graine fixe : même fichier à chaque exécution) ;
 * 5. des vecteurs bruts : `Math.pow`, `String(nombre)`, `mulberry32`, `hashStr`, `rngFor`.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const R = vi.hoisted(() => {
  interface Appel { test: string; module: string; fonction: string; entree: { args: unknown[] }; sortie?: unknown; erreur?: string }
  const appels: Appel[] = [];
  let profondeur = 0;
  let nomTest: () => string = () => '(hors test)';

  /** Même encodage que `generer-fixtures.ts` : Map, Set, undefined, Infinity/-Infinity/NaN/-0. */
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
    if (v instanceof Map) return { $map: [...v.entries()].map(([k, x]) => [encoder(k), encoder(x)]) };
    if (v instanceof Set) return { $set: [...v.values()].map(encoder) };
    if (Array.isArray(v)) return v.map(encoder);
    if (typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) o[k] = encoder(x);
      return o;
    }
    throw new Error(`valeur non encodable (${typeof v})`);
  }

  function envelopper(module: string, mod: Record<string, unknown>): Record<string, unknown> {
    const sortie: Record<string, unknown> = {};
    for (const [nom, valeur] of Object.entries(mod)) {
      if (typeof valeur !== 'function') { sortie[nom] = valeur; continue; }
      const f = valeur as (...a: unknown[]) => unknown;
      sortie[nom] = function enveloppe(this: unknown, ...args: unknown[]): unknown {
        if (profondeur > 0) return f.apply(this, args);
        const avant = JSON.stringify(encoder(args));
        profondeur += 1;
        try {
          const r = f.apply(this, args);
          if (JSON.stringify(encoder(args)) !== avant) throw new Error(`${nom} a modifié ses arguments`);
          appels.push({ test: nomTest(), module, fonction: nom, entree: { args: JSON.parse(avant) as unknown[] }, sortie: encoder(r) });
          return r;
        } catch (e) {
          appels.push({ test: nomTest(), module, fonction: nom, entree: { args: JSON.parse(avant) as unknown[] }, erreur: e instanceof Error ? e.message : String(e) });
          throw e;
        } finally {
          profondeur -= 1;
        }
      };
    }
    return sortie;
  }

  return { appels, encoder, envelopper, poserNomTest: (f: () => string) => { nomTest = f; } };
});

vi.mock('@/lib/pacing/rebid', async (o) => R.envelopper('rebid', await o<Record<string, unknown>>()));
vi.mock('@/lib/simulation/recalage', async (o) => R.envelopper('recalage', await o<Record<string, unknown>>()));
vi.mock('@/lib/demo/simulator', async (o) => R.envelopper('simulator', await o<Record<string, unknown>>()));

R.poserNomTest(() => expect.getState().currentTestName ?? '(hors test)');

// ── Source 1 : les tests unitaires, importés tels quels ──────────────────────────────────────────────────────────────
/** Le `describe` de premier niveau → son fichier. `simulation.test.ts` n'appelle `recaler` que sous `recaler`. */
const SOURCE_DE_DESCRIBE: Record<string, string> = {
  computeRebidWeights: 'rebid.test.ts',
  recaler: 'simulation.test.ts',
  simulateDelivery: 'simulator.test.ts',
  'convergence de la boucle (enchère → cible fixe)': 'convergence.test.ts',
};
await import('@/tests/unit/pacing/rebid.test');
await import('@/tests/unit/simulation/simulation.test');
await import('@/tests/unit/demo/simulator.test');
await import('@/tests/unit/demo/convergence.test');

const { computeRebidWeights } = await import('@/lib/pacing/rebid');
const { recaler } = await import('@/lib/simulation/recalage');
const { simulateDelivery } = await import('@/lib/demo/simulator');
const { PARAMS_DEFAUT } = await import('@/lib/simulation/generateur');
const { mulberry32, hashStr, rngFor } = await import('@/lib/demo/rng');
type CpSimulation = Parameters<typeof recaler>[0][number];

// ── Source 2 : l'entrée « 4 départements », figée ────────────────────────────────────────────────────────────────────
/**
 * Lue le 04/11 sur la base locale (`campaign_cp_rollup`, campagne de démo `dccc0000-0000-4000-8000-000000000002`) :
 * par département, Σ `planned_share` des CP (une valeur par CP, identique sur ses 5 acteurs) et Σ `impressions` des
 * 5 acteurs. Restreinte aux 4 départements du document et renormalisée : c'est la reconstruction du § 2.7. Les
 * littéraux sont ceux que `psql` affiche (`numeric`) ; un nombre JS les relit comme supabase-js le ferait.
 *
 *   with cp as (select postal_code, max(dept) dept, max(planned_share) ps, sum(impressions) imp
 *               from campaign_cp_rollup where campaign_id = 'dccc0000-0000-4000-8000-000000000002' group by postal_code)
 *   select dept, sum(ps), sum(imp) from cp where dept in ('13','59','75','29') group by dept;
 */
const QUATRE_DEPARTEMENTS = [
  { dept: '13', part_plan: 0.05866616835665883140, impressions: 119160 },
  { dept: '59', part_plan: 0.03959105795804360866, impressions: 83910 },
  { dept: '75', part_plan: 0.01251020388091702158, impressions: 49770 },
  { dept: '29', part_plan: 0.01109395438496415121, impressions: 46380 },
] as const;

describe('non-régression 4 départements', () => {
  it('rebid plafonné et recalage amorti', () => {
    const totalPlan = QUATRE_DEPARTEMENTS.reduce((t, d) => t + d.part_plan, 0);
    const totalImp = QUATRE_DEPARTEMENTS.reduce((t, d) => t + d.impressions, 0);
    const items = QUATRE_DEPARTEMENTS.map((d) => ({
      zone_id: 'demo', item_id: d.dept,
      item_weight: (d.part_plan / totalPlan) * 100,
      expected_share: d.part_plan / totalPlan,
      actual_share: d.impressions / totalImp,
    }));
    const facteurs = items.map((i) => (i.expected_share / i.actual_share).toFixed(4));
    expect(facteurs).toEqual(['1.2089', '1.1585', '0.6172', '0.5873']);
    expect(items.map((i) => i.item_weight.toFixed(1))).toEqual(['48.1', '32.5', '10.3', '9.1']);
    const rebid = computeRebidWeights(items);
    expect(rebid.map((r) => r.new_weight.toFixed(1))).toEqual(['54.1', '35.0', '5.9', '5.0']);

    // Le recalage amorti sur la même entrée : un CP par département, son bassin = le département.
    const cps: CpSimulation[] = QUATRE_DEPARTEMENTS.map((d, i) => ({
      code_postal: d.dept, code_canonique: d.dept, cluster_id: d.dept, retenu: true, multiplicateur: items[i].item_weight,
      pop_en_zone: 1, pop_totale: 1, part_en_zone: 100, surface_km2: null, membre: false,
    }));
    const rc = recaler(
      cps,
      new Map(QUATRE_DEPARTEMENTS.map((d) => [d.dept, d.impressions])),
      new Map(items.map((i) => [i.item_id, i.expected_share])),
      PARAMS_DEFAUT,
    );
    expect([...rc.corrections.values()].map((c) => c.toFixed(3))).toEqual(['1.164', '1.125', '0.680', '0.653']);
  });
});

// ── Source 3 : cas aux limites ───────────────────────────────────────────────────────────────────────────────────────
const it_ = (zone_id: string, item_id: string, item_weight: number, expected_share: number, actual_share: number) =>
  ({ zone_id, item_id, item_weight, expected_share, actual_share });
const cp_ = (code: string, zone: string | null, mult: number, part: number): CpSimulation => ({
  code_postal: code, code_canonique: code, cluster_id: zone, retenu: true, multiplicateur: mult,
  pop_en_zone: 1, pop_totale: 1, part_en_zone: part, surface_km2: null, membre: false,
});

describe('limites', () => {
  it('rebid', () => {
    computeRebidWeights([]);
    computeRebidWeights([it_('z', 'a', 0, 0.5, 0.5), it_('z', 'b', 0, 0.5, 0.5)]); // somme de zone nulle
    computeRebidWeights([it_('z', 'a', -10, 0.5, 0.2), it_('z', 'b', 5, 0.5, 0.8)]); // somme négative
    computeRebidWeights([it_('z', 'a', 50, 0, 0), it_('z', 'b', 50, 0.5, -1)]);
    computeRebidWeights([it_('z1', 'a', 30, 0.3, 0.1), it_('z2', 'b', 70, 0.7, 0.9), it_('z1', 'c', 70, 0.7, 0.9)]);
    computeRebidWeights([it_('z', 'a', 50, NaN, 0.5), it_('y', 'b', 50, 0.5, NaN), it_('x', 'c', NaN, 0.5, 0.5)]);
    computeRebidWeights([it_('z', 'a', -0, 0.5, 0.5), it_('z', 'b', 1e308, 1e308, 1e-308), it_('z', 'c', 1e308, 1, 1)]);
    computeRebidWeights([it_('z', 'a', 50, Infinity, 0.5), it_('z', 'b', 50, 0.5, Infinity)]);
  });

  it('recaler', () => {
    const P = PARAMS_DEFAUT;
    recaler([], new Map(), new Map(), P);
    recaler([cp_('1', 'a', 1, 50)], new Map(), new Map([['a', 1]]), P); // rien observé
    recaler([cp_('1', 'a', 1, 50), cp_('2', 'b', 2, 10)], new Map([['a', 0], ['b', 0]]), new Map([['a', 0.5], ['b', 0.5]]), P);
    recaler(
      [cp_('1', 'a', 1, 50), cp_('1', 'b', 3, 10), cp_('2', '', 2, 20), cp_('3', null, 0, 5), cp_('4', 'c', -1, 5), cp_('5', 'a', NaN, 5)],
      new Map([['a', 10], ['b', 1], ['x', 5]]), new Map([['a', 0.2], ['b', 0.8], ['c', 0]]), P,
    );
    recaler([cp_('1', 'a', 1e-9, 50), cp_('2', 'b', 1e9, 50)], new Map([['a', 1], ['b', 1e6]]), new Map([['a', 0.99], ['b', 0.01]]), P);
    recaler([cp_('1', 'a', 1, 50)], new Map([['a', 1]]), new Map([['a', NaN]]), { ...P, amortissement: 1 });
    recaler([cp_('1', 'a', 1, 50), cp_('2', 'b', 1, 50)], new Map([['a', 3], ['b', 1]]), new Map([['a', 0.5], ['b', 0.5]]), { ...P, amortissement: 0 });
    recaler([cp_('1', 'a', 1, 20), cp_('2', 'a', 1, 19.999999999999996)], new Map([['a', 1]]), new Map([['a', 1]]), P);
  });

  it('simulateDelivery', () => {
    const it2 = (bid: number, cps: string[]) => ({ zone_id: 'z', item_id: `z:${cps[0]}`, bid_share: bid, cps });
    simulateDelivery({ items: [], audienceByCp: {}, seed: 1, period: 1, totalVolume: 100 });
    simulateDelivery({ items: [it2(0.5, ['a', 'b'])], audienceByCp: {}, seed: 1, period: 1, totalVolume: 100 }); // somme nulle
    simulateDelivery({ items: [it2(0.5, ['a', 'b']), it2(0.2, ['b', 'c'])], audienceByCp: { a: 10, b: 20, c: 30 }, seed: -7, period: 2.5, totalVolume: 1000 });
    simulateDelivery({ items: [it2(-1 / 3, ['a']), it2(0.4, ['b'])], audienceByCp: { a: 10, b: 20 }, seed: 3, period: 1e21, totalVolume: 1000, gain: 3, noise: 0 });
    simulateDelivery({ items: [it2(0.5, ['a']), it2(0.5, ['b'])], audienceByCp: { a: -10, b: 20 }, seed: 4294967297.7, period: 1e-7, totalVolume: 999, gain: 0, noise: 1 });
    simulateDelivery({ items: [it2(NaN, ['a']), it2(0.5, ['b'])], audienceByCp: { a: 10, b: 20 }, seed: 42, period: -0, totalVolume: 1000 });
    simulateDelivery({ items: [it2(0.3, ['é', '😀'])], audienceByCp: { 'é': 5, '😀': 7 }, seed: 42, period: 0.1, totalVolume: 12345 });
  });
});

// ── Source 4 : cas flottants aléatoires (graine fixe) ────────────────────────────────────────────────────────────────
describe('aléatoires', () => {
  const alea = mulberry32(20261104);
  const entier = (n: number) => Math.floor(alea() * n);
  const reel = (lo: number, hi: number) => lo + alea() * (hi - lo);

  it('rebid', () => {
    for (let c = 0; c < 1500; c++) {
      const n = 1 + entier(12);
      const zones = 1 + entier(4);
      const items = Array.from({ length: n }, (_, i) => it_(
        `z${entier(zones)}`, `i${i}`, c % 7 === 0 ? entier(101) : reel(0, 100),
        reel(0, 1), alea() < 0.05 ? 0 : reel(0, 1),
      ));
      computeRebidWeights(items);
    }
  });

  it('recaler', () => {
    for (let c = 0; c < 1500; c++) {
      const nz = 1 + entier(6);
      const zones = Array.from({ length: nz }, (_, i) => `b${i}`);
      const cps = Array.from({ length: 1 + entier(25) }, (_, i) => cp_(
        `${10000 + entier(60)}`, alea() < 0.1 ? null : zones[entier(nz)],
        alea() < 0.05 ? 0 : reel(0.001, 3), c % 5 === 0 ? entier(101) : reel(0, 100),
      ));
      const obs = new Map(zones.filter(() => alea() < 0.9).map((z) => [z, c % 3 === 0 ? entier(10000) : reel(0, 10000)]));
      const cible = new Map(zones.map((z) => [z, reel(0, 1)]));
      const P = { ...PARAMS_DEFAUT, amortissement: c % 2 === 0 ? 0.8 : reel(0, 1), seuilDilution: 20, baisseDilues: c % 4 === 0 ? 0.6 : reel(0, 1) };
      recaler(cps, obs, cible, P);
    }
  });

  it('simulateDelivery', () => {
    for (let c = 0; c < 400; c++) {
      const items = Array.from({ length: 1 + entier(6) }, (_, i) => ({
        zone_id: 'z', item_id: `z:${i}`, bid_share: reel(0, 1), cps: Array.from({ length: 1 + entier(4) }, () => `${entier(40)}`),
      }));
      const audienceByCp: Record<string, number> = {};
      for (let k = 0; k < 40; k++) if (alea() < 0.9) audienceByCp[`${k}`] = c % 2 === 0 ? entier(5000) : reel(0, 5000);
      simulateDelivery({
        items, audienceByCp, seed: entier(2 ** 32), period: 1 + entier(10), totalVolume: entier(2_000_000),
        ...(c % 3 === 0 ? { gain: reel(0, 6), noise: reel(0, 0.5) } : {}),
      });
    }
  });
});

// ── Source 5 : vecteurs bruts ────────────────────────────────────────────────────────────────────────────────────────
const vecteurs: Record<string, unknown> = {};
describe('vecteurs', () => {
  it('Math.pow, String(nombre), rng', () => {
    const alea = mulberry32(4112026);
    const pow: [number, number, number][] = [];
    const speciaux = [0, -0, 1, -1, 0.5, 2, -2, 3, -3, Infinity, -Infinity, NaN, 1e-310, 5e-324, 1e308, 1.0000001,
      0.9999999, -8, 1 / 3, 0.8, -0.5, 2 ** 31 + 1, 2 ** 64 + 5, 1e-5, 1023.9, -1074.5, 1075];
    for (const a of speciaux) for (const b of speciaux) pow.push([a, b, Math.pow(a, b)]);
    for (let i = 0; i < 30000; i++) {
      const k = i % 6;
      let x: number; let e: number;
      if (k === 0) { x = 1 / 3 + alea() * (3 - 1 / 3); e = i % 12 === 0 ? 0.8 : alea(); }
      else if (k === 1) { x = alea() * 1e6; e = (alea() - 0.5) * 40; }
      else if (k === 2) { x = Math.exp((alea() - 0.5) * 1400); e = (alea() - 0.5) * 4; }
      else if (k === 3) { x = -(alea() * 10); e = Math.round((alea() - 0.5) * 20); }
      else if (k === 4) { x = 1 + (alea() - 0.5) * 1e-7; e = (alea() - 0.5) * 1e10; }
      else { x = alea() * 3; e = (alea() - 0.5) * 800; }
      pow.push([x, e, Math.pow(x, e)]);
    }
    vecteurs.pow = pow;

    const nombres = [0, -0, 1, -1, 1.5, 0.1, 1e21, 1e20, 123456789012345680000, 1e-6, 1e-7, 1.234e-7, 5e-324, 1.7976931348623157e308,
      2 ** 53, 2 ** 53 + 2, -2.5e-10, 100, 0.000001, 1234.5678, NaN, Infinity, -Infinity, 1 / 3];
    for (let i = 0; i < 500; i++) nombres.push((alea() - 0.5) * 10 ** Math.floor((alea() - 0.5) * 60));
    vecteurs.texte_nombre = nombres.map((n) => [n, String(n)]);

    const graines = [0, 1, 2, 42, -1, -42, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 32 + 5, 1.9, -1.9, 1e20, NaN, Infinity, 20261104];
    vecteurs.mulberry32 = graines.map((g) => { const r = mulberry32(g); return [g, Array.from({ length: 8 }, () => r())]; });
    const cles = ['', 'a', '75001', '75002', 'res:13001', 'noise:1:13001', 'ctr:2A004', 'é', '😀', 'ß\u0000￿', 'x'.repeat(300)];
    for (let i = 0; i < 300; i++) cles.push(`cp:${Math.floor(alea() * 1e6)}`);
    vecteurs.hash_str = cles.map((k) => [k, hashStr(k)]);
    vecteurs.rng_for = [];
    for (const g of graines) for (const k of cles.slice(0, 40)) (vecteurs.rng_for as unknown[]).push([g, k, rngFor(g, k)]);
  });
});

// ── Écriture ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const RACINE = resolve(__dirname, '../../../..');
const DOSSIER = join(RACINE, 'services/optimisation/tests/parite/fixtures');

afterAll(() => {
  const source = (test: string): string => {
    const tete = test.split(' > ')[0];
    if (tete in SOURCE_DE_DESCRIBE) return SOURCE_DE_DESCRIBE[tete];
    if (['non-régression 4 départements', 'limites', 'aléatoires'].includes(tete)) return tete;
    throw new Error(`appel non classé : ${test}`);
  };
  const rang = new Map<string, number>();
  const cas = R.appels.map((a) => {
    const n = (rang.get(a.test) ?? 0) + 1;
    rang.set(a.test, n);
    return { id: `${a.test} #${n}`, source: source(a.test), ...a };
  });
  const comptes: Record<string, number> = {};
  for (const c of cas) comptes[`${c.source} / ${c.fonction}`] = (comptes[`${c.source} / ${c.fonction}`] ?? 0) + 1;
  const contenu = {
    format: 1,
    genere_par: 'services/optimisation/tests/parite/generer-fixtures-historique.ts',
    node: process.version,
    v8: process.versions.v8,
    encodage: 'Map → {"$map": [[k, v], …]} ; Set → {"$set": […]} ; undefined → {"$undefined": true} ; Infinity/-Infinity/NaN/-0 → {"$nombre": "…"}',
    comptes,
    cas,
    vecteurs: R.encoder(vecteurs),
  };
  mkdirSync(DOSSIER, { recursive: true });
  const gz = gzipSync(Buffer.from(JSON.stringify(contenu), 'utf-8'), { level: 9 });
  writeFileSync(join(DOSSIER, 'historique.json.gz'), gz);
  console.log(JSON.stringify({ comptes, octets: gz.length }, null, 2));
});
