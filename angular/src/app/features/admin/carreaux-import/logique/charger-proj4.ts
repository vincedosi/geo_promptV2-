import { InjectionToken } from '@angular/core';
import { enregistrerProjections, type Proj4 } from '../../logique/shapefile';

let enCours: Promise<Proj4> | null = null;

/**
 * Charge `proj4` par `import()` DYNAMIQUE (arbitrage C10) — un morceau à part, demandé au premier fichier lu,
 * jamais au chargement de la page ni dans le paquet initial —, puis enregistre EPSG:3035 et EPSG:2154. Un
 * seul chargement par session ; un échec (réseau) n'est pas retenu : le dépôt suivant réessaie.
 */
export function chargerProj4(): Promise<Proj4> {
  enCours ??= import('proj4').then(
    (m) => {
      const proj4: Proj4 = m.default;
      enregistrerProjections(proj4);
      return proj4;
    },
    (e: unknown) => {
      enCours = null;
      throw e;
    },
  );
  return enCours;
}

/** Le chargeur de `proj4`, remplaçable dans les specs (pour compter les chargements). */
export const CHARGEUR_PROJ4 = new InjectionToken<() => Promise<Proj4>>('CHARGEUR_PROJ4', {
  providedIn: 'root',
  factory: () => chargerProj4,
});
