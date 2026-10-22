import type { Provider } from '@angular/core';
import { ZoneAnalyseeService } from './etat/zone-analysee.service';

/**
 * Les services d'état de ④ Analyse fournis par la PAGE carte (lot 4) — fichier voisin de `carte.page.ts`, qui est au
 * plafond de taille (`taille-fichiers.test.ts`). À la page et non au panneau (P-e) : la zone analysée et son chiffrage
 * survivent à ④ → ① → ④ ; un changement d'espace recrée la page, donc eux.
 */
export const FOURNISSEURS_ANALYSE: Provider[] = [
  // La zone analysée, reflétée dans `?zoneAnalyse=` et `?couverture=` (T7).
  ZoneAnalyseeService,
];
