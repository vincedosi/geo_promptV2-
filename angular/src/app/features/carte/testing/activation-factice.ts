import { type Provider, signal } from '@angular/core';
import { vi } from 'vitest';
import type { LigneFlux, LotActivation, Prevol } from '../data/activation.api';
import { ActivationCampagneService } from '../etat/activation-campagne.service';
import { ParcoursService } from '../etat/parcours.service';
import { PlanCampagneService } from '../etat/plan-campagne.service';
import type { CarteActivation } from '../logique/activation/cartes';
import { CAMPAGNE_A, planFactice } from './plan-factice';

/**
 * La doublure de `ActivationCampagneService` des écrans de ⑦ (lot 7, T4) : des signaux ÉCRITURABLES et des espions sur
 * ses gestes. Le service (lecture annulable, poussée liée à sa campagne) est éprouvé par
 * `activation-campagne.service.spec.ts` ; les écrans n'ont à prouver que ce qu'ils affichent et ce qu'ils demandent.
 */
export function activationFactice() {
  return {
    prevol: signal<Prevol | null>(prevolDe()),
    lots: signal<readonly LotActivation[]>([]),
    cartes: signal<CarteActivation[]>([carteDe()]),
    chargement: signal(false),
    erreur: signal<string | null>(null),
    messageAnnulation: signal<string | null>(null),
    flux: signal<readonly LigneFlux[]>([]),
    pousseeEnCours: signal<{ campagne: string } | null>(null),
    publication: signal(false),
    pousser: vi.fn(), publier: vi.fn(), annuler: vi.fn(), relire: vi.fn(),
  };
}

export function prevolDe(p: Partial<Prevol> = {}): Prevol {
  return {
    strategie: { id: 's1', nom: 'p', statut: 'active', scope: 'custom_zone', zone_id: null, cpm_previsionnel: null, budget: null },
    version_publiee: 1, zones_modifiees: [], n_codes_postaux: 1200, canaux_connectes: [{ provider: 'dv360', methode: 'oauth', statut: 'active' }],
    mode_dv360: 'reel', n_cp_dv360: 63, extraction: { zone_set_id: 'j1', version: 1 }, motifs: [], blocages: [], activable: true, ...p,
  };
}

export function lotDe(p: Partial<LotActivation> = {}): LotActivation {
  return {
    id: 'l1', canal: 'dv360', version_strategie: 1, statut: 'termine', mode: 'reel', lance_le: '2026-10-26T09:00:00Z', termine_le: null,
    lance_par: null, cibles: { pousse: 2 }, n_cibles: 2, ...p,
  };
}

export function carteDe(p: Partial<CarteActivation> = {}): CarteActivation {
  return {
    canal: 'dv360', plateforme: 'dv360', libelle: 'DV360', maille: 'cp', nature: '63 CP — conversion de la zone (95 % d’utile)', mode: 'api',
    unites: 63, formats: ['cp', 'sdf'], motifs: [], avertissements: [], ...p,
  };
}

/** Le banc : plan (campagne A ouverte, liaison DV360 posée), état de ⑦ et parcours, et leurs fournisseurs de test. */
export function preparerActivation() {
  const plan = planFactice();
  plan.campagne.set(CAMPAGNE_A);
  plan.canaux.set({
    catalog: [{ code: 'dv360', label: 'Google DV360', category: 'dsp', connection_provider: 'dv360', active: true }],
    connectedProviders: ['dv360'], is_demo: false,
    selected: { dsps: ['dv360'], socials: [], ad_server: null, links: { dv360: { advertiser_id: '4242' } } },
  });
  const activation = activationFactice();
  const parcours = { choisir: vi.fn() };
  const fournisseurs: Provider[] = [
    { provide: PlanCampagneService, useValue: plan },
    { provide: ActivationCampagneService, useValue: activation },
    { provide: ParcoursService, useValue: parcours },
  ];
  return { plan, activation, parcours, fournisseurs };
}
