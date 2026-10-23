import { describe, it, expect } from 'vitest';
import { creerClientTest } from './_client';

/**
 * Références du moteur de couverture par rayon (lot 4, T1) — ce que `couverture_rayon_poi` (T11) devra reproduire
 * EXACTEMENT sur les sites Seveso du département 13. Mesurées le 2026-10-22 après reconstruction de
 * `couverture_rayon_risque` (`construire_couverture_rayon.mjs --tout`, 122 bandes, 608 s), recoupées par
 * `carreau_risque_distance`.
 *
 * ── LE RECOUPEMENT ────────────────────────────────────────────────────────
 *
 * Département 13, distance au plus proche Seveso (haut ou bas) ≤ 10 000 m, lue directement dans
 * `carreau_risque_distance` : 22 609 carreaux, `sum(pops[1]::numeric)` = 1 596 236. La courbe `*` rend 1 596 235 sur
 * 22 608 carreaux — un carreau d'écart, celui posé pile sur la borne (le palier est fermé d'un côté, ouvert de
 * l'autre ; même raison que l'écart de 220 sur la France, `zone-risque-caracterisation.test.ts`).
 *
 * ── CE QUE CES VALEURS NE SONT PAS ───────────────────────────────────────
 *
 * Des valeurs de caractérisation, pas des invariants (ceux-là vivent dans `couverture-rayon-invariants.test.ts`).
 * Un nouvel import ICPE ou un nouveau millésime de carreaux les déplacera légitimement : re-mesurer, RECOUPER, et le
 * dire ici. Ce qu'elles interdisent, c'est que le moteur générique de T11 en rende d'autres sur les mêmes sites.
 *
 * Le point `r` d'une courbe est la borne HAUTE du palier (décalage de 100 m, sql/201) : `r = 10 000` porte le cumul
 * des carreaux à moins de 10 km.
 */

const sb = creerClientTest();

interface Point {
  r: number;
  p: number;
  i: number;
}
interface Courbe {
  cle: string;
  total: number;
  carreaux: number;
  points: Point[];
}
interface Couverture {
  calculable: boolean;
  gravite: string;
  courbes: Courbe[];
}

/** Courbe `*` (toutes natures) du département 13, pour une gravité donnée (`null` = les deux, minimum par carreau). */
async function courbe13(gravites: string[] | null): Promise<Courbe> {
  const { data, error } = await sb.rpc('lire_couverture_rayon', {
    p_cible: 'ind',
    p_gravites: gravites,
    p_natures: null,
    p_perim_niveau: 'departement',
    p_perim_codes: ['13'],
  });
  expect(error).toBeNull();
  const c = data as unknown as Couverture;
  expect(c.calculable).toBe(true);
  const totale = c.courbes.find((x) => x.cle === '*');
  expect(totale, 'la courbe totale doit porter la clé *').toBeDefined();
  return totale!;
}

/** Cumul au palier `r`. */
function au(c: Courbe, r: number): number {
  const p = c.points.find((x) => x.r === r);
  expect(p, `palier ${r} absent`).toBeDefined();
  return p!.p;
}

/** Mesurées le 2026-10-22 — voir l'en-tête. */
const REFERENCES_13 = { total: 1596235, r1000: 44875, r5000: 748717, r10000: 1596235, carreaux: 22608 };
const REFERENCES_13_HAUT = { total: 1137681, r1000: 13202, r5000: 361670, r10000: 1137681, carreaux: 13789 };
const REFERENCES_13_BAS = { total: 1370216, r1000: 34910, r5000: 622433, r10000: 1370216, carreaux: 19327 };

describe('couverture par rayon — références du département 13 (mesurées le 2026-10-22)', () => {
  it('département 13, courbe * : paliers 1, 5 et 10 km', async () => {
    const c = await courbe13(null);
    expect(c.points.length).toBe(100);
    expect(c.total).toBe(REFERENCES_13.total);
    expect(c.carreaux).toBe(REFERENCES_13.carreaux);
    expect(au(c, 1000)).toBe(REFERENCES_13.r1000);
    expect(au(c, 5000)).toBe(REFERENCES_13.r5000);
    expect(au(c, 10000)).toBe(REFERENCES_13.r10000);
  }, 60_000);

  it('département 13, une courbe par gravité : seveso_haut et seveso_bas', async () => {
    let sommeGravites = 0;
    for (const [gravite, ref] of [
      ['seveso_haut', REFERENCES_13_HAUT],
      ['seveso_bas', REFERENCES_13_BAS],
    ] as const) {
      const c = await courbe13([gravite]);
      sommeGravites += c.total;
      expect(c.total, gravite).toBe(ref.total);
      expect(c.carreaux, gravite).toBe(ref.carreaux);
      expect(au(c, 1000), gravite).toBe(ref.r1000);
      expect(au(c, 5000), gravite).toBe(ref.r5000);
      expect(au(c, 10000), gravite).toBe(ref.r10000);
    }
    // `*` est le MINIMUM par carreau, pas la somme : un carreau proche des deux niveaux ne compte qu'une fois. Sur les
    // courbes VIVANTES : comparer les constantes ne verrouillait rien.
    expect((await courbe13(null)).total).toBeLessThan(sommeGravites);
  }, 60_000);

  it('la somme des incréments égale le dernier cumul (télescopage, sql/201)', async () => {
    for (const gravites of [null, ['seveso_haut'], ['seveso_bas']]) {
      const c = await courbe13(gravites);
      const somme = c.points.reduce((t, x) => t + x.i, 0);
      expect(somme, String(gravites)).toBe(c.points[c.points.length - 1].p);
    }
  }, 60_000);
});
