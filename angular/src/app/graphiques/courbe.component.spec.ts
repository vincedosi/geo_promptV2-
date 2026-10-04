import { NgZone, signal } from '@angular/core';
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

let observateursDeconnectes = 0;
let rappelsObservateur: (() => void)[] = [];
const observerOrigine = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;

afterEach(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = observerOrigine;
});

async function rendre(series: SerieCourbe[] = SERIES, jetonsInconnus: string[] = []) {
  observateursDeconnectes = 0;
  rappelsObservateur = [];
  const graphique = new GraphiqueFactice();
  const teinte = signal('#111111');
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { constructor(rappel: () => void) { rappelsObservateur.push(rappel); } observe() {} disconnect() { observateursDeconnectes++; } };
  TestBed.configureTestingModule({
    providers: [
      { provide: FABRIQUE_GRAPHIQUE, useValue: () => graphique },
      {
        provide: CouleursService,
        useValue: {
          palette: (j: Record<string, string>) => () =>
            Object.fromEntries(Object.keys(j).map((k) => {
              if (jetonsInconnus.includes(k)) throw new Error(`Jeton de couleur inconnu : --${k}`);
              return [k, `${teinte()}:${k}`];
            })),
        },
      },
    ],
  });
  const f = TestBed.createComponent(CourbeComponent);
  f.componentRef.setInput('series', series);
  f.componentRef.setInput('libelle', 'Population par rayon');
  await f.whenStable();
  return { f, graphique, teinte, el: f.nativeElement as HTMLElement };
}

describe('CourbeComponent', () => {
  it("crée le graphique HORS de la zone Angular (NgZone.runOutsideAngular)", async () => {
    // Règle des lots suivants (revue finale du lot AIDA). Tenue AUJOURD'HUI par
    // `afterNextRender`, qu'Angular exécute via `ngZone.runOutsideAngular`
    // (AfterRenderManager) : ce test verrouille la propriété si la création
    // quittait un jour `afterNextRender`. Indifférent en zoneless.
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
    const appels: boolean[] = [];
    let dehors = false;
    TestBed.configureTestingModule({
      providers: [
        { provide: FABRIQUE_GRAPHIQUE, useValue: () => { appels.push(dehors); return new GraphiqueFactice(); } },
        { provide: CouleursService, useValue: { palette: (j: Record<string, string>) => () => ({ ...j }) } },
      ],
    });
    const zone = TestBed.inject(NgZone);
    vi.spyOn(zone, 'runOutsideAngular').mockImplementation((fn) => {
      dehors = true;
      try { return fn(); } finally { dehors = false; }
    });
    const f = TestBed.createComponent(CourbeComponent);
    f.componentRef.setInput('series', SERIES);
    f.componentRef.setInput('libelle', 'Population par rayon');
    await f.whenStable();
    expect(appels).toEqual([true]);
  });

  it('redimensionne le graphique quand son conteneur change de taille', async () => {
    const { graphique } = await rendre();
    expect(rappelsObservateur.length).toBe(1);
    rappelsObservateur[0]();
    expect(graphique.redimensionnements).toBe(1);
  });

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

  it('la légende donne la valeur de chaque courbe au repère (dernier point sans dépasser), en mono', async () => {
    const series: SerieCourbe[] = [
      { cle: 'total', libelle: 'Toutes natures', jeton: 'brand-teal', points: [[100, 10], [200, 30], [300, 50]] },
    ];
    TestBed.resetTestingModule();
    const { f, el } = await rendre(series);
    f.componentRef.setInput('repere', { x: 250 });
    f.componentRef.setInput('formaterValeur', (y: number) => `${y} hab.`);
    await f.whenStable();
    const valeur = el.querySelector('[data-role="valeur-legende"]')!;
    expect(valeur.textContent!.trim()).toBe('30 hab.');
    expect(valeur.classList).toContain('font-mono');
  });

  it("sans repère la légende ne chiffre rien ; masquée, une courbe passe à 0,5 d’opacité sans être barrée", async () => {
    const { f, el } = await rendre();
    expect(el.querySelector('[data-role="valeur-legende"]')!.textContent!.trim()).toBe('—');
    const bouton = el.querySelectorAll('button')[1];
    bouton.click();
    await f.whenStable();
    expect(bouton.classList).toContain('opacity-50');
    expect(bouton.classList).not.toContain('line-through');
    expect(bouton.getAttribute('title')).toBe('Afficher cette courbe');
  });

  it("transmet les graduations, les étiquettes et les formateurs à l’option", async () => {
    const { f, graphique } = await rendre();
    f.componentRef.setInput('graduationsX', [1000, 2000]);
    f.componentRef.setInput('etiquettes', true);
    await f.whenStable();
    const o = graphique.options.at(-1) as { xAxis: { axisLabel: { customValues: number[] } }; grid: { top: number } };
    expect(o.xAxis.axisLabel.customValues).toEqual([1000, 2000]);
    expect(o.grid.top).toBe(20);
  });

  it('sans légende (étape ⑤) : aucun bouton ; domaine, graduations Y, marges, grille et couleurs du repère transmis', async () => {
    const { f, graphique, el } = await rendre();
    f.componentRef.setInput('legende', false);
    f.componentRef.setInput('domaineY', [0, 100]);
    f.componentRef.setInput('graduationsY', [0, 50, 100]);
    f.componentRef.setInput('marges', { top: 14, right: 8, bottom: 30, left: 42 });
    f.componentRef.setInput('grillePleine', true);
    f.componentRef.setInput('jetonFondInfobulle', 'bg-level-2');
    f.componentRef.setInput('repere', { x: 15, libelle: 'Recalage v2', jeton: 'text-tertiary', jetonLibelle: 'text-secondary' });
    await f.whenStable();
    expect(el.querySelectorAll('button').length).toBe(0);
    const o = graphique.options.at(-1) as {
      yAxis: { min: number; max: number; interval: number }; grid: Record<string, number>;
      tooltip: { backgroundColor: string };
      series: { markLine: { lineStyle: { color: string }; label: { color: string } } }[];
    };
    expect([o.yAxis.min, o.yAxis.max, o.yAxis.interval]).toEqual([0, 100, 50]);
    expect(o.grid).toEqual({ left: 42, right: 8, bottom: 30, top: 14, outerBoundsMode: 'none' });
    // Les marges de Recharts remplacent la réserve de 8 px du conteneur.
    expect(el.querySelector('[role="img"] > div')!.classList.contains('mr-2')).toBe(false);
    expect(o.tooltip.backgroundColor).toBe('#111111:bg-level-2');
    expect(o.series[0].markLine.lineStyle.color).toBe('#111111:text-tertiary');
    expect(o.series[0].markLine.label.color).toBe('#111111:text-secondary');
  });

  it('la légende ignore les trous (`null`) pour la valeur au repère', async () => {
    TestBed.resetTestingModule();
    const { f, el } = await rendre([{ cle: 'v', libelle: 'V', jeton: 'brand-teal', points: [[1, 10], [2, 20], [3, null]] }]);
    f.componentRef.setInput('repere', { x: 3 });
    await f.whenStable();
    expect(el.querySelector('[data-role="valeur-legende"]')!.textContent!.trim()).toBe('20');
  });

  it('repose les options quand les couleurs changent (bascule de thème)', async () => {
    const { f, graphique, teinte } = await rendre();
    const avant = graphique.options.length;
    teinte.set('#222222');
    await f.whenStable();
    expect(graphique.options.length).toBeGreaterThan(avant);
  });

  it("libère le graphique et débranche l'observateur à la destruction", async () => {
    const { f, graphique } = await rendre();
    f.destroy();
    expect(graphique.detruit).toBe(true);
    expect(observateursDeconnectes).toBe(1);
  });

  it('un jeton hors brand-teal/nature-* donne SA couleur, pas un repli', async () => {
    const { graphique } = await rendre([{ cle: 'x', libelle: 'X', jeton: 'success', points: [[1, 1]] }]);
    const o = graphique.options.at(-1) as { series: { lineStyle: { color: string } }[] };
    expect(o.series[0].lineStyle.color).toBe('#111111:success');
  });

  it("un jeton inconnu échoue bruyamment au lieu de s'afficher", async () => {
    await expect(
      rendre([{ cle: 'x', libelle: 'X', jeton: 'fautif', points: [[1, 1]] }], ['fautif']),
    ).rejects.toThrow(/Jeton de couleur inconnu/);
  });
});
