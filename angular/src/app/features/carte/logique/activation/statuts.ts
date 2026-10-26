import { formaterNombre } from '../../../../core/format/nombre';

/**
 * ⑦ Activation — LA table des libellés de statut (preuve du lot 7, C-2) : statuts de lot (`activation_lots.statut` :
 * `en_cours`, `termine`, `partiel`, `echec`, `annule`) et de cible (`activation_cibles.statut` : `en_attente`, `pousse`,
 * `echec`, `annule`), en minuscules, au singulier et au pluriel. React affichait le code brut (« 2 pousse », « en_cours ») ;
 * l'historique, son détail et le flux de poussée lisent tous ici. Les cibles sont des line items : accord au masculin.
 */
const LIBELLES: Readonly<Record<string, { un: string; plusieurs: string }>> = {
  en_attente: { un: 'en attente', plusieurs: 'en attente' },
  en_cours: { un: 'en cours', plusieurs: 'en cours' },
  pousse: { un: 'poussé', plusieurs: 'poussés' },
  termine: { un: 'terminé', plusieurs: 'terminés' },
  partiel: { un: 'partiel', plusieurs: 'partiels' },
  echec: { un: 'échec', plusieurs: 'échecs' },
  annule: { un: 'annulé', plusieurs: 'annulés' },
};

/** Le libellé d'un statut au fil d'une phrase (« · poussé ») ; un code inconnu reste tel quel plutôt que d'être tu. */
export function statutMinuscule(statut: string): string {
  return LIBELLES[statut]?.un ?? statut;
}

/** Le libellé d'un statut seul, en sentence case (« Terminé », « En cours »). */
export function libelleStatut(statut: string): string {
  const s = statutMinuscule(statut);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Un compte accordé : « 1 poussé », « 2 poussés », « 0 échec » (singulier jusqu'à 1, comme en français). */
export function compteStatut(n: number, statut: string): string {
  const l = LIBELLES[statut];
  return `${formaterNombre(n)} ${l ? (n > 1 ? l.plusieurs : l.un) : statut}`;
}

/** « 1 line item », « 2 line items ». */
export function compteLineItems(n: number): string {
  return `${formaterNombre(n)} line item${n > 1 ? 's' : ''}`;
}
