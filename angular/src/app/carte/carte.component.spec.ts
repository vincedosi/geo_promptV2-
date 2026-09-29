import { TestBed } from '@angular/core/testing';
import { CarteComponent } from './carte.component';
import { FABRIQUE_CARTE } from './fabrique-carte';
import { CarteFactice } from './testing/carte-factice';

class ObservateurFactice {
  static instances: ObservateurFactice[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(readonly rappel: () => void) { ObservateurFactice.instances.push(this); }
}

async function rendre() {
  let carte!: CarteFactice;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ObservateurFactice;
  TestBed.configureTestingModule({
    providers: [{ provide: FABRIQUE_CARTE, useValue: (o: never) => (carte = new CarteFactice(o)) }],
  });
  const f = TestBed.createComponent(CarteComponent);
  f.componentRef.setInput('cadre', [4.75, 43.35, 5.3, 43.6]);
  const pretes: unknown[] = [];
  const cadres: unknown[] = [];
  const erreurs: string[] = [];
  f.componentInstance.prete.subscribe((m) => pretes.push(m));
  f.componentInstance.deplacee.subscribe((b) => cadres.push(b));
  f.componentInstance.erreur.subscribe((e) => erreurs.push(e));
  await f.whenStable();
  return { f, carte: () => carte, pretes, cadres, erreurs };
}

describe('CarteComponent', () => {
  afterEach(() => { ObservateurFactice.instances = []; });

  it('crée la carte dans son conteneur, sur le fond et le cadre demandés', async () => {
    const { carte } = await rendre();
    const o = carte().options as { container: HTMLElement; style: string; bounds: unknown };
    expect(o.container).toBeInstanceOf(HTMLElement);
    expect(o.style).toBe('https://tiles.openfreemap.org/styles/positron');
    expect(o.bounds).toEqual([4.75, 43.35, 5.3, 43.6]);
  });

  it('rend la carte au chargement, et chaque cadre au moveend', async () => {
    const { carte, pretes, cadres } = await rendre();
    carte().emettre('load');
    carte().emettre('moveend');
    expect(pretes).toEqual([carte()]);
    expect(cadres).toEqual([[4.75, 43.35, 5.3, 43.6]]);
  });

  it('se redimensionne quand son conteneur change de taille', async () => {
    const { carte } = await rendre();
    ObservateurFactice.instances[0].rappel();
    expect(carte().appelsResize).toBe(1);
  });

  it('à la destruction : observateur débranché, carte retirée', async () => {
    const { f, carte } = await rendre();
    f.destroy();
    expect(ObservateurFactice.instances[0].disconnect).toHaveBeenCalled();
    expect(carte().retiree).toBe(true);
  });

  it('signale un fond de carte qui échoue AVANT le chargement', async () => {
    const { carte, erreurs } = await rendre();
    carte().emettre('error');
    expect(erreurs).toEqual(["Le fond de carte n'a pas pu être chargé."]);
  });

  it('ne signale PAS une erreur de tuile survenue APRÈS le chargement', async () => {
    const { carte, erreurs } = await rendre();
    carte().emettre('load');
    carte().emettre('error');
    expect(erreurs).toEqual([]);
  });
});
