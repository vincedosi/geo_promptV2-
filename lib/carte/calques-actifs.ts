/**
 * @file lib/carte/calques-actifs.ts — bascule d'un calque à dégradé + validation
 * d'un `DegradeId` relu à la frontière (localStorage, URL...).
 *
 * Logique PURE, extraite pour être testée sans monter React (Tâche 6,
 * 2026-09-12) — c'est l'absence de tests qui a laissé passer deux défauts
 * critiques à la Tâche 4.
 *
 * `lib/carte/degrades.ts` (fichier protégé, contrat de la Tâche 5) reste
 * inchangé : ce module l'enveloppe, il ne le remplace pas.
 */
import { activerDegrade, type DegradeId } from './degrades';

/** Les six valeurs connues — narrowées explicitement, jamais un cast. */
const DEGRADE_IDS: readonly DegradeId[] = [
  'carreaux',
  'iris',
  'civic-indicateurs',
  'civic-sante',
  'meteo',
  'campagne-impressions',
];

/**
 * Valide une valeur relue (localStorage, paramètre d'URL...) contre les six
 * `DegradeId` connus. `lib/carte/degrades.ts` est pur et ne valide rien : un
 * identifiant périmé (ancien nom de dégradé, valeur corrompue) ferait rendre
 * `libelleDegrade` `undefined` dans un toast affiché à l'utilisateur.
 */
export function validerDegradeId(valeur: unknown): DegradeId | null {
  return typeof valeur === 'string' && (DEGRADE_IDS as readonly string[]).includes(valeur)
    ? (valeur as DegradeId)
    : null;
}

export interface ResultatBasculeCalque {
  /** Nouveau dégradé actif après la bascule. */
  degradeActif: DegradeId | null;
  /** Dégradé à éteindre en effet de bord (jamais `cible`), ou `null`. */
  aEteindre: DegradeId | null;
}

/**
 * Bascule la visibilité d'un calque à dégradé, en respectant l'exclusivité
 * (un seul dégradé de couleur à la fois — contrat `activerDegrade`).
 *
 * `next = true` ACTIVE toujours `cible`, et évince l'ancien dégradé actif
 * quel qu'il soit. C'est le cas qu'`activerDegrade` seul ne couvre pas : il
 * traite la ré-activation du dégradé déjà actif comme une EXTINCTION (pensé
 * pour un bouton unique par dégradé, cf `tests/unit/carte/degrades.test.ts`).
 * Une checkbox de calque qui passe à coché doit toujours dire « actif »,
 * jamais « j'étais déjà actif, je m'éteins » — d'où le retour à `null` avant
 * l'appel quand `cible` était déjà le dégradé actif.
 *
 * `next = false` DÉSACTIVE `cible` sans jamais toucher à un autre dégradé.
 */
export function basculerDegrade(
  actif: DegradeId | null,
  cible: DegradeId,
  next: boolean,
): ResultatBasculeCalque {
  if (!next) {
    return { degradeActif: actif === cible ? null : actif, aEteindre: null };
  }
  const resultat = activerDegrade(actif === cible ? null : actif, cible);
  return { degradeActif: resultat.actif, aEteindre: resultat.eteint };
}
