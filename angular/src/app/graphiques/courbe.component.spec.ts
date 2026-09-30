import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CouleursService } from '../core/theme/couleurs.service';
import { CourbeComponent } from './courbe.component';
import { FABRIQUE_GRAPHIQUE, type GraphiqueMinimal } from './fabrique-graphique';
import type { SerieCourbe } from './option-courbe';

class GraphiqueFactice implements GraphiqueMinimal {
  options: unknown[] = [];
  redimensionnements = 0;
  detruit = false;
  setOption(o: unknown) { this.options.push(o); }
  resize() { this.redimensionnements++; }
  dispose() { this.detruit = true; }
}

const SERIES: SerieCourbe[] = [
  { cle: 'total', libelle: 'Toutes natures', jeton: 'brand-teal', points: [[100, 10]] },
  { cle: 'a', libelle: 'Nature A', jeton: 'nature-1', points: [[100, 4]] },
];

async function rendre() {
  const graphique = new GraphiqueFactice();
  const teinte = signal('#111111');
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  TestBed.configureTestingModule({
    providers: [
      { provide: FABRIQUE_GRAPHIQUE, useValue: () => graphique },
      {
        provide: CouleursService,
        useValue: { palette: (j: Record<string, string>) => () => Object.fromEntries(Object.keys(j).map((k) => [k, teinte()])) },
      },
    ],
  });
  const f = TestBed.createComponent(CourbeComponent);
  f.componentRef.setInput('series', SERIES);
  f.componentRef.setInput('libelle', 'Population par rayon');
  await f.whenStable();
  return { f, graphique, teinte, el: f.nativeElement as HTMLElement };
}

describe('CourbeComponent', () => {
  it('pose les options et décrit le graphique aux lecteurs d\'écran', async () => {
    const { graphique, el } = await rendre();
    expect(graphique.options.length).toBeGreaterThan(0);
    expect(el.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('Population par rayon');
  });

  it('la légende masque et rétablit une série', async () => {
    const { f, graphique, el } = await rendre();
    const boutons = el.querySelectorAll('button');
    expect(boutons.length).toBe(2);
    boutons[1].click();
    await f.whenStable();
    expect(boutons[1].getAttribute('aria-pressed')).toBe('false');
    const derniere = graphique.options.at(-1) as { series: { name: string }[] };
    expect(derniere.series.map((s) => s.name)).toEqual(['Toutes natures']);
  });

  it('repose les options quand les couleurs changent (bascule de thème)', async () => {
    const { f, graphique, teinte } = await rendre();
    const avant = graphique.options.length;
    teinte.set('#222222');
    await f.whenStable();
    expect(graphique.options.length).toBeGreaterThan(avant);
  });

  it('libère le graphique à la destruction', async () => {
    const { f, graphique } = await rendre();
    f.destroy();
    expect(graphique.detruit).toBe(true);
  });
});
