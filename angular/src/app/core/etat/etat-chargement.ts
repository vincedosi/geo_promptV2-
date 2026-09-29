/**
 * L'état d'une donnée chargée, porté À CÔTÉ de la donnée. Même convention que
 * components/campagne/suivi-v2/etat-section.ts côté React : un tableau vide
 * confondait « en cours », « en échec » et « vraiment vide ».
 */
export type EtatChargement<T> =
  | { statut: 'chargement' }
  | { statut: 'echec'; message: string }
  | { statut: 'pret'; valeur: T };
