/**
 * @file lib/navigation/garde-saisie.ts — le clavier ne doit jamais voler une
 * frappe de saisie, sauf Echap
 *
 * Round de correction 1 (Tâche 8, 2026-09-12) : le listener global de
 * `app/map/page.tsx` appliquait sa garde de focus (INPUT/TEXTAREA/
 * contentEditable) AVANT de distinguer Echap des autres touches — Echap ne
 * fermait donc plus rien tant qu'on tapait dans un champ (l'Assistant, une
 * recherche de panneau...). L'ancien `IconBar.tsx` scopait cette garde au
 * seul raccourci `/` ; aucun des quatre anciens listeners Echap n'avait de
 * garde de focus. La portée avait changé silencieusement.
 *
 * Règle : un raccourci À MODIFICATEUR (Ctrl/Alt, cf `entreeParRaccourci`) ne
 * doit jamais s'activer pendant une saisie — c'est ce qu'on ne veut jamais
 * voler. Echap, lui, n'est JAMAIS filtré : c'est justement la touche qui
 * ferme ce qu'on est en train de remplir.
 *
 * Logique pure, testée sans monter React
 * (tests/unit/navigation/garde-saisie.test.ts).
 */

/**
 * Dit si `touche` doit être ignorée par le routeur de raccourcis parce que le
 * focus est dans un champ de saisie. `cible` est `document.activeElement`.
 */
export function ignorerRaccourciClavier(touche: string, cible: Element | null): boolean {
  if (touche === 'Escape') return false;
  if (!cible) return false;
  const tag = cible.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (cible as HTMLElement).isContentEditable === true;
}
