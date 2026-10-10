import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { ENREGISTRER_FICHIER } from '../../../../core/http/telecharger';
import { ZonesCustomApi } from '../../data/zones-custom.api';
import { ExportZoneService } from '../../etat/export-zone.service';
import { PlanMediaService } from '../../etat/plan-media.service';
import type { LignePlan } from '../../logique/zones/plan-media';
import { PlanMediaComponent } from './plan-media.component';

const E = ' ';
const attendre = () => new Promise((r) => setTimeout(r, 0));

const LIGNES: LignePlan[] = [
  { id: 'z1:p1', name: 'CIRFA Rennes', values: { total: 333_333, '18_24': 30_000 } },
  { id: 'z1:p2', name: 'CIRFA Brest', values: { total: 111_111, '18_24': 10_000 } },
  { id: 'z2', name: 'Zone sans statistiques', values: null },
];
const ZONES = [{ id: 'z1', name: 'CIRFA BRETAGNE' }, { id: 'z2', name: 'Zone sans statistiques' }];

async function monter(api: Partial<Record<keyof ZonesCustomApi, unknown>> = {}) {
  const service = {
    zones: signal(ZONES), lignes: signal(LIGNES), chargement: signal(false),
    totaux: signal<Record<string, number> | null>({ total: 68_000_000, '18_24': 5_000_000 }), ouvert: signal(true),
  };
  const appels = {
    campagnesPlan: vi.fn(() => of({ campaigns: [
      { id: 'c1', name: '[ESSAI lot 4] Campagne', dsp_source: 'magelian', has_plan: false },
      { id: 'c2', name: 'Autre', dsp_source: 'ttd', has_plan: true },
    ] })),
    planMedia: vi.fn(() => of({ plan: null })),
    enregistrerPlan: vi.fn(() => of({ ok: true, plan: { updated_at: '2026-10-10T12:34:00Z' } })),
    detacherPlan: vi.fn(() => of({ ok: true })),
    instantane: vi.fn(() => of({})),
    ...api,
  };
  const exporter = vi.fn(async () => null as string | null);
  const enregistrer = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: PlanMediaService, useValue: service },
      { provide: ZonesCustomApi, useValue: appels },
      { provide: ExportZoneService, useValue: { exporter } },
      { provide: ENREGISTRER_FICHIER, useValue: enregistrer },
    ],
  });
  const fixture = TestBed.createComponent(PlanMediaComponent);
  fixture.componentRef.setInput('haut', 48);
  const el = fixture.nativeElement as HTMLElement;
  const stable = async () => { await attendre(); await fixture.whenStable(); };
  await stable();
  const saisir = async (selecteur: string, valeur: string) => {
    const champ = el.querySelector<HTMLInputElement | HTMLSelectElement>(selecteur)!;
    champ.value = valeur;
    champ.dispatchEvent(new Event(champ.tagName === 'SELECT' ? 'change' : 'input'));
    await stable();
  };
  const cellules = (id: string) => [...el.querySelectorAll(`tr[data-ligne="${id}"] td`)].map((td) => td.textContent?.trim());
  return { fixture, el, service, appels, exporter, enregistrer, stable, saisir, cellules };
}

describe('PlanMediaComponent — panneau et calculs (ZoneMediaPlanPanel.tsx)', () => {
  it('en-tête « Plan média — 2 zones », 600 px à droite sous la barre ; la croix ferme', async () => {
    const { el, fixture, service } = await monter();
    const cadre = el.querySelector<HTMLElement>('[data-plan-media]')!;
    expect(cadre.style.top).toBe('48px');
    expect(cadre.className).toContain('w-[600px]');
    expect(el.querySelector('[data-titre]')!.textContent!.trim()).toBe('Plan média — 2 zones');
    let ferme = false;
    fixture.componentInstance.fermer.subscribe(() => (ferme = true));
    el.querySelector<HTMLButtonElement>('button[title="Fermer"]')!.click();
    expect(ferme).toBe(true);
    expect(service.ouvert()).toBe(true);
  });

  it('budget 10 000 €, CPM 5 € : impressions totales et chaque cellule égales au calcul React', async () => {
    const { el, saisir, cellules } = await monter();
    expect(el.querySelector('[data-impressions]')!.textContent!.trim()).toBe('—');
    await saisir('input[data-budget]', '10000');
    await saisir('input[data-cpm]', '5');
    expect(el.querySelector('[data-impressions]')!.textContent!.trim()).toBe(`2${E}000${E}000`);
    expect(cellules('z1:p1')).toEqual(['CIRFA Rennes', '75,0 %', '0,49 %', `333${E}333`, `1${E}500${E}000`, '4,5×', '23 €', '']);
    expect(cellules('z2')).toEqual(['Zone sans statistiques', '—', '—', 'n/d', '0', '—', '—', '']);
    expect([...el.querySelectorAll('tr[data-total] td')].map((td) => td.textContent?.trim()))
      .toEqual(['Total', '100 %', '0,65 %', `444${E}444`, `2${E}000${E}000`, '4,5×', '23 €', '100 %']);
    expect(el.querySelector<HTMLInputElement>('tr[data-ligne="z1:p1"] input')!.value).toBe('75');
  });

  it('saisir une part ramène les autres à 100 ; « Répartir au prorata » revient au prorata ; changer de cible aussi', async () => {
    const { el, saisir, stable } = await monter();
    expect(el.querySelector('[data-prorata]')).toBeNull();
    await saisir('tr[data-ligne="z1:p1"] input', '50');
    expect(el.querySelector<HTMLInputElement>('tr[data-ligne="z1:p2"] input')!.value).toBe('50');
    el.querySelector<HTMLButtonElement>('[data-prorata]')!.click();
    await stable();
    expect(el.querySelector<HTMLInputElement>('tr[data-ligne="z1:p2"] input')!.value).toBe('25');

    await saisir('tr[data-ligne="z1:p1"] input', '10');
    await saisir('select[data-cible]', '18_24');
    expect(el.querySelector('[data-prorata]')).toBeNull();
    expect(el.querySelector<HTMLInputElement>('tr[data-ligne="z1:p1"] input')!.value).toBe('75');
  });

  it('« Chargement des audiences… » pendant la lecture, ni tableau ni actions', async () => {
    const { el, service, stable } = await monter();
    service.chargement.set(true);
    await stable();
    expect(el.textContent).toContain('Chargement des audiences…');
    expect(el.querySelector('mg-tableau-plan-media')).toBeNull();
    expect(el.querySelector('[data-csv]')).toBeNull();
  });
});

describe('PlanMediaComponent — campagne rattachée', () => {
  it('liste : « ● » devant une campagne qui a déjà un plan ; sans campagne, « Enregistrer » est désactivé', async () => {
    const { el } = await monter();
    const options = [...el.querySelectorAll('select[data-campagne] option')].map((o) => o.textContent?.trim());
    expect(options).toEqual(['— Aucune (plan non enregistré) —', '[ESSAI lot 4] Campagne · magelian', '● Autre · ttd']);
    expect(el.querySelector<HTMLButtonElement>('[data-enregistrer]')!.disabled).toBe(true);
  });

  it('choisir une campagne relit son plan : budget, CPM, cible et poids repris (même si la cible change)', async () => {
    const planMedia = vi.fn(() => of({ plan: {
      zones: ZONES, budget: 2000, cpm: 4, cible: '18_24', weights: { 'z1:p1': 40, 'z1:p2': 60, z2: 0 }, updated_at: '2026-10-10T12:34:00Z',
    } }));
    const { el, saisir } = await monter({ planMedia });
    await saisir('select[data-campagne]', 'c1');
    expect(planMedia).toHaveBeenCalledWith('c1');
    expect(el.querySelector<HTMLInputElement>('input[data-budget]')!.value).toBe('2000');
    expect(el.querySelector<HTMLInputElement>('input[data-cpm]')!.value).toBe('4');
    expect(el.querySelector<HTMLSelectElement>('select[data-cible]')!.value).toBe('18_24');
    expect(el.querySelector<HTMLInputElement>('tr[data-ligne="z1:p1"] input')!.value).toBe('40');
    expect(el.querySelector('[data-etat-plan]')!.textContent).toContain('Enregistré le');
  });

  it('plan stocké sur D’AUTRES zones (revue 1) : les lignes restent au prorata, et « Enregistrer » n’écrit pas de zéros', async () => {
    const planMedia = vi.fn(() => of({ plan: {
      zones: [{ id: 'autre', name: 'Autre' }], budget: 2000, cpm: 4, cible: 'total', weights: { 'autre:p1': 60, 'autre:p2': 40 },
    } }));
    const enregistrerPlan = vi.fn((_corps: { plan: { weights: unknown } }) => of({ ok: true }));
    const { el, saisir, stable } = await monter({ planMedia, enregistrerPlan });
    await saisir('select[data-campagne]', 'c1');
    expect(el.querySelector<HTMLInputElement>('tr[data-ligne="z1:p1"] input')!.value).toBe('75');
    expect(el.querySelector('[data-prorata]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-enregistrer]')!.click();
    await stable();
    expect(enregistrerPlan.mock.calls[0][0].plan.weights).toEqual({ 'z1:p1': 75, 'z1:p2': 25, z2: 0 });
  });

  it('« Enregistrer » ÉCRIT le plan (poids au dixième), puis « détacher » le retire', async () => {
    const { el, appels, saisir, stable } = await monter();
    await saisir('select[data-campagne]', 'c1');
    expect(el.querySelector('[data-etat-plan]')!.textContent!.trim()).toBe('Plan non encore enregistré');
    await saisir('input[data-budget]', '10000');
    el.querySelector<HTMLButtonElement>('[data-enregistrer]')!.click();
    await stable();
    expect(appels.enregistrerPlan).toHaveBeenCalledWith({
      campaign_id: 'c1',
      plan: { zones: ZONES, budget: 10_000, cpm: null, cible: 'total', weights: { 'z1:p1': 75, 'z1:p2': 25, z2: 0 } },
    });
    expect(el.querySelector('[data-etat-plan]')!.textContent).toContain('Enregistré le');
    expect([...el.querySelectorAll('select[data-campagne] option')][1].textContent?.trim()).toBe('● [ESSAI lot 4] Campagne · magelian');

    el.querySelector<HTMLButtonElement>('[data-detacher]')!.click();
    await stable();
    expect(appels.detacherPlan).toHaveBeenCalledWith('c1');
    expect(el.querySelector('[data-detacher]')).toBeNull();
  });

  it('un refus 403 dit « Campagne hors de votre organisation. »', async () => {
    const enregistrerPlan = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 403 })));
    const { el, saisir, stable } = await monter({ enregistrerPlan });
    await saisir('select[data-campagne]', 'c1');
    el.querySelector<HTMLButtonElement>('[data-enregistrer]')!.click();
    await stable();
    expect(el.querySelector('[data-etat-plan]')!.textContent!.trim()).toBe('Campagne hors de votre organisation.');
  });
});

describe('PlanMediaComponent — exports', () => {
  it('CSV : un fichier `plan_media.csv` qui commence par le BOM', async () => {
    const { el, enregistrer, stable } = await monter();
    el.querySelector<HTMLButtonElement>('[data-csv]')!.click();
    await stable();
    expect(enregistrer).toHaveBeenCalledTimes(1);
    const [, reponse, nom] = enregistrer.mock.calls[0] as [Document, { body: Blob }, string];
    expect(nom).toBe('plan_media.csv');
    expect((await reponse.body.text()).startsWith('Plan média')).toBe(true);
  });

  it('DSP : un fichier par zone, poids par item pour la zone décomposable, export simple sinon ; instantané si campagne', async () => {
    const { el, exporter, appels, saisir, stable } = await monter();
    await saisir('select[data-campagne]', 'c1');
    await saisir('input[data-budget]', '10000');
    el.querySelector<HTMLButtonElement>('[data-export="tiktok_geo"]')!.click();
    await stable();
    expect(exporter.mock.calls).toEqual([
      ['z1', 'tiktok_geo', { weights: '{"p1":75,"p2":25}', budget: '10000' }],
      ['z2', 'tiktok_geo'],
    ]);
    expect(appels.instantane).toHaveBeenCalledWith(expect.objectContaining({ campaign_id: 'c1', dsp: 'tiktok', budget: 10_000 }));
  });

  it('panneau fermé pendant « Génération… » : la série s’arrête avant la zone suivante (revue 1)', async () => {
    const { fixture, el, exporter, stable } = await monter();
    let liberer!: (v: string | null) => void;
    exporter.mockImplementationOnce(() => new Promise<string | null>((r) => (liberer = r)));
    el.querySelector<HTMLButtonElement>('[data-export="bidding_script"]')!.click();
    await stable();
    fixture.destroy();
    liberer(null);
    await stable();
    expect(exporter).toHaveBeenCalledTimes(1);
  });

  it('un export refusé s’arrête et affiche le message ; aucun instantané sans campagne', async () => {
    const { el, exporter, appels, stable } = await monter();
    exporter.mockImplementationOnce(async () => 'Zone introuvable');
    el.querySelector<HTMLButtonElement>('[data-export="bidding_script"]')!.click();
    await stable();
    expect(exporter).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-erreur-export]')!.textContent!.trim()).toBe('Zone introuvable');
    expect(appels.instantane).not.toHaveBeenCalled();
  });
});
