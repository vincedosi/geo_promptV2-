import { describe, it, expect } from 'vitest';
import { hauteurExtrusionExpr, largeurMailleExpr } from '@/lib/carreaux/expressions';

/**
 * Le relief 3D doit se lire pareil à TOUS les zooms.
 *
 * ── Le défaut corrigé ───────────────────────────────────────────────────────
 *
 * La réglette donnait une hauteur en mètres absolus. Or la maille change cinq
 * fois de taille dans la cascade (20 km → 200 m). Mesuré le 2026-09-11 à 46° de
 * latitude, pitch 60°, pour le réglage par défaut de 4 km :
 *
 *   zoom  4 : colonne   1 px, maille  6 px →  0,2× — relief invisible
 *   zoom  8 : colonne  16 px, maille  9 px →  1,7×
 *   zoom 12 : colonne 261 px, maille 15 px → 17,3× — forêt d'aiguilles
 *
 * Un facteur 87 pour un réglage inchangé. C'est ce rapport que ces tests
 * verrouillent : il doit être CONSTANT, quel que soit le palier.
 *
 * ── Pourquoi un évaluateur maison ───────────────────────────────────────────
 *
 * MapLibre n'évalue pas ses expressions hors d'une carte. Vérifier la FORME du
 * tableau ne prouverait rien — une expression peut être bien formée et fausse,
 * et MapLibre rejette en SILENCE ce qu'il n'aime pas (leçon du bug DualMap).
 * L'évaluateur ci-dessous ne couvre que les opérateurs réellement utilisés, et
 * calcule donc ce que la carte calculera.
 */

type Feature = Record<string, number | undefined>;

function evaluer(expr: unknown, f: Feature): number | boolean {
  if (typeof expr === 'number' || typeof expr === 'boolean') return expr;
  if (!Array.isArray(expr)) throw new Error('littéral inattendu : ' + JSON.stringify(expr));

  const [op, ...args] = expr as [string, ...unknown[]];
  const n = (i: number) => Number(evaluer(args[i], f));

  switch (op) {
    case 'literal': return args[0] as number;
    case 'get': return f[args[0] as string] as number;
    case 'has': return f[args[0] as string] !== undefined;
    case 'to-number': {
      const brut = evaluer(args[0], f);
      const v = Number(brut);
      return Number.isFinite(v) ? v : Number(args[1] ?? 0);
    }
    case '*': return args.reduce<number>((acc, a) => acc * Number(evaluer(a, f)), 1);
    case '/': return n(0) / n(1);
    case '-': return args.length === 1 ? -n(0) : n(0) - n(1);
    case '+': return args.reduce<number>((acc, a) => acc + Number(evaluer(a, f)), 0);
    case 'min': return Math.min(...args.map(a => Number(evaluer(a, f))));
    case 'max': return Math.max(...args.map(a => Number(evaluer(a, f))));
    case 'sqrt': return Math.sqrt(n(0));
    case '>': return n(0) > n(1);
    case 'all': return args.every(a => Boolean(evaluer(a, f)));
    case 'case': {
      for (let i = 0; i + 1 < args.length; i += 2) {
        if (evaluer(args[i], f)) return evaluer(args[i + 1], f) as number;
      }
      return evaluer(args[args.length - 1], f) as number;
    }
    default: throw new Error('opérateur non couvert par l évaluateur : ' + op);
  }
}

/** Les cinq paliers réellement servis par `get_tile`, et leur côté en mètres. */
const PALIERS = [
  { superficie_km2: 0.04, cote: 200 },
  { superficie_km2: 1, cote: 1_000 },
  { superficie_km2: 4, cote: 2_000 },
  { superficie_km2: 25, cote: 5_000 },
  { superficie_km2: 400, cote: 20_000 },
];

const BORNES = { min: 0, max: 4 };            // log10 : 1 à 10 000 hab/km²
const ECHELLE = ['to-number', ['get', 'echelle'], 0];
const IND = 'population_totale';
const DENOM = 'superficie_km2';

/** Une feature exploitable : indicateur présent, dénominateur > 0. */
const feature = (superficie_km2: number, echelle: number): Feature => ({
  [IND]: 1, superficie_km2, echelle,
});

describe('largeurMailleExpr', () => {
  it('redonne le cote de la maille depuis sa surface', () => {
    for (const p of PALIERS) {
      expect(evaluer(largeurMailleExpr(), feature(p.superficie_km2, 0))).toBeCloseTo(p.cote, 6);
    }
  });

  it('rend 0 si la surface manque — pas une colonne fantome', () => {
    expect(evaluer(largeurMailleExpr(), { [IND]: 1 })).toBe(0);
  });
});

describe('hauteurExtrusionExpr — le rapport colonne/maille est constant', () => {
  const h = (superficie: number, echelle: number, exageration = 1.5) =>
    Number(evaluer(
      hauteurExtrusionExpr(IND, DENOM, BORNES, exageration, ECHELLE),
      feature(superficie, echelle),
    ));

  it('rend la MEME silhouette a tous les paliers — le defaut corrige', () => {
    // A valeur egale, la colonne doit valoir la meme fraction de sa maille,
    // que la tuile vienne du palier 200 m ou du palier 20 km.
    for (const p of PALIERS) {
      expect(h(p.superficie_km2, BORNES.max) / p.cote).toBeCloseTo(1.5, 9);
      expect(h(p.superficie_km2, BORNES.min + 2) / p.cote).toBeCloseTo(0.75, 9);
    }
  });

  it('une hauteur en metres absolus, elle, variait d un facteur 100', () => {
    // Ce test documente ce qu'on a quitte : 4 000 m valaient 20 fois la maille
    // de 200 m et un cinquieme de celle de 20 km.
    expect(4000 / 200).toBe(20);
    expect(4000 / 20_000).toBe(0.2);
  });

  it('plafonne au-dessus de la borne haute — Paris n ecrase pas le relief', () => {
    expect(h(1, 99)).toBeCloseTo(h(1, BORNES.max), 9);
  });

  it('reste au sol sous la borne basse, sans passer dans les negatifs', () => {
    expect(h(1, BORNES.min)).toBe(0);
    expect(h(1, -99)).toBe(0);
  });

  it('laisse au sol une donnee absente — ni zero affiche, ni record', () => {
    const sansIndicateur: Feature = { superficie_km2: 1, echelle: 4 };
    const sansDenominateur: Feature = { [IND]: 1, superficie_km2: 0, echelle: 4 };
    const expr = hauteurExtrusionExpr(IND, DENOM, BORNES, 1.5, ECHELLE);
    expect(evaluer(expr, sansIndicateur)).toBe(0);
    expect(evaluer(expr, sansDenominateur)).toBe(0);
  });

  it('la reglette n agit que sur l exageration, proportionnellement', () => {
    // Deplacer la reglette ne doit jamais changer la LECTURE : deux carreaux
    // gardent le meme rapport de hauteur quel que soit le reglage.
    const a = h(1, 3, 1), b = h(1, 2, 1);
    const a5 = h(1, 3, 5), b5 = h(1, 2, 5);
    expect(a5 / a).toBeCloseTo(5, 9);
    expect(a5 / b5).toBeCloseTo(a / b, 9);
  });
});
