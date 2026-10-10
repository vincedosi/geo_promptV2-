import { InjectionToken } from '@angular/core';
import type { Bbox } from '../../../carte/bbox';
import type { ProfilRayons } from '../../risques/logique/profil';

/** Ce que le module risque demande à la carte principale qui le porte. */
export interface ZonesAAfficher {
  /** Le profil CALCULÉ du module : la carte dessine ce que le module compte. */
  profil: ProfilRayons;
  /** Natures retenues dans le module, vide = toutes : elles entrent dans la clé des tuiles (B3). */
  natures: readonly string[];
  /** Cadre `[ouest, sud, est, nord]` sur lequel recadrer la carte (`ZonesRisqueEventDetail.recadrer`). */
  recadrer?: Bbox;
}

/**
 * Le pont entre le module risque et la carte principale (arbitrage B3, lot 4, T13).
 *
 * React passait par un `CustomEvent` sur `window` (`ZONES_RISQUE_EVENT`) : l'overlay et la couche vivaient dans deux
 * branches d'arbre qu'aucune prop ne traversait. Ici le module est une route ENFANT de la carte (B2) : il est créé sous
 * l'injecteur d'élément de l'outlet de `CartePage`, qui fournit ce jeton. Un jeton plutôt qu'un événement global :
 * `window` est celui du shell AIDA, et un module rendu AILLEURS que sous la carte ne voit tout simplement pas de pont —
 * son bouton « Voir sur la carte » n'existe pas, au lieu de crier dans le vide.
 */
export interface PontCarte {
  /** Allume les zones de ce profil sur la carte principale (géométrie DÉJÀ préparée) ; `null` les éteint. */
  afficherZonesRisque(d: ZonesAAfficher | null): void;
}

export const PONT_CARTE = new InjectionToken<PontCarte>('PONT_CARTE');
