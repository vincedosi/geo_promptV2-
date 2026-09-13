/**
 * @file lib/analyses/score.ts — score composite multi-indicateurs (Tâche 12, 2026-09-13)
 *
 * « Où faut-il acheter ? » répondu par un seul nombre 0-100 par code postal,
 * agrégeant plusieurs indicateurs INSEE de poids et de sens différents.
 *
 * **Deux implémentations, volontairement, et elles doivent coïncider.**
 * Le calcul de production se fait EN SQL (`calculer_score_composite`,
 * sql/146) : normaliser côté client supposerait de faire descendre toutes les
 * valeurs de tous les indicateurs sur tout le périmètre, ce que le budget I/O
 * Nano interdit (CLAUDE.md). Ce module tient la même règle en TypeScript —
 * il est la SPÉCIFICATION EXÉCUTABLE de la RPC, testée sans base
 * (`tests/unit/analyses/score.test.ts`).
 *
 * **Aucun consommateur en production**, et c'est assumé : seul son test
 * l'importe. Une version antérieure de ce commentaire annonçait qu'il servait
 * « aux recalculs locaux quand les valeurs sont déjà en main (curseur de poids
 * déplacé : on repondère sans refaire un aller-retour) » — ce chemin n'existe
 * pas, déplacer un curseur ne recalcule rien tant qu'on ne relance pas le
 * POST. `npm run catalogue` (knip) le remontera donc comme export mort : il
 * est gardé délibérément, parce qu'une règle de calcul écrite deux fois dans
 * deux langages doit être vérifiable dans celui des deux qui se teste sans
 * base.
 *
 * Toute évolution de l'une doit être répercutée dans l'autre DANS LE MÊME
 * COMMIT — même règle de poids et même arrondi au dixième des deux côtés.
 *
 * Une réserve sur « même arrondi », pour ne pas promettre plus que le code ne
 * tient : `ROUND(numeric, 1)` en SQL est exact, `Math.round(x*10)/10` en JS
 * passe par le binaire. Une moyenne pondérée valant exactement 0,35 rendrait
 * 0,4 côté SQL et 0,3 côté TS. Aucune divergence mesurée sur 45 codes postaux
 * réels (Marseille, Lozère), et sans conséquence sur un score dont la lecture
 * est au dixième — mais c'est le seul écart théorique subsistant entre les
 * deux jumeaux, et il vaut mieux l'écrire que le découvrir.
 */

/** Sens de lecture d'un indicateur : une valeur haute est-elle favorable ? */
export type SensIndicateur = 'croissant' | 'decroissant';

/** Une ligne à scorer : un code (postal) et ses valeurs DÉJÀ normalisées, indicateur par indicateur. */
export interface LigneScore {
  code: string;
  /** `null` = indicateur non renseigné pour ce code — distinct d'un zéro mesuré. */
  valeurs: (number | null)[];
}

export interface ResultatScore {
  code: string;
  /** 0-100, arrondi au dixième comme la RPC. */
  score: number;
}

/**
 * Ramène une série sur 0-100 par min-max, sur la population OBSERVÉE (jamais
 * des bornes nationales : le score répond « où, dans ce périmètre » — les
 * bornes nationales, elles, servent l'échelle de couleurs IRIS, cf.
 * `iris_bornes_echelle`).
 *
 * - `decroissant` inverse : la valeur la plus basse vaut 100 (chômage, pollution…).
 * - Étendue nulle (toutes les valeurs égales) → `50` partout, et non `0` ou
 *   `NaN` : un indicateur constant n'est ni favorable ni défavorable, il ne
 *   doit pas tirer le score composite vers le bas.
 * - Les `null` traversent la fonction sans fausser les bornes (ils ne comptent
 *   ni dans le min ni dans le max), et ressortent `null` : c'est
 *   `scoreComposite` qui décide quoi faire d'un indicateur manquant.
 */
export function normaliser(valeurs: (number | null)[], sens: SensIndicateur): (number | null)[] {
  const presentes = valeurs.filter((v): v is number => v !== null && Number.isFinite(v));
  if (presentes.length === 0) return valeurs.map(() => null);

  const mn = Math.min(...presentes);
  const mx = Math.max(...presentes);
  const etendue = mx - mn;

  return valeurs.map((v) => {
    if (v === null || !Number.isFinite(v)) return null;
    if (etendue === 0) return 50;
    const croissant = (100 * (v - mn)) / etendue;
    return sens === 'decroissant' ? 100 - croissant : croissant;
  });
}

/**
 * Somme pondérée de valeurs **déjà normalisées** (sortie de `normaliser`).
 *
 * Le nom peut tromper : cette fonction ne normalise pas, elle pondère. La
 * normalisation se fait par indicateur, sur toute la colonne — donc avant,
 * quand on a la série entière sous la main ; ici on ne voit qu'une ligne à la
 * fois. Le test du plan (`valeurs: [100, 0]`, poids `[0.75, 0.25]` → `75`) ne
 * tient que sous cette convention : normaliser une ligne isolée rendrait `50`.
 *
 * Règles :
 * - Poids ramenés à 1 **sur les seuls indicateurs présents** de la ligne : un
 *   code postal auquel il manque un indicateur est scoré sur ce qu'il a,
 *   plutôt que pénalisé d'un zéro qu'on n'a pas mesuré.
 * - Ligne écartée (absente du résultat, et non scorée 0) si toutes ses valeurs
 *   manquent, ou si les indicateurs présents pèsent zéro : dans les deux cas
 *   aucun score n'est calculable, et un 0 se lirait comme un mauvais score.
 * - Arrondi au dixième, identique au `ROUND(..., 1)` de la RPC.
 */
export function scoreComposite(lignes: LigneScore[], poids: number[]): ResultatScore[] {
  const resultats: ResultatScore[] = [];

  for (const ligne of lignes) {
    let somme = 0;
    let sommePoids = 0;

    for (let i = 0; i < ligne.valeurs.length; i++) {
      const v = ligne.valeurs[i];
      const p = poids[i];
      if (v === null || !Number.isFinite(v) || !Number.isFinite(p)) continue;
      somme += v * p;
      sommePoids += p;
    }

    if (sommePoids === 0) continue;
    resultats.push({ code: ligne.code, score: Math.round((somme / sommePoids) * 10) / 10 });
  }

  return resultats;
}
