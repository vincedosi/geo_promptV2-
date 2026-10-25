import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ExtractionJeu } from '../../data/jeux.api';
import type { CanauxCampagne } from '../../data/plan.api';
import { PlanCampagneService } from '../../etat/plan-campagne.service';
import { DEFAULT_PROG_DRAFT, type ProgDraft } from '../../logique/plan/brouillon';
import { CAMPAGNE_A, planFactice } from '../../testing/plan-factice';
import { BandeauPlanComponent, LIGNES_CP_VISIBLES, SectionImpressionsComponent } from './section-impressions.component';

const J = '16fd2706-8baf-433b-82eb-8c7fada847da';
const CANAUX: CanauxCampagne = {
  catalog: [
    { code: 'dv360', label: 'Google DV360', category: 'dsp', connection_provider: null, active: true },
    { code: 'meta', label: 'Meta', category: 'social', connection_provider: null, active: true },
  ],
  connectedProviders: [], is_demo: true, selected: { dsps: [], socials: [], ad_server: null },
};
const EXTRACTION = {
  id: 'x1', version: 3, n_retenus: 100, plateformes: [
    { plateforme: 'dv360', maille: 'cp', seuil: 30, rayon_m: null, n_unites: 120, taux_utile: 80 },
    { plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 5000, n_unites: 4, taux_utile: 60 },
  ],
} as ExtractionJeu;
const PLAN: Partial<ProgDraft> = {
  jeuZones: { id: J, nom: 'Rentrée', version: 2, extraction: { id: 'x1', version: 3 } },
  channels: { dsps: ['dv360'], socials: ['meta'], ad_server: null },
  channelBudgets: { dv360: 10000, meta: 3000 },
  cpmPrevus: { dv360: 4 },
};

async function monter<T>(composant: Type<T>, brouillon: Partial<ProgDraft> = PLAN) {
  const plan = planFactice();
  plan.campagne.set(CAMPAGNE_A);
  plan.prerempli.set(true);
  plan.canaux.set(CANAUX);
  plan.brouillon.set({ ...DEFAULT_PROG_DRAFT, ...brouillon });
  plan.extraction.set(EXTRACTION);
  TestBed.configureTestingModule({ providers: [{ provide: PlanCampagneService, useValue: plan }] });
  const fixture = TestBed.createComponent(composant);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const texte = (sel: string) => el.querySelector(sel)!.textContent!.replace(/\s+/g, ' ').trim();
  return { el, plan, stable: () => fixture.whenStable(), texte };
}

describe('SectionImpressionsComponent — impressions prévues (T5, A-10, A-11)', () => {
  it('impressions = budget ÷ CPM × 1 000, par plateforme ; maille et unités de l’extraction', async () => {
    const { texte } = await monter(SectionImpressionsComponent);
    expect(texte('[data-prevision="dv360"] [data-impressions-ligne]')).toBe('2 500 000');
    expect(texte('[data-prevision="dv360"] [data-budget-ligne]')).toBe('10 000 €');
    expect(texte('[data-prevision="dv360"] [data-maille]')).toBe('120 codes postaux');
    expect(texte('[data-prevision="meta"] [data-maille]')).toBe('4 cercles');
  });

  it('CPM manquant : pas d’impressions pour la plateforme, et elle est nommée', async () => {
    const { el, texte } = await monter(SectionImpressionsComponent);
    expect(texte('[data-prevision="meta"] [data-impressions-ligne]')).toBe('—');
    expect(texte('[data-cpm-manquant]')).toBe('CPM prévu manquant : Meta');
    expect(el.querySelector('[data-prevision="meta"] [data-voir-cp]')).toBeNull();
  });

  it('saisir un CPM le pose au brouillon ; le total suit (budget, impressions, CPM moyen pondéré)', async () => {
    const { el, plan, stable, texte } = await monter(SectionImpressionsComponent);
    const cpm = el.querySelector<HTMLInputElement>('[data-prevision="meta"] [data-cpm]')!;
    cpm.value = '6';
    cpm.dispatchEvent(new Event('input'));
    await stable();
    expect(plan.brouillon().cpmPrevus).toEqual({ dv360: 4, meta: 6 });
    expect(texte('[data-prevision="meta"] [data-impressions-ligne]')).toBe('500 000');
    expect(texte('[data-total-budget]')).toBe('13 000 €');
    expect(texte('[data-total-impressions]')).toBe('3 000 000');
    // 13 000 € ÷ 3 000 000 × 1 000 = 4,333… → 4,33 €
    expect(texte('[data-total-cpm]')).toBe('4,33 €');
    expect(el.querySelector('[data-cpm-manquant]')).toBeNull();
  });

  it('« Voir par CP » lit les CP de la plateforme au clic ; la répartition retombe EXACTEMENT sur le total', async () => {
    const { el, plan, stable } = await monter(SectionImpressionsComponent, { ...PLAN, channelBudgets: { dv360: 100, meta: 3000 }, cpmPrevus: { dv360: 3 } });
    el.querySelector<HTMLButtonElement>('[data-prevision="dv360"] [data-voir-cp]')!.click();
    await stable();
    expect(plan.chargerCp).toHaveBeenCalledWith(J, 3, 'dv360');
    // 100 ÷ 3 × 1 000 = 33 333 impressions, réparties sur les poids 2, 1, 1 : 16 666,5 · 8 333,25 · 8 333,25.
    plan.cps.set(new Map([[`${J}|3|dv360`, { cp: [
      { code_postal: '69001', multiplicateur: 2 }, { code_postal: '69002', multiplicateur: 1 }, { code_postal: '69003', multiplicateur: 1 },
    ], total: 3 }]]));
    await stable();
    const cellules = [...el.querySelectorAll('[data-tableau-cp="dv360"] tbody tr')].map((tr) => Number(tr.lastElementChild!.textContent!.replace(/\s/g, '')));
    expect(cellules.reduce((s, v) => s + v, 0)).toBe(33333);
    expect(cellules).toEqual([16667, 8333, 8333]);
  });

  it('jeu RISQUE (sans résumé par plateforme) : chaque plateforme au CP, « Voir par CP » sur le plan entier (V-7)', async () => {
    const { el, plan, stable, texte } = await monter(SectionImpressionsComponent, { ...PLAN, cpmPrevus: { dv360: 4, meta: 6 } });
    plan.extraction.set({ ...EXTRACTION, n_retenus: 87, taux_utile: 70, plateformes: null } as ExtractionJeu);
    await stable();
    expect(texte('[data-prevision="dv360"] [data-maille]')).toBe('87 codes postaux');
    expect(texte('[data-prevision="meta"] [data-maille]')).toBe('87 codes postaux');
    el.querySelector<HTMLButtonElement>('[data-prevision="meta"] [data-voir-cp]')!.click();
    await stable();
    expect(plan.chargerCp).toHaveBeenCalledWith(J, 3, undefined);
  });

  it(`plus de ${LIGNES_CP_VISIBLES} CP : ${LIGNES_CP_VISIBLES} lignes, puis « Voir tout »`, async () => {
    const { el, plan, stable } = await monter(SectionImpressionsComponent);
    el.querySelector<HTMLButtonElement>('[data-prevision="dv360"] [data-voir-cp]')!.click();
    const cp = Array.from({ length: 60 }, (_, i) => ({ code_postal: String(69000 + i), multiplicateur: 1 }));
    plan.cps.set(new Map([[`${J}|3|dv360`, { cp, total: 60 }]]));
    await stable();
    expect(el.querySelectorAll('[data-tableau-cp="dv360"] tbody tr')).toHaveLength(LIGNES_CP_VISIBLES);
    el.querySelector<HTMLButtonElement>('[data-voir-tout]')!.click();
    await stable();
    expect(el.querySelectorAll('[data-tableau-cp="dv360"] tbody tr')).toHaveLength(60);
  });
});

describe('BandeauPlanComponent — le bandeau de l’étape', () => {
  it('budget, impressions, CPM moyen, plateformes ; CP au plan lus une fois pour l’extraction', async () => {
    const { el, plan, stable } = await monter(BandeauPlanComponent);
    const kpi = (k: string) => el.querySelector(`[data-kpi="${k}"] [data-role="valeur"]`)!.textContent!.replace(/\s+/g, ' ').trim();
    expect(kpi('budget')).toBe('13 000 €');
    expect(kpi('impressions')).toBe('2 500 000');
    expect(kpi('cpm')).toBe('4,00 €');
    expect(kpi('plateformes')).toBe('2');
    expect(plan.chargerCp).toHaveBeenCalledWith(J, 3);
    expect(kpi('cp')).toBe('—');
    plan.cps.set(new Map([[`${J}|3|`, { cp: [], total: 1234 }]]));
    await stable();
    expect(kpi('cp')).toBe('1 234');
    // V-4 : « dont M retenus » sous le nombre de CP au plan.
    expect(el.querySelector('[data-kpi="cp"]')!.textContent!.replace(/\s+/g, ' ')).toContain('dont 100 retenus');
  });
});
