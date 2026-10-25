import { computed, signal } from '@angular/core';
import { type Observable, NEVER } from 'rxjs';
import { vi } from 'vitest';
import type { ExtractionJeu } from '../data/jeux.api';
import type { Campagne, CanauxCampagne, CpDExtraction, StatutStrategie } from '../data/plan.api';
import { DEFAULT_PROG_DRAFT, type ProgDraft } from '../logique/plan/brouillon';
import { previsions as chiffrer, totauxPrevus } from '../logique/plan/impressions';

/**
 * La doublure de `PlanCampagneService` des écrans de ⑥ (lot 6, T3-T4) : des signaux ÉCRITURABLES là où le service
 * expose des lectures, et des espions sur ses gestes. Le service lui-même (URL, préremplissage, autosave) est éprouvé
 * par `plan-campagne.service.spec.ts` ; les écrans n'ont à prouver que ce qu'ils affichent et ce qu'ils demandent.
 * `modifier` applique VRAIMENT la mise à jour au brouillon : un geste se lit dans le signal. `previsions` et `totaux`
 * sont les VRAIS calculs (T5) ; les CP d'extraction se posent dans `cps` (clé `jeu|version|plateforme`).
 */
export function planFactice() {
  const brouillon = signal<ProgDraft>(DEFAULT_PROG_DRAFT);
  const campagne = signal<string | null>(null);
  const previsions = computed(() => {
    const d = brouillon();
    return chiffrer([...d.channels.dsps, ...d.channels.socials], d.channelBudgets, d.cpmPrevus ?? {});
  });
  const cps = signal<ReadonlyMap<string, CpDExtraction>>(new Map());
  const cle = (jeu: string, version: number, plateforme?: string) => `${jeu}|${version}|${plateforme ?? ''}`;
  return {
    campagne,
    brouillon,
    detail: signal<Campagne | null>(null),
    strategieExistante: signal<{ id: string; statut: StatutStrategie } | null>(null),
    canaux: signal<CanauxCampagne | null>(null),
    restaure: signal<{ savedAt: string } | null>(null),
    prerempli: signal(false),
    erreur: signal<string | null>(null),
    accesRefuse: signal(false),
    etape: signal(1),
    sauveLe: signal<string | null>(null),
    choisirCampagne: vi.fn((id: string | null) => campagne.set(id)),
    creerCampagne: vi.fn((): Observable<{ id: string; name: string }> => NEVER),
    modifier: vi.fn((maj: (d: ProgDraft) => ProgDraft) => brouillon.update(maj)),
    definirEtape: vi.fn(),
    repartirDeZero: vi.fn(),
    extraction: signal<ExtractionJeu | null>(null),
    previsions,
    totaux: computed(() => totauxPrevus(previsions())),
    cps,
    cpDe: (jeu: string, version: number, plateforme?: string) => cps().get(cle(jeu, version, plateforme)) ?? null,
    erreurCp: (): string | null => null,
    chargerCp: vi.fn(),
    retenirExtractions: vi.fn(),
    apresLancement: vi.fn(),
  };
}

export type PlanFactice = ReturnType<typeof planFactice>;

export const CAMPAGNE_A = '0f8fad5b-d9cb-469f-a165-70867728950e';
export const CAMPAGNE_B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

/** Une campagne lue (`GET /api/admin/campaigns/[id]`). */
export const detailCampagne = (id: string, name: string): Campagne => ({
  id, name, advertiser: null, product: null, date_start: null, date_end: null, organization_id: 'o', is_demo: false,
});
