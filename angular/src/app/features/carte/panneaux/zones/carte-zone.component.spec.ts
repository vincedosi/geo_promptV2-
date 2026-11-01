import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ZoneCustomResume } from '../../data/zones-custom.api';
import type { IndicateurRegistre } from '../../logique/analyses/score';
import type { Recette } from '../../logique/zones/recette';
import { CarteZoneComponent } from './carte-zone.component';

const zone = (recette: Recette | null | undefined, source_type = 'composite'): ZoneCustomResume => ({
  id: 'z1', name: 'Ma zone', description: null, source_type, source_metadata: {}, feature_count_iris: 3, feature_count_cp: 2,
  bbox: null, created_at: '2026-10-15T10:00:00Z', created_by: null, dept_codes: [], region_codes: [],
  ...(recette === undefined ? {} : { recette }),
});

@Component({
  imports: [CarteZoneComponent],
  template: `<mg-carte-zone [zone]="zone()" [recalculEnCours]="enCours()" [indicateurs]="indicateurs()" [referencee]="referencee()"
    [duplicationEnCours]="duplication()" (recalculer)="recalculs = recalculs + 1" (dupliquer)="duplications = duplications + 1" />`,
})
class Hote {
  readonly zone = signal(zone(null));
  readonly enCours = signal(false);
  readonly indicateurs = signal<readonly IndicateurRegistre[]>([]);
  readonly referencee = signal(false);
  readonly duplication = signal(false);
  recalculs = 0;
  duplications = 0;
}

async function monter(z: ZoneCustomResume) {
  const fixture = TestBed.createComponent(Hote);
  fixture.componentInstance.zone.set(z);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('CarteZoneComponent — la recette (lot 3, T12)', () => {
  it('rayon autour des POI : la ligne de recette, la puce lisible, pas de composition technique, « Recalculer »', async () => {
    const { fixture, el } = await monter(zone({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: { type: 'departement', code: '33' } }, 'recette_rayon_poi'));
    expect(el.querySelector('[data-recette]')!.textContent!.trim()).toBe('Rayon de 5 km autour des POI « lycee »');
    expect(el.querySelector('[data-source]')!.textContent!.trim()).toBe('Rayon autour des POI');
    expect(el.querySelector('[data-composition]')).toBeNull();
    expect(el.textContent).not.toContain('recette_');
    el.querySelector<HTMLButtonElement>('button[data-recalculer]')!.click();
    expect(fixture.componentInstance.recalculs).toBe(1);
  });

  it('recalcul en vol : le bouton est désactivé', async () => {
    const { fixture, el } = await monter(zone({ v: 1, type: 'codes_postaux', codes: ['33000'] }, 'recette_codes_postaux'));
    fixture.componentInstance.enCours.set(true);
    await fixture.whenStable();
    expect(el.querySelector<HTMLButtonElement>('button[data-recalculer]')!.disabled).toBe(true);
  });

  it('zone d’avant le lot 3 (`recette: null`) : « Forme figée », sa composition React, pas de bouton', async () => {
    const { el } = await monter(zone(null));
    expect(el.querySelector('[data-recette]')!.textContent!.trim()).toBe('Forme figée');
    expect(el.querySelector('[data-composition]')).not.toBeNull();
    expect(el.querySelector('[data-source]')!.textContent!.trim()).toBe('Composite multi-layers');
    expect(el.querySelector('[data-recalculer]')).toBeNull();
  });

  it('dessin : « Dessin à main levée », pas de bouton', async () => {
    const { el } = await monter(zone({ v: 1, type: 'dessin' }, 'recette_dessin'));
    expect(el.querySelector('[data-recette]')!.textContent!.trim()).toBe('Dessin à main levée');
    expect(el.querySelector('[data-recalculer]')).toBeNull();
  });

  it('seuil sur territoires : libellé du catalogue et unité', async () => {
    const { fixture, el } = await monter(zone({ v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20, perimetre: null }, 'recette_seuil_territoire'));
    fixture.componentInstance.indicateurs.set([{ indicator_code: 'taux_pauvrete', label: 'Taux de pauvreté', famille: null, unit: '%' }]);
    await fixture.whenStable();
    expect(el.querySelector('[data-recette]')!.textContent!.trim()).toBe('Territoires où taux de pauvreté ≥ 20 %');
  });
});

describe('CarteZoneComponent — Dupliquer, sans script de bidding (③ finitions, T5)', () => {
  const RAYON: Recette = { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: { type: 'departement', code: '33' } };
  const dupliquer = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button[data-dupliquer]');

  it('« Dupliquer » sur toute zone, figée ou non ; un clic émet une fois', async () => {
    for (const r of [null, { v: 1, type: 'dessin' } as Recette, RAYON]) {
      TestBed.resetTestingModule();
      const { fixture, el } = await monter(zone(r));
      expect(dupliquer(el)!.textContent!.trim()).toBe('Dupliquer');
      dupliquer(el)!.click();
      expect(fixture.componentInstance.duplications).toBe(1);
    }
  });

  it('zone citée par un plan (dernier recalcul refusé, 409) : « Recalculer dans une nouvelle zone », plus de « Recalculer »', async () => {
    const { fixture, el } = await monter(zone(RAYON, 'recette_rayon_poi'));
    fixture.componentInstance.referencee.set(true);
    await fixture.whenStable();
    expect(dupliquer(el)!.textContent!.trim()).toBe('Recalculer dans une nouvelle zone');
    expect(el.querySelector('[data-recalculer]')).toBeNull();
  });

  it('duplication en vol : le bouton est désactivé', async () => {
    const { fixture, el } = await monter(zone(null));
    fixture.componentInstance.duplication.set(true);
    await fixture.whenStable();
    expect(dupliquer(el)!.disabled).toBe(true);
  });

  it('aucun script de custom bidding (spec § 19, Q-6) ; « Exporter TikTok » reste', async () => {
    const { el } = await monter(zone(null));
    expect(el.querySelector('[data-export="bidding_script"]')).toBeNull();
    expect(el.querySelector('[data-export="tiktok_geo"]')).not.toBeNull();
  });

  it('seuil sur carreaux : le minimum de ménages dans la ligne de recette', async () => {
    const { el } = await monter(zone({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: { type: 'departement', code: '33' }, min_menages: 11 }, 'recette_seuil_carreaux'));
    expect(el.querySelector('[data-recette]')!.textContent!.trim()).toMatch(/ · minimum de ménages : 11$/);
  });
});
