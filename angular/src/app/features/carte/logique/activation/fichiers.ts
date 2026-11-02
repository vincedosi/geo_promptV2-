import { formaterNombre } from '../../../../core/format/nombre';
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
  pays: 'Pays (CSV)',
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
export function nomRepliFichier(version: number, plateforme: Plateforme, format: FormatFichier, bloc?: number): string {
  const ext = format === 'polygone' ? 'geojson' : plateforme === 'dv360' && (format === 'cp' || format === 'sdf') ? 'txt' : 'csv';
  // B14 round 1 (I-2) : le suffixe `_bloc<n>` du serveur pour un bloc du découpage.
  return `extraction_v${version}_${plateforme}_${format}${bloc !== undefined ? `_bloc${bloc}` : ''}.${ext}`;
}

/** B14 round 1 (I-2) : le libellé du fichier d'UN bloc — « Communes (CSV) — bloc 2 (500) ». */
export function libelleBloc(libelle: string, bloc: { numero: number; n_unites: number }): string {
  return `${libelle} — bloc ${formaterNombre(bloc.numero)} (${formaterNombre(bloc.n_unites)})`;
}
