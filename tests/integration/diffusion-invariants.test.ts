/**
 * Les invariants de la ventilation diffusion × classes de risque (sql/207).
 *
 * ── POURQUOI DES INVARIANTS ET PAS DES VALEURS ATTENDUES ─────────────────
 *
 * Le jeu de démonstration est reproductible (`md5(code_postal || jour)`, jamais
 * `random()`), donc on POURRAIT figer des nombres. On ne le fait pas : un test
 * qui compare à 14 103 699 se casse au premier import de sites et ne dit pas
 * pourquoi. Un test d'invariant survit au changement de données et continue de
 * garder la propriété qui compte.
 *
 * ── CE QUE CES PROPRIÉTÉS PROTÈGENT ──────────────────────────────────────
 *
 * Toute la refonte tient sur « un carreau, une classe ». Si cette règle cède
 * quelque part — dans le prorata au code postal, dans la somme sur les acteurs,
 * dans le choix du dénominateur — les chiffres redeviennent plausibles ET faux,
 * ce qui est le pire des deux mondes. C'est exactement l'état d'avant : l'écran
 * annonçait 537 919 habitants de trop sans qu'aucun nombre pris isolément ne
 * soit erroné.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { creerClientTest } from './_client';
import { PROFIL_DEFAUT, normaliserProfil } from '@/lib/risques/profil';

const sb = creerClientTest();

/** La campagne du jeu de démonstration (sql/208), à UUID fixe. */
const CAMPAGNE = 'd0000000-0000-4000-8000-00000000f1a5';

interface ClasseDiffusion {
  classe: string;
  population: number;
  impressions: number;
  depense: number;
  indice: number | null;
}

interface Diffusion {
  calculable: boolean;
  error?: string;
  est_demo: boolean;
  impressions_totales: number;
  impressions_en_zone: number;
  population_touchee: number;
  classes: ClasseDiffusion[];
}

async function diffusion(profil = PROFIL_DEFAUT): Promise<Diffusion> {
  const { data, error } = await sb.rpc('diffusion_par_classe', {
    p_campagne: CAMPAGNE,
    p_profil: profil as never,
    p_cible: 'ind',
    p_maille: 'departement',
    p_parent: null,
    p_limite: 200,
  });
  if (error) throw new Error(`diffusion_par_classe : ${error.message}`);
  return data as unknown as Diffusion;
}

describe('ventilation de la diffusion par classe de risque', () => {
  let d: Diffusion;

  beforeAll(async () => {
    const { count } = await sb
      .from('dsp_campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('id', CAMPAGNE);
    if (!count) {
      throw new Error(
        'Le jeu de démonstration est absent. '
        + 'npx tsx scripts/seed-demo-campagne-risque.ts',
      );
    }
    d = await diffusion();
  }, 120_000);

  it('la campagne de demonstration porte le drapeau is_demo', () => {
    // Le badge de l'écran en dépend. Un jeu de démonstration qui ne se déclare
    // pas finit par être lu comme une campagne réelle.
    expect(d.est_demo).toBe(true);
  });

  it('la somme des impressions ventilees egale les impressions en zone', () => {
    // La propriété qui fonde tout : les classes ne se recouvrent pas, donc
    // leurs impressions s'additionnent. La tolérance d'une unité absorbe
    // l'arrondi de chaque classe.
    const somme = d.classes
      .filter((c) => c.classe !== 'hors')
      .reduce((t, c) => t + c.impressions, 0);
    expect(Math.abs(somme - d.impressions_en_zone)).toBeLessThanOrEqual(
      d.classes.filter((c) => c.classe !== 'hors').length,
    );
  });

  it('les impressions en zone ne depassent jamais les impressions totales', () => {
    // Un dépassement signalerait un double comptage — typiquement l'oubli de
    // sommer sur les acteurs, la PK de campaign_cp_rollup démultipliant chaque
    // code postal jusqu'à cinq fois.
    expect(d.impressions_en_zone).toBeLessThanOrEqual(d.impressions_totales);
  });

  it('aucune classe ne porte plus de population que le total touche', () => {
    for (const c of d.classes) {
      expect(c.population).toBeLessThanOrEqual(d.population_touchee);
    }
  });

  it('un indice de pression est un nombre positif, ou null', () => {
    // `null` a un sens précis — « incalculable faute de population » — et ne
    // doit jamais être confondu avec zéro, qui voudrait dire « aucune
    // impression ».
    for (const c of d.classes) {
      if (c.indice !== null) {
        expect(c.indice).toBeGreaterThan(0);
        expect(Number.isFinite(c.indice)).toBe(true);
      }
    }
  });

  it('le scenario de demonstration SOUS-presse le seuil haut', () => {
    /*
     * Le jeu applique −45 % là où plus d'un quart de la population du code
     * postal est exposée au seuil haut. L'écran doit donc le montrer : un
     * indice du seuil haut inférieur à celui du hors-zone.
     *
     * Ce test garde le SCÉNARIO autant que le calcul. Un jeu uniforme donnerait
     * 100 partout — un écran qui ne montre rien, et sur lequel on ne pourrait
     * pas juger si la ventilation fonctionne.
     */
    const haut = d.classes.filter((c) => c.classe.startsWith('haut:'));
    const hors = d.classes.find((c) => c.classe === 'hors');
    expect(haut.length, 'aucune classe de seuil haut').toBeGreaterThan(0);
    expect(hors?.indice, 'le hors-zone n’a pas d’indice').not.toBeNull();

    const indiceHaut = haut
      .filter((c) => c.indice !== null)
      .reduce((t, c) => t + (c.indice as number) * c.population, 0)
      / Math.max(haut.reduce((t, c) => t + c.population, 0), 1);

    expect(
      indiceHaut,
      `Le seuil haut devrait être sous-pressé par le scénario de démonstration. `
      + `Indice pondéré ${indiceHaut.toFixed(0)} contre ${hors?.indice} hors zone.`,
    ).toBeLessThan(hors?.indice as number);
  });

  it('un profil sans anneau ne classe rien, et ne leve pas', async () => {
    // Cas dégénéré atteignable à l'écran : retirer le dernier anneau des deux
    // niveaux. Il doit rendre un résultat vide, pas une erreur.
    const vide = normaliserProfil({
      haut: [], bas: [], autres: [], lie: false, inclurePPRT: true,
    });
    const r = await diffusion(vide);
    expect(r.calculable).toBe(true);
    expect(r.impressions_en_zone).toBe(0);
    expect(r.classes.filter((c) => c.classe !== 'hors')).toHaveLength(0);
  }, 120_000);
});
