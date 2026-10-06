/**
 * Copie de `lib/version.ts` — `APP_VERSION` et `BUILD_DATE` seuls, affichés par le Health check
 * (lot 6, 2026-10-06). Parité : `tests/unit/angular/admin-logique-paritaire.test.ts`, qui échoue
 * à chaque incrément côté React — c'est voulu : la copie doit suivre.
 */
export const APP_VERSION = '7.19.0';
export const BUILD_DATE = '2026-04-28';
