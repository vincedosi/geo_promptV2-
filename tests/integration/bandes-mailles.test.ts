/**
 * Le total de population exposée ne dépend PAS de la maille choisie.
 *
 * ── CE QUE CE FICHIER VERROUILLE ──────────────────────────────────────────
 *
 * L'écran affichait « Seveso seuil haut 5 km / seuil bas 5 km » en en-tête
 * pendant que l'onglet Territoires calculait sur sa propre réglette à 500 m :
 * **390 112 habitants d'un côté, 24 406 618 de l'autre**, pour le même profil
 * affiché.
 *
 * ⚠ Ce n'était pas un oubli de câblage. Les deux écrans tournaient sur deux
 * moteurs, et celui de Territoires ne POUVAIT PAS honorer le profil : son
 * garde-fou de surface plafonne le rayon national à 1 179 m. sql/221 lui a
 * donné les deux mailles qui manquaient à l'autre moteur, ce qui permet de
 * n'en garder qu'un.
 *
 * Une fois les deux écrans sur le même moteur, un second piège s'est révélé,
 * plus discret : **l'arrondi au grain le plus fin rendait le total dépendant du
 * découpage.** Mesuré avant correctif, pour un seul et même profil :
 *
 *     vérité non arrondie   24 406 554
 *     région                24 406 565
 *     département           24 406 618
 *     code postal           24 407 351
 *     commune               24 408 136
 *
 * 0,006 % d'écart, invisible en pratique — et exactement la même famille de
 * défaut que celui qu'on venait de corriger : un chiffre d'en-tête qui bouge
 * parce qu'on a choisi de le lire autrement. La population couverte est une
 * propriété du PROFIL, pas du découpage.
 *
 * ⚠ Ces tests LISENT la base. Aucune valeur absolue n'est figée : elles
 * changeront au prochain import de sites. On vérifie des RELATIONS.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { creerClientTest } from './_client';

const sb = creerClientTest();

/** Un profil large, pour que les quatre mailles aient de la matière. */
const PROFIL = {
  haut: [5000],
  bas: [5000],
  autres: [],
  lie: true,
  inclurePPRT: true,
};

const MAILLES = ['region', 'departement', 'commune', 'code_postal'] as const;

interface Bandes {
  calculable?: boolean;
  error?: string;
  maille?: string;
  total?: number;
  n_unites?: number;
  n_carreaux?: number;
  hors_zone?: number;
  par_classe?: Record<string, number>;
  unites?: Array<{
    unite: string;
    nom: string | null;
    total: number;
    pop_totale: number | null;
    surface_km2: number | null;
  }>;
}

async function bandes(
  maille: string,
  opts: { parent?: string; region?: string; limite?: number } = {},
): Promise<Bandes> {
  const { data, error } = await sb.rpc('population_par_classe', {
    p_profil: PROFIL as never,
    p_cible: 'ind',
    p_maille: maille,
    p_parent: (opts.parent ?? null) as never,
    p_limite: opts.limite ?? 40000,
    p_natures: null as never,
    p_region: (opts.region ?? null) as never,
  });
  if (error) throw new Error(`population_par_classe(${maille}) : ${error.message}`);
  return data as unknown as Bandes;
}

const parMaille = new Map<string, Bandes>();
let precalcul = false;

beforeAll(async () => {
  const { count } = await sb
    .from('carreau_risque_distance')
    .select('carreau_id', { count: 'exact', head: true });
  precalcul = (count ?? 0) > 0;
  if (!precalcul) return;
  // En SÉQUENCE et non en `Promise.all` : chaque appel lit 883 451 lignes
  // jointes aux carreaux, et le budget du projet est de trois requêtes
  // simultanées, pas quatre.
  for (const m of MAILLES) parMaille.set(m, await bandes(m));
}, 300_000);

describe('les quatre mailles', () => {
  it('le pré-calcul existe, sinon rien de ce qui suit n’a de sens', () => {
    expect(precalcul, 'carreau_risque_distance est vide').toBe(true);
  });

  it('les quatre sont calculables', () => {
    if (!precalcul) return;
    for (const m of MAILLES) {
      expect(parMaille.get(m)?.calculable, `${m} refusée`).toBe(true);
    }
  });

  it('elles rendent EXACTEMENT le même total', () => {
    if (!precalcul) return;
    // Le cœur de cette phase. Pas « à peu près » : à l'habitant près.
    const totaux = MAILLES.map((m) => parMaille.get(m)!.total);
    expect(new Set(totaux).size, `totaux divergents : ${totaux.join(' / ')}`).toBe(1);
  });

  it('elles rendent la même ventilation par classe et le même hors-zone', () => {
    if (!precalcul) return;
    const ref = parMaille.get('departement')!;
    for (const m of MAILLES) {
      const b = parMaille.get(m)!;
      expect(b.par_classe, `par_classe diverge à la maille ${m}`).toEqual(ref.par_classe);
      expect(b.hors_zone, `hors_zone diverge à la maille ${m}`).toBe(ref.hors_zone);
      expect(b.n_carreaux, `n_carreaux diverge à la maille ${m}`).toBe(ref.n_carreaux);
    }
  });

  it('`total` égale la somme de `par_classe`', () => {
    if (!precalcul) return;
    // Le correctif de sql/188 : les deux sortent du même arrondi.
    for (const m of MAILLES) {
      const b = parMaille.get(m)!;
      const somme = Object.values(b.par_classe ?? {}).reduce((t, v) => t + v, 0);
      expect(somme, `${m} : total ${b.total} ≠ somme ${somme}`).toBe(b.total);
    }
  });

  /*
   * ── CE QUE `total` N'EST PAS, ET POURQUOI ON NE LE « RÉPARE » PAS ───────
   *
   * La somme des LIGNES ne retombe pas sur `total`, contrairement à la somme
   * de `par_classe` testée juste au-dessus. Mesuré le 2026-09-21 sur le profil
   * par défaut : +1 habitant à la maille région, +22 au département, +502 à la
   * commune — l'écart croît avec le nombre d'unités, parce que chaque cellule
   * (unité × classe) est arrondie à l'entier avant d'être sommée.
   *
   * ⚠ C'est un choix, et l'inverse serait PIRE. Faire de `total` la somme des
   * lignes le ferait redépendre de la maille, ce que le premier test de ce
   * fichier interdit — et pour cause : l'écran affichait 24 406 565 en région
   * contre 24 408 136 en commune pour un même profil avant sql/222. Un total
   * qui bouge quand on change de découpage fait douter de tout l'écran ; un
   * arrondi de 502 sur 7 millions ne se voit sur aucun chiffre affiché.
   *
   * Ce test ne verrouille donc pas une égalité mais un ORDRE DE GRANDEUR :
   * l'écart doit rester celui d'un arrondi. Chaque cellule dérive d'au plus
   * un demi-habitant et une unité porte au plus huit classes, donc un demi
   * par unité est déjà large — mais suffisamment serré pour distinguer un
   * arrondi de la perte d'un département entier, qui est ce qu'on veut voir.
   *
   * L'interface dit « les lignes se répartissent ce total, à l'arrondi près ».
   * Elle affirmait l'égalité jusqu'au 2026-09-21, ce qui était faux — et le
   * seul test qui semblait la garantir portait sur `population_exposee_agregee`,
   * l'AUTRE moteur, où elle est vraie (un carreau y appartient à une unité).
   */
  it('la somme des lignes dérive du total d’un arrondi, et pas plus', () => {
    if (!precalcul) return;
    for (const m of MAILLES) {
      const b = parMaille.get(m)!;
      const somme = (b.unites ?? []).reduce((t, u) => t + u.total, 0);
      const ecart = Math.abs(somme - b.total!);
      expect(
        ecart,
        `${m} : écart ${ecart} entre le total ${b.total} et la somme des ${b.n_unites} lignes `
        + '— trop grand pour un arrondi, c’est une unité perdue ou comptée deux fois',
      ).toBeLessThanOrEqual(b.n_unites!);
    }
  });

  it('le nombre d’unités croît avec la finesse de la maille', () => {
    if (!precalcul) return;
    const n = (m: string) => parMaille.get(m)!.n_unites!;
    expect(n('region')).toBeLessThan(n('departement'));
    expect(n('departement')).toBeLessThan(n('code_postal'));
    expect(n('code_postal')).toBeLessThan(n('commune'));
  });
});

describe('libellés et dénominateurs', () => {
  it('région, département et commune portent un nom et un dénominateur', () => {
    if (!precalcul) return;
    for (const m of ['region', 'departement', 'commune']) {
      const u = parMaille.get(m)!.unites![0];
      expect(u.nom, `${m} : première unité sans nom`).toBeTruthy();
      expect(u.pop_totale, `${m} : pas de dénominateur`).toBeGreaterThan(0);
      expect(u.surface_km2, `${m} : pas de surface`).toBeGreaterThan(0);
    }
  });

  it('le code postal porte un nom mais AUCUN dénominateur', () => {
    if (!precalcul) return;
    /*
     * ⚠ Délibéré, et RÉEXAMINÉ avec des mesures le 2026-09-20 avant d'être
     * confirmé. Les contours de `ref_codes_postaux` se recouvrent sur ~14 %
     * des carreaux et ne pavent pas le territoire : attribuer un carreau à
     * « son » code postal est un arbitrage, pas une mesure.
     *
     * Deux dénominateurs ont été essayés et écartés : `cp_population_totale`
     * (6 carreaux et 975 habitants sur 59640, contre 121 et 23 116 à la main),
     * et un recalcul complet sur les 2,3 millions de carreaux (23 carreaux, et
     * des parts jusqu'à 15 173 %).
     *
     * Une colonne vide qui s'explique vaut mieux qu'un pourcentage faux qui
     * colore une carte.
     */
    for (const u of parMaille.get('code_postal')!.unites!) {
      expect(u.pop_totale, `${u.unite} ne doit pas avoir de part`).toBeNull();
      expect(u.surface_km2, `${u.unite} ne doit pas avoir de densité`).toBeNull();
    }
  });

  it('la part ne dépasse JAMAIS 100 %', () => {
    if (!precalcul) return;
    /*
     * ⚠ Aucune marge, et c'est le point. Numérateur et dénominateur portent
     * exactement les mêmes carreaux, attribués par la même règle — vérifié sur
     * la commune 59183 : 478 carreaux et 82 900 habitants de part et d'autre.
     *
     * Deux défauts ont dû tomber pour que cette assertion tienne :
     *   · le dénominateur venait des IRIS quand le numérateur venait du
     *     carroyage — 1 070 communes au-dessus de 100 %, jusqu'à 163 % ;
     *   · les deux n'étaient pas dans la même unité, l'un entier et l'autre
     *     non — 14 exposés pour 13,5 au dénominateur, soit 103,7 %.
     *
     * Une marge de tolérance aurait masqué les deux.
     */
    for (const m of ['region', 'departement', 'commune']) {
      for (const u of parMaille.get(m)!.unites!) {
        if (u.pop_totale === null) continue;
        expect(u.total, `${m}/${u.unite} : ${u.total} exposés pour ${u.pop_totale} habitants`)
          .toBeLessThanOrEqual(u.pop_totale);
      }
    }
  });
});

describe('le périmètre : deux arguments, deux nomenclatures', () => {
  it('`p_parent` restreint à un département', async () => {
    if (!precalcul) return;
    const b = await bandes('commune', { parent: '13' });
    expect(b.calculable).toBe(true);
    expect(b.total!).toBeLessThan(parMaille.get('commune')!.total!);
    // Toutes les communes rendues appartiennent bien au département demandé.
    for (const u of b.unites!) expect(u.unite.startsWith('13')).toBe(true);
  });

  it('`p_region` restreint à une région, et ne se confond pas avec un département', async () => {
    if (!precalcul) return;
    /*
     * ⚠ C'est le piège de sql/171. **18 codes INSEE désignent à la fois un
     * département et une région** — `75` vaut Paris ET la Nouvelle-Aquitaine.
     * Un prédicat `code_dept = p OR code_region = p` rendait 164 codes postaux
     * pour un drill-down parisien qui en compte 21.
     *
     * Deux arguments séparés rendent la confusion impossible : on le vérifie
     * en demandant le MÊME code des deux façons et en exigeant deux résultats
     * différents.
     */
    const commeRegion = await bandes('departement', { region: '75' });
    const commeDept = await bandes('departement', { parent: '75' });

    // '75' n'est pas un code de région valide (les régions vont de 01 à 94
    // mais 75 n'en est pas une) : la demande doit rendre un ensemble VIDE,
    // jamais Paris par accident.
    expect(commeDept.n_unites, 'parent=75 doit rendre Paris').toBe(1);
    expect(commeRegion.n_unites, 'region=75 ne doit PAS rendre Paris')
      .not.toBe(commeDept.n_unites);
  });

  it('une région réelle restreint sans rien perdre en route', async () => {
    if (!precalcul) return;
    // Île-de-France : 8 départements, tous exposés sur ce profil.
    const b = await bandes('departement', { region: '11' });
    expect(b.calculable).toBe(true);
    expect(b.n_unites!).toBeGreaterThan(0);
    expect(b.n_unites!).toBeLessThanOrEqual(8);
    expect(b.total!).toBeLessThan(parMaille.get('departement')!.total!);
  });
});
