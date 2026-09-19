/**
 * Le croisement des DEUX implémentations de la règle d'affectation.
 *
 * ── POURQUOI CE TEST EXISTE ───────────────────────────────────────────────
 *
 * La règle vit en TypeScript (`lib/risques/affectation.ts`, pour les quelques
 * dizaines de carreaux d'une infobulle) et en SQL (`classe_carreau_risque`,
 * sql/204, pour les ~914 000 carreaux d'un tableau). Faire descendre les
 * 914 000 jusqu'au navigateur pour n'avoir qu'une implémentation coûterait
 * ~50 Mo à chaque anneau déplacé.
 *
 * Deux implémentations sont donc assumées. Ce qui ne l'est pas, c'est qu'elles
 * divergent : la carte contredirait alors le tableau qu'elle illustre, et rien
 * ne le signalerait — les deux nombres seraient plausibles.
 *
 * ── CE QUI DISTINGUE CE TEST DES JUMEAUX PRÉCÉDENTS ───────────────────────
 *
 * Le projet porte déjà trois jumeaux TypeScript de RPC (`lib/analyses/score.ts`,
 * `lib/campagne/alignement.ts`, `lib/qualite/verdict.ts`). Leur en-tête signale
 * la même limite : le croisement a eu lieu **une fois, à la main**, et rien ne
 * le rejoue. Si la RPC est retouchée, les tests restent verts et le chiffre
 * affiché n'a plus d'oracle.
 *
 * Celui-ci est rejoué à chaque exécution de la suite d'intégration, et il
 * balaie les bornes — l'endroit exact où deux implémentations choisissent
 * chacune leur convention sans s'en apercevoir.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { creerClientTest } from './_client';
import {
  classerCarreau, idClasse, type DistancesCarreau,
} from '@/lib/risques/affectation';
import { normaliserProfil, type ProfilRayons } from '@/lib/risques/profil';

const sb = creerClientTest();

/** Demande au SQL la classe d'un carreau, pour le profil donné. */
async function classeSql(d: DistancesCarreau, p: ProfilRayons): Promise<string> {
  const { data, error } = await sb.rpc('classe_carreau_risque', {
    p_d_haut: d.haut,
    p_d_bas: d.bas,
    p_pprt_niveau: d.pprt,
    // La liaison est appliquée AVANT l'appel, exactement comme
    // `population_par_classe` le fait : le niveau bas hérite des anneaux du
    // haut. Passer `p.bas` brut ferait diverger les deux sur `lie: true`.
    p_haut: p.haut,
    p_bas: p.lie ? p.haut : p.bas,
    p_inclure_pprt: p.inclurePPRT,
  });
  if (error) throw new Error(`classe_carreau_risque : ${error.message}`);
  return data as string;
}

const profils: Array<[string, ProfilRayons]> = [
  ['défaut', normaliserProfil({
    haut: [1000, 2000, 5000], bas: [500, 1000], autres: [], lie: false, inclurePPRT: true,
  })],
  ['sans PPRT', normaliserProfil({
    haut: [1000, 2000, 5000], bas: [500, 1000], autres: [], lie: false, inclurePPRT: false,
  })],
  ['niveaux liés', normaliserProfil({
    haut: [1000, 2000, 5000], bas: [500], autres: [], lie: true, inclurePPRT: true,
  })],
  ['niveau bas vide', normaliserProfil({
    haut: [2000], bas: [], autres: [], lie: false, inclurePPRT: true,
  })],
  ['quatre anneaux', normaliserProfil({
    haut: [100, 1000, 5000, 9900], bas: [200, 400, 600, 800], autres: [],
    lie: false, inclurePPRT: true,
  })],
];

describe('la regle d affectation classe identiquement en TypeScript et en SQL', () => {
  beforeAll(async () => {
    const { error } = await sb.rpc('classe_carreau_risque', {
      p_d_haut: 0, p_d_bas: null, p_pprt_niveau: null,
      p_haut: [1000], p_bas: [], p_inclure_pprt: true,
    });
    if (error) throw new Error(`sql/204 absente de la base locale : ${error.message}`);
  }, 30_000);

  for (const [nom, profil] of profils) {
    it(`profil « ${nom} » : accord sur une grille de distances`, async () => {
      /**
       * Les distances balayées incluent les BORNES exactes du profil et leurs
       * voisines immédiates. C'est là que deux implémentations divergent sans
       * bruit : l'une range 1 000 m dans `[0, 1000)`, l'autre dans
       * `[1000, 2000)`, et un carreau change de bande selon qui l'interroge.
       */
      const bornes = [...profil.haut, ...profil.bas];
      const distances: Array<number | null> = [
        null, 0, 1, 99, 100, 101, 999, 1000, 1001, 4999, 5000, 5001, 9999, 10000,
        ...bornes.flatMap((b) => [b - 1, b, b + 1]),
      ];
      const pprts: Array<DistancesCarreau['pprt']> = [null, 'haut', 'bas'];

      const cas: DistancesCarreau[] = [];
      for (const haut of distances) {
        for (const bas of distances) {
          for (const pprt of pprts) cas.push({ haut, bas, autres: null, pprt });
        }
      }

      // Un seul aller-retour pour tous les cas : un par cas ferait des milliers
      // de requêtes et le test durerait des minutes pour la même information.
      const { data, error } = await sb.rpc('classer_lot_risque', {
        p_cas: cas.map((c) => ({ h: c.haut, b: c.bas, p: c.pprt })),
        p_haut: profil.haut,
        p_bas: profil.lie ? profil.haut : profil.bas,
        p_inclure_pprt: profil.inclurePPRT,
      });
      if (error) throw new Error(`classer_lot_risque : ${error.message}`);

      const enSql = data as string[];
      expect(enSql).toHaveLength(cas.length);

      const divergences: string[] = [];
      for (let i = 0; i < cas.length; i += 1) {
        const attendu = idClasse(classerCarreau(cas[i], profil));
        if (enSql[i] !== attendu) {
          const c = cas[i];
          divergences.push(
            `haut=${c.haut} bas=${c.bas} pprt=${c.pprt} → TS « ${attendu} », SQL « ${enSql[i]} »`,
          );
        }
      }

      expect(
        divergences.slice(0, 10),
        `${divergences.length} divergence(s) entre lib/risques/affectation.ts et `
        + `classe_carreau_risque (sql/204). La carte contredirait le tableau.`,
      ).toEqual([]);
    }, 60_000);
  }

  it('l appel unitaire concorde aussi — le lot ne masque pas une difference de signature', async () => {
    // Le balayage passe par `classer_lot_risque`, une enveloppe. Si elle
    // divergeait de `classe_carreau_risque`, tout le balayage validerait la
    // mauvaise fonction et l'application, qui appelle la seconde, resterait
    // fausse.
    const profil = profils[0][1];
    const cas: DistancesCarreau[] = [
      { haut: 1500, bas: 200, autres: null, pprt: null },
      { haut: 7000, bas: 300, autres: null, pprt: null },
      { haut: null, bas: null, autres: null, pprt: 'haut' },
      { haut: 8000, bas: null, autres: null, pprt: 'haut' },
    ];
    for (const c of cas) {
      expect(await classeSql(c, profil)).toBe(idClasse(classerCarreau(c, profil)));
    }
  }, 30_000);
});
