import { type Provider, type Signal, computed, inject } from '@angular/core';
import { CouvertureService } from './couches/couverture.service';
import { ScoreService } from './couches/score.service';
import { ZonesRisqueService } from './couches/zones-risque.service';
import { JeuZonesService } from './etat/jeu-zones.service';
import { ZoneAnalyseeService } from './etat/zone-analysee.service';

/**
 * Les services d'état de ④ Analyse fournis par la PAGE carte (lot 4) — fichier voisin de `carte.page.ts`, qui est au
 * plafond de taille (`taille-fichiers.test.ts`). À la page et non au panneau (P-e) : la zone analysée et son chiffrage
 * survivent à ④ → ① → ④ ; un changement d'espace recrée la page, donc eux.
 */
export const FOURNISSEURS_ANALYSE: Provider[] = [
  // La zone analysée, reflétée dans `?zoneAnalyse=` et `?couverture=` (T7).
  ZoneAnalyseeService,
  // Sa couverture peinte sur LA carte (T8, A-7) : contour, part par CP ou par IRIS, surbrillance.
  CouvertureService,
];

/**
 * L'état de ⑤ Jeu de zones (lot 5, T9) fourni par la PAGE, pour la même raison (P-e) : la zone convertie, le jeu
 * ouvert et les conversions lues survivent à ⑤ → ① → ⑤.
 */
export const FOURNISSEURS_JEU: Provider[] = [JeuZonesService];

/**
 * La pastille « renseignée » de ④ (A2) : un score composite, des zones à risque ou une couverture de zone PEINTS. À
 * appeler dans un contexte d'injection (initialiseur de champ de la page).
 */
export function suivreAnalyseAffichee(): Signal<boolean> {
  const score = inject(ScoreService);
  const zonesRisque = inject(ZonesRisqueService);
  const couverture = inject(CouvertureService);
  return computed(() => score.affiche() !== null || zonesRisque.affichees() !== null || couverture.affichee());
}
