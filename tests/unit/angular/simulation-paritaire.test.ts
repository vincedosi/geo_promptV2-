/**
 * La logique de simulation copiée dans angular/ rend la MÊME chose que
 * lib/simulation/ (gel P5, copies de la décision P6).
 *
 * Fixture : `fixtures/simulation-reponse.json`, une réponse de
 * `GET /api/zones/jeux/[id]/simulation` de 40 codes postaux et 5 bassins.
 * Elle est SYNTHÉTIQUE : produite en appelant les fonctions pures de React
 * (`diffuserPeriode`, `recaler`) sur des entrées inventées à graine fixe,
 * faute de pile locale joignable pour capturer la réponse réelle.
 */
import { describe, expect, it } from 'vitest';
import * as Rv from '@/lib/simulation/vue';
import * as Av from '../../../angular/src/app/features/risques/logique/simulation/vue';
import * as Ral from '@/lib/simulation/alignement';
import * as Aal from '../../../angular/src/app/features/risques/logique/simulation/alignement';
import * as Rc from '@/lib/campagne/alignement';
import * as Ac from '../../../angular/src/app/features/risques/logique/simulation/alignement-campagne';
import * as Re from '@/lib/simulation/entrees';
import * as Ae from '../../../angular/src/app/features/risques/logique/simulation/entrees';
import { PARAMS_DEFAUT as RP } from '@/lib/simulation/generateur';
import { PARAMS_DEFAUT as AP } from '../../../angular/src/app/features/risques/logique/simulation/parametres';
import type { ReponseSimulation } from '@/lib/simulation/payload';
import reponse from './fixtures/simulation-reponse.json';

const REP = reponse as unknown as ReponseSimulation;
const ENTREES = REP.entrees!;

describe('simulation : Angular = React', () => {
  it('la fixture est exploitable', () => {
    expect(Rv.construireVue(REP, 'tout')).not.toBeNull();
    expect(ENTREES).toHaveLength(40);
    expect(REP.zones).toHaveLength(5);
  });

  it('PARAMS_DEFAUT identiques', () => expect(AP).toEqual(RP));

  for (const p of ['v1', 'v2', 'tout'] as const) {
    it(`construireVue(${p})`, () => {
      expect(Av.construireVue(REP, p)).toEqual(Rv.construireVue(REP, p));
    });
  }

  it('construireVue(v2) sur une simulation non recalée retombe sur la v1, comme React', () => {
    const v1 = { ...REP, simulation: { ...REP.simulation!, statut: 'v1' as const } };
    expect(Av.construireVue(v1, 'v2')).toEqual(Rv.construireVue(v1, 'v2'));
    expect(Av.construireVue(v1, 'v2')?.periode).toBe('v1');
  });

  it('construireVue sans simulation, sans entrées : null des deux côtés', () => {
    expect(Av.construireVue({ simulation: null }, 'tout')).toBeNull();
    expect(Rv.construireVue({ simulation: null }, 'tout')).toBeNull();
  });

  it('courbeAlignement', () => {
    expect(Av.courbeAlignement(REP)).toEqual(Rv.courbeAlignement(REP));
    expect(Av.courbeAlignement(REP).length).toBeGreaterThan(0);
  });

  it('constats, avec le défaut et un plafond', () => {
    for (const p of ['v1', 'v2', 'tout'] as const) {
      const rv = Rv.construireVue(REP, p)!;
      const av = Av.construireVue(REP, p)!;
      expect(Av.constats(av, ENTREES)).toEqual(Rv.constats(rv, ENTREES));
      expect(Av.constats(av, ENTREES, 1)).toEqual(Rv.constats(rv, ENTREES, 1));
    }
  });

  it('etatSite', () => {
    for (const i of [null, 0, 49, 50, 80, 89.9, 90, 120]) expect(Av.etatSite(i)).toBe(Rv.etatSite(i));
  });

  it('LIBELLE_PERIODE', () => expect(Av.LIBELLE_PERIODE).toEqual(Rv.LIBELLE_PERIODE));

  it('versCpSimulation, cibleParZone, impressionsUtiles, alignementParZone', () => {
    const cr = ENTREES.map(Re.versCpSimulation);
    expect(ENTREES.map(Ae.versCpSimulation)).toEqual(cr);
    expect(Aal.cibleParZone(cr)).toEqual(Ral.cibleParZone(cr));
    for (const [imps, part] of [[1000, 0], [1000, 33.3], [1000, 100], [1000, 140], [1000, -5]]) {
      expect(Aal.impressionsUtiles(imps, part)).toBe(Ral.impressionsUtiles(imps, part));
    }
    const cible = Ral.cibleParZone(cr);
    const diffusions = [
      new Map<string, number>(),
      new Map([...cible].map(([k, v]) => [k, v * 1000])),
      new Map([...cible].map(([k, v], i) => [k, i === 0 ? 5000 : v * 10])),
    ];
    for (const d of diffusions) expect(Aal.alignementParZone(d, cible)).toEqual(Ral.alignementParZone(d, cible));
    expect(Aal.alignementParZone(diffusions[1], new Map())).toEqual(Ral.alignementParZone(diffusions[1], new Map()));
    expect(Aal.RAISON_NON_CALCULABLE).toEqual(Ral.RAISON_NON_CALCULABLE);
  });

  it('calculerAlignement (jumeau de la campagne)', () => {
    const lots: { code: string; reel: number; plan: number }[][] = [
      [],
      [{ code: 'a', reel: 0, plan: 10 }],
      [{ code: 'a', reel: 100, plan: 0 }, { code: 'b', reel: 50, plan: 0 }],
      [{ code: 'a', reel: 100, plan: 100 }, { code: 'b', reel: 100, plan: 100 }],
      [{ code: 'a', reel: 200, plan: 100 }, { code: 'b', reel: 20, plan: 100 }, { code: 'c', reel: 80, plan: 0 }],
      ENTREES.slice(0, 20).map((e, i) => ({ code: e.code_postal, reel: 500 + i * 37, plan: i % 5 === 0 ? 0 : 400 + i * 41 })),
    ];
    for (const u of lots) {
      for (const [tol, poids] of [[10, 1], [0, 1], [25, 2.5]]) {
        expect(Ac.calculerAlignement(u, tol, poids)).toEqual(Rc.calculerAlignement(u, tol, poids));
      }
    }
  });
});
