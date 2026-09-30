import { chargerFeuille } from '../core/ressources/feuilles';
import { urlRessourceDistante } from '../core/ressources/ressource-distante';

/**
 * Pose la feuille de style MapLibre dans `<head>`, une seule fois, et attend
 * qu'elle soit appliquée.
 *
 * `angular.json` déclare `maplibre-gl.css` avec `inject: false` : Angular
 * l'émet en `maplibre.css` dans le dossier de build, mais ne l'ajoute PAS à
 * `index.html` — sinon elle chargerait dans le paquet INITIAL, sur chaque
 * page, même quand aucune carte n'est montée (élargir le budget
 * `anyComponentStyle` aurait protégé MapLibre au prix d'affaiblir la
 * protection pour tout futur composant). C'est donc à `mg-carte` de la poser
 * lui-même, à la demande, la première fois qu'une carte existe — jamais avant.
 *
 * L'adresse est résolue contre l'application DISTANTE (`base`), jamais contre
 * le document : dans le shell AIDA, `'maplibre.css'` tout court viserait le
 * dossier du shell. Rejette, en nommant le fichier, si la feuille ne charge pas.
 */
export function chargerFeuilleMaplibre(doc: Document, base: string): Promise<void> {
  return chargerFeuille(doc, 'data-mg-maplibre', urlRessourceDistante('maplibre.css', base));
}
