import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NEVER } from 'rxjs';
import { PlanApi } from '../../data/plan.api';
import { DEFAULT_PROG_DRAFT } from '../../logique/plan/brouillon';
import type { ResolvedChannel } from '../../logique/plan/canaux';
import type { PlatformLinks } from '../../logique/plan/liens-plateformes';
import { CAMPAGNE_A } from '../../testing/plan-factice';
import { LiaisonCanalComponent } from './liaison-canal.component';
import { RecapCanauxComponent } from './recap-canaux.component';

const NIVEAUX = [{ key: 'advertiser', label: 'Annonceur' }, { key: 'campaign', label: 'Campagne' }];
const canal = (o: Partial<ResolvedChannel> = {}): ResolvedChannel => ({
  code: 'ttd', label: 'The Trade Desk', category: 'dsp', connection_provider: null, active: true, link_levels: NIVEAUX,
  available: true, connected: false, ...o,
});

@Component({
  selector: 'mg-hote-liaison',
  imports: [LiaisonCanalComponent],
  template: '<mg-liaison-canal [canal]="canal()" [campagne]="campagne" [liens]="liens()" (changement)="liens.set($event)" />',
})
class Hote {
  readonly campagne = CAMPAGNE_A;
  readonly canal = signal(canal());
  readonly liens = signal<PlatformLinks | undefined>(undefined);
}

async function monter() {
  TestBed.configureTestingModule({ providers: [{ provide: PlanApi, useValue: { ressourcesDv360: () => NEVER } }] });
  const fixture = TestBed.createComponent(Hote);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  return { el, hote: fixture.componentInstance, stable: () => fixture.whenStable() };
}

describe('LiaisonCanalComponent — accordéon de liaison (T5)', () => {
  it('replié : « non liée » ; déplié sans connexion : la saisie manuelle, qui écrit `${key}_id` / `_name`', async () => {
    const { el, hote, stable } = await monter();
    expect(el.querySelector('[data-statut-liaison]')!.textContent!.trim()).toBe('non liée');
    expect(el.querySelector('mg-liaison-manuelle')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-bascule-liaison]')!.click();
    await stable();
    const id = el.querySelector<HTMLInputElement>('[data-id="advertiser"]')!;
    id.value = '42';
    id.dispatchEvent(new Event('input'));
    await stable();
    expect(hote.liens()).toEqual({ advertiser_id: '42' });
    expect(el.querySelector('[data-statut-liaison]')!.textContent!.trim()).toBe('liaison partielle · 42');
    const id2 = el.querySelector<HTMLInputElement>('[data-id="campaign"]')!;
    id2.value = '7';
    id2.dispatchEvent(new Event('input'));
    await stable();
    expect(el.querySelector('[data-statut-liaison]')!.textContent!.trim()).toBe('✓ liée · 42 → 7');
    expect(el.querySelector('mg-liaison-manuelle [data-etat-liaison]')!.textContent!.trim()).toBe('✓ renseignée');
  });

  it('DV360 connecté : la cascade API plutôt que la saisie', async () => {
    const { el, hote, stable } = await monter();
    hote.canal.set(canal({ code: 'dv360', label: 'DV360', connection_provider: 'dv360', connected: true }));
    el.querySelector<HTMLButtonElement>('[data-bascule-liaison]')!.click();
    await stable();
    expect(el.querySelector('mg-liaison-dv360')).not.toBeNull();
    expect(el.querySelector('mg-liaison-manuelle')).toBeNull();
  });
});

describe('RecapCanauxComponent — le câblage (T5)', () => {
  it('nœud nom · annonceur, branches DSP et Social, sans « Mesure » (ad server hors V1)', async () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(RecapCanauxComponent);
    fixture.componentRef.setInput('brouillon', {
      ...DEFAULT_PROG_DRAFT, name: 'Rentrée', advertiser: 'Marque',
      channels: { dsps: ['ttd'], socials: ['meta'], ad_server: 'adform' },
      channelLinks: { ttd: { advertiser_id: '1', campaign_id: '2' } },
    });
    fixture.componentRef.setInput('catalogue', [canal(), canal({ code: 'meta', label: 'Meta', category: 'social', link_levels: [] })]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-noeud-nom]')!.textContent!.trim()).toBe('Rentrée');
    expect([...el.querySelectorAll('[data-branche]')].map((b) => b.getAttribute('data-branche'))).toEqual(['DSP', 'Social']);
    expect(el.querySelector('[data-ligne-recap="ttd"]')!.textContent).toContain('✓ liée · 1 → 2');
    expect(el.querySelector('[data-ligne-recap="meta"]')!.textContent).toContain('— non liée');
  });
});
