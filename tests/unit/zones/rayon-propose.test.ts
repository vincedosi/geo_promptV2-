import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ESSAIS_RAYON_PROPOSE, PAS_RAYON_PROPOSE_M, RAYON_SECURITE_MAX_M, chercherRayonPropose, type EssaiPavage,
} from '@/lib/zones/rayon-propose';

/**
 * B10 — le plus petit rayon sous le plafond de cercles d'une plateforme (`max_unites`), proposé quand le pavage au rayon
 * demandé est refusé `trop_de_cercles` : une recherche dichotomique d'au plus `ESSAIS_RAYON_PROPOSE` pavages, UN À LA
 * FOIS (contrainte I/O du projet), au pas de la réglette de ⑤. Le pavage est INJECTÉ : ces tests n'ont pas de base.
 */

/** Une zone où le nombre de cercles retenus décroît comme 1 / r² (`k` cercles à 1 km), et le journal des essais. */
function zone(k: number, refusAuDela?: { rayon_m: number; refus: string }) {
  const essais: number[] = [];
  let enVol = 0;
  let maxEnVol = 0;
  const essayer = async (rayon_m: number): Promise<EssaiPavage | null> => {
    enVol += 1;
    maxEnVol = Math.max(maxEnVol, enVol);
    essais.push(rayon_m);
    await new Promise((r) => setTimeout(r, 1));
    enVol -= 1;
    if (refusAuDela && rayon_m >= refusAuDela.rayon_m) return { n_cercles: 0, refus: refusAuDela.refus };
    const n = Math.ceil(k / (rayon_m / 1e3) ** 2);
    return n > 200 ? { n_cercles: n, refus: 'trop_de_cercles' } : { n_cercles: n };
  };
  return { essayer, essais, enVol: () => maxEnVol };
}

const LIMITES_META = { rayon_max_m: 80e3 };

describe('chercherRayonPropose — dichotomie bornée', () => {
  it('propose le plus petit rayon au pas qui passe sous le plafond, en au plus 6 pavages, un à la fois', async () => {
    // 50 000 cercles à 1 km : il faut r ≥ √(50 000 / 200) = 15,81 km → 16 km au pas de 500 m.
    const z = zone(50e3);
    const p = await chercherRayonPropose(z.essayer, { rayon_m: 5e3, n_cercles: 2e3, plafond: 200 }, LIMITES_META);
    expect(p.rayon_propose).not.toBeNull();
    expect(p.rayon_propose?.rayon_m).toBe(16e3);
    expect(p.rayon_propose?.n_cercles).toBeLessThanOrEqual(200);
    expect(p.rayon_propose?.au_pas).toBe(true);
    expect(z.essais.length).toBeLessThanOrEqual(ESSAIS_RAYON_PROPOSE);
    expect(z.enVol()).toBe(1);
    for (const r of z.essais) expect(r % PAS_RAYON_PROPOSE_M).toBe(0);
    // Le pas en dessous est bien refusé : c'est le plus petit.
    expect(Math.ceil(50e3 / ((16e3 - PAS_RAYON_PROPOSE_M) / 1e3) ** 2)).toBeGreaterThan(200);
  });

  it('aucun rayon jusqu’au maximum de la plateforme ne passe : rien de proposé, le maximum essayé est dit', async () => {
    const z = zone(5e6); // 5 millions à 1 km : 782 cercles à 80 km
    const p = await chercherRayonPropose(z.essayer, { rayon_m: 10e3, n_cercles: 5e4, plafond: 200 }, LIMITES_META);
    expect(p.rayon_propose).toBeNull();
    expect(p.sans_proposition).toMatchObject({ motif: 'aucun_sous_plafond', rayon_max_m: 80e3 });
    expect(z.essais).toContain(80e3);
    expect(z.essais.length).toBeLessThanOrEqual(ESSAIS_RAYON_PROPOSE);
  });

  it('sans rayon maximal de plateforme : la borne de sécurité de paver_cercles (sql/276)', async () => {
    const z = zone(5e8);
    const p = await chercherRayonPropose(z.essayer, { rayon_m: 10e3, n_cercles: 5e6, plafond: 200 }, {});
    expect(p.sans_proposition?.rayon_max_m).toBe(RAYON_SECURITE_MAX_M);
    expect(Math.max(...z.essais)).toBeLessThanOrEqual(RAYON_SECURITE_MAX_M);
  });

  it('déjà au maximum : aucun pavage de plus', async () => {
    const z = zone(5e6);
    const p = await chercherRayonPropose(z.essayer, { rayon_m: 80e3, n_cercles: 782, plafond: 200 }, LIMITES_META);
    expect(p.rayon_propose).toBeNull();
    expect(z.essais).toEqual([]);
  });

  it('un pavage en échec arrête la recherche ; un autre refus aussi (une borne de coût ne se lève pas en grandissant)', async () => {
    const echec = await chercherRayonPropose(async () => null, { rayon_m: 5e3, n_cercles: 2e3, plafond: 200 }, LIMITES_META);
    expect(echec).toMatchObject({ rayon_propose: null, sans_proposition: { motif: 'echec', essais: 1 } });
    const z = zone(50e3, { rayon_m: 9e3, refus: 'zone_trop_vaste' });
    const vaste = await chercherRayonPropose(z.essayer, { rayon_m: 5e3, n_cercles: 2e3, plafond: 200 }, LIMITES_META);
    expect(vaste).toMatchObject({ rayon_propose: null, sans_proposition: { motif: 'refus' } });
  });

  it('essais épuisés avant d’atteindre le pas : le meilleur trouvé, dit « non au pas »', async () => {
    // Une décroissance très lente (n ∝ 1/√r) : l'estimation en 1/r² rate, la dichotomie n'a pas le temps de finir.
    const essais: number[] = [];
    const essayer = async (r: number): Promise<EssaiPavage> => {
      essais.push(r);
      const n = Math.ceil(2_000 / Math.sqrt(r / 1e3));
      return n > 200 ? { n_cercles: n, refus: 'trop_de_cercles' } : { n_cercles: n };
    };
    const p = await chercherRayonPropose(essayer, { rayon_m: 1e3, n_cercles: 2e3, plafond: 200 }, { rayon_max_m: 200e3 });
    expect(essais.length).toBe(ESSAIS_RAYON_PROPOSE);
    if (p.rayon_propose) {
      expect(p.rayon_propose.au_pas).toBe(false);
      expect(p.rayon_propose.n_cercles).toBeLessThanOrEqual(200);
    } else {
      expect(p.sans_proposition?.motif).toBe('essais_epuises');
    }
  });

  it('un pavage qui ne retient plus aucun cercle n’est pas une proposition', async () => {
    const essayer = async (r: number): Promise<EssaiPavage> => (r > 6e3 ? { n_cercles: 0 } : { n_cercles: 400, refus: 'trop_de_cercles' });
    const p = await chercherRayonPropose(essayer, { rayon_m: 5e3, n_cercles: 400, plafond: 200 }, LIMITES_META);
    expect(p.rayon_propose).toBeNull();
    expect(p.sans_proposition?.motif).toBe('aucun_cercle');
  });
});

describe('source', () => {
  it('le pas des rayons essayés est celui de la réglette de ⑤ (parité)', () => {
    const angular = readFileSync('angular/src/app/features/carte/logique/jeu/mailles-url.ts', 'utf8').match(/export const PAS_RAYON_M = (\d+);/)?.[1];
    expect(Number(angular)).toBe(PAS_RAYON_PROPOSE_M);
  });
  it('aucun Promise.all : les pavages partent un à un', () => {
    const code = readFileSync('lib/zones/rayon-propose.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/Promise\.(all|allSettled|race|any)/);
  });
});
