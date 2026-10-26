import type { Maille, Plateforme } from '../jeu/plateformes';
import type { FormatFichier } from './cartes';

/**
 * ⑦ Activation et ⑤ Jeu de zones — les boutons de fichier d'une plateforme pour une extraction figée (lot 7, T5, A-6,
 * A-14), logique PURE : un libellé par format, et le nom de repli quand la réponse n'a pas de `Content-Disposition`.
 *
 * Les libellés sont ceux du brief SANS la flèche « ↓ » : `mg-bouton-export` dessine déjà l'icône de téléchargement
 * (remplacée par l'icône qui tourne pendant la lecture) ; écrire la flèche en plus la doublerait.
 */

const LIBELLE: Readonly<Record<Exclude<FormatFichier, 'territoires'>, string>> = {
  cp: 'Codes postaux',
  sdf: 'SDF DV360',
  cercles: 'Cercles (CSV)',
  polygone: 'Polygone (GeoJSON)',
};

/** Le libellé d'un format ; `territoires` se dit d'après la maille (départements ou communes). */
export function libelleFormat(format: FormatFichier, maille: Maille): string {
  if (format !== 'territoires') return LIBELLE[format];
  return maille === 'commune' ? 'Communes (CSV)' : 'Départements (CSV)';
}

/**
 * Le nom de repli, sur le patron du serveur (`fichierPlateforme` : `extraction_<jeu>_v<n>_<plateforme>_<format>`) sans
 * le nom du jeu, que l'écran n'a pas forcément : `.txt` pour les deux fichiers DV360 au CP, `.geojson` pour le
 * polygone, `.csv` sinon.
 */
export function nomRepliFichier(version: number, plateforme: Plateforme, format: FormatFichier): string {
  const ext = format === 'polygone' ? 'geojson' : plateforme === 'dv360' && (format === 'cp' || format === 'sdf') ? 'txt' : 'csv';
  return `extraction_v${version}_${plateforme}_${format}.${ext}`;
}
