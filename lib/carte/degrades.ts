/**
 * @file lib/carte/degrades.ts — un seul degrade de couleur a la fois
 *
 * Avant ce module, cinq choropletehes pouvaient s'empiler (carreaux, IRIS,
 * indicateurs civiques, sante environnementale, meteo) : la carte devenait
 * illisible et aucune legende ne disait laquelle on lisait.
 *
 * Reducteur PUR : il dit quoi eteindre, il n'eteint rien lui-meme.
 */

export type DegradeId =
  | 'carreaux'
  | 'iris'
  | 'civic-indicateurs'
  | 'civic-sante'
  | 'meteo'
  | 'campagne-impressions';

const LIBELLES: Record<DegradeId, string> = {
  'carreaux': 'Carreaux Filosofi',
  'iris': 'IRIS',
  'civic-indicateurs': 'Indicateurs civiques',
  'civic-sante': 'Santé environnementale',
  'meteo': 'Météo',
  'campagne-impressions': 'Impressions de la campagne',
};

export function libelleDegrade(id: DegradeId): string {
  return LIBELLES[id];
}

export interface BasculeDegrade {
  /** Le degrade desormais actif, ou null si on vient d'eteindre le dernier. */
  actif: DegradeId | null;
  /** Celui qu'il faut eteindre, ou null. Sert au toast d'explication. */
  eteint: DegradeId | null;
}

/** Active `cible`. Re-activer le degrade courant l'eteint. */
export function activerDegrade(actif: DegradeId | null, cible: DegradeId): BasculeDegrade {
  if (actif === cible) return { actif: null, eteint: cible };
  return { actif: cible, eteint: actif };
}
