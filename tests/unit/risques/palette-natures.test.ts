/**
 * La palette qualitative des natures, et le regroupement de la queue.
 *
 * Le critère du lot est arithmétique — « la somme des segments = le volume
 * total » — et c'est exactement ce qu'un regroupement peut casser : garder les
 * sept premières natures sans compter les autres afficherait une barre plus
 * courte que le total, sans que rien ne le dise.
 */
import { describe, it, expect } from 'vitest';
import {
  partsDeNature, teinteNature, TEINTES_NATURE, NATURES_DISTINGUABLES,
  LIBELLE_AUTRES_NATURES,
} from '@/lib/risques/palette-natures';

/** Les natures réellement mesurées le 2026-09-21, France entière, Seveso. */
const MESURE: Record<string, number> = {
  'Toxicité aiguë': 502,
  'GPL et produits pétroliers': 485,
  'Explosibles': 79,
  'Gaz et liquides inflammables': 50,
  'Inflammables (ancienne nomenclature)': 46,
  'Déchets': 45,
  'Dangereux pour le milieu aquatique': 25,
  'Nature non précisée': 12,
  'Chimie (IED)': 4,
  'Combustion et refroidissement': 4,
  'Déchets (IED)': 3,
  'Entrepôts et stockages': 2,
  'Fluides frigorigènes': 1,
  'Agroalimentaire et divers': 1,
};

describe('partsDeNature', () => {
  it('la somme des segments EGALE le total, regroupement compris', () => {
    // Le critère d'acceptation du lot, sur les chiffres réels : 1 259 sites.
    const parts = partsDeNature(MESURE);
    const total = Object.values(MESURE).reduce((t, n) => t + n, 0);
    expect(total).toBe(1259);
    expect(parts.reduce((t, p) => t + p.n, 0)).toBe(total);
  });

  it('ordonne par effectif decroissant, jamais par libelle', () => {
    // La nature dominante est la première chose à voir. L'alphabet ferait
    // remonter « Agroalimentaire et divers » en tête.
    const parts = partsDeNature(MESURE);
    expect(parts[0].libelle).toBe('Toxicité aiguë');
    expect(parts[1].libelle).toBe('GPL et produits pétroliers');
  });

  it('regroupe la queue sous un seul libelle', () => {
    const parts = partsDeNature(MESURE);
    expect(parts).toHaveLength(NATURES_DISTINGUABLES + 1);
    const derniere = parts[parts.length - 1];
    expect(derniere.libelle).toBe(LIBELLE_AUTRES_NATURES);
    expect(derniere.regroupee).toBe(true);
    // 12 + 4 + 4 + 3 + 2 + 1 + 1
    expect(derniere.n).toBe(27);
  });

  it('n ajoute aucun regroupement quand tout tient dans la palette', () => {
    // Une ligne « Autres natures : 0 » s'afficherait dans la légende sans
    // segment visible, et on chercherait où elle est sur la barre.
    const parts = partsDeNature({ A: 3, B: 2 });
    expect(parts.map((p) => p.libelle)).toEqual(['A', 'B']);
  });

  it('ignore les natures a zero', () => {
    const parts = partsDeNature({ A: 3, B: 0 });
    expect(parts).toHaveLength(1);
  });

  it('rend une liste vide sans aucun site', () => {
    // Zéro site est un résultat légitime (des filtres qui n'en gardent aucun),
    // et diviser par ce total produirait des `NaN` dans les largeurs CSS.
    expect(partsDeNature({})).toEqual([]);
    expect(partsDeNature({ A: 0 })).toEqual([]);
  });

  it('les parts en pourcentage totalisent environ 100', () => {
    const parts = partsDeNature(MESURE);
    const somme = parts.reduce((t, p) => t + p.pct, 0);
    // Chaque part est arrondie à une décimale : la somme peut s'écarter de
    // quelques dixièmes. C'est la LARGEUR des segments qui doit être exacte,
    // et elle se calcule sur les effectifs, pas sur ces pourcentages.
    expect(somme).toBeGreaterThan(99.5);
    expect(somme).toBeLessThan(100.5);
  });

  it('donne une teinte distincte a chaque nature gardee', () => {
    const parts = partsDeNature(MESURE);
    const teintes = new Set(parts.map((p) => p.teinte));
    // Deux natures de la même couleur est pire que pas de couleur du tout.
    expect(teintes.size).toBe(parts.length);
  });
});

describe('teinteNature', () => {
  it('rend un jeton CSS et jamais un hex', () => {
    // `DESIGN_SYSTEM.md` : toujours `var(--token)`. Ces teintes ont déjà été
    // écrites en dur une fois (constat R-05), sans variante de thème clair.
    for (let i = 0; i < 12; i++) expect(teinteNature(i)).toMatch(/^var\(--nature-\d\)$/);
  });

  it('plafonne a la derniere teinte au-dela de la palette', () => {
    expect(teinteNature(99)).toBe(TEINTES_NATURE[TEINTES_NATURE.length - 1]);
  });
});
