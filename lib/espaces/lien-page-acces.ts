/**
 * @file lib/espaces/lien-page-acces.ts — adresse de la page Angular « Accès »
 *
 * Depuis le 2026-10-10, les droits (comptes, espaces, données visibles) se
 * gèrent sur UNE page, en Angular : `admin/acces`. Les pages React
 * `/admin/users` et `/admin/organizations` sont supprimées, et les liens qui y
 * menaient (barre latérale, Réglages de la carte, tableau de bord, page Sources)
 * passent par ici.
 *
 * L'application Angular tourne À PART — autonome sur :4200, ou dans le shell
 * AIDA — donc son adresse ne se devine pas : elle vient de
 * `NEXT_PUBLIC_URL_ANGULAR` (ex. `http://localhost:4200/app`). Jamais d'URL en
 * dur. Sans la variable, `null` : l'appelant ne rend pas l'entrée, plutôt qu'un
 * lien mort.
 *
 * ⚠ `process.env.NEXT_PUBLIC_URL_ANGULAR` doit rester écrit en toutes lettres :
 * Next ne remplace dans le bundle client que les accès LITTÉRAUX.
 */
export function lienPageAcces(
  base: string | undefined = process.env.NEXT_PUBLIC_URL_ANGULAR,
): string | null {
  const propre = (base ?? '').trim().replace(/\/+$/, '');
  return propre ? `${propre}/admin/acces` : null;
}
