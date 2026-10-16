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
  template: `<mg-carte-zone [zone]="zone()" [recalculEnCours]="enCours()" [indicateurs]="indicateurs()" (recalculer)="recalculs = recalculs + 1" />`,
})
class Hote {
  readonly zone = signal(zone(null));
  readonly enCours = signal(false);
  readonly indicateurs = signal<readonly IndicateurRegistre[]>([]);
  recalculs = 0;
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
