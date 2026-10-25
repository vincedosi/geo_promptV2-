import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { PlanApi, type RessourcesDv360 } from '../../data/plan.api';
import type { PlatformLinks } from '../../logique/plan/liens-plateformes';
import { CAMPAGNE_A } from '../../testing/plan-factice';
import { LiaisonDv360Component, messageDv360 } from './liaison-dv360.component';

@Component({
  selector: 'mg-hote-dv360',
  imports: [LiaisonDv360Component],
  template: '<mg-liaison-dv360 [campagne]="campagne" [liens]="liens()" (changement)="liens.set($event)" />',
})
class Hote {
  readonly campagne = CAMPAGNE_A;
  readonly liens = signal<PlatformLinks | undefined>(undefined);
}

const niveau = (level: RessourcesDv360['level'], items: Array<{ id: string; name: string }>) => of({ level, items });

async function monter(ios: Array<{ id: string; name: string }> = [{ id: 'io1', name: 'IO unique' }]) {
  const ressourcesDv360 = vi.fn((_c: string, a?: string, k?: string) => (
    !a ? niveau('advertisers', [{ id: 'a1', name: 'Annonceur 1' }])
      : !k ? niveau('campaigns', [{ id: 'k1', name: 'Campagne 1' }])
        : niveau('insertion_orders', ios)));
  TestBed.configureTestingModule({ providers: [{ provide: PlanApi, useValue: { ressourcesDv360 } }] });
  const fixture = TestBed.createComponent(Hote);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const choisir = async (niv: string, v: string) => {
    const s = el.querySelector<HTMLSelectElement>(`[data-niveau="${niv}"]`)!;
    s.value = v;
    s.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  };
  return { el, hote: fixture.componentInstance, ressourcesDv360, choisir };
}

describe('LiaisonDv360Component — cascade annonceur → campagne → insertion order (T5)', () => {
  it('annonceurs au montage ; chaque niveau lit le suivant ; un seul IO est présélectionné', async () => {
    const { el, hote, ressourcesDv360, choisir } = await monter();
    expect(ressourcesDv360).toHaveBeenCalledWith(CAMPAGNE_A);
    expect(el.querySelector<HTMLSelectElement>('[data-niveau="campaign"]')!.disabled).toBe(true);
    await choisir('advertiser', 'a1');
    expect(hote.liens()).toEqual({ advertiser_id: 'a1', advertiser_name: 'Annonceur 1' });
    expect(ressourcesDv360).toHaveBeenLastCalledWith(CAMPAGNE_A, 'a1');
    await choisir('campaign', 'k1');
    expect(ressourcesDv360).toHaveBeenLastCalledWith(CAMPAGNE_A, 'a1', 'k1');
    expect(hote.liens()).toMatchObject({ campaign_id: 'k1', insertion_order_id: 'io1', insertion_order_name: 'IO unique' });
    expect(el.querySelector('[data-etat-liaison]')!.textContent!.trim()).toBe('✓ liée');
  });

  it('changer d’annonceur remet campagne et IO à zéro', async () => {
    const { hote, choisir } = await monter([{ id: 'io1', name: 'A' }, { id: 'io2', name: 'B' }]);
    await choisir('advertiser', 'a1');
    await choisir('campaign', 'k1');
    expect(hote.liens()!['insertion_order_id']).toBeUndefined();
    await choisir('advertiser', '');
    expect(hote.liens()).toEqual({});
  });

  it('connexion absente : le message de React', () => {
    const e = new HttpErrorResponse({ status: 409, error: { error: 'dv360_not_connected' } });
    expect(messageDv360(e)).toBe('DV360 non connecté pour cette organisation (Réglages → Connexions API).');
    expect(messageDv360(new HttpErrorResponse({ status: 502, error: { error: 'dv360_api_error', detail: 'quota' } }))).toBe('quota');
  });

  it('une erreur de lecture est affichée', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PlanApi, useValue: { ressourcesDv360: () => throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'dv360_not_connected' } })) } }],
    });
    const fixture = TestBed.createComponent(Hote);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')!.textContent).toContain('DV360 non connecté');
  });
});
