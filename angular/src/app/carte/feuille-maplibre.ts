/**
 * Pose la feuille de style MapLibre dans `<head>`, une seule fois.
 *
 * `angular.json` déclare `maplibre-gl.css` avec `inject: false` : Angular
 * l'émet en `maplibre.css` dans le dossier de build, mais ne l'ajoute PAS à
 * `index.html` — sinon elle chargerait dans le paquet INITIAL, sur chaque
 * page, même quand aucune carte n'est montée (c'est ce que corrige ce fix
 * round : élargir le budget `anyComponentStyle` aurait protégé MapLibre au
 * prix d'affaiblir la protection pour tout futur composant). C'est donc à
 * `mg-carte` de la poser lui-même, à la demande, la première fois qu'une
 * carte existe — jamais avant.
 */
export function assurerFeuilleMaplibre(doc: Document): void {
  if (doc.head.querySelector('link[data-mg-maplibre]')) return;
  const lien = doc.createElement('link');
  lien.rel = 'stylesheet';
  lien.href = 'maplibre.css';
  lien.setAttribute('data-mg-maplibre', '');
  doc.head.appendChild(lien);
}
