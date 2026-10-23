import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { FABRIQUE_GRAPHIQUE, type GraphiqueMinimal } from '../../../../graphiques/fabrique-graphique';
import { KpiComponent } from '../../../../ui/kpi/kpi.component';
import { CourbePopulationComponent, type CourbeCumulee } from './courbe-population.component';

class GraphiqueFactice implements GraphiqueMinimal {
  options: Record<string, unknown>[] = [];
  setOption(o: unknown) { this.options.push(o as Record<string, unknown>); }
  resize() {}
  dispose() {}
  derniere() { return this.options.at(-1)!; }
}

/** Une courbe de 5 km : 100 m → 5 000 m par paliers de 100 m, 1 000 habitants de plus à chaque palier. */
const COURBES: CourbeCumulee[] = [
  { cle: '*', total: 50_000, points: Array.from({ length: 50 }, (_, i) => ({ r: (i + 1) * 100, p: (i + 1) * 1000, i: 1000 })) },
  { cle: 'lycee_general', total: 30_000, points: Array.from({ length: 50 }, (_, i) => ({ r: (i + 1) * 100, p: (i + 1) * 600, i: 600 })) },
];

@Component({
  imports: [CourbePopulationComponent, KpiComponent],
  template: `
    <div class="flex flex-col">
      <mg-courbe-population [courbes]="courbes()" libelleCible="Population totale" nomPerimetre="Bouches-du-Rhône"
                            titre="Population couverte autour des lycées" nomTotale="Tous les POI" [rayonMax]="rayonMax()" [(rayon)]="rayon">
        <mg-kpi [taille]="22" valeur="160" libelle="POI retenus" note="dans le périmètre" />
        <button mgActions type="button" data-action>Action</button>
        <p mgNote data-note>Note du parent</p>
      </mg-courbe-population>
    </div>
  `,
})
class Hote {
  readonly courbes = signal<readonly CourbeCumulee[]>(COURBES);
  readonly rayonMax = signal(5000);
  readonly rayon = signal(1000);
}

const n = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ').trim();

async function rendre() {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  const graphique = new GraphiqueFactice();
  TestBed.configureTestingModule({
    providers: [
      { provide: FABRIQUE_GRAPHIQUE, useValue: () => graphique },
      { provide: CouleursService, useValue: {
        palette: (j: Record<string, string>) => () => Object.fromEntries(Object.keys(j).map((k) => [k, `couleur:${k}`])),
      } },
    ],
  });
  const f = TestBed.createComponent(Hote);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const kpis = () => [...el.querySelectorAll('[data-role="kpis"] mg-kpi')].map((k) => n(k.querySelector('[data-role="libelle"]')?.textContent));
  return { f, el, graphique, kpis };
}

describe('CourbePopulationComponent', () => {
  it('chiffres au rayon du parent, part rapportée au rayon MAXIMAL, KPI projeté entre la part et l’incrément', async () => {
    const { el, kpis } = await rendre();
    expect(kpis()).toEqual(['à moins de 1,0 km', 'du total à 5 km', 'POI retenus', 'au palier suivant']);
    expect(n(el.querySelector('[data-role="kpis"] mg-kpi [data-role="valeur"]')?.textContent)).toBe('10 000');
    expect(n(el.textContent)).toContain('20,0 %');
    expect(n(el.textContent)).toContain('50 000 au maximum');
    expect(n(el.textContent)).toContain('population totale · Bouches-du-Rhône');
  });

  it('le curseur écrit le `model` du parent ; un rayon posé par le parent déplace le repère', async () => {
    const { f, el, graphique } = await rendre();
    const curseur = el.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(curseur.max).toBe('5000');
    curseur.value = '2500';
    curseur.dispatchEvent(new Event('input'));
    await f.whenStable();
    expect(f.componentInstance.rayon()).toBe(2500);
    f.componentInstance.rayon.set(4000);
    await f.whenStable();
    const premiere = (graphique.derniere()['series'] as { markLine?: { data: { xAxis: number }[] } }[])[0];
    expect(premiere.markLine?.data[0].xAxis).toBe(4000);
    expect(n(el.querySelector('[data-role="rayon"]')?.textContent)).toBe('4,0 km');
  });

  it('légende : la totale porte `nomTotale` en teal ; graduations coupées au rayon maximal, aucune sous 1 km', async () => {
    const { f, graphique } = await rendre();
    const series = graphique.derniere()['series'] as { name: string; lineStyle: { color: string } }[];
    expect(series[0]).toMatchObject({ name: 'Tous les POI', lineStyle: { color: 'couleur:brand-teal' } });
    expect(series[1]).toMatchObject({ name: 'lycee_general', lineStyle: { color: 'couleur:nature-1' } });
    const graduations = () => (graphique.derniere()['xAxis'] as { axisLabel: { customValues?: number[] } }).axisLabel.customValues;
    expect(graduations()).toEqual([1000, 2000, 3000, 4000, 5000]);
    f.componentInstance.rayonMax.set(800);
    await f.whenStable();
    expect(graduations()).toBeUndefined();
  });

  it('projections : `[mgActions]` dans la rangée du curseur, `[mgNote]` sous la légende de `mg-courbe`', async () => {
    const { el } = await rendre();
    expect(el.querySelector('input[type="range"]')!.parentElement!.querySelector('[data-action]')).not.toBeNull();
    expect(el.querySelector('mg-courbe [data-note]')?.textContent).toBe('Note du parent');
  });
});
