import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { PlanApi, type PlanRattache } from '../../data/plan.api';
import { LancementCampagneService } from '../../etat/lancement-campagne.service';
import { ParcoursService } from '../../etat/parcours.service';
import { PlanCampagneService } from '../../etat/plan-campagne.service';
import { DEFAULT_PROG_DRAFT, type ProgDraft } from '../../logique/plan/brouillon';
import { CAMPAGNE_A, detailCampagne, planFactice } from '../../testing/plan-factice';
import { PiedLancementComponent } from './pied-lancement.component';

const J = '16fd2706-8baf-433b-82eb-8c7fada847da';
const PRET: ProgDraft = {
  ...DEFAULT_PROG_DRAFT,
  name: 'Rentrée',
  jeuZones: { id: J, nom: 'Lyon', version: 2, extraction: { id: 'x', version: 3 } },
  channels: { dsps: ['dv360'], socials: [], ad_server: null },
  channelBudgets: { dv360: 10000 }, cpmPrevus: { dv360: 4 },
  startDate: '2026-11-01', endDate: '2026-11-30',
};
const RATTACHE = { strategie: 's1', codes_postaux: 12, n_retenus: 10, part_plan_en_zone: 90, taux_utile: 75 } as PlanRattache;

function monter(brouillon: ProgDraft = PRET, api: Partial<Record<keyof PlanApi, unknown>> = {}) {
  const plan = planFactice();
  plan.campagne.set(CAMPAGNE_A);
  plan.detail.set(detailCampagne(CAMPAGNE_A, 'Rentrée'));
  plan.prerempli.set(true);
  plan.brouillon.set(brouillon);
  const appels = {
    rattacher: vi.fn(() => of(RATTACHE)),
    modifierStrategie: vi.fn(() => of({ strategy: {} })),
    ecrireCanaux: vi.fn(() => of({ ok: true })),
    modifierCampagne: vi.fn(() => of({ success: true })),
    brouillons: vi.fn(() => of({ drafts: [] })),
    supprimerBrouillon: vi.fn(() => of({ deleted: true })),
    ...api,
  };
  const parcours = { choisir: vi.fn() };
  TestBed.configureTestingModule({
    // Comme la page (FOURNISSEURS_PLAN) : le service de lancement et les notifications vivent HORS du pied.
    providers: [
      { provide: PlanCampagneService, useValue: plan }, { provide: PlanApi, useValue: appels }, { provide: ParcoursService, useValue: parcours },
      LancementCampagneService, NotificationsService,
    ],
  });
  const fixture = TestBed.createComponent(PiedLancementComponent);
  fixture.componentRef.setInput('liaisonsConfirmees', true);
  const el = fixture.nativeElement as HTMLElement;
  const notifs = TestBed.inject(NotificationsService);
  return { fixture, el, plan, appels, parcours, notifs, stable: () => fixture.whenStable() };
}

describe('PiedLancementComponent — récapitulatif et lancement (T6)', () => {
  it('récap : extraction, plateformes avec budget · CPM · impressions, totaux', async () => {
    const { el, stable } = monter();
    await stable();
    const t = (s: string) => el.querySelector(s)!.textContent!.replace(/\s+/g, ' ').trim();
    expect(t('[data-recap-extraction]')).toBe('Lyon · extraction v3');
    // Le nom et l'identité restent séparés : Angular retire l'espace seul entre deux balises (preuve navigateur T7b).
    const [nom, identite] = [...el.querySelectorAll('[data-recap-lancement] > div:first-child > span')].map((s) => s.textContent);
    expect(el.querySelector('[data-recap-lancement] > div:first-child')!.textContent).toBe(`${nom} ${identite}`);
    expect(t('[data-recap-plateforme="dv360"]')).toBe('dv360 · 10 000 € · CPM 4,00 € · 2 500 000 imp.');
    expect(t('[data-recap-impressions]')).toBe('2 500 000');
    expect(t('[data-recap-periode]')).toBe('01/11/26 → 30/11/26');
    expect(el.querySelector<HTMLButtonElement>('[data-lancer]')!.disabled).toBe(false);
    expect(el.querySelector('[data-motifs]')).toBeNull();
  });

  it('CPM manquant : bouton inactif, le motif est dit', async () => {
    const { el, stable } = monter({ ...PRET, cpmPrevus: {} });
    await stable();
    expect(el.querySelector<HTMLButtonElement>('[data-lancer]')!.disabled).toBe(true);
    expect(el.querySelector('[data-motifs]')!.textContent).toContain('CPM prévu manquant : dv360');
  });

  it('liaisons non confirmées : bouton inactif', async () => {
    const { el, fixture, stable } = monter();
    fixture.componentRef.setInput('liaisonsConfirmees', false);
    await stable();
    expect(el.querySelector<HTMLButtonElement>('[data-lancer]')!.disabled).toBe(true);
  });

  it('réussite : message, brouillon jeté, « Préparer l’activation → ⑦ »', async () => {
    const { el, plan, appels, parcours, notifs, stable } = monter();
    // Le plan CP de l'extraction, lu par le bandeau : 12 lignes écrites, dont 11 retenues (codes bruts, D-3).
    plan.cps.set(new Map([[`${J}|3|`, { cp: [], total: 12, retenus: 11 }]]));
    await stable();
    el.querySelector<HTMLButtonElement>('[data-lancer]')!.click();
    await stable();
    expect(appels.modifierCampagne).not.toHaveBeenCalled();
    expect(appels.modifierStrategie).toHaveBeenCalledWith('s1', { total_budget: 10000, forecast_cpm: 4, kpi_target: 2500000, start_date: '2026-11-01', end_date: '2026-11-30' });
    // Les canaux ÉCRITS repartent au plan (relecture 2 du lot 7, I-2).
    expect(plan.apresLancement).toHaveBeenCalledWith('s1', null, expect.objectContaining({ dsps: expect.any(Array), socials: expect.any(Array) }));
    expect(notifs.notifications()[0]).toMatchObject({ variante: 'success', titre: 'Campagne créée' });
    expect(el.querySelector('[data-titre-lance]')!.textContent!.trim()).toBe('✓ Campagne créée');
    expect(el.querySelector('[data-message-lancement]')!.textContent!.replace(/\s/g, ' ')).toBe('12 CP au plan, dont 11 retenus · 90 % du plan en zone · 75,0 % d’utile · 2 500 000 impressions prévues');
    el.querySelector<HTMLButtonElement>('[data-vers-activation]')!.click();
    expect(parcours.choisir).toHaveBeenCalledWith('activation');
    // « Modifier et relancer » (relecture 3, M4) : retour au récapitulatif, le bouton de lancement est rendu.
    el.querySelector<HTMLButtonElement>('[data-relancer]')!.click();
    await stable();
    expect(el.querySelector('[data-lance]')).toBeNull();
    expect(el.querySelector<HTMLButtonElement>('[data-lancer]')!.disabled).toBe(false);
  });

  it('échec de rattacher : notification au message de la route, ni PATCH ni PUT, rien de jeté', async () => {
    const { el, plan, appels, notifs, stable } = monter(PRET, {
      rattacher: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'Ce jeu de zones ne couvre aucun code postal.' } }))),
    });
    await stable();
    el.querySelector<HTMLButtonElement>('[data-lancer]')!.click();
    await stable();
    expect(appels.modifierStrategie).not.toHaveBeenCalled();
    expect(appels.ecrireCanaux).not.toHaveBeenCalled();
    expect(plan.apresLancement).not.toHaveBeenCalled();
    expect(notifs.notifications()[0]).toMatchObject({ variante: 'error', titre: 'Rattachement impossible', message: 'Ce jeu de zones ne couvre aucun code postal.' });
    expect(el.querySelector('[data-echec-lancement]')!.textContent!.trim()).toBe('Rattachement impossible. Ce jeu de zones ne couvre aucun code postal.');
    expect(el.querySelector<HTMLButtonElement>('[data-lancer]')!.disabled).toBe(false);
  });

  it('campagne déjà lancée (Modification) : « Mettre à jour le plan → » puis « ✓ Plan mis à jour » (revue finale, V-5)', async () => {
    const { el, plan, notifs, stable } = monter();
    plan.strategieExistante.set({ id: 's0', statut: 'active' });
    await stable();
    const bouton = el.querySelector<HTMLButtonElement>('[data-lancer]')!;
    expect(bouton.textContent!.trim()).toBe('Mettre à jour le plan →');
    bouton.click();
    await stable();
    expect(el.querySelector('[data-titre-lance]')!.textContent!.trim()).toBe('✓ Plan mis à jour');
    expect(notifs.notifications()[0]).toMatchObject({ variante: 'success', titre: 'Plan mis à jour' });
  });

  it('échec APRÈS rattacher : la stratégie écrite devient l’existante, rien n’est jeté (revue finale, m3)', async () => {
    const { el, plan, stable } = monter(PRET, {
      modifierStrategie: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'invalid_body' } }))),
    });
    await stable();
    el.querySelector<HTMLButtonElement>('[data-lancer]')!.click();
    await stable();
    expect(plan.poserStrategie).toHaveBeenCalledWith(CAMPAGNE_A, 's1');
    expect(plan.apresLancement).not.toHaveBeenCalled();
    expect(plan.jeterBrouillonsDe).not.toHaveBeenCalled();
    expect(el.querySelector('[data-echec-lancement]')!.textContent!.trim()).toBe('Budget et période non enregistrés. Le serveur a refusé les valeurs envoyées.');
  });

  it('en cours : « Création… », un second clic ne relance pas', async () => {
    const enVol = new Subject<PlanRattache>();
    const { el, appels, stable } = monter(PRET, { rattacher: vi.fn(() => enVol) });
    await stable();
    el.querySelector<HTMLButtonElement>('[data-lancer]')!.click();
    await stable();
    const bouton = el.querySelector<HTMLButtonElement>('[data-lancer]')!;
    expect(bouton.textContent!.trim()).toBe('Création…');
    bouton.click();
    expect(appels.rattacher).toHaveBeenCalledTimes(1);
  });

  it('lancement de A en vol, B ouverte : bouton inactif, sans « Création… », le motif est dit (revue finale)', async () => {
    const enVol = new Subject<PlanRattache>();
    const { el, plan, stable } = monter(PRET, { rattacher: vi.fn(() => enVol) });
    await stable();
    el.querySelector<HTMLButtonElement>('[data-lancer]')!.click();
    plan.campagne.set('7c9e6679-7425-40de-944b-e07fc1f90ae7');
    await stable();
    const bouton = el.querySelector<HTMLButtonElement>('[data-lancer]')!;
    expect(bouton.disabled).toBe(true);
    expect(bouton.textContent!.trim()).toBe('Créer la campagne →');
    expect(el.querySelector('[data-motifs]')!.textContent).toContain('Un lancement est en cours sur une autre campagne.');
  });

  it('une réponse revenue après un changement de campagne n’écrit rien dans la nouvelle ; son brouillon serveur est jeté', async () => {
    const enVol = new Subject<PlanRattache>();
    const { el, plan, stable } = monter(PRET, { rattacher: vi.fn(() => enVol) });
    await stable();
    el.querySelector<HTMLButtonElement>('[data-lancer]')!.click();
    plan.campagne.set('7c9e6679-7425-40de-944b-e07fc1f90ae7');
    enVol.next(RATTACHE);
    enVol.complete();
    await stable();
    expect(plan.apresLancement).not.toHaveBeenCalled();
    expect(el.querySelector('[data-lance]')).toBeNull();
    // Le seul chemin (F-6) : PlanCampagneService.jeterBrouillonsDe, éprouvé par son spec.
    expect(plan.jeterBrouillonsDe).toHaveBeenCalledWith(CAMPAGNE_A);
    // De retour sur sa campagne : l'issue est toujours là.
    plan.campagne.set(CAMPAGNE_A);
    await stable();
    expect(el.querySelector('[data-lance]')).not.toBeNull();
  });

  it('pied DÉTRUIT après rattacher (autre campagne, autre étape) : le PATCH et le PUT partent quand même (relecture 3, I1)', async () => {
    const enVol = new Subject<PlanRattache>();
    const { fixture, el, plan, appels, notifs, stable } = monter(PRET, { rattacher: vi.fn(() => enVol) });
    await stable();
    el.querySelector<HTMLButtonElement>('[data-lancer]')!.click();
    fixture.destroy();
    enVol.next(RATTACHE);
    enVol.complete();
    expect(appels.modifierStrategie).toHaveBeenCalledWith('s1', expect.objectContaining({ kpi_target: 2500000 }));
    expect(appels.ecrireCanaux).toHaveBeenCalledTimes(1);
    // Les canaux ÉCRITS repartent au plan (relecture 2 du lot 7, I-2).
    expect(plan.apresLancement).toHaveBeenCalledWith('s1', null, expect.objectContaining({ dsps: expect.any(Array), socials: expect.any(Array) }));
    expect(notifs.notifications()[0]).toMatchObject({ variante: 'success', titre: 'Campagne créée' });
    expect(TestBed.inject(LancementCampagneService).etat()).toMatchObject({ campagne: CAMPAGNE_A, statut: 'reussi' });
  });
});
