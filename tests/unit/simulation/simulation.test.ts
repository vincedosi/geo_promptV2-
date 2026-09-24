/**
 * Le générateur, le recalage et l'alignement de la simulation de campagne
 * (étape ⑤ du module risque).
 *
 * Ce que ces tests verrouillent, dans l'ordre du brief : la reproductibilité à
 * graine égale, la somme des impressions égale au volume, l'effet inventaire,
 * le recalage qui RÉDUIT l'écart, et le score « non calculable » plutôt qu'un
 * score parfait par défaut.
 */
import { describe, it, expect } from 'vitest';
import {
  PARAMS_DEFAUT, diffuserJour, diffuserPeriode, planDeLExtraction,
  repartirEntier, volumeJournalier, deriveAuJour,
} from '@/lib/simulation/generateur';
import {
  cibleParZone, alignementParZone, impressionsUtiles,
} from '@/lib/simulation/alignement';
import { recaler } from '@/lib/simulation/recalage';
import type { CpSimulation, LigneDiffusion, ParamsSimulation } from '@/lib/simulation/types';

/** Un jeu synthétique : un bassin DENSE, un bassin RURAL, et deux CP hors zone. */
function jeu(): CpSimulation[] {
  const cp = (
    code: string, zone: string | null, retenu: boolean, mult: number,
    pz: number, pt: number, surf: number, extra: Partial<CpSimulation> = {},
  ): CpSimulation => ({
    code_postal: code, code_canonique: code, cluster_id: zone, retenu,
    multiplicateur: mult, pop_en_zone: pz, pop_totale: pt,
    part_en_zone: pt > 0 ? (pz / pt) * 100 : 0, surface_km2: surf, membre: false, ...extra,
  });
  return [
    // Vallée dense : 3 CP à 8 000 hab/km².
    cp('69001', 'dense', true, 1.4, 30000, 40000, 5),
    cp('69002', 'dense', true, 1.2, 25000, 36000, 4.5),
    cp('69003', 'dense', true, 1.1, 20000, 32000, 4),
    // Bassin rural : 3 CP à 40 hab/km², entièrement exposés.
    cp('07001', 'rural', true, 1.3, 3000, 3200, 80),
    cp('07002', 'rural', true, 1.2, 2800, 3000, 75),
    cp('07003', 'rural', true, 1.0, 2500, 2800, 70),
    // Hors zone, sous le seuil : pondérés, ils reçoivent aussi la fuite.
    cp('69100', 'dense', false, 0.4, 3000, 50000, 8),
    cp('07100', 'rural', false, 0.3, 200, 4000, 90),
  ];
}

const P: ParamsSimulation = { ...PARAMS_DEFAUT, budget: 100_000 };

/** Les impressions utiles d'un ensemble de lignes, par bassin. */
function utilesParZone(cps: CpSimulation[], lignes: LigneDiffusion[]): Map<string, number> {
  const par = new Map(cps.map((c) => [c.code_postal, c]));
  const m = new Map<string, number>();
  for (const l of lignes) {
    const c = par.get(l.code_postal)!;
    if (!c.cluster_id) continue;
    m.set(c.cluster_id, (m.get(c.cluster_id) ?? 0) + impressionsUtiles(l.impressions, c.part_en_zone));
  }
  return m;
}

describe('repartirEntier', () => {
  it('rend exactement le total, sans perdre ni créer une unité', () => {
    const r = repartirEntier(1001, [1, 1, 1]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(1001);
    expect(Math.max(...r) - Math.min(...r)).toBeLessThanOrEqual(1);
  });
  it('rend des zéros sans poids', () => {
    expect(repartirEntier(10, [0, 0])).toEqual([0, 0]);
  });
});

describe('diffuserJour', () => {
  it('est reproductible à graine égale', () => {
    const cps = jeu();
    const a = diffuserJour(cps, planDeLExtraction(cps), P, 3);
    const b = diffuserJour(cps, planDeLExtraction(cps), P, 3);
    expect(a).toEqual(b);
  });

  it('change avec la graine', () => {
    const cps = jeu();
    const a = diffuserJour(cps, planDeLExtraction(cps), P, 3);
    const b = diffuserJour(cps, planDeLExtraction(cps), { ...P, graine: 1 }, 3);
    expect(a).not.toEqual(b);
  });

  it('diffuse exactement le volume du jour', () => {
    const cps = jeu();
    const l = diffuserJour(cps, planDeLExtraction(cps), P, 1);
    expect(l.reduce((t, x) => t + x.impressions, 0)).toBe(volumeJournalier(P));
  });

  it('rend des impressions entières et une ligne par (code postal, partenaire)', () => {
    const cps = jeu();
    const l = diffuserJour(cps, planDeLExtraction(cps), P, 1);
    expect(l.every((x) => Number.isInteger(x.impressions) && x.impressions > 0)).toBe(true);
    const cles = l.map((x) => `${x.code_postal}|${x.partenaire}`);
    expect(new Set(cles).size).toBe(cles.length);
  });

  it('générer les jours après coup rend les mêmes lignes qu’une génération d’une traite', () => {
    const cps = jeu();
    const plan = planDeLExtraction(cps);
    const traite = diffuserPeriode(cps, plan, P, 1, 6).filter((l) => l.jour >= 4);
    const apres = diffuserPeriode(cps, plan, P, 4, 6);
    expect(apres).toEqual(traite);
  });

  it('concentre la diffusion sur le dense quand l’effet inventaire monte', () => {
    const cps = jeu();
    const plan = planDeLExtraction(cps);
    const part = (p: ParamsSimulation) => {
      const u = utilesParZone(cps, diffuserPeriode(cps, plan, p, 1, 7));
      return (u.get('dense') ?? 0) / ((u.get('dense') ?? 0) + (u.get('rural') ?? 0));
    };
    expect(part({ ...P, intensite: 1.8 })).toBeGreaterThan(part({ ...P, intensite: 1 }));
  });

  it('fait partir une part du volume hors zone', () => {
    const cps = jeu();
    const l = diffuserJour(cps, planDeLExtraction(cps), { ...P, fuite: 0.1 }, 1);
    const hors = l.filter((x) => x.code_postal === '69100' || x.code_postal === '07100')
      .reduce((t, x) => t + x.impressions, 0);
    expect(hors).toBeGreaterThan(0);
  });
});

describe('deriveAuJour', () => {
  it('ne dépend que de la graine et du jour', () => {
    expect(deriveAuJour(['b', 'a'], P, 5)).toEqual(deriveAuJour(['a', 'b'], P, 5));
  });
});

describe('cibleParZone', () => {
  it('rend la part de population EXPOSÉE de chaque bassin, sans les membres', () => {
    const cps = [...jeu(), {
      ...jeu()[0], code_postal: '69009', membre: true,
    }];
    const c = cibleParZone(cps);
    const dense = 30000 + 25000 + 20000 + 3000;
    const rural = 3000 + 2800 + 2500 + 200;
    expect(c.get('dense')).toBeCloseTo(dense / (dense + rural), 10);
    expect([...c.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
});

describe('alignementParZone', () => {
  it('vaut 100 quand la diffusion utile suit exactement la cible', () => {
    const cible = new Map([['a', 0.6], ['b', 0.4]]);
    const r = alignementParZone(new Map([['a', 600], ['b', 400]]), cible);
    expect(r.calculable && r.score).toBe(100);
  });

  it('pénalise un écart', () => {
    const cible = new Map([['a', 0.6], ['b', 0.4]]);
    const r = alignementParZone(new Map([['a', 900], ['b', 100]]), cible);
    expect(r.calculable).toBe(true);
    if (r.calculable) expect(r.score).toBeLessThan(60);
  });

  it('n’est PAS calculable sans diffusion — jamais un 100 par défaut', () => {
    const r = alignementParZone(new Map(), new Map([['a', 1]]));
    expect(r).toMatchObject({ calculable: false, raison: 'aucune_diffusion' });
  });

  it('n’est PAS calculable sans plan', () => {
    const r = alignementParZone(new Map([['a', 10]]), new Map());
    expect(r).toMatchObject({ calculable: false, raison: 'plan_vide' });
  });

  it('rend un indice nul pour une zone planifiée qui ne reçoit rien', () => {
    const r = alignementParZone(new Map([['a', 10]]), new Map([['a', 0.5], ['b', 0.5]]));
    expect(r.zones.find((z) => z.cluster_id === 'b')?.indice).toBe(0);
  });
});

describe('recaler', () => {
  it('réduit l’écart au plan : la v2 est mieux alignée que la v1', () => {
    const cps = jeu();
    const Pi = { ...P, intensite: 1.8 };
    const cible = cibleParZone(cps);
    const v1 = planDeLExtraction(cps);
    const obs = utilesParZone(cps, diffuserPeriode(cps, v1, Pi, 1, 14));
    const rc = recaler(cps, obs, cible, Pi);
    const s1 = alignementParZone(obs, cible);
    const s2 = alignementParZone(utilesParZone(cps, diffuserPeriode(cps, rc.multiplicateurs, Pi, 15, 28)), cible);
    expect(s1.calculable && s2.calculable).toBe(true);
    if (s1.calculable && s2.calculable) expect(s2.score).toBeGreaterThan(s1.score);
  });

  it('relève la zone sous-servie et baisse la zone sur-servie', () => {
    const cps = jeu();
    const cible = new Map([['dense', 0.5], ['rural', 0.5]]);
    const rc = recaler(cps, new Map([['dense', 900], ['rural', 100]]), cible, P);
    expect(rc.corrections.get('rural')!).toBeGreaterThan(1);
    expect(rc.corrections.get('dense')!).toBeLessThan(1);
  });

  it('baisse les codes postaux très dilués', () => {
    const cps = jeu();
    const rc = recaler(cps, new Map([['dense', 1], ['rural', 1]]), cibleParZone(cps), P);
    expect(rc.dilues).toContain('69100');
    expect(rc.dilues).not.toContain('69001');
  });

  it('recentre les multiplicateurs sur 1', () => {
    const cps = jeu();
    const rc = recaler(cps, new Map([['dense', 900], ['rural', 100]]), cibleParZone(cps), P);
    const v = [...rc.multiplicateurs.values()];
    expect(v.reduce((a, b) => a + b, 0) / v.length).toBeCloseTo(1, 2);
  });
});
