import { Component, type Injector, computed, effect, inject, runInInjectionContext, signal } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Subject, of, throwError } from 'rxjs';
import { FABRIQUE_CARTE } from '../../carte/fabrique-carte';
import { CarteFactice } from '../../carte/testing/carte-factice';
import { AuthService } from '../../core/auth/auth.service';
import { OrganisationsApi } from '../session/data/organisations.api';
import { ReferentielApi } from '../risques/data/referentiel.api';
import { CarreauxApi } from './data/carreaux.api';
import { IrisApi } from './data/iris.api';
import { CarteApi } from './data/carte.api';
import { RadioApi } from './data/radio.api';
import { SitesRisqueApi } from '../risques/data/sites-risque.api';
import { CiviqueApi } from './data/civique.api';
import { MeteoApi } from './data/meteo.api';
import { IsochronesApi } from './data/isochrones.api';
import { AnalysesApi } from './data/analyses.api';
import { ClusteringApi } from './data/clustering.api';
import { ZonesCustomApi } from './data/zones-custom.api';
import { JeuxZonesApi } from '../risques/data/jeux-zones.api';
import { ZonesRisqueApi } from '../risques/data/zones-risque.api';
import { PONT_CARTE } from './etat/pont-carte';
import { ZonesRisqueService } from './couches/zones-risque.service';
import { ZonesCustomService } from './couches/zones-custom.service';
import type { ZoneCustomResume } from './data/zones-custom.api';
import { CouleursService } from '../../core/theme/couleurs.service';
import { CartePage } from './carte.page';
import { AnnonceService } from './etat/annonce.service';
import { CouchesCarteService, quandStyleCharge } from './etat/couches-carte.service';
import { EtatCarteService } from './etat/etat-carte.service';
import { MeteoService } from './couches/meteo.service';
import { PileEchapService } from './etat/pile-echap.service';
import { ENTREES_NAVIGATION } from './logique/navigation';

@Component({ selector: 'mg-vide', template: '' })
class Vide {}

/** Le module risque, réduit à ce que la carte doit lui offrir : le pont (B3), vu par l'injecteur de l'outlet. */
@Component({ selector: 'mg-module-factice', template: '' })
class ModuleFactice {
  readonly pont = inject(PONT_CARTE, { optional: true });
}

class ObservateurFactice {
  observe = vi.fn();
  disconnect = vi.fn();
}

const attendre = () => new Promise((r) => setTimeout(r, 0));

/** Ce qu'un test peut changer à l'ouverture : l'adresse (un lien `?customZone=`), les zones enregistrées, l'organisation. */
interface OptionsOuverture {
  url?: string;
  zones?: Partial<Record<keyof ZonesCustomApi, unknown>>;
  organisation?: string | null;
}

async function ouvrir(options: OptionsOuverture = {}) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ObservateurFactice;
  const cartes: CarteFactice[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'carte', component: CartePage, children: [{ path: 'risques', component: ModuleFactice }] },
        { path: '', component: Vide },
      ]),
      { provide: FABRIQUE_CARTE, useValue: (o: never) => { const c = new CarteFactice(o); cartes.push(c); return c; } },
      {
        provide: AuthService,
        useValue: {
          session: signal({ access_token: 'j', user: { email: 'a@exemple.test', user_metadata: {} } }),
          connecte: computed(() => true), email: computed(() => 'a@exemple.test'),
          lireRole: async () => null, deconnecter: async () => undefined,
          lireProfil: async () => ({ role: null, nom: null, organisation: options.organisation ?? null }),
          oublierProfil: () => undefined,
        },
      },
      { provide: OrganisationsApi, useValue: { lister: () => of({ organizations: [], active_org_id: null, is_super_admin: false }), changer: () => of() } },
      { provide: ReferentielApi, useValue: { geo: () => of({ regions: [] }) } },
      {
        provide: ZonesCustomApi,
        useValue: {
          lister: () => of({ zones: [] }), stats: () => of({}), geometrie: () => of(), exporter: () => of(),
          totauxNationaux: () => of({ totals: {} }), audienceItems: () => of({ items: null }), zone: () => of({}), campagnesPlan: () => of({ campaigns: [] }),
          ...options.zones,
        },
      },
      { provide: ZonesRisqueApi, useValue: { urlTuilesZones: () => '/api/tiles/zones-risque/{z}/{x}/{y}?profil=x', preparer: () => of({ classes: 1 }) } },
      { provide: JeuxZonesApi, useValue: { lister: () => of({ jeux: [] }) } },
      { provide: CarreauxApi, useValue: { urlTuiles: () => '/api/tiles/{z}/{x}/{y}?v=19' } },
      { provide: IrisApi, useValue: { urlTuiles: () => '/api/tiles/iris/{z}/{x}/{y}?v=2', bornes: () => of({}), detail: () => of() } },
      { provide: CarteApi, useValue: { categories: () => of({ categories: ['lycee', 'panneaux', 'risque_industriel'] }), pois: () => of(), ooh: () => of(), transport: () => of(), urlTuilesTmja: () => '/api/tmja-tiles/{z}/{x}/{y}?v=v10' } },
      { provide: RadioApi, useValue: { optionsFiltre: () => of({}), emetteurs: () => of({ type: 'FeatureCollection', features: [] }), stations: () => of({}) } },
      { provide: MeteoApi, useValue: { donnees: () => of() } },
      { provide: IsochronesApi, useValue: {} },
      // Mes analyses (T18) : le groupe reste replié dans ces essais — la liste n'est jamais lue.
      { provide: AnalysesApi, useValue: {} },
      { provide: ClusteringApi, useValue: {} },
      { provide: SitesRisqueApi, useValue: { carte: () => of(), exposition: () => of() } },
      { provide: CiviqueApi, useValue: { geojsonVariable: () => of(), detailCp: () => of(), zones: () => of(), santeDepartement: () => of(), santeCp: () => of(), santeCommune: () => of() } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(options.url ?? '/carte');
  const stable = async () => {
    for (let i = 0; i < 3; i++) { await attendre(); await harness.fixture.whenStable(); }
  };
  await stable();
  const hote = harness.fixture.nativeElement.querySelector('mg-carte-principale') as HTMLElement;
  return { harness, hote, cartes, stable };
}

/** Une frappe sur l'hôte, dont la cible COMPOSÉE est `cible` (par défaut l'hôte lui-même). */
function frapper(hote: HTMLElement, init: KeyboardEventInit, cible: Element = hote): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, composed: true, cancelable: true, ...init });
  cible.dispatchEvent(e);
  return e;
}

const titrePanneau = (hote: HTMLElement) => hote.querySelector('mg-panneau-carte')?.getAttribute('aria-label') ?? null;

describe('CartePage — squelette de la carte principale', () => {
  it("(f) le rail rend les entrées de ENTREES_NAVIGATION dans l'ordre (l'Assistant retiré le 2026-10-12) : 5 en haut, 2 en bas", async () => {
    const { hote } = await ouvrir();
    const rail = hote.querySelector('mg-rail')!;
    const ids = [...rail.querySelectorAll('button[data-entree]')].map((b) => b.getAttribute('data-entree'));
    expect(ids).toEqual(ENTREES_NAVIGATION.map((e) => e.id));
    expect(rail.querySelectorAll('[data-bas] button[data-entree]').length).toBe(2);
    expect(ids.length - 2).toBe(5);
    // Libellés et infobulles de la source unique.
    const filtre = rail.querySelector('button[data-entree="filtre"]')!;
    expect(filtre.textContent?.trim()).toBe('Filtre');
    expect(filtre.getAttribute('title')).toBe('Où je regarde');
    // Un seul séparateur : celui qui suit Campagne (celui de l'Assistant est parti avec lui).
    expect(rail.querySelectorAll('[data-separateur]').length).toBe(1);
  });

  it('(g) Alt+2 sur l\'hôte ouvre « Calques », Échap le ferme (après la sortie de 200 ms)', async () => {
    const { hote, stable } = await ouvrir();
    const e = frapper(hote, { key: '2', altKey: true });
    await stable();
    expect(e.defaultPrevented).toBe(true);
    expect(titrePanneau(hote)).toBe('Calques');
    frapper(hote, { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(titrePanneau(hote)).toBeNull();
  });

  it("(h) Alt+2 dont la cible composée est un <input> : rien", async () => {
    const { hote, stable } = await ouvrir();
    const champ = document.createElement('input');
    hote.appendChild(champ);
    frapper(hote, { key: '2', altKey: true }, champ);
    await stable();
    expect(titrePanneau(hote)).toBeNull();
  });

  it('(i) Échap depuis un <input> ferme quand même', async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, { key: '1', altKey: true });
    await stable();
    expect(titrePanneau(hote)).toBe('Filtre');
    const champ = document.createElement('input');
    hote.appendChild(champ);
    frapper(hote, { key: 'Escape' }, champ);
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(titrePanneau(hote)).toBeNull();
  });

  it('(j) Campagne est inerte : clic et Alt+C n\'ouvrent rien ; Ctrl+K (Assistant) n\'est pas capté', async () => {
    const { hote, stable } = await ouvrir();
    const campagne = hote.querySelector<HTMLButtonElement>('mg-rail button[data-entree="campagne"]')!;
    expect(campagne.getAttribute('aria-disabled')).toBe('true');
    expect(campagne.getAttribute('title')).toBe('Disponible prochainement');
    campagne.click();
    frapper(hote, { key: 'c', altKey: true });
    const k = frapper(hote, { key: 'k', ctrlKey: true });
    await stable();
    expect(titrePanneau(hote)).toBeNull();
    expect(hote.querySelector('mg-rail [aria-pressed="true"]')).toBeNull();
    expect(k.defaultPrevented).toBe(false);
  });

  it('un clic sur une entrée ouvre son panneau (titre, point de couleur), re-cliquer le ferme ; un autre outil garde le MÊME panneau', async () => {
    const { hote, stable } = await ouvrir();
    const bouton = (id: string) => hote.querySelector<HTMLButtonElement>(`mg-rail button[data-entree="${id}"]`)!;
    bouton('analyse').click();
    await stable();
    const panneau = hote.querySelector('mg-panneau-carte')!;
    expect(titrePanneau(hote)).toBe('Analyse');
    expect(panneau.querySelector<HTMLElement>('[data-pastille]')!.style.background).toBe('var(--cat-analysis)');
    expect(bouton('analyse').getAttribute('aria-pressed')).toBe('true');
    bouton('zones').click();
    await stable();
    expect(hote.querySelector('mg-panneau-carte')).toBe(panneau);
    expect(titrePanneau(hote)).toBe('Zones');
    bouton('zones').click();
    await stable();
    expect(titrePanneau(hote)).toBeNull();
  });

  it('un clic HORS du panneau et du rail le ferme ; dans le panneau, non', async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, { key: '3', altKey: true });
    await stable();
    hote.querySelector('mg-panneau-carte')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(titrePanneau(hote)).toBe('Analyse');
    hote.querySelector('mg-carte')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(titrePanneau(hote)).toBeNull();
  });

  it('fermer le panneau par sa croix RENDRA le focus à l\'hôte : Alt+2 puis Échap répondent encore', async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, { key: '1', altKey: true });
    await stable();
    const croix = hote.querySelector<HTMLButtonElement>('mg-panneau-carte button[aria-label="Fermer"]')!;
    croix.focus();
    expect(document.activeElement).toBe(croix);
    croix.click();
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(titrePanneau(hote)).toBeNull();
    // La croix est partie avec le panneau : sans correctif, le focus serait sur <body>, hors de l'écouteur.
    expect(document.activeElement).toBe(hote);
    frapper(document.activeElement as HTMLElement, { key: '2', altKey: true });
    await stable();
    expect(titrePanneau(hote)).toBe('Calques');
    frapper(document.activeElement as HTMLElement, { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(titrePanneau(hote)).toBeNull();
  });

  it('fermer le panneau sans que le focus y soit (re-clic du rail) ne déplace pas le focus', async () => {
    const { hote, stable } = await ouvrir();
    const bouton = hote.querySelector<HTMLButtonElement>('mg-rail button[data-entree="calques"]')!;
    bouton.click();
    await stable();
    bouton.focus();
    bouton.click();
    await stable();
    expect(titrePanneau(hote)).toBeNull();
    expect(document.activeElement).toBe(bouton);
  });

  it("Échap dans un menu ouvert du badge de session ferme le MENU seulement, pas le panneau", async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, { key: '3', altKey: true });
    await stable();
    hote.querySelector<HTMLButtonElement>('mg-badge-session [data-declencheur="utilisateur"]')!.click();
    await stable();
    const option = hote.querySelector<HTMLElement>('mg-badge-session [data-menu="utilisateur"] button')!;
    expect(option).not.toBeNull();
    const e = frapper(hote, { key: 'Escape' }, option);
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(e.defaultPrevented).toBe(true);
    expect(hote.querySelector('mg-badge-session [data-menu="utilisateur"]')).toBeNull();
    expect(titrePanneau(hote)).toBe('Analyse');
    // Le menu fermé, l'Échap suivant revient à la pile de la carte.
    frapper(hote, { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(titrePanneau(hote)).toBeNull();
  });

  it('(k) mode immersif : rail en translateX(-100%), barre du haut masquée ; Échap ré-affiche', async () => {
    const { hote, stable } = await ouvrir();
    const bouton = hote.querySelector<HTMLButtonElement>('button[data-immersif]')!;
    expect(bouton.getAttribute('title')).toBe('Masquer la barre (mode immersif)');
    bouton.click();
    await stable();
    expect(hote.querySelector<HTMLElement>('mg-rail')!.style.transform).toBe('translateX(-100%)');
    expect(hote.querySelector('mg-barre-haut')).toBeNull();
    expect(bouton.getAttribute('aria-pressed')).toBe('true');
    expect(bouton.getAttribute('title')).toBe('Afficher la barre (Escape)');
    frapper(hote, { key: 'Escape' });
    await stable();
    expect(hote.querySelector<HTMLElement>('mg-rail')!.style.transform).toBe('translateX(0)');
    expect(hote.querySelector('mg-barre-haut')).not.toBeNull();
  });

  it('Échap ferme le DERNIER ouvert : panneau ouvert après le mode immersif → panneau d\'abord', async () => {
    const { hote, stable } = await ouvrir();
    hote.querySelector<HTMLButtonElement>('button[data-immersif]')!.click();
    await stable();
    frapper(hote, { key: '1', altKey: true });
    await stable();
    frapper(hote, { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(titrePanneau(hote)).toBeNull();
    expect(hote.querySelector<HTMLElement>('mg-rail')!.style.transform).toBe('translateX(-100%)');
    frapper(hote, { key: 'Escape' });
    await stable();
    expect(hote.querySelector<HTMLElement>('mg-rail')!.style.transform).toBe('translateX(0)');
  });

  it('(l) la carte est créée UNE fois, au centre et au zoom de React, fond Liberty, zoom en bas à droite avec boussole', async () => {
    const { cartes } = await ouvrir();
    expect(cartes).toHaveLength(1);
    const o = cartes[0].options as Record<string, unknown>;
    expect(o['center']).toEqual([2.3, 46.6]);
    expect(o['zoom']).toBe(5.5);
    expect(o['style']).toBe('https://tiles.openfreemap.org/styles/liberty');
    expect(cartes[0].controles[0].position).toBe('bottom-right');
  });

  it('badge de zoom : « z5  20km » au départ, puis suit le zoom (paliers de get_tile)', async () => {
    const { hote, cartes, stable } = await ouvrir();
    const badge = () => hote.querySelector('[data-badge-zoom]')!.textContent;
    expect(badge()).toBe('z5  20km');
    for (const [z, attendu] of [[12.4, 'z12  200m'], [9, 'z9  1km'], [8.9, 'z8  2km'], [7, 'z7  5km'], [3.5, 'z3  —']] as const) {
      cartes[0].zoom = z;
      cartes[0].emettre('zoom');
      await stable();
      expect(badge()).toBe(attendu);
    }
  });

  it('la barre du haut porte le logo, la bascule Campagne (inerte) / Carte (pressée), le thème et la session', async () => {
    const { hote } = await ouvrir();
    const barre = hote.querySelector('mg-barre-haut')!;
    expect(barre.querySelector('mg-logo')).not.toBeNull();
    expect(barre.querySelector('[data-bascule="campagne"]')!.getAttribute('aria-disabled')).toBe('true');
    expect(barre.querySelector('[data-bascule="carte"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(barre.querySelector('mg-bascule-theme')).not.toBeNull();
    expect(barre.querySelector('mg-badge-session')).not.toBeNull();
  });

  it("une navigation de requête RÉUTILISE l'écran : ni page ni carte recréées", async () => {
    const { harness, hote, cartes, stable } = await ouvrir();
    await TestBed.inject(Router).navigateByUrl('/carte?risque=etape%3Drayon');
    await stable();
    expect(harness.fixture.nativeElement.querySelector('mg-carte-principale')).toBe(hote);
    expect(cartes).toHaveLength(1);
    expect(cartes[0].retiree).toBe(false);
  });
});


/** L'injecteur de la page : celui qui porte ses services d'état (`providers` du composant). */
const injecteurPage = (harness: RouterTestingHarness): Injector =>
  harness.fixture.debugElement.query(By.directive(CartePage)).injector;

/** Un service de couche minimal qui suit le contrat B11 de `CouchesCarteService`. */
class CoucheFactice {
  private readonly couches = inject(CouchesCarteService);
  readonly poses: unknown[] = [];
  constructor() {
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (!carte) return;
      nettoyer(quandStyleCharge(carte as never, () => this.poses.push(carte)));
    });
    this.couches.inscrireEffacement('factice', () => undefined);
  }
}

const URL_POSITRON = 'https://tiles.openfreemap.org/styles/positron';
const URL_LIBERTY = 'https://tiles.openfreemap.org/styles/liberty';
const URL_BRIGHT = 'https://tiles.openfreemap.org/styles/bright';
const styleDe = (c: CarteFactice) => (c.options as Record<string, unknown>)['style'];

async function ouvrirReglages(hote: HTMLElement, stable: () => Promise<void>) {
  hote.querySelector<HTMLButtonElement>('mg-rail button[data-entree="reglages"]')!.click();
  await stable();
}

describe('CartePage — fond de carte, recréation, Tout effacer (T4)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('choisir « Clair » RECRÉE la carte sur Positron, mémorise le choix, et carteCourante passe par null', async () => {
    const { harness, hote, cartes, stable } = await ouvrir();
    const couches = injecteurPage(harness).get(CouchesCarteService);
    cartes[0].emettre('load');
    await stable();
    expect(couches.carteCourante()).toBe(cartes[0]);

    await ouvrirReglages(hote, stable);
    hote.querySelector<HTMLButtonElement>('mg-reglages button[data-fond="positron"]')!.click();
    expect(couches.carteCourante()).toBeNull();
    await stable();

    expect(cartes).toHaveLength(2);
    expect(cartes[0].retiree).toBe(true);
    expect(styleDe(cartes[1])).toBe(URL_POSITRON);
    expect((cartes[1].options as Record<string, unknown>)['center']).toEqual([2.3, 46.6]);
    expect(localStorage.getItem('genesis_map_style')).toBe('positron');
    expect(couches.carteCourante()).toBeNull();
    cartes[1].emettre('load');
    await stable();
    expect(couches.carteCourante()).toBe(cartes[1]);
    // Le fond courant est marqué, dans les Réglages comme dans le sélecteur compact.
    expect(hote.querySelector('mg-reglages button[data-fond="positron"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(hote.querySelector('mg-reglages button[data-fond="magelian"]')!.getAttribute('aria-pressed')).toBe('false');
    expect(hote.querySelector('[data-fond-compact="positron"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('re-choisir le fond courant ne recrée rien', async () => {
    const { hote, cartes, stable } = await ouvrir();
    await ouvrirReglages(hote, stable);
    hote.querySelector<HTMLButtonElement>('mg-reglages button[data-fond="liberty"]')!.click();
    await stable();
    expect(cartes).toHaveLength(1);
  });

  it('le sélecteur compact « FOND » change de fond lui aussi (Sta / OSM / Cla / den)', async () => {
    const { hote, cartes, stable } = await ouvrir();
    const boutons = [...hote.querySelectorAll('mg-fond-compact button')].map((b) => b.textContent?.trim());
    expect(boutons).toEqual(['Sta', 'OSM', 'Cla', 'den']);
    hote.querySelector<HTMLButtonElement>('[data-fond-compact="bright"]')!.click();
    await stable();
    expect(styleDe(cartes[1])).toBe(URL_BRIGHT);
  });

  it('une couche active inscrite est RE-POSÉE sur la nouvelle instance après un changement de fond', async () => {
    const { harness, hote, cartes, stable } = await ouvrir();
    const couche = runInInjectionContext(injecteurPage(harness), () => new CoucheFactice());
    cartes[0].emettre('load');
    await stable();
    expect(couche.poses).toEqual([cartes[0]]);

    await ouvrirReglages(hote, stable);
    hote.querySelector<HTMLButtonElement>('mg-reglages button[data-fond="bright"]')!.click();
    await stable();
    expect(couche.poses).toEqual([cartes[0]]);
    cartes[1].emettre('load');
    await stable();
    expect(couche.poses).toEqual([cartes[0], cartes[1]]);
  });

  it("le fond mémorisé est repris à l'ouverture (id)", async () => {
    localStorage.setItem('genesis_map_style', 'bright');
    const { cartes } = await ouvrir();
    expect(styleDe(cartes[0])).toBe(URL_BRIGHT);
  });

  it("une URL mémorisée à l'ancienne (valeur de React) est relue comme le premier fond qui la porte", async () => {
    localStorage.setItem('genesis_map_style', URL_POSITRON);
    const { cartes } = await ouvrir();
    expect(styleDe(cartes[0])).toBe(URL_POSITRON);
  });

  it('un localStorage qui LÈVE : fond par défaut, aucune erreur, et choisir un fond fonctionne quand même', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('SecurityError'); });
    const { hote, cartes, stable } = await ouvrir();
    expect(styleDe(cartes[0])).toBe(URL_LIBERTY);
    await ouvrirReglages(hote, stable);
    hote.querySelector<HTMLButtonElement>('mg-reglages button[data-fond="positron"]')!.click();
    await stable();
    expect(cartes).toHaveLength(2);
  });

  it('« MAGELIAN » : surcharges posées au load, avec les couleurs de CouleursService, puis ré-appliquées au thème', async () => {
    const theme = signal(0);
    const couleurs = {
      palette: () => computed(() => {
        const t = theme();
        return new Proxy({}, { get: (_c, cle) => `c-${String(cle)}-${t}` });
      }),
    };
    TestBed.overrideProvider(CouleursService, { useValue: couleurs });
    localStorage.setItem('genesis_map_style', 'magelian');
    const { cartes, stable } = await ouvrir();
    expect(styleDe(cartes[0])).toBe(URL_POSITRON);
    cartes[0].styleCouches = [{ id: 'background', type: 'background' }, { id: 'water', type: 'fill' }];
    cartes[0].emettre('load');
    await stable();
    expect(cartes[0].peintures).toContainEqual({ couche: 'background', propriete: 'background-color', valeur: 'c-fond-0' });
    expect(cartes[0].peintures).toContainEqual({ couche: 'water', propriete: 'fill-color', valeur: 'c-eau-0' });
    // Une couche de DONNÉES posée après le load (météo) n'est jamais repeinte, même à la bascule de thème.
    cartes[0].styleCouches.push({ id: 'meteo-fill', type: 'fill' }, { id: 'zones-etiquettes', type: 'symbol' });
    theme.set(1);
    await stable();
    expect(cartes[0].peintures).toContainEqual({ couche: 'background', propriete: 'background-color', valeur: 'c-fond-1' });
    expect(cartes[0].peintures.some((p) => p.couche === 'meteo-fill' || p.couche === 'zones-etiquettes')).toBe(false);
    expect(cartes).toHaveLength(1);
  });

  it('« Clair » ne pose AUCUNE surcharge MAGELIAN (même URL Positron, autre fond)', async () => {
    localStorage.setItem('genesis_map_style', 'positron');
    const { cartes, stable } = await ouvrir();
    cartes[0].styleCouches = [{ id: 'background', type: 'background' }];
    cartes[0].emettre('load');
    await stable();
    expect(cartes[0].peintures).toEqual([]);
  });

  it('Tout effacer : chaque effacement inscrit appelé UNE fois, dégradé remis à zéro, AUCUNE annonce', async () => {
    const { harness, hote, stable } = await ouvrir();
    const injecteur = injecteurPage(harness);
    const couches = injecteur.get(CouchesCarteService);
    const etat = injecteur.get(EtatCarteService);
    const a = vi.fn();
    const b = vi.fn();
    couches.inscrireEffacement('a', a);
    couches.inscrireEffacement('b', b);
    etat.basculerDegrade('carreaux', true);
    etat.perimetreScope.set('metro');
    etat.poiSelectionnes.set(['lycee']);
    const bouton = hote.querySelector<HTMLButtonElement>('button[data-tout-effacer]')!;
    expect(bouton.getAttribute('title')).toBe('Tout effacer (couches et zones affichées)');
    bouton.click();
    await stable();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(etat.degradeActif()).toBeNull();
    expect(etat.perimetreScope()).toBeNull();
    expect(etat.poiSelectionnes()).toEqual([]);
    expect(injecteur.get(AnnonceService).annonces()).toEqual([]);
  });

  it('Réglages et Aide remplacent leur contenu provisoire', async () => {
    const { hote, stable } = await ouvrir();
    await ouvrirReglages(hote, stable);
    expect(hote.querySelector('mg-reglages')).not.toBeNull();
    expect(hote.querySelector('[data-provisoire]')).toBeNull();
    hote.querySelector<HTMLButtonElement>('mg-rail button[data-entree="aide"]')!.click();
    await stable();
    expect(hote.querySelector('mg-aide')).not.toBeNull();
  });
});

describe('CartePage — filtre unique : panneau, puce, pastille du rail (T5)', () => {
  it('le panneau Filtre monte le vrai panneau ; un filtre posé allume la pastille du rail et la puce ; la croix de la puce le retire', async () => {
    const { harness, hote, stable } = await ouvrir();
    const pastille = () => hote.querySelector('mg-rail button[data-entree="filtre"] [data-pastille-filtre]');
    expect(pastille()).toBeNull();
    expect(hote.querySelector('mg-puce-filtre')).toBeNull();
    hote.querySelector<HTMLButtonElement>('mg-rail button[data-entree="filtre"]')!.click();
    await stable();
    expect(hote.querySelector('mg-panneau-filtre')).not.toBeNull();
    hote.querySelector<HTMLButtonElement>('mg-panneau-filtre [data-france]')!.click();
    await stable();
    const etat = injecteurPage(harness).get(EtatCarteService);
    expect(etat.filtre()?.type).toBe('france');
    expect(pastille()).not.toBeNull();
    // La pastille ne vaut que pour l'entrée Filtre.
    expect(hote.querySelectorAll('mg-rail [data-pastille-filtre]').length).toBe(1);
    const puce = hote.querySelector<HTMLElement>('mg-puce-filtre')!;
    expect(puce.textContent).toContain('France entière');
    puce.querySelector<HTMLButtonElement>('button[aria-label="Retirer le filtre"]')!.click();
    await stable();
    expect(etat.filtre()).toBeNull();
    expect(pastille()).toBeNull();
    expect(hote.querySelector('mg-puce-filtre')).toBeNull();
  });

  it('rouvrir le panneau re-sème depuis le filtre courant : « France entière » reste pressée', async () => {
    const { harness, hote, stable } = await ouvrir();
    const etat = injecteurPage(harness).get(EtatCarteService);
    etat.filtre.set({ type: 'france', code: 'france', label: 'France entière' });
    hote.querySelector<HTMLButtonElement>('mg-rail button[data-entree="filtre"]')!.click();
    await stable();
    expect(hote.querySelector('mg-panneau-filtre [data-france]')!.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('CartePage — panneau Calques, carreaux Filosofi, légende (T6)', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.overrideProvider(CouleursService, { useValue: { palette: () => signal({ absente: '#9aa0a6', trait: '#555555' }) } });
  });
  afterEach(() => localStorage.clear());

  it('Calques : le vrai panneau ; allumer les carreaux pose la couche, ouvre la légende, survit au changement de fond ; Tout effacer les masque', async () => {
    const { harness, hote, cartes, stable } = await ouvrir();
    cartes[0].emettre('load');
    await stable();
    hote.querySelector<HTMLButtonElement>('mg-rail button[data-entree="calques"]')!.click();
    await stable();
    expect(hote.querySelector('mg-panneau-calques')).not.toBeNull();
    expect(hote.querySelector('mg-legende-carte [data-legende]')).toBeNull();

    hote.querySelector<HTMLButtonElement>('mg-panneau-calques button[data-groupe]')!.click();
    await stable();
    hote.querySelector<HTMLButtonElement>('mg-section-carreaux button[data-entete-carreaux]')!.click();
    await stable();
    expect(cartes[0].sources.has('carreaux-mvt')).toBe(true);
    expect(injecteurPage(harness).get(EtatCarteService).degradeActif()).toBe('carreaux');
    expect(hote.querySelector('mg-panneau-calques')!.textContent).toContain('Actifs (1)');
    expect(hote.querySelector('mg-legende-carte [data-bloc="carreaux"]')!.textContent).toContain('Carreaux Filosofi · pers./km²');

    // Changement de fond : la nouvelle instance reçoit la couche, visible.
    await ouvrirReglages(hote, stable);
    hote.querySelector<HTMLButtonElement>('mg-reglages button[data-fond="bright"]')!.click();
    await stable();
    cartes[1].emettre('load');
    await stable();
    expect(cartes[1].sources.has('carreaux-mvt')).toBe(true);
    expect((cartes[1].getLayer('carreaux-mvt-fill')!['layout'] as { visibility: string }).visibility).toBe('visible');

    hote.querySelector<HTMLButtonElement>('button[data-tout-effacer]')!.click();
    await stable();
    expect((cartes[1].getLayer('carreaux-mvt-fill')!['layout'] as { visibility: string }).visibility).toBe('none');
    expect(hote.querySelector('mg-legende-carte [data-legende]')).toBeNull();
  });
});

describe('CartePage — IRIS : section, couche en cascade, panneau de détail (T7)', () => {
  beforeEach(() => {
    TestBed.overrideProvider(CouleursService, { useValue: { palette: () => signal({ absente: '#9aa0a6', trait: '#555555' }) } });
  });

  it('allumer IRIS évince les carreaux (annonce), pose iris-source, légende IRIS ; clic → détail ; Tout effacer le ferme', async () => {
    const detail = vi.fn(() => of({ code_iris: '751010201', nom_iris: 'Saint-Germain', code_commune: '75101', code_dept: '75', is_true_iris: true, population: 1200 }));
    const bornes = vi.fn(() => of({ pop_15_29: { colonne: 'pop_15_29', classe: 'effectif', log_min: 0.5, log_max: 4.2, val_min: 3, val_max: 15000 } }));
    TestBed.overrideProvider(IrisApi, { useValue: { urlTuiles: () => '/api/tiles/iris/{z}/{x}/{y}?v=2', bornes, detail } });
    const { harness, hote, cartes, stable } = await ouvrir();
    cartes[0].emettre('load');
    await stable();
    hote.querySelector<HTMLButtonElement>('mg-rail button[data-entree="calques"]')!.click();
    await stable();
    hote.querySelector<HTMLButtonElement>('mg-panneau-calques button[data-groupe]')!.click();
    await stable();
    hote.querySelector<HTMLButtonElement>('mg-section-carreaux button[data-entete-carreaux]')!.click();
    await stable();
    hote.querySelector<HTMLButtonElement>('mg-section-iris button[data-entete-iris]')!.click();
    await stable();
    expect(cartes[0].sources.has('iris-source')).toBe(true);
    expect((cartes[0].getLayer('carreaux-mvt-fill')!['layout'] as { visibility: string }).visibility).toBe('none');
    expect(injecteurPage(harness).get(EtatCarteService).degradeActif()).toBe('iris');
    expect(hote.querySelector('mg-annonce')!.textContent).toContain('Carreaux Filosofi a été masqué');
    expect(hote.querySelector('mg-legende-carte [data-bloc="iris"]')!.textContent).toContain('IRIS · /km²');
    expect(bornes).toHaveBeenCalledTimes(1);

    expect(hote.querySelector('[data-detail-iris]')).toBeNull();
    cartes[0].emettreSurCouche('click', 'iris-fill', { features: [{ properties: { code_iris: '751010201' } }] });
    await stable();
    expect(detail).toHaveBeenCalledWith('751010201');
    expect(hote.querySelector('[data-detail-iris] [data-nom]')!.textContent!.trim()).toBe('Saint-Germain');

    hote.querySelector<HTMLButtonElement>('button[data-tout-effacer]')!.click();
    await stable();
    expect(hote.querySelector('[data-detail-iris]')).toBeNull();
    expect((cartes[0].getLayer('iris-fill')!['layout'] as { visibility: string }).visibility).toBe('none');
  });

  it('fermer le détail par sa croix rend le focus à l’hôte : Alt+2 ouvre encore Calques (revue 1)', async () => {
    const detail = vi.fn(() => of({ code_iris: '751010201', nom_iris: 'Saint-Germain', code_commune: null, code_dept: null, is_true_iris: true }));
    TestBed.overrideProvider(IrisApi, { useValue: { urlTuiles: () => '', bornes: () => of({}), detail } });
    const { hote, cartes, stable } = await ouvrir();
    cartes[0].emettre('load');
    await stable();
    cartes[0].emettreSurCouche('click', 'iris-fill', { features: [{ properties: { code_iris: '751010201' } }] });
    await stable();
    const croix = hote.querySelector<HTMLButtonElement>('[data-detail-iris] button[data-fermer]')!;
    croix.focus();
    croix.click();
    await stable();
    expect(hote.querySelector('[data-detail-iris]')).toBeNull();
    const racine = hote.getRootNode() as Document | ShadowRoot;
    expect(racine.activeElement).toBe(hote);
    frapper(hote, { key: '2', altKey: true });
    await stable();
    expect(titrePanneau(hote)).toBe('Calques');
  });
});

describe('CartePage — météo (T11)', () => {
  it('le dialogue météo est un <dialog> DANS la page ; Échap dedans le ferme, le panneau Calques et la carte restent', async () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); }, configurable: true, writable: true,
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      value: function (this: HTMLDialogElement) { this.removeAttribute('open'); }, configurable: true, writable: true,
    });
    const { harness, hote, cartes, stable } = await ouvrir();
    frapper(hote, { key: '2', altKey: true });
    await stable();
    const meteo = injecteurPage(harness).get(MeteoService);
    meteo.ouvrirDialogue();
    await stable();
    const dialogue = hote.querySelector('mg-dialogue-meteo dialog')!;
    expect(dialogue.hasAttribute('open')).toBe(true);
    expect(injecteurPage(harness).get(PileEchapService).etat().at(-1)!.id).toBe('meteo');
    const bouton = dialogue.querySelector<HTMLButtonElement>('[data-variable="temperature_2m"]')!;
    bouton.focus();
    const e = frapper(hote, { key: 'Escape' }, bouton);
    expect(e.defaultPrevented).toBe(true);
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(hote.querySelector('mg-dialogue-meteo')).toBeNull();
    expect(injecteurPage(harness).get(PileEchapService).etat().map((x) => x.id)).not.toContain('meteo');
    expect(titrePanneau(hote)).toBe('Calques');
    expect(cartes).toHaveLength(1);
    expect(cartes[0].retiree).toBe(false);
    // Le focus est revenu à l'hôte : un second Échap ferme le panneau (sinon il tomberait sur <body>).
    expect(document.activeElement).toBe(hote);
  });
});

describe('CartePage — le module risque, route ENFANT (T13, B2/B3)', () => {
  it("ouvrir puis fermer le module : MÊME instance de CartePage, carte principale créée UNE fois, calque masqué hors module", async () => {
    const { harness, hote, cartes, stable } = await ouvrir();
    const page = harness.fixture.debugElement.query(By.directive(CartePage)).componentInstance;
    const calque = hote.querySelector<HTMLElement>('[data-module-risque]')!;
    expect(calque.classList).toContain('hidden');
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/carte/risques?risque=etape%3Drayon');
    await stable();
    // Le module est rendu DANS l'hôte de la carte, en surimpression ; la carte est toujours là, dessous.
    expect(hote.querySelector('[data-module-risque] mg-module-factice')).not.toBeNull();
    expect(calque.classList).not.toContain('hidden');
    expect(calque.className).toContain('absolute inset-0 z-[60]');
    // La carte recouverte sort du parcours clavier (revue 1), et y revient à la fermeture.
    expect(hote.querySelector('[data-zone-carte]')!.hasAttribute('inert')).toBe(true);
    expect(harness.fixture.debugElement.query(By.directive(CartePage)).componentInstance).toBe(page);
    await router.navigateByUrl('/carte');
    await stable();
    expect(hote.querySelector('mg-module-factice')).toBeNull();
    expect(calque.classList).toContain('hidden');
    expect(hote.querySelector('[data-zone-carte]')!.hasAttribute('inert')).toBe(false);
    expect(harness.fixture.debugElement.query(By.directive(CartePage)).componentInstance).toBe(page);
    expect(cartes).toHaveLength(1);
    expect(cartes[0].retiree).toBe(false);
  });

  it('le module, rendu par l’outlet, voit le pont de la carte : `ZonesRisqueService` de CETTE page (B3)', async () => {
    const { harness, stable } = await ouvrir();
    await TestBed.inject(Router).navigateByUrl('/carte/risques');
    await stable();
    const module = harness.fixture.debugElement.query(By.directive(ModuleFactice)).componentInstance as ModuleFactice;
    expect(module.pont).toBe(injecteurPage(harness).get(ZonesRisqueService));
  });

  it('module fermé alors qu’il portait le focus : le focus revient à l’hôte (raccourcis et Échap répondent encore)', async () => {
    const { hote, stable } = await ouvrir();
    await TestBed.inject(Router).navigateByUrl('/carte/risques');
    await stable();
    const champ = document.createElement('button');
    hote.querySelector('mg-module-factice')!.appendChild(champ);
    champ.focus();
    await TestBed.inject(Router).navigateByUrl('/carte');
    await stable();
    expect(document.activeElement).toBe(hote);
  });

  it("Zones › Jeux de zones : la liste est rendue dans le panneau", async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, { key: '4', altKey: true });
    await stable();
    expect(titrePanneau(hote)).toBe('Zones');
    expect(hote.querySelector('mg-panneau-carte mg-jeux-de-zones')).not.toBeNull();
    expect(hote.querySelector('mg-jeux-de-zones [data-jeux-vide]')).not.toBeNull();
  });

  it('Zones › Créer une zone (T16) : capture inactive sans couche ; le dessin ouvert, un clic sur la carte NE ferme PAS le panneau', async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, { key: '4', altKey: true });
    await stable();
    expect(hote.querySelector('[data-provisoire]')).toBeNull();
    expect(hote.querySelector<HTMLButtonElement>('[data-capturer]')!.disabled).toBe(true);
    const outils = [...hote.querySelectorAll('mg-outil-creation [data-repli]')].map((b) => b.textContent!.trim());
    expect(outils).toEqual(['Importer une liste de codes postaux ▼', 'Zone par rayon ▼', 'Dessiner une zone ▼']);
    hote.querySelector<HTMLButtonElement>('mg-creer-dessin [data-repli]')!.click();
    await stable();
    hote.querySelector('mg-carte')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(titrePanneau(hote)).toBe('Zones');
    // L'outil quitté, la carte est rendue : le clic hors du panneau le referme de nouveau.
    hote.querySelector<HTMLButtonElement>('mg-creer-dessin [data-quitter]')!.click();
    await stable();
    hote.querySelector('mg-carte')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(titrePanneau(hote)).toBeNull();
  });
});

describe('CartePage — panneau Zones, lien customZone, script DV360 (T14)', () => {
  const ID = '11111111-2222-3333-4444-555555555555';
  const ENTITE = {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[5, 43], [6, 43], [6, 44.5], [5, 44.5], [5, 43]]] },
    properties: { id: ID, name: 'CIRFA BRETAGNE' },
  };

  /** La carte publiée au `load` : c'est là que le lien est lu (`mapReady`). */
  async function carteChargee(options: OptionsOuverture) {
    const o = await ouvrir(options);
    o.cartes[0].emettre('load');
    await o.stable();
    return o;
  }

  it('le panneau Zones monte le vrai panneau : créer, jeux de zones, « Mes zones »', async () => {
    const { hote, stable } = await ouvrir();
    hote.querySelector<HTMLButtonElement>('mg-rail button[data-entree="zones"]')!.click();
    await stable();
    const panneau = hote.querySelector('mg-panneau-carte mg-panneau-zones')!;
    expect(panneau).not.toBeNull();
    expect([...panneau.querySelectorAll('h4')].map((h) => h.textContent?.trim())).toEqual(['Créer une zone', 'Jeux de zones à risque', 'Mes zones']);
    expect(panneau.querySelector('mg-mes-zones')).not.toBeNull();
  });

  it('sans lien : aucune géométrie demandée, aucun bouton DV360', async () => {
    const geometrie = vi.fn(() => of(ENTITE));
    const { hote } = await carteChargee({ zones: { geometrie } });
    expect(geometrie).not.toHaveBeenCalled();
    expect(hote.querySelector('button[data-script-dv360]')).toBeNull();
  });

  it('?customZone=<id> : géométrie lue UNE fois carte prête, recadrage sur son emprise (60 px, 1 s), bouton DV360 nommé ; une autre navigation de requête ne relit rien', async () => {
    const geometrie = vi.fn(() => of(ENTITE));
    const exporter = vi.fn(() => of());
    const { harness, hote, cartes, stable } = await carteChargee({ url: `/carte?customZone=${ID}`, zones: { geometrie, exporter } });
    expect(geometrie).toHaveBeenCalledTimes(1);
    expect(geometrie).toHaveBeenCalledWith(ID);
    expect(cartes[0].cadrages.at(-1)).toEqual({ cadre: [[5, 43], [6, 44.5]], options: { padding: 60, duration: 1000 } });
    // Le créneau de bataille est peint : l'aplat des anneaux et le point au centre.
    expect(cartes[0].getLayer('battle-fill')).toBeDefined();
    expect(cartes[0].getLayer('battle-pois-circle')).toBeDefined();
    const bouton = hote.querySelector<HTMLButtonElement>('button[data-script-dv360]')!;
    expect(bouton.getAttribute('title')).toBe('Générer le fichier custom bidding DV360 pour « CIRFA BRETAGNE »');
    expect(bouton.style.top).toBe('136px');
    bouton.click();
    expect(exporter).toHaveBeenCalledWith(ID, 'bidding_script');

    await harness.navigateByUrl(`/carte?customZone=${ID}&autre=1`);
    await stable();
    expect(geometrie).toHaveBeenCalledTimes(1);
    // Une carte republiée (changement de fond, B11) ne relit pas la zone : `customZoneLoadedRef`.
    const couches = injecteurPage(harness).get(CouchesCarteService);
    couches.publier(null);
    await stable();
    couches.publier(cartes[0] as unknown as maplibregl.Map);
    await stable();
    expect(geometrie).toHaveBeenCalledTimes(1);
  });

  it('« Tout effacer » : le créneau se vide, le bouton DV360 disparaît, `customZone` quitte l’URL', async () => {
    const { hote, cartes, stable } = await carteChargee({ url: `/carte?customZone=${ID}`, zones: { geometrie: () => of(ENTITE) } });
    expect(hote.querySelector('button[data-script-dv360]')).not.toBeNull();
    hote.querySelector<HTMLButtonElement>('button[data-tout-effacer]')!.click();
    await stable();
    expect(hote.querySelector('button[data-script-dv360]')).toBeNull();
    expect(cartes[0].getLayer('battle-fill')).toBeUndefined();
    expect(TestBed.inject(Router).url).toBe('/carte');
  });

  it('changement d’organisation (badge de la barre) : la page émet `espaceChange` UNE fois et ne nettoie plus rien à la main — l’hôte la recrée (droits sur la carte, T3)', async () => {
    const { harness, hote, stable } = await carteChargee({ url: `/carte?customZone=${ID}`, zones: { geometrie: () => of(ENTITE) } });
    const page = harness.fixture.debugElement.query(By.directive(CartePage)).componentInstance as CartePage;
    const emis = vi.fn();
    page.espaceChange.subscribe(emis);
    const etat = injecteurPage(harness).get(EtatCarteService);
    const barre = harness.fixture.debugElement.query(By.css('mg-barre-haut')).componentInstance as { orgChangee: { emit(v: string | null): void } };

    etat.filtre.set({ type: 'zone', code: ID, label: 'CIRFA BRETAGNE', bbox: [5, 43, 6, 44.5] });
    barre.orgChangee.emit('org-2');
    await stable();
    expect(emis).toHaveBeenCalledTimes(1);
    // Plus de nettoyage manuel : filtre, zone du lien et URL restent tels quels — c'est la recréation qui les remet à zéro.
    expect(etat.filtre()?.code).toBe(ID);
    expect(hote.querySelector('button[data-script-dv360]')).not.toBeNull();
    expect(TestBed.inject(Router).url).toBe(`/carte?customZone=${ID}`);
  });

  it('lien en échec : une annonce le dit (React : console seulement)', async () => {
    const { harness } = await carteChargee({ url: `/carte?customZone=${ID}`, zones: { geometrie: () => throwError(() => ({ status: 404 })) } });
    expect(injecteurPage(harness).get(AnnonceService).annonces().map((a) => a.texte))
      .toContain('La zone du lien n’a pas pu être chargée (HTTP 404).');
  });

  it('« Tout effacer » pendant la lecture du lien : la réponse tardive ne remplit plus le créneau (revue 1)', async () => {
    const vol = new Subject<unknown>();
    const { hote, cartes, stable } = await carteChargee({ url: `/carte?customZone=${ID}`, zones: { geometrie: () => vol } });
    hote.querySelector<HTMLButtonElement>('button[data-tout-effacer]')!.click();
    await stable();
    expect(vol.observed).toBe(false);
    vol.next(ENTITE);
    await stable();
    expect(cartes[0].getLayer('battle-fill')).toBeUndefined();
    expect(hote.querySelector('button[data-script-dv360]')).toBeNull();
  });
});
describe('CartePage — plan média des zones affichées (T15)', () => {
  const ENTITE = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[5, 43], [6, 43], [6, 44], [5, 43]]] }, properties: {} };
  const zone = (id: string, name: string) => ({ id, name, source_type: 'composite', bbox: [5, 43, 6, 44] }) as unknown as ZoneCustomResume;

  it('première zone affichée → panneau ouvert à droite sous la barre, totaux lus UNE fois ; la croix le ferme, « Plan média (n) » le rouvre ; Tout effacer → fermé', async () => {
    const totauxNationaux = vi.fn(() => of({ totals: { total: 68_000_000 } }));
    const { harness, hote, cartes, stable } = await ouvrir({ zones: { geometrie: () => of(ENTITE), totauxNationaux } });
    cartes[0].emettre('load');
    await stable();
    expect(hote.querySelector('mg-plan-media')).toBeNull();

    const zones = injecteurPage(harness).get(ZonesCustomService);
    zones.afficher(zone('a', 'A'));
    await stable();
    const panneau = hote.querySelector<HTMLElement>('mg-plan-media [data-plan-media]')!;
    expect(panneau).not.toBeNull();
    expect(panneau.style.top).toBe('44px');
    expect(hote.querySelector('[data-titre]')!.textContent!.trim()).toBe('Plan média — 1 zone');
    expect(hote.querySelector('button[data-plan-media]')).toBeNull();

    hote.querySelector<HTMLButtonElement>('mg-plan-media button[title="Fermer"]')!.click();
    await stable();
    expect(hote.querySelector('mg-plan-media')).toBeNull();
    zones.afficher(zone('b', 'B'));
    await stable();
    expect(hote.querySelector('mg-plan-media')).toBeNull();
    const rouvrir = hote.querySelector<HTMLButtonElement>('button[data-plan-media]')!;
    expect(rouvrir.textContent!.trim()).toBe('Plan média (2)');
    rouvrir.click();
    await stable();
    expect(hote.querySelector('[data-titre]')!.textContent!.trim()).toBe('Plan média — 2 zones');
    expect(totauxNationaux).toHaveBeenCalledTimes(1);

    hote.querySelector<HTMLButtonElement>('button[data-tout-effacer]')!.click();
    await stable();
    expect(hote.querySelector('mg-plan-media')).toBeNull();
    expect(hote.querySelector('button[data-plan-media]')).toBeNull();
  });
});
