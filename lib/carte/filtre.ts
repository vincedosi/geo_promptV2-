/**
 * @file lib/carte/filtre.ts — le filtre unique de la carte
 *
 * « Ou je regarde ». UN SEUL filtre actif a la fois : poser un filtre remplace
 * le precedent, re-poser le meme le retire.
 *
 * Le filtre borne REELLEMENT les requetes (bbox ou liste de codes), il ne se
 * contente pas de masquer cote client : c'est le garde-fou contre les scans
 * France entiere qui ont epuise le budget I/O Nano le 28/03.
 *
 * Il ne s'applique JAMAIS au perimetre d'une strategie de campagne : une
 * strategie couvre toute la campagne (voir l'encart de l'onglet Strategie).
 */

/**
 * Bbox metropole — plafond impose par CLAUDE.md, jamais la France entiere + DROM.
 * Gelee a l'execution via Object.freeze() : c'est une valeur partagee par reference,
 * et sa mutation corromprait le garde-fou pour tous les appels suivants. Le gel protege
 * au-dela du contrat readonly du compilateur.
 */
export const BBOX_METRO: readonly [number, number, number, number] = Object.freeze([-5.5, 41.2, 9.8, 51.2]);

// Non exporte : aucun consommateur externe (verifie par `npm run catalogue`) —
// seul `FiltreActif.type` ci-dessous en a besoin, dans ce fichier.
//
// 'france' ajoute le 2026-09-15 (spec-filtre-france.md, option B choisie par
// Vincent) : une intention explicite de perimetre national, PAS une bbox.
// Touche minimale a ce fichier protege — un simple membre d'union ajoute.
// `poserFiltre`/`retirerFiltre`/le repli de `bboxDuFiltre` restent inchanges :
// c'est `lib/carte/bbox-requete.ts` qui porte la vraie correction (rendre
// `undefined` pour ce type, jamais `BBOX_METRO` — voir son en-tete).
type TypeFiltre = 'region' | 'departement' | 'commune' | 'cp' | 'zone' | 'france';

export interface FiltreActif {
  type: TypeFiltre;
  /** Code INSEE, code postal ou uuid de zone selon `type`. */
  code: string;
  /** Libelle affiche dans le chip. */
  label: string;
  /** Bbox resolue, quand elle est connue. */
  bbox?: readonly [number, number, number, number];
}

/** Meme filtre : meme type ET meme code. */
function memeFiltre(a: FiltreActif | null, b: FiltreActif): boolean {
  return a !== null && a.type === b.type && a.code === b.code;
}

/**
 * Pose un filtre. Remplace le precedent ; re-poser le meme le retire.
 * Rend le nouvel etat, jamais une mutation de l'ancien.
 */
export function poserFiltre(courant: FiltreActif | null, prochain: FiltreActif): FiltreActif | null {
  return memeFiltre(courant, prochain) ? null : prochain;
}

export function retirerFiltre(): null {
  return null;
}

/** Bbox a envoyer aux requetes. Sans filtre resolu, on borne a la metropole. */
export function bboxDuFiltre(f: FiltreActif | null): readonly [number, number, number, number] {
  return f?.bbox ?? BBOX_METRO;
}
