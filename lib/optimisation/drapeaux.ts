/**
 * @file lib/optimisation/drapeaux.ts — la bascule TS → Python, par drapeau (tâche 1.6, plan § 5).
 *
 * Le cahier des charges interdit de supprimer le TS tant que Python n'est pas validé : chaque calcul porté passe par
 * un drapeau à trois valeurs.
 * - `ts` (DÉFAUT, et valeur de toute variable ABSENTE) : le TS seul, exactement comme avant — aucun appel au service ;
 * - `ombre` : le TS calcule et reste la valeur écrite ou rendue ; Python est appelé à côté, l'écart est comparé et
 *   journalisé (`ombre.ts`) ; une panne de Python n'interrompt jamais le TS ;
 * - `python` : la valeur de Python est écrite ou rendue ; une panne de Python est une erreur, jamais un repli
 *   silencieux sur le TS.
 *
 * Deux drapeaux, parce que les deux blocs se valident séparément :
 * - `OPTIMISATION_PLAN_SOURCE` : le plan initial (extraction zone et risque, `rattacher`, `export`, `cp-geo`) ;
 * - `OPTIMISATION_CORRECTION_SOURCE` : la correction des poids (`simulation/recaler`).
 */

export type SourceCalcul = 'ts' | 'ombre' | 'python';

const VALEURS: readonly SourceCalcul[] = ['ts', 'ombre', 'python'];

/** Une valeur inconnue n'est signalée qu'une fois par processus (le journal ne doit pas se remplir à chaque appel). */
const dejaSignale = new Set<string>();

function lire(nom: 'OPTIMISATION_PLAN_SOURCE' | 'OPTIMISATION_CORRECTION_SOURCE'): SourceCalcul {
  const brut = process.env[nom]?.trim().toLowerCase();
  if (!brut) return 'ts';
  if ((VALEURS as readonly string[]).includes(brut)) return brut as SourceCalcul;
  // Une faute de frappe ne doit pas basculer la production sur un calcul non validé : on reste au TS, en le DISANT.
  const cle = `${nom}=${brut}`;
  if (!dejaSignale.has(cle)) {
    dejaSignale.add(cle);
    console.warn(JSON.stringify({
      evenement: 'optimisation_drapeau_inconnu', variable: nom, valeur: brut, retenu: 'ts',
      message: `${nom} vaut « ${brut} » : valeurs permises ts, ombre, python. Le calcul TypeScript est gardé.`,
    }));
  }
  return 'ts';
}

/** `OPTIMISATION_PLAN_SOURCE` : source du plan initial. Lue à chaque appel (aucun redémarrage requis en dev). */
export function sourcePlan(): SourceCalcul {
  return lire('OPTIMISATION_PLAN_SOURCE');
}

/** `OPTIMISATION_CORRECTION_SOURCE` : source de la correction des poids. */
export function sourceCorrection(): SourceCalcul {
  return lire('OPTIMISATION_CORRECTION_SOURCE');
}
