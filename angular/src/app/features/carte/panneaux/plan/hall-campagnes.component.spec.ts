import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { type CampagneListe, PlanApi } from '../../data/plan.api';
import { MESSAGE_RESERVE_ADMIN, PlanCampagneService } from '../../etat/plan-campagne.service';
import { CAMPAGNE_A, CAMPAGNE_B, planFactice } from '../../testing/plan-factice';
import { HallCampagnesComponent } from './hall-campagnes.component';

const C3 = '16fd2706-8baf-433b-82eb-8c7fada847da';
const camp = (id: string, name: string, dsp_source = 'magelian') => ({ id, name, dsp_source } as CampagneListe);

/** jsdom n'implémente ni `showModal` ni `close` : doublures (patron de `confirmation.component.spec.ts`). */
beforeEach(() => {
  const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  const close = vi.fn(function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: showModal, configurable: true, writable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: close, configurable: true, writable: true });
});

function apiFactice(o: Partial<Record<string, unknown>> = {}) {
  return {
    // A : coquille sans stratégie (brouillon) ; B : coquille AVEC stratégie (lancée) ; C3 : import DSP avec stratégie.
    campagnes: vi.fn(() => of([camp(CAMPAGNE_A, 'Rentrée'), camp(CAMPAGNE_B, 'Noël'), camp(C3, 'Import Adform', 'adform')])),
    strategies: vi.fn(() => of({ strategies: [{ campaign_id: CAMPAGNE_B }, { campaign_id: C3 }] })),
    brouillons: vi.fn(() => of({ drafts: [{ campaign_id: CAMPAGNE_A, last_saved_at: '2026-10-24T09:00:00Z' }] })),
    modeDemo: vi.fn(() => of({ demo_mode: false, can_toggle: true })),
    basculerModeDemo: vi.fn(() => of({ demo_mode: true })),
    supprimerCampagne: vi.fn(() => of({ success: true, deleted: 1 })),
    ...o,
  };
}

async function monter(api = apiFactice()) {
  const plan = planFactice();
  TestBed.configureTestingModule({ providers: [{ provide: PlanCampagneService, useValue: plan }, { provide: PlanApi, useValue: api }] });
  const fixture = TestBed.createComponent(HallCampagnesComponent);
  await fixture.whenStable();
  return { el: fixture.nativeElement as HTMLElement, plan, api, stable: () => fixture.whenStable() };
}

describe('HallCampagnesComponent — le hall de ⑥ (port de CreationHall)', () => {
  it('trois blocs : « Nouvelle campagne », « Reprendre une création » (coquille sans stratégie, badge brouillon), « Modifier une campagne lancée »', async () => {
    const { el, api } = await monter();
    // Lectures dans l'ordre, chacune après la précédente : stratégies et brouillons de TOUT l'espace (sans campagne).
    expect(api.strategies).toHaveBeenCalledWith();
    expect(api.brouillons).toHaveBeenCalledWith();
    expect(el.querySelector('[data-nouvelle-campagne]')!.textContent!.trim()).toBe('Nouvelle campagne');
    expect([...el.querySelectorAll('[data-coquille]')].map((r) => r.getAttribute('data-coquille'))).toEqual([CAMPAGNE_A]);
    expect(el.querySelector('[data-badge-brouillon]')!.textContent!.trim()).toBe(`brouillon · ${new Date('2026-10-24T09:00:00Z').toLocaleDateString('fr-FR')}`);
    expect([...el.querySelectorAll('[data-lancee]')].map((r) => r.getAttribute('data-lancee'))).toEqual([CAMPAGNE_B, C3]);
    expect(el.textContent).toContain('Reprendre une création');
    expect(el.textContent).toContain('Modifier une campagne lancée');
  });

  it('la chaîne est SÉQUENTIELLE : les stratégies attendent les campagnes', async () => {
    const campagnes = new Subject<CampagneListe[]>();
    const api = apiFactice({ campagnes: vi.fn(() => campagnes) });
    await monter(api);
    expect(api.strategies).not.toHaveBeenCalled();
    campagnes.next([]);
    expect(api.strategies).toHaveBeenCalledTimes(1);
  });

  it('reprendre ou modifier ouvre la campagne par le service', async () => {
    const { el, plan } = await monter();
    el.querySelector<HTMLButtonElement>(`[data-coquille="${CAMPAGNE_A}"] button`)!.click();
    expect(plan.choisirCampagne).toHaveBeenCalledWith(CAMPAGNE_A);
    el.querySelector<HTMLButtonElement>(`[data-lancee="${CAMPAGNE_B}"] [data-modifier]`)!.click();
    expect(plan.choisirCampagne).toHaveBeenCalledWith(CAMPAGNE_B);
  });

  it('supprimer une coquille : confirmation, DELETE, ligne retirée sans relire', async () => {
    const { el, api, stable } = await monter();
    el.querySelector<HTMLButtonElement>(`[data-coquille="${CAMPAGNE_A}"] [data-supprimer]`)!.click();
    await stable();
    expect(el.querySelector('mg-confirmation')!.textContent).toContain('« Rentrée » et son brouillon seront supprimés — action irréversible.');
    expect(api.supprimerCampagne).not.toHaveBeenCalled();
    el.querySelector<HTMLButtonElement>('mg-confirmation .confirmer')!.click();
    await stable();
    expect(api.supprimerCampagne).toHaveBeenCalledWith(CAMPAGNE_A);
    expect(el.querySelector('[data-coquille]')).toBeNull();
    expect(api.campagnes).toHaveBeenCalledTimes(1);
  });

  it('« Nouvelle campagne » passe par le service ; un refus est DIT', async () => {
    const { el, plan, stable } = await monter();
    plan.creerCampagne.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    el.querySelector<HTMLButtonElement>('[data-nouvelle-campagne]')!.click();
    await stable();
    expect(plan.creerCampagne).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-erreur-hall]')!.textContent!.trim()).toBe(MESSAGE_RESERVE_ADMIN);
  });

  it('liste refusée (403) : le message des administrateurs, aucun bloc', async () => {
    const { el } = await monter(apiFactice({ campagnes: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 403 }))) }));
    expect(el.querySelector('[data-erreur-hall]')!.textContent!.trim()).toBe(MESSAGE_RESERVE_ADMIN);
    expect(el.querySelector('[data-coquille], [data-lancee]')).toBeNull();
  });

  it('stratégies et brouillons illisibles : best-effort, les coquilles restent listées sans badge', async () => {
    const { el } = await monter(apiFactice({
      strategies: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
      brouillons: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
    }));
    expect(el.querySelectorAll('[data-coquille]')).toHaveLength(2);
    expect(el.querySelector('[data-badge-brouillon]')).toBeNull();
    expect(el.querySelector('[data-erreur-hall]')).toBeNull();
  });

  it('mode démo (A-7) : visible si basculable, optimiste, retour arrière sur refus', async () => {
    const reponse = new Subject<{ demo_mode: boolean }>();
    const api = apiFactice({ basculerModeDemo: vi.fn(() => reponse) });
    const { el, stable } = await monter(api);
    const caseDemo = el.querySelector<HTMLInputElement>('[data-mode-demo] input')!;
    caseDemo.click();
    await stable();
    expect(api.basculerModeDemo).toHaveBeenCalledWith(true);
    expect(caseDemo.checked).toBe(true);
    reponse.error(new HttpErrorResponse({ status: 500 }));
    await stable();
    expect(caseDemo.checked).toBe(false);
    const sans = await (async () => { TestBed.resetTestingModule(); return monter(apiFactice({ modeDemo: vi.fn(() => NEVER) })); })();
    expect(sans.el.querySelector('[data-mode-demo]')).toBeNull();
  });
});
