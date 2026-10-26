import { type Provider, type Signal, computed, inject } from '@angular/core';
import { CouvertureService } from './couches/couverture.service';
import { JeuCarteService } from './couches/jeu-carte.service';
import { ScoreService } from './couches/score.service';
import { ZonesRisqueService } from './couches/zones-risque.service';
import { NotificationsService } from '../../ui/notifications/notifications.service';
import { ActivationCampagneService } from './etat/activation-campagne.service';
import { JeuZonesService } from './etat/jeu-zones.service';
import { LancementCampagneService } from './etat/lancement-campagne.service';
import { PlanCampagneService } from './etat/plan-campagne.service';
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
export const FOURNISSEURS_JEU: Provider[] = [
  JeuZonesService,
  // La plateforme regardée peinte sur LA carte (T11, A-14) : retirée à la destruction du service (page recréée).
  JeuCarteService,
];

/**
 * L'état de ⑥ Plan (lot 6, T2) fourni par la PAGE, pour la même raison (P-e) : la campagne courante (`?campagne=`),
 * son brouillon autosauvé et les CP d'extraction lus survivent à ⑥ → ① → ⑥. Un changement d'espace recrée la page,
 * donc lui : le brouillon d'un espace ne s'écrit jamais dans l'autre.
 */
export const FOURNISSEURS_PLAN: Provider[] = [
  PlanCampagneService,
  // Le lancement (relecture 3) : à la page, il survit au pied détruit (autre campagne, autre étape) ; ses notifications
  // aussi — la pile `mg-notifications` du pied lit ce service.
  LancementCampagneService,
  NotificationsService,
];

/**
 * L'état de ⑦ Activation (lot 7, T3) fourni par la PAGE (P-e, A-10) : la poussée DV360 en cours survit à ⑦ → ① → ⑦ et
 * au changement de campagne ; un changement d'espace recrée la page, donc lui — la poussée est alors abandonnée.
 */
export const FOURNISSEURS_ACTIVATION: Provider[] = [ActivationCampagneService];

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

/**
 * La pastille « renseignée » de ⑤ (lot 5, T10) : une zone à convertir (`?zoneJeu=`) ou un jeu ouvert (`?jeu=`). Lue
 * dans l'état de la page, qui reflète l'URL — injecté ici, le service naît avec la page, sans aucune requête.
 */
export function suivreJeuRenseigne(): Signal<boolean> {
  const jeu = inject(JeuZonesService);
  return computed(() => jeu.zoneId() !== null || jeu.jeuId() !== null);
}

/**
 * La pastille « renseignée » de ⑥ (lot 6, T3) : la campagne courante a déjà une stratégie (le conteneur de son plan).
 * Injecté ici, le service naît avec la page : sans `?campagne=`, il ne lit rien.
 */
export function suivrePlanRenseigne(): Signal<boolean> {
  const plan = inject(PlanCampagneService);
  return computed(() => plan.strategieExistante() !== null);
}
