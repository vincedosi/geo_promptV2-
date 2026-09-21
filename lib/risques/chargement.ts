/**
 * L'état de chargement de l'écran de risque, agrégé en un seul signal.
 *
 * ── POURQUOI AGRÉGER ──────────────────────────────────────────────────────
 *
 * Quatre étapes, cinq sources de données, et **quatre formes de signal
 * différentes** : `use-bandes` porte un `etat` à trois valeurs,
 * `use-courbe-rayon` et `use-sites-compte` un booléen `chargement`,
 * `use-jeux-zones` un `etat` à quatre valeurs. Chaque panneau affichait donc
 * son attente à sa façon, et la carte n'en affichait aucune.
 *
 * Conséquence concrète : en changeant un filtre, les chiffres du bandeau
 * restaient à l'écran, inchangés, pendant les secondes du recalcul — sans rien
 * pour dire qu'ils décrivaient encore l'état PRÉCÉDENT. Un chiffre périmé qui
 * a l'air valide est pire qu'un chiffre absent.
 *
 * ── CE MODULE NE SAIT RIEN DE REACT ───────────────────────────────────────
 *
 * Il ne fait que combiner des pistes en un verdict. C'est ce qui le rend
 * testable sans monter un écran, et c'est `ContexteChargement` qui l'alimente.
 */

/** Une source de données qui peut être en cours. */
export interface Piste {
  /** Identifiant stable, pour qu'une piste remplace la sienne et non une autre. */
  cle: string;
  /** Ce que l'utilisateur lit pendant l'attente. Une phrase, pas un nom de variable. */
  libelle: string;
  actif: boolean;
}

export interface Chargement {
  /** Au moins une piste est en cours. */
  actif: boolean;
  /** Les libellés des pistes en cours, dédoublonnés, dans l'ordre reçu. */
  libelles: string[];
  /**
   * La phrase à afficher, ou `null` si rien ne charge.
   *
   * ⚠ Une SEULE phrase même à plusieurs pistes : « Calcul de la population…
   * Découpage des zones… Comptage des sites… » se lit comme une panne. On
   * nomme la première et on compte le reste.
   */
  texte: string | null;
}

/**
 * Combine les pistes en un signal unique.
 *
 * @param pistes - Les sources déclarées par l'écran.
 * @returns Le verdict global.
 *
 * @example
 * agregerChargement([{ cle: 'a', libelle: 'Calcul…', actif: true }]).texte
 * // → 'Calcul…'
 */
export function agregerChargement(pistes: Piste[]): Chargement {
  const libelles: string[] = [];
  for (const p of pistes) {
    if (p.actif && !libelles.includes(p.libelle)) libelles.push(p.libelle);
  }
  if (libelles.length === 0) return { actif: false, libelles: [], texte: null };
  const texte = libelles.length === 1
    ? libelles[0]
    : `${libelles[0]} (+${libelles.length - 1})`;
  return { actif: true, libelles, texte };
}

/**
 * Les chiffres affichés décrivent-ils encore l'état précédent ?
 *
 * ⚠ La distinction porte sur la PRÉSENCE d'une donnée, pas sur le chargement
 * seul : au tout premier chargement il n'y a rien à périmer — l'écran est
 * vide, et le griser ne dirait rien de plus que la barre. C'est au RE-calcul
 * que la nuance compte, parce que des chiffres justes d'hier y restent
 * affichés.
 *
 * @param chargeEnCours - Une piste au moins est active.
 * @param aDesDonnees - Des valeurs sont déjà à l'écran.
 * @returns `true` s'il faut les marquer comme obsolètes.
 */
export function estPerime(chargeEnCours: boolean, aDesDonnees: boolean): boolean {
  return chargeEnCours && aDesDonnees;
}
