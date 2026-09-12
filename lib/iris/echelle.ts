/**
 * @file lib/iris/echelle.ts
 *
 * Rend les valeurs IRIS comparables entre paliers de zoom.
 *
 * `get_iris_tile` (sql/139) sert une CASCADE : departements sous z7, communes
 * a z7-z8, IRIS au-dela. Un effectif brut n'y est pas comparable — la somme
 * d'un departement vaut ~475 fois celle d'un IRIS. Rapporte a la surface,
 * l'ecart disparait. C'est exactement le raisonnement de
 * `lib/carreaux/normalisation.ts`, applique a une autre cascade.
 *
 * ── Trois classes, parce que deux ne suffisent pas ─────────────────────────
 *
 * La classe repond a DEUX questions qu'il serait tentant de confondre :
 *   (a) faut-il diviser par la surface ?
 *   (b) la distribution a-t-elle une queue droite longue ?
 *
 *   `effectif`   population, pop_*, nb_*  → diviser par la surface · p99,9
 *   `densite`    densite_*                → deja par km2          · p99,9
 *   `proportion` part_*, taux_*, rev_*…   → telle quelle          · p95
 *
 * `densite_pop` est le cas qui impose la troisieme : deja une densite, mais
 * longue queue. Classee `proportion`, son plafond tombait a 14 460 hab/km2 au
 * lieu de 60 555 — les 5 % d'IRIS les plus denses, c'est-a-dire le coeur des
 * villes, saturaient.
 *
 * ── La classe n'est PAS definie ici ────────────────────────────────────────
 *
 * Elle vient de `classe_iris()` en base (sql/138), servie avec les bornes par
 * `/api/iris/bornes`. Trois consommateurs en dependent — l'agregation,
 * les bornes et ce module — et une regle recopiee dans deux langages est une
 * regle qui divergera. Les colonnes d'`iris` etant dynamiques, le front ne peut
 * de toute facon pas connaitre la liste a l'avance.
 */
import type { BornesEchelle } from '@/lib/carreaux/bornes';

export type ClasseIris = 'effectif' | 'densite' | 'proportion';

/** Une ligne de `iris_bornes_echelle`. `log_*` sont des LOGARITHMES base 10. */
export interface BornesIris {
  colonne: string;
  classe: ClasseIris;
  log_min: number;
  log_max: number;
  val_min: number;
  val_max: number;
}

/** Bornes par colonne, telles que servies par `/api/iris/bornes`. */
export type CatalogueBornesIris = Record<string, BornesIris>;

/** Adapte une borne IRIS aux helpers d'echelle partages (`palierEchelle`…). */
export function echelleDe(bornes: BornesIris): BornesEchelle {
  return { min: bornes.log_min, max: bornes.log_max };
}

/**
 * Expression MapLibre de la valeur NORMALISEE.
 *
 * Le `max(…, 0.0001)` sur la surface reprend le garde-fou des carreaux : une
 * superficie absente diviserait par zero et ferait ressortir la maille comme la
 * plus dense de France. Une donnee manquante ne doit pas inventer un record —
 * c'est pourquoi {@link donneeIrisExploitableExpr} l'ecarte en amont.
 */
export function valeurNormaliseeExpr(colonne: string, classe: ClasseIris): unknown[] {
  const brute: unknown[] = ['to-number', ['get', colonne], 0];
  if (classe !== 'effectif') return brute;
  return ['/', brute, ['max', ['to-number', ['get', 'superficie_km2'], 0], 0.0001]];
}

/**
 * Expression MapLibre de l'echelle : log10 de la valeur normalisee.
 *
 * Le plancher a `val_min` evite `log10(0)` — qui vaut `-Infinity` et
 * contaminerait toute l'interpolation en silence.
 */
export function echelleLogExpr(bornes: BornesIris): unknown[] {
  return ['log10', ['max',
    valeurNormaliseeExpr(bornes.colonne, bornes.classe),
    bornes.val_min,
  ]];
}

/**
 * Predicat : la feature porte-t-elle de quoi calculer la valeur normalisee ?
 *
 * MVT OMET purement une propriete nulle. Sans ce garde-fou, `['get', col]`
 * rendrait `null`, `to-number` le convertirait en 0, et la maille se peindrait
 * au bas de l'echelle : la carte affirmerait « personne ici » la ou la bonne
 * reponse est « on ne sait pas ».
 */
export function donneeIrisExploitableExpr(colonne: string, classe: ClasseIris): unknown[] {
  const conditions: unknown[] = ['all', ['has', colonne]];
  if (classe === 'effectif') {
    conditions.push(
      ['has', 'superficie_km2'],
      ['>', ['to-number', ['get', 'superficie_km2'], 0], 0],
    );
  }
  return conditions;
}

/**
 * Unite reelle a afficher, denominateur compris.
 *
 * Un effectif normalise se lit en « /km² ». Omettre le denominateur ferait lire
 * une densite comme un total — le meme mensonge que sur les carreaux, en plus
 * discret puisque l'ordre de grandeur reste plausible.
 */
export function uniteIris(classe: ClasseIris): string {
  if (classe === 'effectif') return '/km²';
  if (classe === 'densite')  return '/km²';
  return '';
}

/**
 * Le palier de la cascade servi a ce zoom — le MEME decoupage que
 * `get_iris_tile`. Sert a nommer ce qu'on regarde dans le panneau ; la carte,
 * elle, lit `niveau` sur la feature.
 *
 * **Le plancher n'est pas un detail.** MapLibre demande la tuile `floor(zoom)` :
 * a un zoom de carte de 6,5, la tuile servie est la z6, donc des DEPARTEMENTS.
 * Sans ce `Math.floor`, le panneau annoncait « Communes » pendant que la carte
 * affichait des departements — constate au navigateur le 2026-09-12, sur tout
 * le demi-cran superieur de chaque palier. Un panneau qui se trompe de palier
 * fait lire une valeur departementale comme une valeur communale.
 */
export function niveauAuZoom(zoom: number): 'departement' | 'commune' | 'iris' {
  const zTuile = Math.floor(zoom);
  if (zTuile <= 6) return 'departement';
  if (zTuile <= 8) return 'commune';
  return 'iris';
}

/** Libelle francais d'un palier, au pluriel — pour le panneau. */
export const LIBELLE_NIVEAU: Record<'departement' | 'commune' | 'iris', string> = {
  departement: 'Départements',
  commune:     'Communes',
  iris:        'IRIS',
};
