/**
 * @file lib/carte/degrades.ts — un seul degrade de couleur a la fois
 *
 * Avant ce module, six choroplèthes pouvaient s'empiler (carreaux, IRIS,
 * indicateurs civiques, sante environnementale, meteo, impressions de campagne) : la carte devenait
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
  | 'campagne-impressions'
  | 'score'
  | 'diffusion'
  | 'zones-risque';

const LIBELLES: Record<DegradeId, string> = {
  'carreaux': 'Carreaux Filosofi',
  'iris': 'IRIS',
  'civic-indicateurs': 'Indicateurs civiques',
  'civic-sante': 'Santé environnementale',
  'meteo': 'Météo',
  'campagne-impressions': 'Impressions de la campagne',
  // Tâche 12 (2026-09-13) : le score composite est une choroplèthe comme les
  // autres. L'ajouter ICI plutôt que de le peindre à côté du registre est ce
  // qui l'empêche de s'empiler avec les six premières — le défaut même que la
  // Tâche 5 a fermé.
  'score': 'Score composite',
  // Tâche 13B (2026-09-15) : la carte Diffusion plein écran (pression réelle
  // contre plan, échelle divergente) est elle aussi une choroplèthe pleine
  // page — même raisonnement que le score composite ci-dessus.
  'diffusion': 'Diffusion campagne',
  // 2026-09-19 : les zones de risque sont des aplats pleine page, comme le
  // score composite et la diffusion. Les ajouter ICI plutôt que de les peindre
  // à côté du registre est ce qui les empêche de s'empiler avec les huit
  // autres — et ce qui garantit qu'une seule légende parle à la fois.
  'zones-risque': 'Zones de risque',
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
