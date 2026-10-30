/**
 * Copie Angular (lot 4, P6) VERBATIM de `lib/carte/garde-perimetre.ts` (imports relatifs seuls
 * changes), verrouillee par tests/unit/angular/carte-logique-paritaire.test.ts
 * (gel P5 etendu a /map). Ne pas corriger un defaut ici sans le corriger dans React.
 *
 * @file lib/carte/garde-perimetre.ts — garde-fou I/O Nano avant un calcul d'analyse
 *
 * Traduction directe de la spec §5 (Tâche 7, 2026-09-12) : le panneau Analyse
 * ne doit jamais lancer un calcul sans périmètre borné — c'est exactement la
 * famille de requêtes qui a épuisé le budget I/O Supabase Nano le 28/03 et le
 * 08/04 (voir CLAUDE.md « Incidents »). La garde BLOQUE UN LANCEMENT, elle ne
 * paramètre rien : elle s'applique donc à tout outil qui déclenche un calcul,
 * que son API accepte ou non un filtre géographique en argument.
 *
 * Logique pure, testée sans monter React (tests/unit/carte/garde-perimetre.test.ts).
 * Le CÂBLAGE réel de cette garde sur les cinq outils du panneau Analyse
 * (Voronoï, bataille V1/V2, application de la bataille, lancement du
 * clustering) est vérifié structurellement par
 * tests/unit/carte/panneau-analyse-garde.test.ts, qui lit le SOURCE de
 * `PanneauAnalyse.tsx` — round 2 de correction (Tâche 7, 2026-09-12) : une
 * première version ajoutait ici une fonction `lancementsAutorises` qui
 * énumérait les cinq outils mais recopiait une seule valeur booléenne cinq
 * fois et n'était appelée nulle part en production — un test qui l'exerçait
 * ne pouvait pas détecter un câblage nu dans le composant réel. Supprimée :
 * le test structurel lit le vrai composant, pas une façade.
 *
 * Un périmètre est choisi si :
 *   - un `FiltreActif` est posé (lib/carte/filtre.ts) — quel que soit son type,
 *     y compris `zone` (une zone enregistrée sélectionnée dans PanneauFiltre
 *     compose déjà un `FiltreActif` de type `zone`) ; OU
 *   - une zone est sélectionnée par un identifiant qui ne transiterait pas par
 *     `FiltreActif` — second paramètre optionnel, pour ne pas braquer cette
 *     fonction sur la seule modélisation actuelle si une sélection de zone
 *     propre au panneau Analyse apparaît plus tard (Phase 2, Tâches 14-18).
 *
 * **Filtre `'france'` (2026-09-15, spec-filtre-france.md) : un périmètre
 * CHOISI, pas absent.** `perimetreChoisi`/`messageGardePerimetre` passent
 * donc naturellement — c'est le sens même de la Tâche (« France entière » est
 * désormais une intention explicite, plus l'absence de filtre). Mais poser ce
 * filtre lève la garde pour TOUS les outils du panneau Analyse d'un coup, et
 * cinq d'entre eux coûtent bien plus que le score composite (159 ms sur les
 * 6 187 CP) : le Voronoï dépassait 30 s avant le correctif de la veille,
 * clustering et bataille sont du même ordre — rouvrir les incidents du 28/03
 * et du 08/04 pour ces cinq-là. `outilAdmetNational`/`messageGardeOutil`
 * ci-dessous ajoutent donc un second refus, spécifique au périmètre national,
 * que seul le score composite ne subit pas.
 */
import type { FiltreActif } from './filtre';

/** Message affiché quand aucun périmètre n'est choisi — texte VERBATIM de la spec §5. */
export const MESSAGE_PERIMETRE_MANQUANT =
  'Choisissez un périmètre (filtre ou zone) avant de lancer un calcul';

/** Un filtre actif OU une zone sélectionnée constituent un périmètre valide. */
export function perimetreChoisi(filtre: FiltreActif | null, zoneSelectionnee?: string | null): boolean {
  return filtre !== null || !!zoneSelectionnee;
}

/**
 * Message à afficher avant de bloquer un lancement, `null` si le calcul peut
 * continuer. Appeler AVANT tout lancement d'un outil d'analyse.
 */
export function messageGardePerimetre(filtre: FiltreActif | null, zoneSelectionnee?: string | null): string | null {
  return perimetreChoisi(filtre, zoneSelectionnee) ? null : MESSAGE_PERIMETRE_MANQUANT;
}

// ─────────────────────────────────────────────────────────────────────────
// Refus explicite du périmètre national — spec-filtre-france.md §3
// ─────────────────────────────────────────────────────────────────────────

/**
 * Les cinq outils de calcul du panneau Analyse gardés par cette garde (le
 * Voronoï, sixième, a été supprimé le 30/10/2026 — décision Vincent). Ne
 * couvre pas la Corrélation (bornée par une campagne, pas par la carte —
 * absence de garde ASSUMÉE, voir `PanneauAnalyse.tsx`).
 */
export type OutilAnalyse =
  | 'bataille_v1'
  | 'bataille_v2'
  | 'application_bataille'
  | 'clustering'
  | 'score_composite';

/** Libellé humain de chaque outil, pour un message de refus qui NOMME l'outil. */
const LIBELLE_OUTIL: Record<OutilAnalyse, string> = {
  bataille_v1: 'La bataille isochrone',
  bataille_v2: 'La bataille isochrone V2',
  application_bataille: 'L’application de la bataille',
  clustering: 'Le clustering',
  score_composite: 'Le score composite',
};

/**
 * Seuls les outils dont le coût mesuré sur la France entière reste négligeable
 * admettent un périmètre national. Au 2026-09-15, un seul : le score composite
 * (159 ms, 640 Ko lus sur les 6 187 CP — voir `/api/analyses/score`). Les cinq
 * autres n'ont jamais été mesurés à cette échelle et le Voronoï dépassait 30 s
 * avant le correctif de la veille : les traiter comme la France l'incident du
 * 28/03/08-04 rejoué par l'outil censé le prévenir.
 */
export function outilAdmetNational(outil: OutilAnalyse): boolean {
  return outil === 'score_composite';
}

/**
 * Message de refus d'un périmètre national pour UN outil donné, `null` si
 * l'outil l'admet. À combiner avec `messageGardePerimetre` : appeler
 * seulement quand un périmètre EST choisi (sinon `MESSAGE_PERIMETRE_MANQUANT`
 * prime — voir `messageGardeOutil`).
 */
export function messageRefusNational(outil: OutilAnalyse): string | null {
  if (outilAdmetNational(outil)) return null;
  return `${LIBELLE_OUTIL[outil]} ne peut pas être calculé sur la France entière — choisissez une région ou un département.`;
}

/**
 * Message à afficher avant de bloquer le lancement d'UN outil précis,
 * `null` si le calcul peut continuer. Combine les deux refus, dans l'ordre :
 * 1. aucun périmètre choisi du tout (`messageGardePerimetre`) ;
 * 2. un périmètre national choisi, pour un outil qui ne l'admet pas
 *    (`messageRefusNational`).
 *
 * Pour le score composite, `outilAdmetNational` rend toujours `true` : cette
 * fonction se comporte alors exactement comme `messageGardePerimetre` seule.
 */
export function messageGardeOutil(
  outil: OutilAnalyse,
  filtre: FiltreActif | null,
  zoneSelectionnee?: string | null,
): string | null {
  const messageAbsence = messageGardePerimetre(filtre, zoneSelectionnee);
  if (messageAbsence !== null) return messageAbsence;
  if (filtre?.type === 'france') return messageRefusNational(outil);
  return null;
}
