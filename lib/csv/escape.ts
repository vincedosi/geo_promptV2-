/**
 * lib/csv/escape.ts
 * Échappement CSV sûr pour export (protection injection de formule + délimiteur).
 *
 * OWASP CSV Injection : une cellule dont le contenu commence par = + - @
 * (ou une tabulation / retour chariot) est interprétée comme une formule
 * par Excel/LibreOffice à l'ouverture (ex: =HYPERLINK(...), =cmd|...).
 * On neutralise en préfixant d'une apostrophe AVANT l'échappement
 * guillemets/délimiteur habituel.
 */

const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

/**
 * Échappe une valeur de cellule pour un CSV avec le séparateur donné.
 * Neutralise les préfixes de formule puis échappe guillemets/délimiteur/retour ligne.
 */
export function csvEscapeCell(value: string, separator = ';'): string {
  let str = value;
  if (FORMULA_PREFIX_RE.test(str)) str = `'${str}`;
  str = str.replace(/"/g, '""');
  const needsQuoting = str.includes(separator) || str.includes('"') || str.includes('\n') || str.includes('\r');
  return needsQuoting ? `"${str}"` : str;
}
