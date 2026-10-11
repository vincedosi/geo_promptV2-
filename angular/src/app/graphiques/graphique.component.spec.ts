import { TestBed } from '@angular/core/testing';
import { FABRIQUE_GRAPHIQUE, type GraphiqueMinimal } from './fabrique-graphique';
import { GraphiqueComponent } from './graphique.component';

/** Un graphique factice : on relit les options posées, les redimensionnements et la libération. */
class GraphiqueFactice implements GraphiqueMinimal {
  readonly options: { option: unknown; reglages: unknown }[] = [];
  redimensionnements = 0;
  libere = false;
  constructor(readonly element: HTMLElement) {}
  setOption(option: unknown, reglages?: unknown): void { this.options.push({ option, reglages }); }
  resize(): void { this.redimensionnements++; }
  dispose(): void { this.libere = true; }
}

let crees: GraphiqueFactice[] = [];
let rappelsObservateur: (() => void)[] = [];
let deconnexions = 0;

function monter(hauteur = 220) {
  crees = [];
  rappelsObservateur = [];
  deconnexions = 0;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    constructor(rappel: () => void) { rappelsObservateur.push(rappel); }
    observe() {}
    disconnect() { deconnexions++; }
  };
  TestBed.configureTestingModule({
    providers: [{ provide: FABRIQUE_GRAPHIQUE, useValue: (el: HTMLElement) => { const g = new GraphiqueFactice(el); crees.push(g); return g; } }],
  });
  const fixture = TestBed.createComponent(GraphiqueComponent);
  fixture.componentRef.setInput('option', { series: [{ type: 'bar', data: [1] }] });
  fixture.componentRef.setInput('libelle', 'Barres');
  fixture.componentRef.setInput('hauteur', hauteur);
  return fixture;
}

describe('mg-graphique et monterGraphique (cycle de vie ECharts partagé)', () => {
  it('UN graphique, créé après le premier rendu dans le conteneur, qui reçoit l’option en notMerge', async () => {
    const fixture = monter(180);
    await fixture.whenStable();
    expect(crees).toHaveLength(1);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('Barres');
    expect((el.querySelector('[role="img"]') as HTMLElement).style.height).toBe('180px');
    expect(crees[0].element.parentElement!.getAttribute('role')).toBe('img');
    expect(crees[0].options).toEqual([{ option: { series: [{ type: 'bar', data: [1] }] }, reglages: { notMerge: true } }]);
  });

  it('une nouvelle option est reposée (pas un second graphique)', async () => {
    const fixture = monter();
    await fixture.whenStable();
    fixture.componentRef.setInput('option', { series: [] });
    await fixture.whenStable();
    expect(crees).toHaveLength(1);
    expect(crees[0].options.at(-1)).toEqual({ option: { series: [] }, reglages: { notMerge: true } });
  });

  it('suit la taille du conteneur, et libère graphique et observateur à la destruction', async () => {
    const fixture = monter();
    await fixture.whenStable();
    rappelsObservateur[0]();
    expect(crees[0].redimensionnements).toBe(1);
    fixture.destroy();
    expect(crees[0].libere).toBe(true);
    expect(deconnexions).toBe(1);
  });
});
