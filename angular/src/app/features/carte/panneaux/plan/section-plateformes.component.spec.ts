import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NEVER } from 'rxjs';
import type { ExtractionJeu } from '../../data/jeux.api';
import { type CanauxCampagne, PlanApi } from '../../data/plan.api';
import { PlanCampagneService } from '../../etat/plan-campagne.service';
import { DEFAULT_PROG_DRAFT, type ProgDraft } from '../../logique/plan/brouillon';
import { CAMPAGNE_A, planFactice } from '../../testing/plan-factice';
import { SectionPlateformesComponent } from './section-plateformes.component';

const CANAUX: CanauxCampagne = {
  catalog: [
    { code: 'dv360', label: 'Google DV360', category: 'dsp', connection_provider: 'dv360', active: true,
      link_levels: [{ key: 'advertiser', label: 'Annonceur' }, { key: 'campaign', label: 'Campagne' }, { key: 'insertion_order', label: 'Insertion order' }] },
    { code: 'ttd', label: 'The Trade Desk', category: 'dsp', connection_provider: null, active: true, link_levels: [{ key: 'advertiser', label: 'Annonceur' }] },
    { code: 'meta', label: 'Meta', category: 'social', connection_provider: 'meta', active: true },
    { code: 'adform', label: 'Adform', category: 'adserver', connection_provider: null, active: true },
  ],
  connectedProviders: [], is_demo: true, selected: { dsps: [], socials: [], ad_server: null },
};

@Component({
  selector: 'mg-hote-plateformes',
  imports: [SectionPlateformesComponent],
  template: '<mg-section-plateformes [(confirmation)]="confirmation" />',
})
class Hote { readonly confirmation = signal<string | null>(null); }

async function monter(brouillon: Partial<ProgDraft> = {}, extraction: ExtractionJeu | null = null) {
  const plan = planFactice();
  plan.campagne.set(CAMPAGNE_A);
  plan.prerempli.set(true);
  plan.canaux.set(CANAUX);
  plan.brouillon.set({ ...DEFAULT_PROG_DRAFT, ...brouillon });
  plan.extraction.set(extraction);
  TestBed.configureTestingModule({
    providers: [{ provide: PlanCampagneService, useValue: plan }, { provide: PlanApi, useValue: { ressourcesDv360: () => NEVER } }],
  });
  const fixture = TestBed.createComponent(Hote);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const stable = () => fixture.whenStable();
  const saisir = async (sel: string, v: string) => {
    const i = el.querySelector<HTMLInputElement>(sel)!;
    i.value = v;
    i.dispatchEvent(new Event('input'));
    await stable();
  };
  return { el, plan, hote: fixture.componentInstance, stable, saisir };
}

describe('SectionPlateformesComponent — plateformes, budgets, liaisons, période (T5)', () => {
  it('DSP et réseaux disponibles, sans ad server (hors V1) ; badges démo', async () => {
    const { el } = await monter();
    expect([...el.querySelectorAll('[data-plateforme]')].map((r) => r.getAttribute('data-plateforme'))).toEqual(['dv360', 'ttd', 'meta']);
    expect(el.textContent).not.toContain('Adform');
    expect(el.textContent).not.toContain('Ad server');
    expect(el.querySelector('[data-plateforme="ttd"]')!.textContent).toContain('démo');
  });

  it('cocher une plateforme : ligne de budget, budget global = somme, accordéon de liaison', async () => {
    const { el, plan, stable, saisir } = await monter();
    el.querySelector<HTMLElement>('[data-plateforme="dv360"]')!.click();
    await stable();
    expect(plan.brouillon().channels.dsps).toEqual(['dv360']);
    expect(el.querySelector('[data-plateforme="dv360"]')!.getAttribute('aria-checked')).toBe('true');
    expect(el.querySelector('mg-liaison-canal[data-liaison-canal="dv360"]')).not.toBeNull();
    el.querySelector<HTMLElement>('[data-plateforme="meta"]')!.click();
    await stable();
    await saisir('[data-plateforme="dv360"] [data-budget]', '1000');
    await saisir('[data-plateforme="meta"] [data-budget]', '500');
    expect(plan.brouillon().channelBudgets).toEqual({ dv360: 1000, meta: 500 });
    expect(el.querySelector('[data-budget-global]')!.textContent!.replace(/\s/g, ' ').trim()).toBe('1 500 €');
  });

  it('taper dans le budget ne décoche pas la plateforme', async () => {
    const { el, plan, stable } = await monter({ channels: { dsps: ['dv360'], socials: [], ad_server: null } });
    el.querySelector<HTMLInputElement>('[data-plateforme="dv360"] [data-budget]')!.click();
    await stable();
    expect(plan.brouillon().channels.dsps).toEqual(['dv360']);
  });

  it('décocher une plateforme retire son budget ET son CPM prévu', async () => {
    const { el, plan, stable } = await monter({
      channels: { dsps: ['dv360', 'ttd'], socials: [], ad_server: null },
      channelBudgets: { dv360: 1000, ttd: 200 }, cpmPrevus: { dv360: 4, ttd: 2 },
    });
    el.querySelector<HTMLElement>('[data-plateforme="dv360"]')!.click();
    await stable();
    expect(plan.brouillon().channels.dsps).toEqual(['ttd']);
    expect(plan.brouillon().channelBudgets).toEqual({ ttd: 200 });
    expect(plan.brouillon().cpmPrevus).toEqual({ ttd: 2 });
  });

  it('coche « Je confirme ces liaisons » : posée sur l’empreinte, réinitialisée quand la sélection change', async () => {
    const { el, hote, stable } = await monter({ channels: { dsps: ['ttd'], socials: [], ad_server: null } });
    const coche = () => el.querySelector<HTMLInputElement>('[data-confirmer-liaisons]')!;
    coche().click();
    await stable();
    expect(hote.confirmation()).not.toBeNull();
    expect(coche().checked).toBe(true);
    el.querySelector<HTMLElement>('[data-plateforme="meta"]')!.click();
    await stable();
    expect(coche().checked).toBe(false);
  });

  it('période : début et fin écrits au brouillon', async () => {
    const { plan, saisir } = await monter();
    await saisir('[data-debut]', '2026-11-01');
    await saisir('[data-fin]', '2026-11-30');
    expect(plan.brouillon()).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-30' });
  });

  it('A-5 : maille et taux d’utile de l’extraction en face de chaque plateforme ; une plateforme sans canal est dite', async () => {
    const x = {
      id: 'x', version: 1, plateformes: [
        { plateforme: 'dv360', maille: 'cp', seuil: 30, rayon_m: null, n_unites: 87, taux_utile: 76.4 },
        { plateforme: 'tiktok', maille: 'commune', seuil: 20, rayon_m: null, n_unites: 12, exacte: true },
      ],
    } as ExtractionJeu;
    const { el } = await monter({ channels: { dsps: ['dv360'], socials: [], ad_server: null } }, x);
    expect(el.querySelector('[data-plateforme="dv360"] [data-maille-extraction]')!.textContent!.trim()).toBe('Extraction : 87 codes postaux · 76,4 % d’utile');
    expect(el.querySelector('[data-plateforme="meta"] [data-maille-extraction]')).toBeNull();
    expect(el.querySelector('[data-hors-catalogue]')!.textContent).toContain('Non reliées à un canal : TikTok.');
  });

  it('aucun canal disponible : le message de React', async () => {
    const { el, plan, stable } = await monter();
    plan.canaux.set({ ...CANAUX, catalog: [], is_demo: false });
    await stable();
    expect(el.querySelector('[data-aucun-canal]')!.textContent!.trim())
      .toBe('Aucun canal connecté. Configure une connexion dans Administration → Système → Connexions API.');
  });
});
