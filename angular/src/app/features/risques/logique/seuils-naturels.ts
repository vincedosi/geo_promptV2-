/**
 * Seuils naturels (Fisher-Jenks) pour une échelle de couleurs.
 *
 * ── POURQUOI PAS LES QUANTILES ────────────────────────────────────────────
 *
 * Les quantiles imposent le MÊME NOMBRE d'unités par classe. C'est légitime
 * quand la grandeur est à peu près étalée ; c'est un mensonge quand elle est
 * concentrée — et la population exposée au risque industriel l'est
 * violemment.
 *
 * Mesure du 2026-09-18 sur les 94 départements exposés (part de la population
 * de l'unité vivant en zone à risque) :
 *
 *     minimum   0,02 %      médiane   0,33 %
 *     moyenne   0,52 %      90ᵉ c.    1,13 %      maximum   4,07 %
 *     les 10 premiers départements portent 54 % de toute la population exposée
 *
 * Découpé en quantiles, le seuil de la classe haute tombe à **0,75 %**. Cette
 * classe réunit donc un département à 0,8 % et la Seine-Maritime à 4,07 % — un
 * facteur cinq, peint de la même couleur. Symétriquement, les quantiles
 * écartèlent le bas de la distribution, où quarante départements se tiennent
 * en deux dixièmes de point, et fabriquent un contraste qui n'existe pas.
 *
 * Jenks fait l'inverse : il cherche les COUPURES, c'est-à-dire les endroits où
 * la distribution se creuse réellement. C'est la classification par défaut de
 * la cartographie thématique depuis les années 1960, et la seule honnête sur
 * une série concentrée.
 *
 * ── L'ALGORITHME ──────────────────────────────────────────────────────────
 *
 * Fisher-Jenks exact, par programmation dynamique : on minimise la somme des
 * variances intra-classes. Coût O(n²k), soit ~50 000 opérations pour 100
 * unités et 5 classes — négligeable, et il tourne à chaque changement de
 * filtre.
 *
 * Au-delà de `MAX_EXACT` valeurs le coût cesse d'être négligeable (2,3 M
 * carreaux n'arriveront jamais ici, mais 6 187 codes postaux, si). On
 * échantillonne alors régulièrement : les seuils d'une série ordonnée sont
 * stables par échantillonnage, contrairement à ses extrêmes — que l'on
 * réinjecte donc explicitement.
 */

/** Au-delà, on échantillonne avant de calculer. 1 200² × 5 reste instantané. */
const MAX_EXACT = 1200;

/**
 * Bornes SUPÉRIEURES de chaque classe, la dernière valant le maximum.
 * `k` classes → `k` bornes. Rend un tableau vide si aucune valeur exploitable.
 *
 * Les valeurs non finies et négatives ou nulles sont écartées : une échelle
 * d'intensité n'a pas de classe pour « rien », c'est le rôle du gris
 * `--donnee-absente`. Les confondre ferait lire « faible » là où il n'y a rien.
 */
export function seuilsNaturels(valeurs: number[], k: number): number[] {
  const propres = valeurs
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  if (propres.length === 0) return [];
  // Moins de valeurs que de classes demandées : chaque valeur est sa classe.
  if (propres.length <= k) return [...new Set(propres)];

  const serie = echantillonner(propres, MAX_EXACT);
  const n = serie.length;

  // mat1[i][j] = indice de début de la j-ième classe finissant en i
  // mat2[i][j] = variance cumulée minimale
  const mat1: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(k + 1).fill(0));
  const mat2: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(k + 1).fill(Infinity));

  for (let j = 1; j <= k; j++) {
    mat1[1][j] = 1;
    mat2[1][j] = 0;
  }

  for (let l = 2; l <= n; l++) {
    let somme = 0;
    let sommeCarres = 0;
    let effectif = 0;

    for (let m = 1; m <= l; m++) {
      const i3 = l - m + 1;
      const val = serie[i3 - 1];
      effectif++;
      somme += val;
      sommeCarres += val * val;
      const variance = sommeCarres - (somme * somme) / effectif;
      const i4 = i3 - 1;

      if (i4 !== 0) {
        for (let j = 2; j <= k; j++) {
          // `<=` et non `<` : à variance égale on préfère la coupure la plus
          // à droite, ce qui évite une première classe vide sur une série
          // dont les toutes petites valeurs sont nombreuses et identiques.
          if (mat2[l][j] >= variance + mat2[i4][j - 1]) {
            mat1[l][j] = i3;
            mat2[l][j] = variance + mat2[i4][j - 1];
          }
        }
      }
    }
    mat1[l][1] = 1;
    mat2[l][1] = sommeCarres - (somme * somme) / effectif;
  }

  // Remontée : on lit les bornes hautes de chaque classe.
  const bornes: number[] = [];
  let k2 = n;
  for (let j = k; j >= 1; j--) {
    bornes.unshift(serie[k2 - 1]);
    k2 = mat1[k2][j] - 1;
    if (k2 < 1) break;
  }

  // Dédoublonnage : une série très plate peut produire deux bornes égales,
  // et deux classes de même borne sont indiscernables à l'écran.
  return [...new Set(bornes)];
}

/**
 * Classe d'une valeur, de 0 à `bornes.length - 1`.
 * Rend `-1` pour une valeur absente ou nulle — à peindre en donnée absente,
 * jamais dans la classe la plus basse.
 */
export function classeDe(valeur: number | undefined, bornes: number[]): number {
  if (valeur === undefined || !Number.isFinite(valeur) || valeur <= 0) return -1;
  if (bornes.length === 0) return -1;
  for (let i = 0; i < bornes.length; i++) {
    if (valeur <= bornes[i]) return i;
  }
  return bornes.length - 1;
}

/**
 * Échantillonnage régulier qui CONSERVE les extrêmes.
 *
 * Un échantillonnage naïf (un élément sur p) perd le maximum une fois sur
 * deux, et le maximum est précisément la borne haute de la dernière classe :
 * le perdre décalerait toute l'échelle vers le bas et laisserait les unités
 * les plus exposées hors de leur propre classe.
 */
function echantillonner(serie: number[], cible: number): number[] {
  if (serie.length <= cible) return serie;
  const pas = serie.length / cible;
  const sortie: number[] = [];
  for (let i = 0; i < cible; i++) sortie.push(serie[Math.floor(i * pas)]);
  const max = serie[serie.length - 1];
  if (sortie[sortie.length - 1] !== max) sortie.push(max);
  return sortie;
}
