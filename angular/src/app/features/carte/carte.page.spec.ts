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
import { PanneauFiltreComponent } from './panneaux/filtre/panneau-filtre.component';
import { CONSIGNE_ETAPE, ETAPES_CARTE, LIBELLE_ETAPE_CARTE } from './logique/parcours';

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
  /** `ReferentielApi.geo` (panneau ①). */
  referentiel?: () => unknown;
  /** `JeuxZonesApi.lister` (panneau ④). */
  jeux?: () => unknown;
  /** `CarteApi.categories` (catalogue des types de POI, ②). */
  categories?: () => unknown;
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
      { provide: ReferentielApi, useValue: { geo: options.referentiel ?? (() => of({ regions: [] })) } },
      {
        provide: ZonesCustomApi,
        useValue: {
          lister: () => of({ zones: [] }), stats: () => of({}), geometrie: () => of(), exporter: () => of(),
          totauxNationaux: () => of({ totals: {} }), audienceItems: () => of({ items: null }), zone: () => of({}), campagnesPlan: () => of({ campaigns: [] }),
          ...options.zones,
        },
      },
      { provide: ZonesRisqueApi, useValue: { urlTuilesZones: () => '/api/tiles/zones-risque/{z}/{x}/{y}?profil=x', preparer: () => of({ classes: 1 }) } },
      { provide: JeuxZonesApi, useValue: { lister: options.jeux ?? (() => of({ jeux: [] })) } },
      { provide: CarreauxApi, useValue: { urlTuiles: () => '/api/tiles/{z}/{x}/{y}?v=19' } },
      { provide: IrisApi, useValue: { urlTuiles: () => '/api/tiles/iris/{z}/{x}/{y}?v=2', bornes: () => of({}), detail: () => of() } },
      { provide: CarteApi, useValue: { categories: options.categories ?? (() => of({ categories: ['lycee', 'panneaux', 'risque_industriel'] })), pois: () => of(), ooh: () => of(), transport: () => of(), urlTuilesTmja: () => '/api/tmja-tiles/{z}/{x}/{y}?v=v10' } },
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

/** L'étape dont le panneau est visible (le seul `[data-panneau-etape]` qui n'est pas inerte), `null` sinon. */
const panneauCourant = (hote: HTMLElement) =>
  hote.querySelector('[data-panneau-etape]:not([inert])')?.getAttribute('data-panneau-etape') ?? null;
/** L'étape marquée courante dans le fil de la barre. */
const etapeDuFil = (hote: HTMLElement) =>
  hote.querySelector('mg-barre-parcours mg-fil-etapes [aria-current="step"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
const routeur = () => TestBed.inject(Router);
/** Alt+n tel que l'envoie un clavier AZERTY : la touche physique dans `code`, le caractère dans `key`. */
const AZERTY: Record<string, string> = { '1': '&', '2': 'é', '3': '"', '4': "'", '5': '(', '6': '-', '7': 'è' };
const altChiffre = (n: string): KeyboardEventInit => ({ key: AZERTY[n], code: `Digit${n}`, altKey: true });
/** L'aside du panneau d'étape. */
const aside = (hote: HTMLElement) => hote.querySelector<HTMLElement>('mg-panneau-etape aside')!;

describe('CartePage — la carte en parcours : barre, fil, panneau d’étape, clavier', () => {
  it("(f) la barre rend ① à ⑦ dans l'ordre, ① courante ; plus aucun rail, ni barre du haut, ni boutons flottants", async () => {
    const { hote } = await ouvrir();
    const boutons = [...hote.querySelectorAll('mg-barre-parcours mg-fil-etapes nav button')];
    expect(boutons.map((b) => b.textContent!.replace(/\s+/g, ' ').trim()))
      .toEqual(ETAPES_CARTE.map((e, i) => `${i + 1} ${LIBELLE_ETAPE_CARTE[e]}`));
    expect(boutons[0].getAttribute('aria-current')).toBe('step');
    expect(boutons.slice(1).every((b) => !b.hasAttribute('aria-current'))).toBe(true);
    expect(panneauCourant(hote)).toBe('perimetre');
    expect(aside(hote).getAttribute('aria-label')).toBe('Étape 1 — Périmètre');
    for (const ancien of ['mg-rail', 'mg-barre-haut', 'mg-panneau-carte', 'mg-puce-filtre', 'mg-boutons-flottants']) {
      expect(hote.querySelector(ancien), ancien).toBeNull();
    }
    // Monté à la première visite seulement (arbitrage A1) : à l'ouverture, ① et lui seul.
    expect(hote.querySelectorAll('[data-panneau-etape]').length).toBe(1);
    expect(routeur().url).toBe('/carte');
  });

  it('(g) Alt+2 (AZERTY : code Digit2, key « é ») passe à ② : Calques dans son panneau, ?etape=donnees ; Échap ne le ferme pas', async () => {
    const { hote, stable } = await ouvrir();
    const e = frapper(hote, altChiffre('2'));
    await stable();
    expect(e.defaultPrevented).toBe(true);
    expect(panneauCourant(hote)).toBe('donnees');
    expect(hote.querySelector('[data-panneau-etape="donnees"] mg-panneau-calques')).not.toBeNull();
    expect(etapeDuFil(hote)).toBe('2 Données');
    expect(routeur().url).toBe('/carte?etape=donnees');
    // ① reste monté, invisible et inerte.
    const premier = hote.querySelector<HTMLElement>('[data-panneau-etape="perimetre"]')!;
    expect(premier.hasAttribute('inert')).toBe(true);
    expect(premier.getAttribute('aria-hidden')).toBe('true');
    expect(premier.classList).toContain('invisible');
    frapper(hote, { key: 'Escape' });
    await stable();
    expect(panneauCourant(hote)).toBe('donnees');
    expect(routeur().url).toBe('/carte?etape=donnees');
  });

  it('Alt+pavé numérique 4 passe aussi à ④', async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, { key: '4', code: 'Numpad4', altKey: true });
    await stable();
    expect(panneauCourant(hote)).toBe('zones');
  });

  it("(h) Alt+2 dont la cible composée est un <input> : l'étape reste ①", async () => {
    const { hote, stable } = await ouvrir();
    const champ = document.createElement('input');
    hote.appendChild(champ);
    const e = frapper(hote, altChiffre('2'), champ);
    await stable();
    expect(e.defaultPrevented).toBe(false);
    expect(panneauCourant(hote)).toBe('perimetre');
  });

  it('(i) Échap depuis un <input> quitte quand même le mode immersif', async () => {
    const { hote, stable } = await ouvrir();
    hote.querySelector<HTMLButtonElement>('[data-immersif]')!.click();
    await stable();
    expect(hote.querySelector('mg-barre-parcours')).toBeNull();
    const champ = document.createElement('input');
    hote.appendChild(champ);
    frapper(hote, { key: 'Escape' }, champ);
    await stable();
    expect(hote.querySelector('mg-barre-parcours')).not.toBeNull();
  });

  it('(j) Alt+5 ouvre ⑤ « bientôt » ; Alt+C et Ctrl+K ne changent pas l’étape et ne sont pas consommés', async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, altChiffre('5'));
    await stable();
    expect(panneauCourant(hote)).toBe('plan');
    expect(hote.querySelector('[data-panneau-etape="plan"] mg-etape-bientot [data-etape-bientot="plan"]')).not.toBeNull();
    const c = frapper(hote, { key: 'c', code: 'KeyC', altKey: true });
    const k = frapper(hote, { key: 'k', code: 'KeyK', ctrlKey: true });
    await stable();
    expect(c.defaultPrevented).toBe(false);
    expect(k.defaultPrevented).toBe(false);
    expect(panneauCourant(hote)).toBe('plan');
  });

  it('cliquer ③ dans le fil la rend courante ; revenir à ① retrouve la MÊME instance du panneau Filtre', async () => {
    const { harness, hote, stable } = await ouvrir();
    const filtre = harness.fixture.debugElement.query(By.directive(PanneauFiltreComponent)).componentInstance;
    const bouton = (n: number) => hote.querySelectorAll<HTMLButtonElement>('mg-barre-parcours mg-fil-etapes nav button')[n];
    bouton(2).click();
    await stable();
    expect(panneauCourant(hote)).toBe('analyse');
    expect(hote.querySelector('[data-panneau-etape="analyse"] mg-panneau-analyse')).not.toBeNull();
    expect(aside(hote).getAttribute('aria-label')).toBe('Étape 3 — Analyse');
    expect(routeur().url).toBe('/carte?etape=analyse');
    bouton(0).click();
    await stable();
    expect(panneauCourant(hote)).toBe('perimetre');
    expect(harness.fixture.debugElement.query(By.directive(PanneauFiltreComponent)).componentInstance).toBe(filtre);
    expect(routeur().url).toBe('/carte');
  });

  it('un clic sur la carte ne replie ni ne change rien', async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, altChiffre('3'));
    await stable();
    hote.querySelector('mg-carte')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    hote.querySelector('mg-carte')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(panneauCourant(hote)).toBe('analyse');
    expect(aside(hote).style.visibility).toBe('visible');
  });

  it('replier puis rouvrir le panneau garde les panneaux montés ; le focus revient à l’hôte et Alt+2 répond encore', async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, altChiffre('3'));
    await stable();
    const analyse = hote.querySelector('mg-panneau-analyse');
    const replier = hote.querySelector<HTMLButtonElement>('mg-panneau-etape [data-replier]')!;
    replier.focus();
    replier.click();
    await stable();
    expect(aside(hote).style.visibility).toBe('hidden');
    expect(aside(hote).style.width).toBe('0px');
    expect(hote.querySelector('mg-panneau-analyse')).toBe(analyse);
    // Le bouton qui portait le focus est caché : le focus revient à l'hôte, sinon il tomberait hors de l'écouteur (B10).
    expect(document.activeElement).toBe(hote);
    frapper(hote, altChiffre('2'));
    await stable();
    expect(panneauCourant(hote)).toBe('donnees');
    const afficher = hote.querySelector<HTMLButtonElement>('[data-zone-carte] [data-afficher-panneau]')!;
    expect(afficher.getAttribute('aria-label')).toBe('Afficher le panneau de l’étape');
    afficher.click();
    await stable();
    expect(aside(hote).style.visibility).toBe('visible');
    expect(hote.querySelector('[data-afficher-panneau]')).toBeNull();
    expect(hote.querySelector('mg-panneau-analyse')).toBe(analyse);
    expect(hote.querySelectorAll('[data-panneau-etape]').length).toBe(3);
  });

  it('changer d’étape alors que le focus est dans le panneau quitté : le focus revient à l’hôte', async () => {
    const { hote, stable } = await ouvrir();
    const bouton = hote.querySelector<HTMLButtonElement>('[data-panneau-etape="perimetre"] mg-panneau-filtre [data-france]')!;
    bouton.focus();
    expect(document.activeElement).toBe(bouton);
    frapper(bouton, altChiffre('2'));
    await stable();
    expect(panneauCourant(hote)).toBe('donnees');
    expect(document.activeElement).toBe(hote);
    frapper(hote, altChiffre('3'));
    await stable();
    expect(panneauCourant(hote)).toBe('analyse');
  });

  it('un ?etape= écrit de l’extérieur pendant que le focus est HORS de la page (shell AIDA) ne vole pas le focus', async () => {
    const { hote, stable } = await ouvrir();
    const dehors = document.createElement('button');
    document.body.appendChild(dehors);
    dehors.focus();
    expect(document.activeElement).toBe(dehors);
    await routeur().navigateByUrl('/carte?etape=analyse');
    await stable();
    expect(panneauCourant(hote)).toBe('analyse');
    expect(document.activeElement).toBe(dehors);
    dehors.remove();
  });

  it('⑤ ⑥ ⑦ : la consigne de l’étape n’est dite qu’UNE fois (en-tête du panneau d’étape)', async () => {
    const { hote, stable } = await ouvrir();
    const occurrences = (texte: string) => hote.textContent!.split(texte).length - 1;
    for (const [n, e] of [['5', 'plan'], ['6', 'activation'], ['7', 'live']] as const) {
      frapper(hote, altChiffre(n));
      await stable();
      expect(occurrences(CONSIGNE_ETAPE[e]), e).toBe(1);
      expect(hote.querySelector('mg-panneau-etape [data-consigne]')!.textContent!.trim()).toBe(CONSIGNE_ETAPE[e]);
    }
  });

  it("Échap dans un menu ouvert du badge de session ferme le MENU seulement : la pile de la carte n'est pas appelée", async () => {
    const { harness, hote, stable } = await ouvrir();
    const fermer = vi.spyOn(injecteurPage(harness).get(PileEchapService), 'fermerLePlusHaut');
    hote.querySelector<HTMLButtonElement>('mg-badge-session [data-declencheur="utilisateur"]')!.click();
    await stable();
    const option = hote.querySelector<HTMLElement>('mg-badge-session [data-menu="utilisateur"] button')!;
    expect(option).not.toBeNull();
    const e = frapper(hote, { key: 'Escape' }, option);
    await stable();
    expect(e.defaultPrevented).toBe(true);
    expect(hote.querySelector('mg-badge-session [data-menu="utilisateur"]')).toBeNull();
    expect(fermer).not.toHaveBeenCalled();
    // Le menu fermé, l'Échap suivant revient à la pile de la carte.
    frapper(hote, { key: 'Escape' });
    expect(fermer).toHaveBeenCalledTimes(1);
  });

  it('(k) mode immersif : barre retirée, aside caché, panneaux montés ; Échap rétablit ; le bouton « quitter » aussi', async () => {
    const { harness, hote, stable } = await ouvrir();
    frapper(hote, altChiffre('2'));
    await stable();
    const calques = hote.querySelector('mg-panneau-calques');
    hote.querySelector<HTMLButtonElement>('mg-barre-parcours [data-immersif]')!.click();
    await stable();
    expect(hote.querySelector('mg-barre-parcours')).toBeNull();
    expect(aside(hote).style.visibility).toBe('hidden');
    expect(aside(hote).style.width).toBe('0px');
    expect(hote.querySelector('mg-panneau-calques')).toBe(calques);
    // Ni l'onglet « carte seule » (le repli n'est pas posé), ni le focus perdu (le bouton est parti avec la barre).
    expect(hote.querySelector('[data-afficher-panneau]')).toBeNull();
    expect(document.activeElement).toBe(hote);
    const quitter = hote.querySelector<HTMLButtonElement>('[data-zone-carte] [data-quitter-immersif]')!;
    expect(quitter.getAttribute('aria-label')).toBe('Quitter le mode immersif');
    frapper(hote, { key: 'Escape' });
    await stable();
    expect(hote.querySelector('mg-barre-parcours')).not.toBeNull();
    expect(aside(hote).style.visibility).toBe('visible');
    expect(hote.querySelector('[data-quitter-immersif]')).toBeNull();
    expect(panneauCourant(hote)).toBe('donnees');

    hote.querySelector<HTMLButtonElement>('mg-barre-parcours [data-immersif]')!.click();
    await stable();
    hote.querySelector<HTMLButtonElement>('[data-quitter-immersif]')!.click();
    await stable();
    expect(hote.querySelector('mg-barre-parcours')).not.toBeNull();
    expect(injecteurPage(harness).get(PileEchapService).etat().map((x) => x.id)).not.toContain('immersif');
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

  it('la barre porte logo, fil d’Ariane, fil d’étapes, Tout effacer, immersif, thème, session ; la légende et le badge vivent dans la carte', async () => {
    const { hote } = await ouvrir();
    const barre = hote.querySelector('mg-barre-parcours')!;
    for (const s of ['mg-logo', 'mg-fil-ariane', 'mg-fil-etapes', '[data-tout-effacer]', '[data-immersif]', 'mg-bascule-theme', 'mg-badge-session']) {
      expect(barre.querySelector(s), s).not.toBeNull();
    }
    expect(barre.querySelector('mg-fil-ariane')!.textContent).toContain('France entière');
    const carte = hote.querySelector('[data-zone-carte]')!;
    for (const s of ['mg-legende-carte', '[data-badge-zoom]', 'mg-annonce', 'mg-detail-iris', 'mg-tiroir-panneau', 'mg-zone-active', 'mg-fond-compact']) {
      expect(carte.querySelector(s), s).not.toBeNull();
    }
  });

  it("une navigation de requête RÉUTILISE l'écran : ni page ni carte recréées ; ?etape=analyse passe à ③", async () => {
    const { harness, hote, cartes, stable } = await ouvrir();
    await routeur().navigateByUrl('/carte?etape=analyse');
    await stable();
    expect(harness.fixture.nativeElement.querySelector('mg-carte-principale')).toBe(hote);
    expect(cartes).toHaveLength(1);
    expect(cartes[0].retiree).toBe(false);
    expect(panneauCourant(hote)).toBe('analyse');
  });

  it('?etape=zones à l’ouverture : ④ courante, et ① n’est pas monté (première visite seulement)', async () => {
    const { hote } = await ouvrir({ url: '/carte?etape=zones' });
    expect(panneauCourant(hote)).toBe('zones');
    expect(hote.querySelector('[data-panneau-etape="perimetre"]')).toBeNull();
  });

  it('zéro relecture : après une visite de ① à ④, cinq bascules ne relisent rien', async () => {
    const geo = vi.fn(() => of({ regions: [] }));
    const lister = vi.fn(() => of({ zones: [] }));
    const jeux = vi.fn(() => of({ jeux: [] }));
    const categories = vi.fn(() => of({ categories: ['lycee'] }));
    const { hote, stable } = await ouvrir({ referentiel: geo, zones: { lister }, jeux, categories, organisation: 'org-1' });
    for (const n of ['2', '3', '4', '1']) {
      frapper(hote, altChiffre(n));
      await stable();
      if (n !== '2') continue;
      // À ②, ouvrir la section POI : le catalogue des types n'est lu qu'à sa première ouverture.
      [...hote.querySelectorAll<HTMLButtonElement>('mg-panneau-calques button[data-groupe]')].find((b) => b.textContent!.includes('POI et mobilité'))!.click();
      await stable();
      hote.querySelector<HTMLElement>('mg-section-poi mg-entete-filtre')!.click();
      await stable();
    }
    const lectures = () => [geo.mock.calls.length, lister.mock.calls.length, jeux.mock.calls.length, categories.mock.calls.length];
    const avant = lectures();
    // Chaque lecture a bien eu lieu UNE fois aux premières visites : l'assertion qui suit ne compare pas des zéros.
    expect(avant.map((n) => n >= 1), `géo, zones, jeux, catégories : ${avant}`).toEqual([true, true, true, true]);
    for (const n of ['3', '1', '4', '2', '1']) { frapper(hote, altChiffre(n)); await stable(); }
    expect(lectures()).toEqual(avant);
    expect(hote.querySelectorAll('[data-panneau-etape]').length).toBe(4);
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

describe('CartePage — fond de carte, recréation, Tout effacer (T4)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('choisir « Clair » RECRÉE la carte sur Positron, mémorise le choix, et carteCourante passe par null', async () => {
    const { harness, hote, cartes, stable } = await ouvrir();
    const couches = injecteurPage(harness).get(CouchesCarteService);
    cartes[0].emettre('load');
    await stable();
    expect(couches.carteCourante()).toBe(cartes[0]);

    hote.querySelector<HTMLButtonElement>('[data-fond-compact="positron"]')!.click();
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
    // Le fond courant est marqué dans le sélecteur compact (les Réglages reviennent dans la boîte à outils, T5).
    expect(hote.querySelector('[data-fond-compact="magelian"]')!.getAttribute('aria-pressed')).toBe('false');
    expect(hote.querySelector('[data-fond-compact="positron"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('re-choisir le fond courant ne recrée rien', async () => {
    const { hote, cartes, stable } = await ouvrir();
    hote.querySelector<HTMLButtonElement>('[data-fond-compact="liberty"]')!.click();
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

    hote.querySelector<HTMLButtonElement>('[data-fond-compact="bright"]')!.click();
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
    hote.querySelector<HTMLButtonElement>('[data-fond-compact="positron"]')!.click();
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
    const bouton = hote.querySelector<HTMLButtonElement>('mg-barre-parcours button[data-tout-effacer]')!;
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
});

describe('CartePage — filtre unique : panneau ①, pastille, fil d’Ariane (T5)', () => {
  const pastilles = (hote: HTMLElement) =>
    [...hote.querySelectorAll('mg-barre-parcours mg-fil-etapes nav button')].filter((b) => b.querySelector('.sr-only')).map((b) => b.textContent!.replace(/\s+/g, ' ').trim());
  const ariane = (hote: HTMLElement) =>
    [...hote.querySelectorAll('mg-barre-parcours mg-fil-ariane button')].map((b) => b.textContent!.trim());

  it('① monte le panneau Filtre ; un filtre posé allume la pastille de ① et ajoute son segment au fil d’Ariane ; « France entière » le retire', async () => {
    const { harness, hote, stable } = await ouvrir();
    const etat = injecteurPage(harness).get(EtatCarteService);
    expect(hote.querySelector('[data-panneau-etape="perimetre"] mg-panneau-filtre')).not.toBeNull();
    hote.querySelector<HTMLButtonElement>('mg-panneau-filtre [data-france]')!.click();
    await stable();
    expect(etat.filtre()?.type).toBe('france');
    // Étape courante : pas de pastille (`mg-fil-etapes`). À ②, ① la porte, avec son texte pour les lecteurs d'écran.
    expect(pastilles(hote)).toEqual([]);
    frapper(hote, altChiffre('2'));
    await stable();
    expect(pastilles(hote)).toEqual(['1 Périmètre (renseignée)']);
    expect(ariane(hote)).toEqual(['France entière']);

    etat.filtre.set({ type: 'region', code: '53', label: 'Bretagne' });
    await stable();
    expect(ariane(hote)).toEqual(['France entière', 'Bretagne']);
    expect(hote.querySelector('mg-fil-ariane button[title="Région 53"]')).not.toBeNull();
    hote.querySelector<HTMLButtonElement>('mg-fil-ariane button')!.click();
    await stable();
    expect(etat.filtre()).toBeNull();
    expect(ariane(hote)).toEqual(['France entière']);
    expect(pastilles(hote)).toEqual([]);
  });

  it('les pastilles Métro / +DROM de ① allument la pastille et précisent le fil d’Ariane', async () => {
    const { harness, hote, stable } = await ouvrir({ url: '/carte?etape=donnees' });
    injecteurPage(harness).get(EtatCarteService).perimetreScope.set('metro');
    await stable();
    expect(pastilles(hote)).toEqual(['1 Périmètre (renseignée)']);
    expect(hote.querySelector('mg-fil-ariane')!.textContent).toContain('· métropole');
  });

  it('un calque allumé allume la pastille de ② (dégradé ou POI choisis)', async () => {
    const { harness, hote, stable } = await ouvrir();
    const etat = injecteurPage(harness).get(EtatCarteService);
    etat.poiSelectionnes.set(['lycee']);
    await stable();
    expect(pastilles(hote)).toEqual(['2 Données (renseignée)']);
    etat.poiSelectionnes.set([]);
    etat.basculerDegrade('carreaux', true);
    await stable();
    expect(pastilles(hote)).toEqual(['2 Données (renseignée)']);
  });

  it('revenir à ① garde « France entière » pressée : panneau monté, aucune relecture du référentiel', async () => {
    const geo = vi.fn(() => of({ regions: [] }));
    const { hote, stable } = await ouvrir({ referentiel: geo });
    hote.querySelector<HTMLButtonElement>('mg-panneau-filtre [data-france]')!.click();
    await stable();
    frapper(hote, altChiffre('2'));
    await stable();
    frapper(hote, altChiffre('1'));
    await stable();
    expect(hote.querySelector('mg-panneau-filtre [data-france]')!.getAttribute('aria-pressed')).toBe('true');
    expect(geo).toHaveBeenCalledTimes(1);
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
    frapper(hote, altChiffre('2'));
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
    hote.querySelector<HTMLButtonElement>('[data-fond-compact="bright"]')!.click();
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
    frapper(hote, altChiffre('2'));
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

  it('fermer le détail par sa croix rend le focus à l’hôte : Alt+2 répond encore (revue 1)', async () => {
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
    frapper(hote, altChiffre('2'));
    await stable();
    expect(panneauCourant(hote)).toBe('donnees');
  });
});

describe('CartePage — météo (T11)', () => {
  it('le dialogue météo est un <dialog> DANS la page ; Échap dedans le ferme, l’étape ② et la carte restent', async () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); }, configurable: true, writable: true,
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      value: function (this: HTMLDialogElement) { this.removeAttribute('open'); }, configurable: true, writable: true,
    });
    const { harness, hote, cartes, stable } = await ouvrir();
    frapper(hote, altChiffre('2'));
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
    expect(panneauCourant(hote)).toBe('donnees');
    expect(cartes).toHaveLength(1);
    expect(cartes[0].retiree).toBe(false);
    // Le focus est revenu à l'hôte : les raccourcis répondent encore (sinon il tomberait sur <body>).
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

  it('module ouvert : Alt+3 ne change ni l’étape ni l’URL, et ne ferme pas le module (Review Focus 2)', async () => {
    const { hote, stable } = await ouvrir({ url: '/carte?etape=donnees' });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/carte/risques?etape=donnees&risque=etape%3Drayon');
    await stable();
    const avant = router.url;
    expect(avant.startsWith('/carte/risques')).toBe(true);
    const e = frapper(hote, altChiffre('3'));
    await stable();
    expect(e.defaultPrevented).toBe(false);
    expect(router.url).toBe(avant);
    expect(panneauCourant(hote)).toBe('donnees');
    expect(hote.querySelector('[data-module-risque] mg-module-factice')).not.toBeNull();
    expect(hote.querySelector('[data-panneau-etape="analyse"]')).toBeNull();
  });

  it("Zones › Jeux de zones : la liste est rendue dans le panneau ④", async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, altChiffre('4'));
    await stable();
    expect(panneauCourant(hote)).toBe('zones');
    expect(hote.querySelector('[data-panneau-etape="zones"] mg-jeux-de-zones')).not.toBeNull();
    expect(hote.querySelector('mg-jeux-de-zones [data-jeux-vide]')).not.toBeNull();
  });

  it('Zones › Créer une zone (T16) : capture inactive sans couche ; le dessin ouvert, un clic sur la carte laisse l’étape ④', async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, altChiffre('4'));
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
    expect(panneauCourant(hote)).toBe('zones');
    expect(hote.querySelector('mg-creer-dessin [data-quitter]')).not.toBeNull();
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
    frapper(hote, altChiffre('4'));
    await stable();
    const panneau = hote.querySelector('[data-panneau-etape="zones"] mg-panneau-zones')!;
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

  it('?customZone=<id> : ④ courante ; géométrie lue UNE fois carte prête, recadrage sur son emprise (60 px, 1 s), bouton DV360 nommé ; une autre navigation de requête ne relit rien', async () => {
    const geometrie = vi.fn(() => of(ENTITE));
    const exporter = vi.fn(() => of());
    const { harness, hote, cartes, stable } = await carteChargee({ url: `/carte?customZone=${ID}`, zones: { geometrie, exporter } });
    expect(panneauCourant(hote)).toBe('zones');
    expect(geometrie).toHaveBeenCalledTimes(1);
    expect(geometrie).toHaveBeenCalledWith(ID);
    expect(cartes[0].cadrages.at(-1)).toEqual({ cadre: [[5, 43], [6, 44.5]], options: { padding: 60, duration: 1000 } });
    // Le créneau de bataille est peint : l'aplat des anneaux et le point au centre.
    expect(cartes[0].getLayer('battle-fill')).toBeDefined();
    expect(cartes[0].getLayer('battle-pois-circle')).toBeDefined();
    const bouton = hote.querySelector<HTMLButtonElement>('button[data-script-dv360]')!;
    expect(bouton.getAttribute('title')).toBe('Générer le fichier custom bidding DV360 pour « CIRFA BRETAGNE »');
    expect(bouton.closest('mg-barre-parcours')).not.toBeNull();
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
    // `customZone` parti, l'étape ④ qu'il avait ouverte reste (elle est dans l'URL depuis l'ouverture).
    expect(TestBed.inject(Router).url).toBe('/carte?etape=zones');
  });

  it('changement d’organisation (badge de la barre) : la page émet `espaceChange` UNE fois et ne nettoie plus rien à la main — l’hôte la recrée (droits sur la carte, T3)', async () => {
    const { harness, hote, stable } = await carteChargee({ url: `/carte?customZone=${ID}`, zones: { geometrie: () => of(ENTITE) } });
    const page = harness.fixture.debugElement.query(By.directive(CartePage)).componentInstance as CartePage;
    const emis = vi.fn();
    page.espaceChange.subscribe(emis);
    const etat = injecteurPage(harness).get(EtatCarteService);
    const barre = harness.fixture.debugElement.query(By.css('mg-barre-parcours')).componentInstance as { orgChangee: { emit(v: string | null): void } };

    etat.filtre.set({ type: 'zone', code: ID, label: 'CIRFA BRETAGNE', bbox: [5, 43, 6, 44.5] });
    barre.orgChangee.emit('org-2');
    await stable();
    expect(emis).toHaveBeenCalledTimes(1);
    // Plus de nettoyage manuel : filtre, zone du lien et URL restent tels quels — c'est la recréation qui les remet à zéro.
    expect(etat.filtre()?.code).toBe(ID);
    expect(hote.querySelector('button[data-script-dv360]')).not.toBeNull();
    expect(TestBed.inject(Router).url).toBe(`/carte?customZone=${ID}&etape=zones`);
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

  it('première zone affichée → panneau ouvert à droite de la carte, totaux lus UNE fois ; la croix le ferme, « Plan média (n) » le rouvre ; Tout effacer → fermé', async () => {
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
    // Dans le conteneur de la carte, sous la barre du parcours : plus de décalage à porter.
    expect(panneau.style.top).toBe('0px');
    expect(panneau.closest('[data-zone-carte]')).not.toBeNull();
    expect(hote.querySelector('[data-titre]')!.textContent!.trim()).toBe('Plan média — 1 zone');
    expect(hote.querySelector('mg-barre-parcours [data-rouvrir-plan]')).toBeNull();

    hote.querySelector<HTMLButtonElement>('mg-plan-media button[title="Fermer"]')!.click();
    await stable();
    expect(hote.querySelector('mg-plan-media')).toBeNull();
    zones.afficher(zone('b', 'B'));
    await stable();
    expect(hote.querySelector('mg-plan-media')).toBeNull();
    const rouvrir = hote.querySelector<HTMLButtonElement>('mg-barre-parcours [data-rouvrir-plan]')!;
    expect(rouvrir.textContent!.trim()).toBe('Plan média (2)');
    rouvrir.click();
    await stable();
    expect(hote.querySelector('[data-titre]')!.textContent!.trim()).toBe('Plan média — 2 zones');
    expect(totauxNationaux).toHaveBeenCalledTimes(1);

    hote.querySelector<HTMLButtonElement>('button[data-tout-effacer]')!.click();
    await stable();
    expect(hote.querySelector('mg-plan-media')).toBeNull();
    expect(hote.querySelector('mg-barre-parcours [data-rouvrir-plan]')).toBeNull();
  });
});
