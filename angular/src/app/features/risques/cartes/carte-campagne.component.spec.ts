import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, Subject } from 'rxjs';
import { FABRIQUE_CARTE, FABRIQUE_POPUP } from '../../../carte/fabrique-carte';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { ThemeService } from '../../../core/theme/theme.service';
import { type ChargementCp, JeuxZonesApi } from '../data/jeux-zones.api';
import { SimulationApi } from '../data/simulation.api';
import { SimulationService } from '../etat/simulation.service';
import { type Periode, type VueSimulation, construireVue } from '../logique/simulation/vue';
import { reponseSimulation } from '../testing/simulation.fixture';
import {
  JETONS_CAMPAGNE, L_BASSINS, L_BASSINS_ETIQUETTE, L_CERCLES, L_CP, L_SITES, S_BASSINS, S_CERCLES,
  S_CP, S_SITES, cadreDesZones, contenuBulleCampagne, couleurIndice, fusionnerDiffusion,
} from '../logique/carte-campagne';
import { CarteCampagneComponent } from './carte-campagne.component';

class ObservateurFactice {
  observe = vi.fn();
  disconnect = vi.fn();
}

/** Les valeurs CLAIRES de `jetons.css` — ce que `paletteDuTheme(…, 'clair')` rend en vrai. */
const CLAIR: Record<string, string> = {
  'brand-teal': '#4ecdc4', 'text-tertiary': '#8a8a8a', 'text-primary': '#1a1a1a', 'halo-carte': 'rgba(255, 255, 255, 0.85)',
  'contour-carte': 'rgba(0,0,0,0.22)', success: '#0fa958', warning: '#c08400', danger: '#d4202f',
  'diverge-sous-3': '#9a2f08', 'diverge-sous-2': '#cc5f27', 'diverge-sous-1': '#e8a878', 'diverge-neutre': '#c6d2cf',
  'diverge-sur-1': '#7ba7cc', 'diverge-sur-2': '#2f6fa3', 'diverge-sur-3': '#14496f',
};
const TEINTES = Object.fromEntries(Object.entries(JETONS_CAMPAGNE).map(([k, v]) => [k, CLAIR[v]])) as never;
const JEU = '0b7ece33-4903-4a0b-a57a-f6c54e78a729';
const attendreAntiRebond = () => new Promise((r) => setTimeout(r, 400));

const GEO = {
  type: 'FeatureCollection' as const,
  features: [
    { type: 'Feature', geometry: null, properties: { type: 'bassin', id: 'za', rang: 1, nom: 'Fos-sur-Mer' } },
    { type: 'Feature', geometry: null, properties: { type: 'bassin', id: 'zb', rang: 2, nom: 'Saint-Fons' } },
    { type: 'Feature', geometry: null, properties: { type: 'site', cluster_id: 'za', nom: 'Usine', ville: 'Fos' } },
  ],
} as unknown as GeoJSON.FeatureCollection;

async function rendre(entrees: { actif?: boolean; vraiTheme?: boolean } = {}) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ObservateurFactice;
  let carte!: CarteFactice;
  const lectures: { bbox: string; rep: Subject<GeoJSON.FeatureCollection> }[] = [];
  const cps: { bbox: string; rep: Subject<ChargementCp> }[] = [];
  const popups: { options: unknown; contenu: HTMLElement | null; retiree: number }[] = [];
  const periode = signal<Periode>('tout');
  const zoneActive = signal<string | null>(null);
  const rep = signal(reponseSimulation('v2'));
  const vue = signal<VueSimulation | null>(construireVue(rep(), 'tout'));
  const couleurs = {
    paletteDuTheme: vi.fn((j: Record<string, string>, _t: string) => Object.fromEntries(Object.entries(j).map(([k, v]) => [k, CLAIR[v]]))),
    palette: vi.fn(),
  };
  const sujet = <T,>(liste: { bbox: string; rep: Subject<T> }[], bbox: string) => {
    const d = { bbox, rep: new Subject<T>() };
    liste.push(d);
    return new Observable<T>((o) => d.rep.subscribe(o));
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: FABRIQUE_CARTE, useValue: (o: never) => (carte = new CarteFactice(o)) },
      { provide: CouleursService, useValue: couleurs },
      { provide: SimulationService, useValue: { vue, zoneActive, periode, jeu: signal(JEU) } },
      { provide: SimulationApi, useValue: { carte: (_id: string, bbox: string) => sujet(lectures, bbox) } },
      { provide: JeuxZonesApi, useValue: { cpGeo: (_id: string, bbox: string) => sujet(cps, bbox) } },
      {
        provide: FABRIQUE_POPUP,
        useValue: (options: unknown) => {
          const p = { options, contenu: null as HTMLElement | null, retiree: 0 };
          popups.push(p);
          const api = {
            setLngLat: () => api, setDOMContent: (c: HTMLElement) => { p.contenu = c; return api; },
            addTo: () => api, remove: () => { p.retiree++; return api; },
          };
          return api;
        },
      },
    ],
  });
  const fixture: ComponentFixture<CarteCampagneComponent> = TestBed.createComponent(CarteCampagneComponent);
  fixture.componentRef.setInput('actif', entrees.actif ?? true);
  await fixture.whenStable();
  carte.emettre('load');
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, carte, lectures, cps, popups, periode, zoneActive, vue, rep, couleurs, el };
}

/** Les dernières données écrites dans une source. */
const derniere = (c: CarteFactice, s: string) => c.sources.get(s)!.donnees.at(-1) as GeoJSON.FeatureCollection;
const proprietes = (c: CarteFactice, s: string) => derniere(c, s).features.map((f) => f.properties as Record<string, unknown>);

describe('CarteCampagneComponent (T17)', () => {
  it('pose quatre sources et sept couches au `load`, couleurs portées par les entités — jamais `var()` dans `paint`', async () => {
    const { carte, couleurs } = await rendre();
    expect(couleurs.paletteDuTheme).toHaveBeenCalledWith(JETONS_CAMPAGNE, 'clair');
    expect(couleurs.palette).not.toHaveBeenCalled();
    expect([...carte.sources.keys()]).toEqual([S_BASSINS, S_SITES, S_CERCLES, S_CP]);
    expect(carte.couches.map((c) => c.couche['id'])).toEqual([
      'sim-cp-fond', 'sim-cp-contour', 'sim-bassins-fond', 'sim-bassins-contour', 'sim-cercles-couche', 'sim-sites-couche',
      'sim-bassins-etiquette',
    ]);
    expect(JSON.stringify(carte.couches)).not.toContain('var(');
    const etiquette = carte.getLayer(L_BASSINS_ETIQUETTE)!['paint'] as Record<string, unknown>;
    expect([etiquette['text-color'], etiquette['text-halo-color']]).toEqual(['#1a1a1a', 'rgba(255, 255, 255, 0.85)']);
  });

  it('lit `/simulation/carte` sur la bbox visible, une fois ; en mode « Codes postaux » ajoute `/cp-geo`', async () => {
    const { carte, lectures, cps, fixture, el } = await rendre();
    expect(lectures.map((l) => l.bbox)).toEqual(['4.7500,43.3500,5.3000,43.6000']);
    expect(cps).toHaveLength(0);
    lectures[0].rep.next(GEO);
    await fixture.whenStable();
    expect(proprietes(carte, S_BASSINS).map((p) => p['nom'])).toEqual(['Fos-sur-Mer', 'Saint-Fons']);
    expect(proprietes(carte, S_SITES)).toHaveLength(1);
    // Bascule → relecture avec les contours, au même cadre.
    [...el.querySelectorAll<HTMLButtonElement>('[data-lecture] button')][1].click();
    await fixture.whenStable();
    expect(lectures).toHaveLength(2);
    lectures[1].rep.next(GEO);
    expect(cps.map((c) => c.bbox)).toEqual(['4.7500,43.3500,5.3000,43.6000']);
    cps[0].rep.next({ type: 'FeatureCollection', features: [{ properties: { code_postal: '13001' } }], n_total: 1, n_affiches: 1, n_retenus: 1, taux_utile: null } as ChargementCp);
    await fixture.whenStable();
    expect(proprietes(carte, S_CP).map((p) => p['code_postal'])).toEqual(['13001']);
    expect(carte.dispositions.filter((d) => d.couche === L_CP).at(-1)!.valeur).toBe('visible');
    expect(carte.dispositions.filter((d) => d.couche === L_BASSINS).at(-1)!.valeur).toBe('none');
  });

  it('masquée (`actif` faux), elle ne lit rien', async () => {
    const { lectures, fixture } = await rendre({ actif: false });
    expect(lectures).toHaveLength(0);
    fixture.componentRef.setInput('actif', true);
    await fixture.whenStable();
    expect(lectures).toHaveLength(1);
  });

  it('changer de PÉRIODE → `setData` des couleurs, ZÉRO requête de géométrie', async () => {
    const { carte, lectures, cps, fixture, vue, rep } = await rendre();
    lectures[0].rep.next(GEO);
    await fixture.whenStable();
    const avant = proprietes(carte, S_BASSINS).map((p) => p['indice']);
    const ecritures = carte.sources.get(S_BASSINS)!.donnees.length;
    vue.set(construireVue(rep(), 'v1'));
    await fixture.whenStable();
    await attendreAntiRebond();
    expect(lectures).toHaveLength(1);
    expect(cps).toHaveLength(0);
    expect(carte.sources.get(S_BASSINS)!.donnees.length).toBe(ecritures + 1);
    expect(proprietes(carte, S_BASSINS).map((p) => p['indice'])).not.toEqual(avant);
  });

  it('bassins et sites peints de l’indice de LEUR zone ; une zone sélectionnée se souligne et se recadre', async () => {
    const { carte, lectures, fixture, vue, zoneActive } = await rendre();
    lectures[0].rep.next(GEO);
    await fixture.whenStable();
    const v = vue()!;
    const za = v.zones.find((z) => z.id === 'za')!;
    const [pa] = proprietes(carte, S_BASSINS);
    expect(pa['couleur']).toBe(couleurIndice(za.indice, TEINTES));
    expect(pa['etiquette']).toBe(`Fos-sur-Mer ${Math.round(za.indice!)}`);
    expect(pa['epaisseur']).toBe(0.8);
    zoneActive.set('za');
    await fixture.whenStable();
    expect(proprietes(carte, S_BASSINS)[0]['epaisseur']).toBe(2.5);
    expect(proprietes(carte, S_BASSINS)[0]['contour']).toBe('#1a1a1a');
    const recadrage = carte.cadrages.at(-1)!;
    expect(recadrage.options).toEqual({ padding: 40, duration: 600, maxZoom: 11 });
  });

  it('bascule de THÈME : aucun `setPaintProperty`, aucune source recréée, aucune relecture (palette claire fixe)', async () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ObservateurFactice;
    const { carte, lectures, fixture, couleurs } = await rendre();
    lectures[0].rep.next(GEO);
    await fixture.whenStable();
    const sources = carte.sources.size;
    const couches = carte.couches.length;
    const ecritures = carte.sources.get(S_BASSINS)!.donnees.length;
    TestBed.inject(ThemeService).basculer();
    await fixture.whenStable();
    await attendreAntiRebond();
    expect(carte.peintures).toEqual([]);
    expect(carte.sources.size).toBe(sources);
    expect(carte.couches).toHaveLength(couches);
    expect(carte.sources.get(S_BASSINS)!.donnees.length).toBe(ecritures);
    expect(lectures).toHaveLength(1);
    expect(couleurs.paletteDuTheme).toHaveBeenCalledTimes(1);
  });

  it('clic sur un bassin → zone active ; survol → bulle par `textContent`, effacée hors entité', async () => {
    const { carte, popups, zoneActive, lectures } = await rendre();
    carte.entitesRendues = [{ layer: { id: L_BASSINS }, properties: { id: 'zb' } }];
    carte.emettre('click', { point: { x: 1, y: 1 } });
    expect(zoneActive()).toBe('zb');
    carte.entitesRendues = [{ layer: { id: L_CERCLES }, properties: { codes: '13001, 13002', imps: 12345, achete: false } }];
    carte.emettre('mousemove', { point: { x: 1, y: 1 }, lngLat: { lng: 5, lat: 43 } });
    expect(popups[0].options).toEqual({ closeButton: false, closeOnClick: false, maxWidth: '260px' });
    expect(popups[0].contenu?.textContent?.replace(/[  ]/g, ' ')).toBe('13001, 13002Impressions12 345Statutfuite hors plan');
    carte.entitesRendues = [];
    carte.emettre('mousemove', { point: { x: 2, y: 2 }, lngLat: { lng: 5, lat: 43 } });
    expect(popups[0].retiree).toBe(1);
    expect(lectures).toHaveLength(1);
  });

  it('sans simulation : le message, et rien peint', async () => {
    const { el, vue, fixture } = await rendre();
    vue.set(null);
    await fixture.whenStable();
    expect(el.querySelector('[data-sans-simulation]')?.textContent?.trim()).toBe('Lancez une simulation pour voir la diffusion dans les zones.');
  });

  it('premier cadrage : AUCUN `fitBounds` tant que la carte est masquée ; à l’écran, UN seul, après `resize()`', async () => {
    const { carte, fixture, vue, rep } = await rendre({ actif: false });
    const ordre: string[] = [];
    const resize = carte.resize.bind(carte);
    const fitBounds = carte.fitBounds.bind(carte);
    carte.resize = () => { ordre.push('resize'); return resize(); };
    carte.fitBounds = (c: unknown, o?: unknown) => { ordre.push('fitBounds'); return fitBounds(c, o); };
    // La simulation arrive pendant que la carte est masquée (largeur nulle).
    vue.set(construireVue(rep(), 'v1'));
    await fixture.whenStable();
    expect(carte.cadrages).toHaveLength(0);
    fixture.componentRef.setInput('actif', true);
    await fixture.whenStable();
    expect(carte.cadrages).toHaveLength(1);
    expect(carte.cadrages[0].options).toEqual({ padding: 40, duration: 0, maxZoom: 9 });
    expect(ordre.indexOf('resize')).toBeGreaterThanOrEqual(0);
    expect(ordre.indexOf('resize')).toBeLessThan(ordre.indexOf('fitBounds'));
    // Masquée puis réaffichée (⑤ → ① → ⑤) : pas de second cadrage.
    fixture.componentRef.setInput('actif', false);
    await fixture.whenStable();
    fixture.componentRef.setInput('actif', true);
    vue.set(construireVue(rep(), 'tout'));
    await fixture.whenStable();
    expect(carte.cadrages).toHaveLength(1);
  });

  it('simulation PURGÉE (vue nulle) : les quatre sources sont vidées — défaut React corrigé', async () => {
    const { carte, lectures, fixture, vue } = await rendre();
    lectures[0].rep.next(GEO);
    await fixture.whenStable();
    expect(proprietes(carte, S_BASSINS)).toHaveLength(2);
    vue.set(null);
    await fixture.whenStable();
    for (const s of [S_BASSINS, S_SITES, S_CERCLES, S_CP]) expect(derniere(carte, s).features).toEqual([]);
  });

  it('la légende est peinte avec la MÊME palette claire que la carte (sept tranches, six bornes)', async () => {
    const { el } = await rendre();
    const pastilles = [...el.querySelectorAll<HTMLElement>('[data-legende-campagne] .w-\\[22px\\]')].map((s) => s.style.background);
    expect(pastilles).toHaveLength(7);
    expect(el.querySelector('[data-legende-campagne]')!.textContent).toContain('Indice de pression · part diffusée ÷ part du plan');
  });
});

describe('fusionnerDiffusion', () => {
  const vue = construireVue(reponseSimulation('v2'), 'v1')!;
  const geo = {
    bassins: { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, geometry: null as never, properties: { id: 'zz', nom: 'Sans plan' } }] },
    sites: { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, geometry: null as never, properties: { cluster_id: 'zz' } }] },
    cp: { type: 'FeatureCollection' as const, features: [] },
  };

  it('⚠ une zone SANS indice est grise (fuite), jamais « conforme » — garde `trancheIndice`', () => {
    const f = fusionnerDiffusion(geo, vue, null, 'bassins', true, TEINTES);
    expect(f.bassins.features[0].properties['couleur']).toBe('#8a8a8a');
    expect(f.bassins.features[0].properties['couleur']).not.toBe(CLAIR['diverge-neutre']);
    expect(f.bassins.features[0].properties['etiquette']).toBe('Sans plan ');
    expect(f.sites.features[0].properties['couleur']).toBe('#8a8a8a');
  });

  it('un cercle par POSITION, rayon ∝ racine des impressions ; décoché → aucun cercle', () => {
    const f = fusionnerDiffusion(geo, vue, null, 'bassins', true, TEINTES);
    const r = f.cerclesFc.features.map((x) => x.properties['r'] as number);
    expect(f.cerclesFc.features).toHaveLength(3);
    expect(Math.max(...r)).toBe(1);
    expect(fusionnerDiffusion(geo, vue, null, 'bassins', false, TEINTES).cerclesFc.features).toEqual([]);
  });

  it('le cadre ignore un bassin hors métropole', () => {
    expect(cadreDesZones([{ bbox: [5, 43, 6, 44] }, { bbox: [-54, 3, -52, 5] }] as never)).toEqual([5, 43, 6, 44]);
    expect(cadreDesZones([] as never)).toBeNull();
  });

  it('bulle d’un bassin inconnu → rien ; bulle d’un site avec sa ville', () => {
    expect(contenuBulleCampagne(L_BASSINS, { id: 'inconnu' }, vue.zones)).toBeNull();
    expect(contenuBulleCampagne(L_SITES, { nom: 'Usine', ville: 'Fos' }, vue.zones)?.textContent).toBe('UsineFos');
  });
});
