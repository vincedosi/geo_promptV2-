import type { LotActivation } from '../../data/activation.api';
import type { CarteActivation } from './cartes';

/**
 * ⑦ Activation — les chiffres du bandeau de l'étape (lot 7, T3, A-12), et la pastille « renseignée » (A-11), PURS.
 * Tout se lit dans les cartes et l'historique déjà chargés : aucune requête à part.
 */

export interface BandeauActivation {
  /** Les plateformes cochées en ⑥ (une carte chacune). */
  plateformes: number;
  /** Les cartes sans motif bloquant, maille connue (`estPrete`). */
  pretes: number;
  /** Les canaux ayant un lot `termine` ou `partiel` non annulé. */
  poussees: number;
  /** Les canaux dont le DERNIER lot est `echec` ou `partiel`. */
  enErreur: number;
  /** La date de la dernière poussée (`fr-FR`, courte, comme l'historique de React), `null` sans poussée. */
  derniere: string | null;
}

/** Un lot qui a fait partir quelque chose et n'a pas été annulé (A-11). */
export function lotAbouti(l: Pick<LotActivation, 'statut'>): boolean {
  return l.statut === 'termine' || l.statut === 'partiel';
}

/** La date d'un lot telle que l'historique de React l'affiche (`ActivationPanel.tsx:420`). */
export function dateLot(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Une carte prête : une maille connue et aucun motif bloquant. Une carte MUETTE (pré-vol ou extraction encore en
 * lecture : ni maille ni motif) n'est pas prête — elle ne dit encore rien (relecture 2, M-1).
 */
export function estPrete(c: Pick<CarteActivation, 'maille' | 'motifs'>): boolean {
  return c.maille !== null && c.motifs.length === 0;
}

export function bandeauActivation(cartes: readonly CarteActivation[], lots: readonly LotActivation[]): BandeauActivation {
  // L'historique arrive le plus récent d'abord ; trié ici pour ne pas dépendre de l'ordre servi.
  const tries = [...lots].sort((a, b) => Date.parse(b.lance_le) - Date.parse(a.lance_le));
  const dernierParCanal = new Map<string, LotActivation>();
  for (const l of tries) if (!dernierParCanal.has(l.canal)) dernierParCanal.set(l.canal, l);
  return {
    plateformes: cartes.length,
    pretes: cartes.filter(estPrete).length,
    poussees: new Set(tries.filter(lotAbouti).map((l) => l.canal)).size,
    enErreur: [...dernierParCanal.values()].filter((l) => l.statut === 'echec' || l.statut === 'partiel').length,
    derniere: tries.length ? dateLot(tries[0].lance_le) : null,
  };
}
