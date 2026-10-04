/**
 * Mise en forme des nombres, portée de `lib/format/nombre.ts` (React) : mêmes
 * sorties, mêmes cas absents. Rien dans `angular/` n'importe hors d'`angular/`,
 * d'où cette copie — gardée identique par `tests/unit/angular/format-paritaire.test.ts` (compare toutes les sorties).
 */

/** Ce qu'on affiche quand il n'y a pas de valeur. */
const ABSENT = '—';

/** Nombre complet, séparateurs de milliers français : `1 234 567`. */
export function formaterNombre(valeur: number | null | undefined): string {
  if (valeur == null) return ABSENT;
  return valeur.toLocaleString('fr-FR');
}

/** Nombre abrégé avec paliers, point décimal comme React : `1.2k`, `3.4M`, `1.2G`. */
export function formaterNombreAbrege(valeur: unknown): string {
  const v = Number(valeur);
  if (!Number.isFinite(v)) return ABSENT;
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'G';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return v.toLocaleString('fr-FR');
}

/** Décimales fixes, séparateurs français : `1 234,6`. */
export function formaterDecimal(valeur: number | null | undefined, decimales = 1): string {
  if (valeur == null || !Number.isFinite(valeur)) return ABSENT;
  return valeur.toLocaleString('fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

/**
 * Nombre abrégé en notation FRANÇAISE : `12,5 k`, `37,3 M`, `1,2 Md` (virgule décimale, espace avant le suffixe),
 * arrondi à l'unité sous 10 000. Distinct de `formaterNombreAbrege` (`37.3M`), comme côté React.
 */
export function formaterNombreCourt(valeur: unknown): string {
  const v = Number(valeur);
  if (!Number.isFinite(v)) return ABSENT;
  const a = Math.abs(v);
  const un = (x: number, suffixe: string) =>
    `${x.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${suffixe}`;
  if (a >= 1e9) return un(v / 1e9, 'Md');
  if (a >= 1e6) return un(v / 1e6, 'M');
  if (a >= 1e4) return un(v / 1e3, 'k');
  return Math.round(v).toLocaleString('fr-FR');
}
