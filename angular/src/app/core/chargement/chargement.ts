/**
 * UNE barre de progression pour tout un écran. Chaque source de données
 * déclare une « piste » ; la barre dit s'il y a du travail en cours, et
 * lequel. Indéterminée à dessein : aucune route ne rend d'avancement, un
 * pourcentage y serait inventé.
 */
export interface Piste {
  cle: string;
  libelle: string;
  actif: boolean;
}

export interface Chargement {
  actif: boolean;
  libelles: string[];
  texte: string | null;
}

export function agregerChargement(pistes: Piste[]): Chargement {
  const libelles: string[] = [];
  for (const p of pistes) {
    if (p.actif && !libelles.includes(p.libelle)) libelles.push(p.libelle);
  }
  if (libelles.length === 0) return { actif: false, libelles: [], texte: null };
  const texte = libelles.length === 1 ? libelles[0] : `${libelles[0]} (+${libelles.length - 1})`;
  return { actif: true, libelles, texte };
}

/**
 * Une valeur à l'écran pendant qu'on recalcule décrit l'état PRÉCÉDENT. Elle
 * s'estompe au lieu de disparaître : un squelette effacerait justement le
 * chiffre qu'on veut comparer au nouveau.
 */
export function estPerime(chargeEnCours: boolean, aDesDonnees: boolean): boolean {
  return chargeEnCours && aDesDonnees;
}
