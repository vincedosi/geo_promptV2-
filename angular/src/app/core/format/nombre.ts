/**
 * Mise en forme des nombres, portée de `lib/format/nombre.ts` (React) : mêmes
 * sorties, mêmes cas absents. Rien dans `angular/` n'importe hors d'`angular/`,
 * d'où cette copie — à garder identique (tests : `nombre.spec.ts`).
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
