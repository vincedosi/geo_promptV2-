import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SimulationService } from '../../etat/simulation.service';
import type { LigneZone, VueSimulation } from '../../logique/simulation/vue';
import { COLONNES_ZONES, LIGNES_VISIBLES, TableauZonesCampagneComponent, zonesTriees } from './tableau-zones-campagne.component';

function zone(i: number, plan: number, diffusee: number, indice: number | null = 100): LigneZone {
  return {
    id: `z${i}`, nom: `Zone ${i}`, rang: i, n_sites: 1, pop_exposee: 1000 * i, part_plan: plan, part_diffusee: diffusee,
    indice, impressions: 10_000, utiles: 12_345, depense: 10, taux_utile: 0.5, exposes_touches: 100,
    cout_expose_touche: 0.1234, bbox: null,
  };
}

async function rendre(zones: LigneZone[]) {
  const zoneActive = signal<string | null>(null);
  const vue = signal<VueSimulation | null>({ zones } as VueSimulation);
  TestBed.configureTestingModule({ providers: [{ provide: SimulationService, useValue: { vue, zoneActive } }] });
  const fixture = TestBed.createComponent(TableauZonesCampagneComponent);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const lignes = () => [...el.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent?.replace(/\s+/g, ' ').replace(/ | /g, ' ').trim()));
  return { fixture, el, lignes, zoneActive, vue };
}

describe('TableauZonesCampagneComponent (T17)', () => {
  it('trie par |part diffusée − part du plan| (POINTS DE PART, pas l’indice) et écarte les zones sans plan', () => {
    const t = zonesTriees([zone(1, 0.1, 0.11, 110), zone(2, 0.001, 0.0001, 10), zone(3, 0.3, 0.2, 67), zone(4, 0, 0.05, null)]);
    expect(t.map((z) => z.id)).toEqual(['z3', 'z1', 'z2']);
  });

  it('en-têtes et cellules MOT POUR MOT de React, à la française', async () => {
    const { el, lignes } = await rendre([zone(1, 0.123, 0.0456, 37)]);
    expect([...el.querySelectorAll('th')].map((th) => th.textContent?.trim())).toEqual([...COLONNES_ZONES]);
    expect(lignes()).toEqual([['Zone 1', '1 000', '12,3 %', '4,6 %', '37sous', '12,3 k', '50,0 %', '0,123 €']]);
  });

  it('40 lignes, puis « Afficher les N zones » / « Replier »', async () => {
    const zones = Array.from({ length: 45 }, (_, i) => zone(i + 1, 0.01, 0.01 + i / 1000));
    const { el, lignes, fixture } = await rendre(zones);
    expect(lignes()).toHaveLength(LIGNES_VISIBLES);
    const bouton = el.querySelector<HTMLButtonElement>('button')!;
    expect(bouton.textContent?.trim()).toBe('Afficher les 45 zones');
    bouton.click();
    await fixture.whenStable();
    expect(lignes()).toHaveLength(45);
    expect(bouton.textContent?.trim()).toBe('Replier');
  });

  it('⚠ un indice ABSENT : pastille neutre et « — », jamais la couleur « conforme »', async () => {
    const { el, lignes } = await rendre([zone(1, 0.1, 0.2, null), zone(2, 0.1, 0.1, 100)]);
    const pastilles = [...el.querySelectorAll<HTMLElement>('[data-pastille]')].map((p) => p.style.background);
    expect(lignes()[0][4]).toBe('—');
    expect(pastilles).toEqual(['var(--bg-level-3)', 'var(--diverge-neutre)']);
  });

  it('un clic sélectionne la zone, un second la désélectionne', async () => {
    const { el, fixture, zoneActive } = await rendre([zone(1, 0.1, 0.2)]);
    const tr = el.querySelector<HTMLTableRowElement>('tbody tr')!;
    tr.click();
    await fixture.whenStable();
    expect(zoneActive()).toBe('z1');
    expect(tr.style.background).toBe('var(--bg-level-2)');
    tr.click();
    await fixture.whenStable();
    expect(zoneActive()).toBeNull();
  });

  it('sans simulation, rien', async () => {
    const { el, vue, fixture } = await rendre([]);
    vue.set(null);
    await fixture.whenStable();
    expect(el.querySelector('table')).toBeNull();
  });
});
