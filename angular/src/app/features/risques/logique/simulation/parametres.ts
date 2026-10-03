/**
 * Réglages par défaut de la simulation — copie Angular de `PARAMS_DEFAUT`
 * (`lib/simulation/generateur.ts:31-55`). Le générateur lui-même reste côté
 * serveur : l'écran n'en a besoin que pour pré-remplir les réglages.
 *
 * ⚠ Recopié À L'IDENTIQUE (graine et partenaires compris) : le test de parité
 * compare `toEqual`.
 */
import type { ParamsSimulation } from './types';

/** Les réglages par défaut, ceux du brief et de la maquette validée. */
export const PARAMS_DEFAUT: ParamsSimulation = {
  jours: 28,
  jourRecalage: 15,
  budget: 250_000,
  intensite: 1.55,
  fuite: 0.04,
  bruit: 0.18,
  derive: 0.12,
  amortissement: 0.8,
  seuilDilution: 20,
  baisseDilues: 0.6,
  graine: 20_260_924,
  // Trois partenaires génériques, à CPM distincts entre 4 et 11 € : jamais un
  // nom de régie réel dans un jeu de démonstration.
  partenaires: [
    { nom: 'Partenaire A', cpm: 4.2, part: 0.45 },
    { nom: 'Partenaire B', cpm: 7.6, part: 0.35 },
    { nom: 'Partenaire C', cpm: 10.8, part: 0.20 },
  ],
};
