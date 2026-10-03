import { Component, NgZone, ViewEncapsulation } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CarteComponent } from './carte.component';
import { FABRIQUE_CARTE } from './fabrique-carte';
import { CarteFactice } from './testing/carte-factice';
import { BASE_RESSOURCES } from '../core/ressources/ressource-distante';

const BASE = 'https://distante.exemple/remotes/magelian/chunk-ABC.js';

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
    providers: [
      { provide: FABRIQUE_CARTE, useValue: (o: never) => (carte = new CarteFactice(o)) },
      { provide: BASE_RESSOURCES, useValue: BASE },
    ],
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
  afterEach(() => {
    ObservateurFactice.instances = [];
    // Le document est partagé entre les tests : chaque test repart sans feuille posée.
    document.head.querySelectorAll('link[data-mg-maplibre]').forEach((l) => l.remove());
  });

  it('pose le zoom +/− SANS boussole, en haut à droite, et publie le zoom courant', async () => {
    const { f, carte } = await rendre();
    expect(carte().controles).toHaveLength(1);
    expect(carte().controles[0].position).toBe('top-right');
    expect((carte().controles[0].controle as { _showCompass?: boolean; options?: { showCompass?: boolean } }).options?.showCompass).toBe(false);
    const zooms: number[] = [];
    f.componentInstance.zoom.subscribe((z) => zooms.push(z));
    carte().zoom = 6.5;
    carte().emettre('zoom');
    expect(zooms).toEqual([6.5]);
  });

  it("crée la carte HORS de la zone Angular (NgZone.runOutsideAngular) : un shell sous zone.js ne détecte pas à chaque mouvement de souris", async () => {
    // Règle des lots suivants (revue finale du lot AIDA). Tenue AUJOURD'HUI par
    // `afterNextRender`, qu'Angular exécute via `ngZone.runOutsideAngular`
    // (AfterRenderManager) : ce test verrouille la propriété si la création
    // quittait un jour `afterNextRender`. Indifférent en zoneless.
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ObservateurFactice;
    const appels: boolean[] = [];
    let dehors = false;
    TestBed.configureTestingModule({
      providers: [
        { provide: FABRIQUE_CARTE, useValue: (o: never) => { appels.push(dehors); return new CarteFactice(o); } },
        { provide: BASE_RESSOURCES, useValue: BASE },
      ],
    });
    const zone = TestBed.inject(NgZone);
    vi.spyOn(zone, 'runOutsideAngular').mockImplementation((fn) => {
      dehors = true;
      try { return fn(); } finally { dehors = false; }
    });
    const f = TestBed.createComponent(CarteComponent);
    f.componentRef.setInput('cadre', [4.75, 43.35, 5.3, 43.6]);
    await f.whenStable();
    expect(appels).toEqual([true]);
  });

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

  it('signale un style qui échoue AVANT le chargement', async () => {
    const { carte, erreurs } = await rendre();
    carte().emettre('error', { error: new Error('style introuvable') });
    expect(erreurs).toEqual(["Le fond de carte n'a pas pu être chargé."]);
  });

  it('ne signale PAS une erreur de tuile survenue APRÈS le chargement', async () => {
    const { carte, erreurs } = await rendre();
    carte().emettre('load');
    carte().emettre('error', { error: new Error('tuile 404') });
    expect(erreurs).toEqual([]);
  });

  it('ne signale PAS un glyphe, un sprite ou une tuile en 404 survenu avant le chargement', async () => {
    const { carte, erreurs } = await rendre();
    carte().styleCharge = true; // le JSON du style est là, ses dépendances échouent
    carte().emettre('error', { error: new Error('glyphe 404') });
    carte().emettre('error', { error: new Error('tuile 404'), sourceId: 'zones', tile: {} });
    carte().emettre('load');
    expect(erreurs).toEqual([]);
  });

  it('ne signale PAS une erreur de tuile même si le style est encore en chargement', async () => {
    const { carte, erreurs } = await rendre();
    carte().emettre('error', { error: new Error('tuile 404'), sourceId: 'openmaptiles' });
    expect(erreurs).toEqual([]);
  });

  it('recadre une seule fois quand `cadre` change, et pas au rendu initial', async () => {
    const { f, carte } = await rendre();
    expect(carte().cadrages).toEqual([]);
    f.componentRef.setInput('cadre', [2, 48, 3, 49]);
    await f.whenStable();
    expect(carte().cadrages).toEqual([{ cadre: [2, 48, 3, 49], options: { padding: 40, animate: false } }]);
  });

  it('pose la feuille de style MapLibre dans <head>, résolue contre l\'application distante', async () => {
    await rendre();
    const lien = document.head.querySelector('link[data-mg-maplibre]');
    expect(lien).not.toBeNull();
    expect(lien?.getAttribute('href')).toBe('https://distante.exemple/remotes/magelian/maplibre.css');
  });

  it('signale une feuille de style MapLibre qui ne charge pas', async () => {
    const { erreurs } = await rendre();
    document.head.querySelector('link[data-mg-maplibre]')!.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 0));
    expect(erreurs).toEqual(["La feuille de style de la carte n'a pas pu être chargée."]);
  });

  describe("dans une racine d'ombre (isolation CSS : toute l'application y vit)", () => {
    /** Un hôte en ViewEncapsulation.ShadowDom, comme RacineDistanteComponent. */
    @Component({
      selector: 'mg-hote-ombre',
      imports: [CarteComponent],
      encapsulation: ViewEncapsulation.ShadowDom,
      template: '<mg-carte [cadre]="cadre" (erreur)="erreurs.push($event)" />',
    })
    class HoteOmbre {
      cadre = [4.75, 43.35, 5.3, 43.6] as const;
      erreurs: string[] = [];
    }

    async function rendreDansOmbre() {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ObservateurFactice;
      TestBed.configureTestingModule({
        providers: [
          { provide: FABRIQUE_CARTE, useValue: (o: never) => new CarteFactice(o) },
          { provide: BASE_RESSOURCES, useValue: BASE },
        ],
      });
      const f = TestBed.createComponent(HoteOmbre);
      await f.whenStable();
      return { f, ombre: (f.nativeElement as HTMLElement).shadowRoot! };
    }

    it("pose maplibre.css DANS la racine d'ombre de la carte, jamais dans le <head> du document", async () => {
      const { ombre } = await rendreDansOmbre();
      const lien = ombre.querySelector('link[data-mg-maplibre]');
      expect(lien?.getAttribute('href')).toBe('https://distante.exemple/remotes/magelian/maplibre.css');
      expect(document.head.querySelector('link[data-mg-maplibre]')).toBeNull();
    });

    it('signale toujours une feuille MapLibre qui ne charge pas', async () => {
      const { f, ombre } = await rendreDansOmbre();
      ombre.querySelector('link[data-mg-maplibre]')!.dispatchEvent(new Event('error'));
      await new Promise((r) => setTimeout(r, 0));
      expect(f.componentInstance.erreurs).toEqual(["La feuille de style de la carte n'a pas pu être chargée."]);
    });
  });
});
