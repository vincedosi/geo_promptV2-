import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, Subject } from 'rxjs';
import { FABRIQUE_CARTE, FABRIQUE_POPUP } from '../../../carte/fabrique-carte';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { type ChargementCp, JeuxZonesApi } from '../data/jeux-zones.api';
import { ZonesRisqueApi } from '../data/zones-risque.api';
import { AtelierJeuxService } from '../etat/atelier-jeux.service';
import { codeZonesRisque } from '../logique/code-profil';
import { ThemeService } from '../../../core/theme/theme.service';
import {
  CarteCodesPostauxComponent, type ChiffresCp, ID_ECARTES_CP, ID_FOND_CP, ID_RAYONS_CP, ID_SURBRILLANCE_CP,
  SOURCE_CP, SOURCE_RAYONS_CP, contenuBulleCp,
} from './carte-codes-postaux.component';

class ObservateurFactice {
  observe = vi.fn();
  disconnect = vi.fn();
}

/** Les valeurs SOMBRES de `jetons.css` — ce que `paletteDuTheme(…, 'sombre')` rend en vrai. */
const SOMBRE: Record<string, string> = {
  'seq-1': '#132625', 'seq-2': '#1b3d3a', 'seq-3': '#2a6b62', 'seq-4': '#3a9e91', 'seq-5': '#4ecdc4',
  'donnee-absente': '#9aa0a6', 'text-tertiary': '#8a8a8a', 'niveau-haut': '#e0603f', 'brand-teal': '#4ecdc4',
};
const JEU = '0b7ece33-4903-4a0b-a57a-f6c54e78a729';
const PROFIL = 'h1000.2000.5000_b500.1000_a_L0_P1';
const attendreAntiRebond = () => new Promise((r) => setTimeout(r, 400));

function reponse(n: Partial<ChargementCp> = {}): ChargementCp {
  return {
    type: 'FeatureCollection', features: [{ properties: { code_postal: '13130', retenu: true } }],
    n_total: 1942, n_affiches: 57, n_retenus: 1006, taux_utile: 81.6, ...n,
  };
}

async function rendre(entrees: { jeuId?: string | null; actif?: boolean; cleRayonsPrete?: string | null } = {}) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ObservateurFactice;
  let carte!: CarteFactice;
  const demandes: { jeu: string; bbox: string; rep: Subject<ChargementCp>; annulee: boolean }[] = [];
  const popups: { options: unknown; contenu: HTMLElement | null; retiree: number }[] = [];
  const reglage = signal(0);
  const couleurs = {
    paletteDuTheme: vi.fn((j: Record<string, string>, _t: string) =>
      Object.fromEntries(Object.entries(j).map(([k, v]) => [k, SOMBRE[v]]))),
    palette: vi.fn(),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: FABRIQUE_CARTE, useValue: (o: never) => (carte = new CarteFactice(o)) },
      { provide: CouleursService, useValue: couleurs },
      { provide: AtelierJeuxService, useValue: { reglage } },
      {
        provide: JeuxZonesApi,
        useValue: {
          cpGeo: (jeu: string, bbox: string) => {
            const d = { jeu, bbox, rep: new Subject<ChargementCp>(), annulee: false };
            demandes.push(d);
            return new Observable<ChargementCp>((o) => {
              const s = d.rep.subscribe(o);
              return () => { d.annulee = true; s.unsubscribe(); };
            });
          },
        },
      },
      {
        provide: ZonesRisqueApi,
        useValue: {
          urlTuilesZones: (profil: string, natures: string[] = []) =>
            `http://api/tiles/zones-risque/{z}/{x}/{y}?profil=${profil}${natures.length ? `&natures=${natures.join(',')}` : ''}`,
        },
      },
      {
        provide: FABRIQUE_POPUP,
        useValue: (options: unknown) => {
          const p = { options, contenu: null as HTMLElement | null, retiree: 0 };
          popups.push(p);
          const api = {
            setLngLat: () => api,
            setDOMContent: (c: HTMLElement) => { p.contenu = c; return api; },
            addTo: () => api,
            remove: () => { p.retiree++; return api; },
          };
          return api;
        },
      },
    ],
  });
  const fixture: ComponentFixture<CarteCodesPostauxComponent> = TestBed.createComponent(CarteCodesPostauxComponent);
  const chiffres: (ChiffresCp | null)[] = [];
  fixture.componentInstance.chiffres.subscribe((c) => chiffres.push(c));
  fixture.componentRef.setInput('jeuId', entrees.jeuId === undefined ? JEU : entrees.jeuId);
  fixture.componentRef.setInput('codeProfil', PROFIL);
  fixture.componentRef.setInput('cleRayonsPrete', entrees.cleRayonsPrete === undefined ? PROFIL : entrees.cleRayonsPrete);
  fixture.componentRef.setInput('actif', entrees.actif ?? true);
  await fixture.whenStable();
  carte.emettre('load');
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, carte, demandes, popups, reglage, couleurs, chiffres, el };
}

describe('CarteCodesPostauxComponent (T15)', () => {
  it('pose source et couches au `load`, avec la palette SOMBRE fixe (A11) — jamais `palette()` du thème courant', async () => {
    const { carte, couleurs } = await rendre();
    expect(couleurs.paletteDuTheme).toHaveBeenCalledWith(expect.anything(), 'sombre');
    expect(couleurs.palette).not.toHaveBeenCalled();
    expect([...carte.sources.keys()]).toEqual([SOURCE_CP, SOURCE_RAYONS_CP]);
    const couche = (id: string) => carte.getLayer(id)!;
    // Gris de l'écarté = `--donnee-absente` à 0,28 par `fill-opacity`, jamais un rgba recopié.
    expect(couche(ID_ECARTES_CP)['paint']).toEqual({ 'fill-color': '#9aa0a6', 'fill-opacity': 0.28 });
    expect(JSON.stringify(couche(ID_FOND_CP)['paint'])).toContain('"#132625"');
    expect(JSON.stringify(couche(ID_FOND_CP)['paint'])).toContain('"#4ecdc4"');
    expect((couche(ID_RAYONS_CP)['paint'] as Record<string, unknown>)['line-color']).toBe('#e0603f');
    expect((couche(ID_SURBRILLANCE_CP)['paint'] as Record<string, unknown>)['line-color']).toBe('#4ecdc4');
    expect(JSON.stringify([...carte.sources.values()].map((s) => s.spec))).not.toContain('var(');
  });

  it('lit `/cp-geo` sur la bbox visible, une fois — et ne relit RIEN au repos ni sur un `moveend` au même cadre', async () => {
    const { carte, demandes, chiffres, el, fixture } = await rendre();
    expect(demandes.map((d) => [d.jeu, d.bbox])).toEqual([[JEU, '4.7500,43.3500,5.3000,43.6000']]);
    expect(carte.appelsResize).toBeGreaterThan(0);
    demandes[0].rep.next(reponse());
    demandes[0].rep.complete();
    await fixture.whenStable();
    expect(carte.sources.get(SOURCE_CP)!.donnees).toHaveLength(1);
    expect(chiffres).toEqual([{ n_total: 1942, n_affiches: 57, n_retenus: 1006, taux_utile: 81.6 }]);
    expect(el.querySelector('[data-legende-cp]')?.textContent).toContain('Part du plan');
    // Défaut React corrigé : un `resize` ou un `jumpTo` de la carte liée émet `moveend` sans changer le cadre.
    for (let i = 0; i < 5; i++) carte.emettre('moveend');
    await attendreAntiRebond();
    expect(demandes).toHaveLength(1);
  });

  it('un vrai déplacement relit après le calme, la requête précédente annulée ; une salve = UN appel', async () => {
    const { carte, demandes } = await rendre();
    carte.cadre = [5, 43, 5.5, 43.5];
    for (let i = 0; i < 5; i++) carte.emettre('moveend');
    expect(demandes).toHaveLength(1);
    await attendreAntiRebond();
    expect(demandes).toHaveLength(2);
    expect(demandes[0].annulee).toBe(true);
    expect(demandes[1].bbox).toBe('5.0000,43.0000,5.5000,43.5000');
  });

  it('masquée (`actif` faux), elle ne lit rien ; visible, elle lit ; masquée puis revenue au même cadre, rien de plus', async () => {
    const { demandes, fixture } = await rendre({ actif: false });
    expect(demandes).toHaveLength(0);
    fixture.componentRef.setInput('actif', true);
    await fixture.whenStable();
    expect(demandes).toHaveLength(1);
    demandes[0].rep.next(reponse());
    fixture.componentRef.setInput('actif', false);
    await fixture.whenStable();
    fixture.componentRef.setInput('actif', true);
    await fixture.whenStable();
    expect(demandes).toHaveLength(1);
  });

  it('un réglage du seuil (`reglage` incrémenté) relit UNE fois, au même cadre', async () => {
    const { demandes, reglage, fixture } = await rendre();
    demandes[0].rep.next(reponse());
    reglage.set(1);
    await fixture.whenStable();
    expect(demandes).toHaveLength(2);
    expect(demandes[1].bbox).toBe(demandes[0].bbox);
  });

  it('sans jeu : aucun appel, le bandeau le dit ; un échec est affiché et remonte `null`', async () => {
    const vide = await rendre({ jeuId: null });
    expect(vide.demandes).toHaveLength(0);
    expect(vide.el.querySelector('[data-etat-cp]')?.textContent).toContain('Aucun jeu construit');
    TestBed.resetTestingModule();
    const { demandes, chiffres, el, fixture } = await rendre();
    expect(el.querySelector('[data-etat-cp]')?.textContent).toContain('Chargement des codes postaux…');
    demandes[0].rep.error(new HttpErrorResponse({ status: 404, error: { error: 'Jeu introuvable.' } }));
    await fixture.whenStable();
    expect(el.querySelector('[data-etat-cp]')?.textContent).toContain('Jeu introuvable.');
    expect(chiffres).toEqual([null]);
  });

  it('la variable de coloration → `setPaintProperty` seul ; la surbrillance → un filtre, sans requête', async () => {
    const { carte, demandes, fixture } = await rendre();
    fixture.componentRef.setInput('coloration', 'population');
    fixture.componentRef.setInput('surbrillance', ['13130', '13500']);
    await fixture.whenStable();
    const peinture = carte.peintures.filter((p) => p.couche === ID_FOND_CP);
    expect(peinture).toHaveLength(1);
    expect(JSON.stringify(peinture[0].valeur)).toContain('"pop_en_zone"');
    expect(carte.filtres.at(-1)).toEqual({
      couche: ID_SURBRILLANCE_CP, filtre: ['in', ['get', 'code_postal'], ['literal', ['13130', '13500']]],
    });
    expect(demandes).toHaveLength(1);
  });

  it('la surimpression des rayons suit la clé du profil (retirée puis reposée), jamais posée carte masquée', async () => {
    const masquee = await rendre({ actif: false });
    expect(masquee.carte.sources.has(SOURCE_RAYONS_CP)).toBe(false);
    TestBed.resetTestingModule();
    const { carte, fixture } = await rendre();
    fixture.componentRef.setInput('natures', ['Toxiques']);
    await fixture.whenStable();
    // La nouvelle clé n'est pas encore préparée par la carte des rayons : rien ne bouge, aucune tuile demandée.
    expect(carte.retraits).toEqual([]);
    fixture.componentRef.setInput('cleRayonsPrete', codeZonesRisque(PROFIL, ['Toxiques']));
    await fixture.whenStable();
    expect(carte.retraits).toEqual([`couche:${ID_RAYONS_CP}`, `source:${SOURCE_RAYONS_CP}`]);
    expect((carte.sources.get(SOURCE_RAYONS_CP)!.spec as { tiles: string[] }).tiles[0]).toContain('&natures=Toxiques');
  });

  it('relecture T15 : la surimpression attend que la carte des rayons ait PRÉPARÉ la clé — aucune tuile avant', async () => {
    const { carte, fixture } = await rendre({ cleRayonsPrete: null });
    expect(carte.sources.has(SOURCE_RAYONS_CP)).toBe(false);
    fixture.componentRef.setInput('cleRayonsPrete', 'une-autre-cle');
    await fixture.whenStable();
    expect(carte.sources.has(SOURCE_RAYONS_CP)).toBe(false);
    fixture.componentRef.setInput('cleRayonsPrete', PROFIL);
    await fixture.whenStable();
    expect((carte.sources.get(SOURCE_RAYONS_CP)!.spec as { tiles: string[] }).tiles[0]).toContain(`profil=${PROFIL}`);
  });

  it('bascule de THÈME (vrai ThemeService) : aucun `setPaintProperty`, aucune source, aucune relecture de `/cp-geo`', async () => {
    const { carte, demandes, fixture, couleurs } = await rendre();
    demandes[0].rep.next(reponse());
    await fixture.whenStable();
    const sources = carte.sources.size;
    TestBed.inject(ThemeService).basculer();
    await fixture.whenStable();
    await attendreAntiRebond();
    expect(carte.peintures).toEqual([]);
    expect(carte.sources.size).toBe(sources);
    expect(demandes).toHaveLength(1);
    expect(couleurs.paletteDuTheme).toHaveBeenCalledTimes(1);
  });

  it('la bulle suit la souris (aucune requête) et s’efface hors d’un code postal', async () => {
    const { carte, popups, demandes } = await rendre();
    carte.entitesRendues = [{ properties: { code_postal: '44000', n_membres: 4, pop_en_zone: 1234, pop_totale: 50000, taux_exposition: 23.4, part_plan: 0.00123, retenu: true } }];
    carte.emettre('mousemove', { point: { x: 1, y: 1 }, lngLat: { lng: 5, lat: 43 } });
    expect(popups).toHaveLength(1);
    expect(popups[0].options).toEqual({ closeButton: false, closeOnClick: false });
    expect(popups[0].contenu?.textContent).toContain('+ 3 code(s) indissociable(s)');
    carte.entitesRendues = [];
    carte.emettre('mousemove', { point: { x: 2, y: 2 }, lngLat: { lng: 5, lat: 43 } });
    expect(popups[0].retiree).toBe(1);
    expect(demandes).toHaveLength(1);
  });
});

describe('contenuBulleCp', () => {
  it('écrit les nombres à la française (React : « 23.4 % », « 0.123 % ») et dit « Écarté par le seuil »', () => {
    const el = contenuBulleCp({ code_postal: '13130', pop_en_zone: 1234, pop_totale: 5678, taux_exposition: 23.4, part_plan: 0.00123, retenu: false });
    const lignes = [...el.children].map((c) => c.textContent?.replace(/ | /g, ' '));
    expect(lignes).toEqual([
      '13130', 'Exposés : 1 234 / 5 678 habitants', 'Taux d’exposition : 23,4 %', 'Part du plan : 0,123 %', 'Écarté par le seuil',
    ]);
    expect(contenuBulleCp({ code_postal: '1', taux_exposition: null }).children[2].textContent).toBe('Taux d’exposition : — %');
    // Un entier reste entier, comme React (« 23 % ») : jamais « 23,0 ».
    expect(contenuBulleCp({ code_postal: '1', taux_exposition: 23 }).children[2].textContent).toBe('Taux d’exposition : 23 %');
  });
});
