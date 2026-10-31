import { HttpResponse } from '@angular/common/http';
import { Component, type Injector, computed, effect, inject, runInInjectionContext, signal } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { FABRIQUE_CARTE } from '../../carte/fabrique-carte';
import { CarteFactice } from '../../carte/testing/carte-factice';
import { AuthService } from '../../core/auth/auth.service';
import { OrganisationsApi } from '../session/data/organisations.api';
import { ReferentielApi } from '../risques/data/referentiel.api';
import { CarreauxApi } from './data/carreaux.api';
import { ProfilRisqueApi } from '../risques/data/profil-risque.api';
import { CouvertureApi } from './data/couverture.api';
import { JeuxApi } from './data/jeux.api';
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
import { ZonesApi } from './data/zones.api';
import { JeuxZonesApi } from '../risques/data/jeux-zones.api';
import { ZonesRisqueApi } from '../risques/data/zones-risque.api';
import { PONT_CARTE } from './etat/pont-carte';
import { DETAIL_ESSAI } from './testing/campagnes-ooh.fixture';
import { ZonesRisqueService } from './couches/zones-risque.service';
import { ScoreService } from './couches/score.service';
import { BatailleService } from './couches/bataille.service';
import { AnalysesPeintesService } from './etat/analyses-peintes';
import { PROFIL_DEFAUT } from '../risques/logique/profil';
import { ZonesCustomService } from './couches/zones-custom.service';
import type { ZoneCustomResume } from './data/zones-custom.api';
import { CouleursService } from '../../core/theme/couleurs.service';
import { CartePage } from './carte.page';
import { AnnonceService } from './etat/annonce.service';
import { CatalogueIndicateursService } from './etat/catalogue-indicateurs.service';
import { CouchesCarteService, quandStyleCharge } from './etat/couches-carte.service';
import { EtatCarteService } from './etat/etat-carte.service';
import { CarreauxService } from './couches/carreaux.service';
import { JEUX_REFERENTIELS } from './logique/jeux-carte';
import { MeteoService } from './couches/meteo.service';
import { PileEchapService } from './etat/pile-echap.service';
import { PanneauFiltreComponent } from './panneaux/filtre/panneau-filtre.component';
import { PlanApi } from './data/plan.api';
import { ActivationApi } from './data/activation.api';
import { CONSIGNE_ETAPE, ETAPES_CARTE, LIBELLE_ETAPE_CARTE } from './logique/parcours';

/** L'indicateur privable de la migration sql/288, au socle (A-2) : ② garde la ligne « Indicateurs au code postal ». */
const ABSTENTION_AU_SOCLE = { indicator_code: 'abstention_pres_2022', label: "Taux d'abstention (présidentielle 2022)", famille: null, origine: 'commune' as const };

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
  /** `JeuxApi.plateformes` (⑤, lu à l'arrivée d'une zone). */
  plateformes?: () => unknown;
  /** `JeuxApi.lister` (outil « Mes zones »). */
  jeux?: () => unknown;
  /** `CarteApi.categories` (catalogue des types de POI, ②). */
  categories?: () => unknown;
  /** `CarteApi.jeuxRecommandes` (sélection recommandée, lue à la première visite de ②). */
  jeuxRecommandes?: () => unknown;
  /** `AnalysesApi.lister` (outil « Mes analyses », lu à la première ouverture du tiroir). */
  analyses?: () => unknown;
  /** `CarteApi.campagnesOoh` / `campagneOoh` (« Autres » → « Panneaux OOH et DOOH »). */
  campagnesOoh?: () => unknown;
  campagneOoh?: (id: string) => unknown;
  /** `CouvertureApi.couverture` (④, ⑤) ; par défaut jamais rendue. */
  couverture?: (...args: unknown[]) => unknown;
  /** `ZonesApi.recalculer` (« Mes zones »). */
  recalculer?: (id: string) => unknown;
  /** `AnalysesApi.indicateurs` (catalogue des indicateurs visibles : ② à sa première visite, ③ « Par seuil », ④). */
  indicateurs?: () => unknown;
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
      // L'atelier de ③ (lot 3) : aucune requête tant qu'on ne prévisualise rien.
      { provide: ZonesApi, useValue: options.recalculer ? { recalculer: options.recalculer } : {} },
      { provide: ZonesRisqueApi, useValue: { urlTuilesZones: () => '/api/tiles/zones-risque/{z}/{x}/{y}?profil=x', preparer: () => of({ classes: 1 }) } },
      { provide: JeuxZonesApi, useValue: { lister: options.jeux ?? (() => of({ jeux: [] })) } },
      { provide: CarreauxApi, useValue: { urlTuiles: () => '/api/tiles/{z}/{x}/{y}?v=19' } },
      { provide: IrisApi, useValue: { urlTuiles: () => '/api/tiles/iris/{z}/{x}/{y}?v=2', bornes: () => of({}), detail: () => of() } },
      // ④ Couverture d'une zone (lot 4, T8) : jamais appelée sans « Chiffrer ».
      { provide: CouvertureApi, useValue: { couverture: options.couverture ?? (() => NEVER) } },
      // ⑤ Jeu de zones (lot 5, T10) : rien n'est lu sans zone ; une zone de l'URL fait lire le registre.
      // « Mes zones » lit `GET /api/zones/jeux?type=tous` par `JeuxApi` depuis le lot 5 (T12, les deux types).
      { provide: JeuxApi, useValue: { plateformes: options.plateformes ?? (() => NEVER), lister: options.jeux ?? (() => of({ jeux: [] })) } },
      { provide: ProfilRisqueApi, useValue: { cibles: () => NEVER } },
      // ⑥ Plan (lot 6, T3) : le hall lit campagnes, stratégies, brouillons et mode démo à son montage ; jamais rendus ici.
      { provide: PlanApi, useValue: { campagnes: () => NEVER, strategies: () => NEVER, brouillons: () => NEVER, modeDemo: () => NEVER } },
      // ⑦ (lot 7) : sans `?campagne=` validée, `ActivationCampagneService` ne lit rien.
      { provide: ActivationApi, useValue: {} },
      { provide: CarteApi, useValue: { categories: options.categories ?? (() => of({ categories: ['lycee', 'panneaux', 'risque_industriel'] })), jeuxRecommandes: options.jeuxRecommandes ?? (() => of({ cles: [] })), pois: () => of(), campagnesOoh: options.campagnesOoh ?? (() => of({ campagnes: [], tronque: false })), campagneOoh: options.campagneOoh ?? (() => of()), transport: () => of(), urlTuilesTmja: () => '/api/tmja-tiles/{z}/{x}/{y}?v=v10' } },
      { provide: RadioApi, useValue: { optionsFiltre: () => of({}), emetteurs: () => of({ type: 'FeatureCollection', features: [] }), stations: () => of({}) } },
      { provide: MeteoApi, useValue: { donnees: () => of() } },
      { provide: IsochronesApi, useValue: {} },
      // Mes analyses (boîte à outils, T6) : la liste n'est lue qu'à l'ouverture de l'outil (inventaire, T7).
      // `indicateurs` : le catalogue que lit « Par seuil » de ③ (lot 3), dépliée par l'inventaire, et que ② lit pour ranger
      // « Indicateurs au code postal » (A-7) : l'abstention y est visible, au socle, comme dans la base locale.
      { provide: AnalysesApi, useValue: { lister: options.analyses ?? (() => of({ analyses: [] })), indicateurs: options.indicateurs ?? (() => of({ indicators: [ABSTENTION_AU_SOCLE] })) } },
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
const AZERTY: Record<string, string> = { '1': '&', '2': 'é', '3': '"', '4': "'", '5': '(', '6': '-', '7': 'è', '8': '_' };
const altChiffre = (n: string): KeyboardEventInit => ({ key: AZERTY[n], code: `Digit${n}`, altKey: true });
/** L'aside du panneau d'étape. */
const aside = (hote: HTMLElement) => hote.querySelector<HTMLElement>('mg-panneau-etape aside')!;

/** La zone d'un lien `/carte?customZone=<id>` : partagée par les essais T14 et l'inventaire des fonctions (T7). */
const ID_ZONE_DU_LIEN = '11111111-2222-3333-4444-555555555555';
const ZONE_DU_LIEN = {
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[5, 43], [6, 43], [6, 44.5], [5, 44.5], [5, 43]]] },
  properties: { id: ID_ZONE_DU_LIEN, name: 'CIRFA BRETAGNE' },
};

describe('CartePage — la carte en parcours : barre, fil, panneau d’étape, clavier', () => {
  it("(f) la barre rend ① à ⑧ dans l'ordre du module risque, ① courante ; plus aucun rail, ni barre du haut, ni boutons flottants", async () => {
    const { hote } = await ouvrir();
    const boutons = [...hote.querySelectorAll('mg-barre-parcours mg-fil-etapes nav button')];
    expect(boutons.map((b) => b.textContent!.replace(/\s+/g, ' ').trim()))
      .toEqual(['1 Périmètre', '2 Données', '3 Zones', '4 Analyse', '5 Jeu de zones', '6 Plan', '7 Activation', '8 Live']);
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

  it('lot 3, T9 : la barre de progression de la page est montée sous la barre du parcours, vide au repos', async () => {
    const { hote } = await ouvrir();
    const barre = hote.querySelector('mg-barre-progression');
    expect(barre).not.toBeNull();
    expect(barre!.previousElementSibling?.tagName.toLowerCase()).toBe('mg-barre-parcours');
    const jauge = barre!.querySelector('[role="progressbar"]')!;
    expect(jauge.getAttribute('aria-busy')).toBe('false');
    expect(jauge.getAttribute('aria-label')).toBe('Aucun calcul en cours');
    expect(jauge.textContent!.trim()).toBe('');
  });

  it('(g) Alt+2 (AZERTY : code Digit2, key « é ») passe à ② : Données dans son panneau, ?etape=donnees ; Échap ne le ferme pas', async () => {
    const { hote, stable } = await ouvrir();
    const e = frapper(hote, altChiffre('2'));
    await stable();
    expect(e.defaultPrevented).toBe(true);
    expect(panneauCourant(hote)).toBe('donnees');
    expect(hote.querySelector('[data-panneau-etape="donnees"] mg-panneau-donnees')).not.toBeNull();
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

  it('catalogue des indicateurs (Disk I/O) : rien au montage sur ①, une lecture à la 1re visite de ②, aucune de plus sur ③ et ④', async () => {
    const indicateurs = vi.fn(() => of({ indicators: [ABSTENTION_AU_SOCLE] }));
    const { hote, stable } = await ouvrir({ indicateurs });
    expect(panneauCourant(hote)).toBe('perimetre');
    expect(indicateurs).not.toHaveBeenCalled();
    frapper(hote, altChiffre('2'));
    await stable();
    expect(panneauCourant(hote)).toBe('donnees');
    expect(indicateurs).toHaveBeenCalledTimes(1);
    frapper(hote, altChiffre('3'));
    await stable();
    frapper(hote, altChiffre('4'));
    await stable();
    expect(panneauCourant(hote)).toBe('analyse');
    expect(indicateurs).toHaveBeenCalledTimes(1);
  });

  it('Alt+pavé numérique 4 passe aussi à ④ Analyse ; Alt+pavé 8 à ⑧ Live ; Alt+9 ne fait rien', async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, { key: '4', code: 'Numpad4', altKey: true });
    await stable();
    expect(panneauCourant(hote)).toBe('analyse');
    frapper(hote, { key: '8', code: 'Numpad8', altKey: true });
    await stable();
    expect(panneauCourant(hote)).toBe('live');
    const neuf = frapper(hote, { key: 'ç', code: 'Digit9', altKey: true });
    await stable();
    expect(neuf.defaultPrevented).toBe(false);
    expect(panneauCourant(hote)).toBe('live');
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

  it('(j) Alt+5 ouvre ⑤ Jeu de zones (lot 5) ; Alt+C et Ctrl+K ne changent pas l’étape et ne sont pas consommés', async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, altChiffre('5'));
    await stable();
    expect(panneauCourant(hote)).toBe('jeu');
    expect(hote.querySelector('[data-panneau-etape="jeu"] mg-panneau-jeu')).not.toBeNull();
    expect(aside(hote).getAttribute('aria-label')).toBe('Étape 5 — Jeu de zones');
    expect(routeur().url).toBe('/carte?etape=jeu');
    const c = frapper(hote, { key: 'c', code: 'KeyC', altKey: true });
    const k = frapper(hote, { key: 'k', code: 'KeyK', ctrlKey: true });
    await stable();
    expect(c.defaultPrevented).toBe(false);
    expect(k.defaultPrevented).toBe(false);
    expect(panneauCourant(hote)).toBe('jeu');
  });

  it('cliquer ④ dans le fil la rend courante ; revenir à ① retrouve la MÊME instance du panneau Filtre', async () => {
    const { harness, hote, stable } = await ouvrir();
    const filtre = harness.fixture.debugElement.query(By.directive(PanneauFiltreComponent)).componentInstance;
    const bouton = (n: number) => hote.querySelectorAll<HTMLButtonElement>('mg-barre-parcours mg-fil-etapes nav button')[n];
    bouton(3).click();
    await stable();
    expect(panneauCourant(hote)).toBe('analyse');
    expect(hote.querySelector('[data-panneau-etape="analyse"] mg-panneau-analyse')).not.toBeNull();
    expect(aside(hote).getAttribute('aria-label')).toBe('Étape 4 — Analyse');
    expect(routeur().url).toBe('/carte?etape=analyse');
    bouton(0).click();
    await stable();
    expect(panneauCourant(hote)).toBe('perimetre');
    expect(harness.fixture.debugElement.query(By.directive(PanneauFiltreComponent)).componentInstance).toBe(filtre);
    expect(routeur().url).toBe('/carte');
  });

  it('un clic sur la carte ne replie ni ne change rien', async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, altChiffre('4'));
    await stable();
    hote.querySelector('mg-carte')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    hote.querySelector('mg-carte')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await new Promise((r) => setTimeout(r, 220));
    await stable();
    expect(panneauCourant(hote)).toBe('analyse');
    expect(aside(hote).style.visibility).toBe('visible');
  });

  it('T4b (Vincent, 13/10) : le panneau d’étape FLOTTE sur la carte — la zone carte ne dépend ni de son ouverture ni de sa largeur', async () => {
    const { hote, stable } = await ouvrir();
    const zone = hote.querySelector<HTMLElement>('[data-zone-carte]')!;
    // Une carte posée DANS le conteneur carte, hors du flux : elle ne lui prend aucune largeur.
    expect(zone.contains(aside(hote))).toBe(true);
    expect(aside(hote).classList).toContain('absolute');
    // Le conteneur carte est un enfant direct de l'hôte, qui est une COLONNE : ses frères (barre, module risque, dialogue)
    // s'empilent au-dessus, en dessous ou par-dessus — aucun ne lui dispute la largeur, quels qu'ils soient (relecture m4).
    expect(zone.parentElement).toBe(hote);
    expect(hote.classList).toContain('flex-col');
    const gabarit = () => [zone.getAttribute('class'), zone.style.width, zone.style.flex, zone.style.marginLeft];
    const avant = gabarit();
    // Élargi à la poignée, puis replié, puis rouvert : le conteneur carte ne bouge pas.
    const poignee = hote.querySelector<HTMLElement>('mg-panneau-etape [role="separator"]')!;
    poignee.setPointerCapture = vi.fn();
    const pointeur = (type: string, x: number) => {
      const e = new MouseEvent(type, { clientX: x, bubbles: true });
      Object.defineProperty(e, 'pointerId', { value: 3 });
      return e;
    };
    poignee.dispatchEvent(pointeur('pointerdown', 500));
    poignee.dispatchEvent(pointeur('pointermove', 720));
    poignee.dispatchEvent(pointeur('pointerup', 720));
    await stable();
    expect(aside(hote).style.width).toBe('700px');
    expect(gabarit()).toEqual(avant);
    hote.querySelector<HTMLButtonElement>('mg-panneau-etape [data-replier]')!.click();
    await stable();
    expect(gabarit()).toEqual(avant);
    hote.querySelector<HTMLButtonElement>('[data-afficher-panneau]')!.click();
    await stable();
    expect(gabarit()).toEqual(avant);
    // Hauteur au contenu : l'étape courante seule dans le flux, l'étape quittée montée, `absolute` et invisible (A1).
    frapper(hote, altChiffre('3'));
    await stable();
    const etape = (e: string) => hote.querySelector<HTMLElement>(`[data-panneau-etape="${e}"]`)!.classList;
    expect(etape('zones').contains('absolute')).toBe(false);
    expect(etape('perimetre').contains('absolute')).toBe(true);
    expect(etape('perimetre').contains('invisible')).toBe(true);
    expect(gabarit()).toEqual(avant);
  });

  it('T4b : le badge de zoom (et, par leur propre spec, zone active et légende) se décale à droite du panneau OUVERT', async () => {
    const { hote, stable } = await ouvrir();
    const zone = hote.querySelector<HTMLElement>('[data-zone-carte]')!;
    const emprise = () => zone.style.getPropertyValue('--emprise-panneau');
    // 12 px de marge + 480 px de panneau : le bord droit de la carte flottante, borné à la place libre (outils à 10 px).
    expect(emprise()).toBe('min(492px, 100% - 150px)');
    expect(hote.querySelector('[data-badge-zoom]')!.classList).toContain('left-[calc(var(--emprise-panneau,0px)+10px)]');
    hote.querySelector<HTMLButtonElement>('mg-panneau-etape [data-replier]')!.click();
    await stable();
    expect(emprise()).toBe('0px');
    hote.querySelector<HTMLButtonElement>('[data-afficher-panneau]')!.click();
    await stable();
    expect(emprise()).toBe('min(492px, 100% - 150px)');
    hote.querySelector<HTMLButtonElement>('mg-barre-parcours [data-immersif]')!.click();
    await stable();
    expect(emprise()).toBe('0px');
  });

  it('T4b round 1 (I-1) : la marge MapLibre suit le panneau — 492 ouvert, 0 replié ou immersif, au relâcher seulement, re-posée sur la carte recréée', async () => {
    const { hote, cartes, stable } = await ouvrir();
    cartes[0].emettre('load');
    await stable();
    const derniere = (i = 0) => cartes[i].marges.at(-1);
    // Ouverture : 12 + 480 à gauche ; à droite, l'écart de la boîte à outils (10, rien d'ouvert au bord droit).
    expect(derniere()).toEqual({ top: 0, bottom: 0, left: 492, right: 10 });
    hote.querySelector<HTMLButtonElement>('mg-panneau-etape [data-replier]')!.click();
    await stable();
    expect(derniere()).toEqual({ top: 0, bottom: 0, left: 0, right: 10 });
    hote.querySelector<HTMLButtonElement>('[data-afficher-panneau]')!.click();
    await stable();
    expect(derniere()).toEqual({ top: 0, bottom: 0, left: 492, right: 10 });

    // Glisser la poignée : AUCUNE marge pendant le glissement, une seule au relâcher.
    const poignee = hote.querySelector<HTMLElement>('mg-panneau-etape [role="separator"]')!;
    poignee.setPointerCapture = vi.fn();
    const pointeur = (type: string, x: number) => {
      const e = new MouseEvent(type, { clientX: x, bubbles: true });
      Object.defineProperty(e, 'pointerId', { value: 4 });
      return e;
    };
    const avant = cartes[0].marges.length;
    poignee.dispatchEvent(pointeur('pointerdown', 500));
    for (const x of [550, 600, 650, 700]) {
      poignee.dispatchEvent(pointeur('pointermove', x));
      await stable();
    }
    expect(cartes[0].marges).toHaveLength(avant);
    poignee.dispatchEvent(pointeur('pointerup', 700));
    await stable();
    expect(cartes[0].marges).toHaveLength(avant + 1);
    expect(derniere()).toEqual({ top: 0, bottom: 0, left: 692, right: 10 });

    hote.querySelector<HTMLButtonElement>('mg-barre-parcours [data-immersif]')!.click();
    await stable();
    expect(derniere()).toEqual({ top: 0, bottom: 0, left: 0, right: 10 });
    frapper(hote, { key: 'Escape' });
    await stable();
    expect(derniere()).toEqual({ top: 0, bottom: 0, left: 692, right: 10 });

    // Un autre fond RECRÉE la carte (B11) : la marge est re-posée sur la nouvelle instance, dès sa publication.
    await choisirFondOutil(hote, stable, 'positron');
    await stable();
    cartes[1].emettre('load');
    await stable();
    expect(derniere(1)).toEqual({ top: 0, bottom: 0, left: 692, right: 10 });
    localStorage.removeItem('genesis_map_style');
  });

  it('replier puis rouvrir le panneau garde les panneaux montés ; le focus revient à l’hôte et Alt+2 répond encore', async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, altChiffre('4'));
    await stable();
    const analyse = hote.querySelector('mg-panneau-analyse');
    const replier = hote.querySelector<HTMLButtonElement>('mg-panneau-etape [data-replier]')!;
    replier.focus();
    replier.click();
    await stable();
    expect(aside(hote).style.visibility).toBe('hidden');
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
    const bouton = hote.querySelector<HTMLButtonElement>('[data-panneau-etape="perimetre"] mg-panneau-filtre [data-scope="all"]')!;
    bouton.focus();
    expect(document.activeElement).toBe(bouton);
    frapper(bouton, altChiffre('2'));
    await stable();
    expect(panneauCourant(hote)).toBe('donnees');
    expect(document.activeElement).toBe(hote);
    frapper(hote, altChiffre('4'));
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

  it('⑤ ⑥ ⑦ ⑧ : la consigne de l’étape n’est dite qu’UNE fois (en-tête du panneau d’étape)', async () => {
    const { hote, stable } = await ouvrir();
    const occurrences = (texte: string) => hote.textContent!.split(texte).length - 1;
    for (const [n, e] of [['5', 'jeu'], ['6', 'plan'], ['7', 'activation'], ['8', 'live']] as const) {
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
    const donnees = hote.querySelector('mg-panneau-donnees');
    hote.querySelector<HTMLButtonElement>('mg-barre-parcours [data-immersif]')!.click();
    await stable();
    expect(hote.querySelector('mg-barre-parcours')).toBeNull();
    expect(aside(hote).style.visibility).toBe('hidden');
    expect(hote.querySelector('mg-panneau-donnees')).toBe(donnees);
    // Ni l'onglet « carte seule » (le repli n'est pas posé), ni le focus perdu (le bouton est parti avec la barre).
    expect(hote.querySelector('[data-afficher-panneau]')).toBeNull();
    expect(document.activeElement).toBe(hote);
    // La sortie à la souris est rangée dans la boîte à outils (T5).
    const quitter = hote.querySelector<HTMLButtonElement>('[data-zone-carte] mg-boite-outils [role="toolbar"] [data-quitter-immersif]')!;
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
    for (const s of ['mg-legende-carte', '[data-badge-zoom]', 'mg-annonce', 'mg-detail-iris', 'mg-tiroir-panneau', 'mg-zone-active', 'mg-boite-outils']) {
      expect(carte.querySelector(s), s).not.toBeNull();
    }
  });

  it("une navigation de requête RÉUTILISE l'écran : ni page ni carte recréées ; ?etape=analyse passe à ④", async () => {
    const { harness, hote, cartes, stable } = await ouvrir();
    await routeur().navigateByUrl('/carte?etape=analyse');
    await stable();
    expect(harness.fixture.nativeElement.querySelector('mg-carte-principale')).toBe(hote);
    expect(cartes).toHaveLength(1);
    expect(cartes[0].retiree).toBe(false);
    expect(panneauCourant(hote)).toBe('analyse');
  });

  it('?etape=zones à l’ouverture : ③ courante, et ① n’est pas monté (première visite seulement)', async () => {
    const { hote } = await ouvrir({ url: '/carte?etape=zones' });
    expect(panneauCourant(hote)).toBe('zones');
    expect(hote.querySelector('[data-panneau-etape="perimetre"]')).toBeNull();
  });

  it('zéro relecture : après une visite de ① à ④ et de l’outil Mes zones, cinq bascules ne relisent rien', async () => {
    const geo = vi.fn(() => of({ regions: [] }));
    const lister = vi.fn(() => of({ zones: [] }));
    const jeux = vi.fn(() => of({ jeux: [] }));
    const categories = vi.fn(() => of({ categories: ['lycee'] }));
    const jeuxRecommandes = vi.fn(() => of({ cles: ['tmja:comptages'] }));
    const { hote, stable } = await ouvrir({ referentiel: geo, zones: { lister }, jeux, categories, jeuxRecommandes, organisation: 'org-1' });
    for (const n of ['2', '3', '4', '1']) {
      frapper(hote, altChiffre(n));
      await stable();
      if (n === '3') {
        // « Mes zones » et les jeux de zones vivent dans la boîte à outils depuis T6 : ils ne sont lus qu'à son ouverture.
        hote.querySelector<HTMLButtonElement>('mg-boite-outils [data-outil="zones"]')!.click();
        await stable();
      }
      // À ②, le catalogue des types de POI et la sélection recommandée sont lus à la première visite (T13).
    }
    const lectures = () => [
      geo.mock.calls.length, lister.mock.calls.length, jeux.mock.calls.length, categories.mock.calls.length, jeuxRecommandes.mock.calls.length,
    ];
    const avant = lectures();
    // Chaque lecture a bien eu lieu UNE fois aux premières visites : l'assertion qui suit ne compare pas des zéros.
    expect(avant.map((n) => n >= 1), `géo, zones, jeux, catégories, sélection : ${avant}`).toEqual([true, true, true, true, true]);
    expect(avant.slice(3), 'catégories et sélection, une fois chacune').toEqual([1, 1]);
    for (const n of ['3', '1', '4', '2', '1']) {
      frapper(hote, altChiffre(n));
      await stable();
      // Fermer puis rouvrir l'outil ne relit rien non plus : son contenu est gardé (ruling AT-6).
      hote.querySelector<HTMLButtonElement>('mg-boite-outils [data-outil="zones"]')!.click();
      await stable();
    }
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
/** Un fond choisi dans l'outil « Fond de carte » de la boîte à outils (T5) : ouvre le tiroir s'il ne l'est pas, puis clique. */
async function choisirFondOutil(hote: HTMLElement, stable: () => Promise<void>, id: string): Promise<void> {
  const bouton = hote.querySelector<HTMLButtonElement>('mg-boite-outils [data-outil="fond"]')!;
  if (bouton.getAttribute('aria-pressed') !== 'true') {
    bouton.click();
    await stable();
  }
  hote.querySelector<HTMLButtonElement>(`[data-tiroir-outil] [data-fond="${id}"]`)!.click();
}

describe('CartePage — la boîte à outils : fond, légende, aide, réglages (T5)', () => {
  beforeEach(() => {
    TestBed.overrideProvider(CouleursService, { useValue: { palette: () => signal({ absente: '#9aa0a6', trait: '#555555' }) } });
  });

  const outil = (hote: HTMLElement, id: string) => hote.querySelector<HTMLButtonElement>(`mg-boite-outils [data-outil="${id}"]`)!;
  /** Le tiroir VISIBLE : un tiroir fermé reste monté, invisible et inerte (ruling AT-6). */
  const tiroir = (hote: HTMLElement) => hote.querySelector<HTMLElement>('[data-tiroir-outil]:not([inert])');
  const titreAide = (hote: HTMLElement) => tiroir(hote)!.querySelector('[data-aide-etape] h4')!.textContent!.replace(/\s+/g, ' ').trim();

  it('la boîte à outils vit dans le conteneur carte : Mes analyses, Mes zones, Fond de carte, Légende, Aide, Réglages', async () => {
    const { hote } = await ouvrir();
    const barre = hote.querySelector('[data-zone-carte] mg-boite-outils [role="toolbar"]')!;
    expect([...barre.querySelectorAll('[data-outil]')].map((b) => b.getAttribute('aria-label')))
      .toEqual(['Mes analyses', 'Mes zones', 'Fond de carte', 'Légende', 'Aide', 'Réglages']);
  });

  it('Échap ferme le DERNIER ouvert : immersif puis tiroir Aide → le tiroir d’abord, puis l’immersif', async () => {
    const { harness, hote, stable } = await ouvrir();
    hote.querySelector<HTMLButtonElement>('mg-barre-parcours [data-immersif]')!.click();
    await stable();
    outil(hote, 'aide').click();
    await stable();
    expect(injecteurPage(harness).get(PileEchapService).etat().map((x) => x.id)).toEqual(['immersif', 'outil']);
    frapper(hote, { key: 'Escape' });
    await stable();
    expect(tiroir(hote)).toBeNull();
    expect(hote.querySelector('mg-barre-parcours')).toBeNull();
    frapper(hote, { key: 'Escape' });
    await stable();
    expect(hote.querySelector('mg-barre-parcours')).not.toBeNull();
    expect(injecteurPage(harness).get(PileEchapService).etat()).toEqual([]);
  });

  it('le tiroir Aide suit l’étape : ② puis ③ → « 3. Zones » et sa consigne', async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, altChiffre('2'));
    await stable();
    outil(hote, 'aide').click();
    await stable();
    expect(titreAide(hote)).toBe('2. Données');
    frapper(hote, altChiffre('3'));
    await stable();
    expect(titreAide(hote)).toBe('3. Zones');
    expect(tiroir(hote)!.textContent).toContain(CONSIGNE_ETAPE.zones);
  });

  it('Légende masque mg-legende-carte, puis la rend', async () => {
    const { hote, stable } = await ouvrir();
    expect(hote.querySelector('mg-legende-carte')).not.toBeNull();
    outil(hote, 'legende').click();
    await stable();
    expect(hote.querySelector('mg-legende-carte')).toBeNull();
    expect(tiroir(hote)).toBeNull();
    outil(hote, 'legende').click();
    await stable();
    expect(hote.querySelector('mg-legende-carte')).not.toBeNull();
  });

  it('Réglages : Apparence et Back office ; « Accès » est un lien RELATIF à la route carte (le préfixe du shell n’est pas éprouvé ici)', async () => {
    const { hote, stable } = await ouvrir();
    outil(hote, 'reglages').click();
    await stable();
    const reglages = tiroir(hote)!.querySelector('mg-reglages')!;
    expect([...reglages.querySelectorAll('section h4')].map((h) => h.textContent?.trim())).toEqual(['Apparence', 'Back office']);
    expect(reglages.querySelector<HTMLAnchorElement>('[data-section="back-office"] a')!.getAttribute('href')).toBe('/admin/acces');
  });

  it('fermer le tiroir qui portait le focus le rend à l’hôte : Alt+2 répond encore', async () => {
    const { hote, stable } = await ouvrir();
    outil(hote, 'aide').click();
    await stable();
    const croix = tiroir(hote)!.querySelector<HTMLButtonElement>('header button[aria-label="Fermer"]')!;
    croix.focus();
    croix.click();
    await stable();
    expect(tiroir(hote)).toBeNull();
    expect((hote.getRootNode() as Document | ShadowRoot).activeElement).toBe(hote);
    frapper(hote, altChiffre('2'));
    await stable();
    expect(panneauCourant(hote)).toBe('donnees');
  });

  it('ruling AT-3 : le détail IRIS ouvert écarte la boîte à outils (340 px) ; les annonces sont SOUS elle, et y restent tiroir ouvert', async () => {
    const detail = vi.fn(() => of({ code_iris: '751010201', nom_iris: 'Saint-Germain', code_commune: null, code_dept: null, is_true_iris: true }));
    TestBed.overrideProvider(IrisApi, { useValue: { urlTuiles: () => '', bornes: () => of({}), detail } });
    const { hote, cartes, stable } = await ouvrir();
    const barre = () => hote.querySelector<HTMLElement>('mg-boite-outils [data-colonne-outils]')!;
    // Les annonces de la page sont projetées dans la colonne, après la barre d'outils (relecture T5, I-1).
    const annonces = hote.querySelector<HTMLElement>('[data-zone-carte] mg-boite-outils [data-colonne-outils] > mg-annonce')!;
    expect(annonces).not.toBeNull();
    expect(annonces.previousElementSibling!.getAttribute('role')).toBe('toolbar');
    expect(barre().style.right).toBe('10px');
    expect(barre().style.width).toBe('calc(100% - 20px)');
    cartes[0].emettre('load');
    await stable();
    cartes[0].emettreSurCouche('click', 'iris-fill', { features: [{ properties: { code_iris: '751010201' } }] });
    await stable();
    expect(hote.querySelector('[data-detail-iris]')).not.toBeNull();
    expect(barre().style.right).toBe('340px');
    // T4b : le panneau d'étape suit — sa place libre recule de la même largeur, son emprise avec.
    expect(aside(hote).style.maxWidth).toBe('calc(100% - 492px)');
    expect(hote.querySelector<HTMLElement>('[data-zone-carte]')!.style.getPropertyValue('--emprise-panneau')).toBe('min(492px, 100% - 480px)');
    outil(hote, 'fond').click();
    await stable();
    expect(tiroir(hote)!.style.right).toBe('388px');
    expect(barre().style.right).toBe('340px');
    expect(barre().style.width).toBe('calc(100% - 350px)');
    expect(hote.querySelector('mg-annonce')).toBe(annonces);
  });
});

describe('CartePage — fond de carte, recréation, Tout effacer (T4)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('choisir « Clair » RECRÉE la carte sur Positron, mémorise le choix, et carteCourante passe par null', async () => {
    const { harness, hote, cartes, stable } = await ouvrir();
    const couches = injecteurPage(harness).get(CouchesCarteService);
    cartes[0].emettre('load');
    await stable();
    expect(couches.carteCourante()).toBe(cartes[0]);

    // Rejoué depuis le tiroir « Fond de carte » de la boîte à outils (T5) — le sélecteur compact est retiré.
    await choisirFondOutil(hote, stable, 'positron');
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
    // Le fond courant est marqué dans le tiroir, resté ouvert : il vit hors de la carte recréée.
    expect(hote.querySelector('[data-tiroir-outil] [data-fond="magelian"]')!.getAttribute('aria-pressed')).toBe('false');
    expect(hote.querySelector('[data-tiroir-outil] [data-fond="positron"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('re-choisir le fond courant ne recrée rien', async () => {
    const { hote, cartes, stable } = await ouvrir();
    await choisirFondOutil(hote, stable, 'liberty');
    await stable();
    expect(cartes).toHaveLength(1);
  });

  it('une couche active inscrite est RE-POSÉE sur la nouvelle instance après un changement de fond', async () => {
    const { harness, hote, cartes, stable } = await ouvrir();
    const couche = runInInjectionContext(injecteurPage(harness), () => new CoucheFactice());
    cartes[0].emettre('load');
    await stable();
    expect(couche.poses).toEqual([cartes[0]]);

    await choisirFondOutil(hote, stable, 'bright');
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
    await choisirFondOutil(hote, stable, 'positron');
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
    // La pastille « France + DROM » pose le filtre France entière (le bouton « France entière » est retiré, Q-2 du 26/10).
    hote.querySelector<HTMLButtonElement>('mg-panneau-filtre [data-scope="all"]')!.click();
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

  it('les pastilles Métro / +DROM de ① allument la pastille ; la métropole a son segment, « + DROM » sa précision (retours 26/10)', async () => {
    const { harness, hote, stable } = await ouvrir({ url: '/carte?etape=donnees' });
    const etat = injecteurPage(harness).get(EtatCarteService);
    etat.filtre.set({ type: 'france', code: 'metro', label: 'France métropolitaine' });
    etat.perimetreScope.set('metro');
    await stable();
    expect(pastilles(hote)).toEqual(['1 Périmètre (renseignée)']);
    expect(ariane(hote)).toEqual(['France entière', 'France métropolitaine']);
    expect(hote.querySelector('mg-fil-ariane')!.textContent).not.toContain('·');
    // La racine retire le filtre ET la pastille : ils ne se contredisent pas.
    hote.querySelector<HTMLButtonElement>('mg-fil-ariane button')!.click();
    await stable();
    expect(etat.filtre()).toBeNull();
    expect(etat.perimetreScope()).toBeNull();
    etat.filtre.set({ type: 'france', code: 'france', label: 'France entière' });
    etat.perimetreScope.set('all');
    await stable();
    expect(hote.querySelector('mg-fil-ariane')!.textContent).toContain('· métropole + DROM');
  });

  it('un jeu de ② affiché allume sa pastille (POI choisis, carreaux allumés) ; un dégradé d’une AUTRE étape ne l’allume pas (T13, AT-4)', async () => {
    const { harness, hote, stable } = await ouvrir();
    const etat = injecteurPage(harness).get(EtatCarteService);
    etat.poiSelectionnes.set(['lycee']);
    await stable();
    expect(pastilles(hote)).toEqual(['2 Données (renseignée)']);
    etat.poiSelectionnes.set([]);
    injecteurPage(harness).get(CarreauxService).basculer(true);
    await stable();
    expect(pastilles(hote)).toEqual(['2 Données (renseignée)']);
    injecteurPage(harness).get(CarreauxService).basculer(false);
    // Le score composite (④) est un dégradé, pas un jeu de ② : il ne renseigne pas ②.
    etat.basculerDegrade('score', true);
    await stable();
    expect(pastilles(hote)).toEqual([]);
  });

  it('④ s’allume quand le score composite OU les zones à risque sont sur la carte, s’éteint avec eux (T14)', async () => {
    const { harness, hote, stable } = await ouvrir();
    const score = injecteurPage(harness).get(ScoreService);
    const zones = injecteurPage(harness).get(ZonesRisqueService);
    expect(pastilles(hote)).toEqual([]);
    score.afficher({ scores: [{ code: '13001', score: 82.5, n_indicateurs: 1 }], libelle: 'Score test', nIndicateurs: 1 });
    await stable();
    expect(pastilles(hote)).toEqual(['4 Analyse (renseignée)']);
    score.eteindre();
    await stable();
    expect(pastilles(hote)).toEqual([]);
    zones.afficherZonesRisque({ profil: PROFIL_DEFAUT, natures: [] });
    await stable();
    expect(pastilles(hote)).toEqual(['4 Analyse (renseignée)']);
    // Un autre dégradé évince les zones (exclusivité) : la pastille suit la carte, pas le geste.
    injecteurPage(harness).get(CarreauxService).basculer(true);
    await stable();
    expect(pastilles(hote)).toEqual(['2 Données (renseignée)']);
  });

  it('④ s’allume sur une bataille V2 peinte, et sur une analyse publiée au registre de page (④ finitions, T5, A-8)', async () => {
    const { harness, hote, stable } = await ouvrir();
    const bataille = injecteurPage(harness).get(BatailleService);
    expect(pastilles(hote)).toEqual([]);
    bataille.appliquer({
      anneaux: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { id: 'a', nom: 'A', palier: 15 } }],
      pois: [{ id: 'a', nom: 'A', lat: 0.5, lng: 0.5 }], cle: 'battle_full__lycee__driving-car__v2', categorie: 'lycee',
    });
    await stable();
    expect(pastilles(hote)).toEqual(['4 Analyse (renseignée)']);
    bataille.effacer();
    await stable();
    expect(pastilles(hote)).toEqual([]);
    // La couverture par rayon et les typologies sont fournies par le PANNEAU (P-e) : elles publient au registre.
    const peinte = signal(false);
    const retirer = injecteurPage(harness).get(AnalysesPeintesService).inscrire(peinte);
    await stable();
    expect(pastilles(hote)).toEqual([]);
    peinte.set(true);
    await stable();
    expect(pastilles(hote)).toEqual(['4 Analyse (renseignée)']);
    retirer();
    await stable();
    expect(pastilles(hote)).toEqual([]);
  });

  it('⑤ : une zone à convertir dans l’URL (?zoneJeu=) allume sa pastille ; sans elle, rien (lot 5, T10)', async () => {
    const { hote } = await ouvrir({ url: `/carte?zoneJeu=${ID_ZONE_DU_LIEN}` });
    expect(pastilles(hote)).toEqual(['5 Jeu de zones (renseignée)']);
    TestBed.resetTestingModule();
    expect(pastilles((await ouvrir()).hote)).toEqual([]);
  });

  it('revenir à ① garde la pastille « France + DROM » pressée : panneau monté, aucune relecture du référentiel', async () => {
    const geo = vi.fn(() => of({ regions: [] }));
    const { hote, stable } = await ouvrir({ referentiel: geo });
    hote.querySelector<HTMLButtonElement>('mg-panneau-filtre [data-scope="all"]')!.click();
    await stable();
    frapper(hote, altChiffre('2'));
    await stable();
    frapper(hote, altChiffre('1'));
    await stable();
    expect(hote.querySelector('mg-panneau-filtre [data-scope="all"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(geo).toHaveBeenCalledTimes(1);
  });
});

describe('CartePage — panneau Données, carreaux Filosofi, légende (T6)', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.overrideProvider(CouleursService, { useValue: { palette: () => signal({ absente: '#9aa0a6', trait: '#555555' }) } });
  });
  afterEach(() => localStorage.clear());

  it('Données : le vrai panneau ; allumer les carreaux pose la couche, ouvre la légende, survit au changement de fond ; Tout effacer les masque', async () => {
    const { harness, hote, cartes, stable } = await ouvrir();
    cartes[0].emettre('load');
    await stable();
    frapper(hote, altChiffre('2'));
    await stable();
    expect(hote.querySelector('mg-panneau-donnees')).not.toBeNull();
    expect(hote.querySelector('mg-legende-carte [data-legende]')).toBeNull();

    hote.querySelector<HTMLButtonElement>('mg-panneau-donnees [data-jeu="carreaux:filosofi"] button[aria-expanded]:not([data-bouton-fiche])')!.click();
    await stable();
    hote.querySelector<HTMLButtonElement>('mg-section-carreaux button[data-entete-carreaux]')!.click();
    await stable();
    expect(cartes[0].sources.has('carreaux-mvt')).toBe(true);
    expect(injecteurPage(harness).get(EtatCarteService).degradeActif()).toBe('carreaux');
    expect(hote.querySelector('mg-panneau-donnees')!.textContent).toContain('Actifs (1)');
    expect(hote.querySelector('mg-legende-carte [data-bloc="carreaux"]')!.textContent).toContain('Carreaux Filosofi · pers./km²');

    // Changement de fond : la nouvelle instance reçoit la couche, visible.
    await choisirFondOutil(hote, stable, 'bright');
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
    // Tiroirs exclusifs (retours du 26/10, T7) : un référentiel déplié à la fois — carreaux, puis IRIS.
    hote.querySelector<HTMLButtonElement>('mg-panneau-donnees [data-jeu="carreaux:filosofi"] button[aria-expanded]:not([data-bouton-fiche])')!.click();
    await stable();
    hote.querySelector<HTMLButtonElement>('mg-section-carreaux button[data-entete-carreaux]')!.click();
    await stable();
    hote.querySelector<HTMLButtonElement>('mg-panneau-donnees [data-jeu="iris:socio-demo"] button[aria-expanded]:not([data-bouton-fiche])')!.click();
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

  it('module ouvert : Alt+4 ne change ni l’étape ni l’URL, et ne ferme pas le module (Review Focus 2)', async () => {
    const { hote, stable } = await ouvrir({ url: '/carte?etape=donnees' });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/carte/risques?etape=donnees&risque=etape%3Drayon');
    await stable();
    const avant = router.url;
    expect(avant.startsWith('/carte/risques')).toBe(true);
    const e = frapper(hote, altChiffre('4'));
    await stable();
    expect(e.defaultPrevented).toBe(false);
    expect(router.url).toBe(avant);
    expect(panneauCourant(hote)).toBe('donnees');
    expect(hote.querySelector('[data-module-risque] mg-module-factice')).not.toBeNull();
    expect(hote.querySelector('[data-panneau-etape="analyse"]')).toBeNull();
  });

  it('outil Mes zones : la liste des jeux est rendue dans le tiroir', async () => {
    const { hote, stable } = await ouvrir();
    hote.querySelector<HTMLButtonElement>('mg-boite-outils [data-outil="zones"]')!.click();
    await stable();
    // Aucun changement d'étape : l'outil s'ouvre au-dessus de l'étape courante.
    expect(panneauCourant(hote)).toBe('perimetre');
    expect(hote.querySelector('[data-tiroir-outil] mg-outil-mes-zones mg-jeux-de-zones')).not.toBeNull();
    expect(hote.querySelector('mg-jeux-de-zones [data-jeux-vide]')).not.toBeNull();
  });

  it('Zones › Créer une zone (T16) : capture inactive sans couche ; le dessin ouvert, un clic sur la carte laisse l’étape ③', async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, altChiffre('3'));
    await stable();
    expect(hote.querySelector('[data-provisoire]')).toBeNull();
    // Lot 3 (T10) : chaque famille se déplie ; « Autour des POI » l'est d'office.
    const famille = async (f: string) => { hote.querySelector<HTMLElement>(`mg-panneau-zones mg-entete-section[data-famille="${f}"]`)!.click(); await stable(); };
    await famille('capture');
    expect(hote.querySelector<HTMLButtonElement>('[data-capturer]')!.disabled).toBe(true);
    await famille('main');
    const outils = [...hote.querySelectorAll('mg-outil-creation [data-repli]')].map((b) => b.textContent!.trim());
    // Tiroirs exclusifs (T7) : « Autour des POI » est repliée, mais son rayon reste MONTÉ, caché, en pause (relecture T7, I-1).
    expect(outils).toEqual(['Zone par rayon ▼', 'Dessiner une zone ▼', 'Importer une liste de codes postaux ▼']);
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
  const ID = ID_ZONE_DU_LIEN;
  const ENTITE = ZONE_DU_LIEN;

  /** La carte publiée au `load` : c'est là que le lien est lu (`mapReady`). */
  async function carteChargee(options: OptionsOuverture) {
    const o = await ouvrir(options);
    o.cartes[0].emettre('load');
    await o.stable();
    return o;
  }

  it('le panneau Zones monte le vrai panneau : créer à ③ ; jeux de zones et « Mes zones » dans l’outil', async () => {
    const { hote, stable } = await ouvrir();
    frapper(hote, altChiffre('3'));
    await stable();
    const panneau = hote.querySelector('[data-panneau-etape="zones"] mg-panneau-zones')!;
    expect(panneau).not.toBeNull();
    // Lot 3 (T10) : ③ rangée par familles, la capture en dernier.
    expect([...panneau.querySelectorAll('mg-entete-section')].map((h) => h.textContent?.trim())).toEqual(['Autour des POI', 'Par seuil', 'À la main', 'Capture']);
    expect(panneau.querySelector('mg-mes-zones')).toBeNull();
    panneau.querySelector<HTMLButtonElement>('[data-ouvrir-mes-zones]')!.click();
    await stable();
    expect(panneauCourant(hote)).toBe('zones');
    const outil = hote.querySelector('[data-tiroir-outil]:not([inert]) mg-outil-mes-zones')!;
    expect(outil).not.toBeNull();
    expect([...outil.querySelectorAll('h4')].map((h) => h.textContent?.trim())).toEqual(['Jeux de zones', 'Mes zones']);
    expect(outil.querySelector('mg-mes-zones')).not.toBeNull();
  });

  it('le catalogue d’indicateurs est fourni UNE fois, par la page : ③, son pied, « Mes zones » et Analyse partagent la même lecture (X4)', async () => {
    const { harness, hote, stable } = await ouvrir();
    const duPage = injecteurPage(harness).get(CatalogueIndicateursService);
    frapper(hote, altChiffre('3'));
    await stable();
    const zones = harness.fixture.debugElement.query(By.css('mg-panneau-zones'));
    expect(zones.injector.get(CatalogueIndicateursService)).toBe(duPage);
    hote.querySelector<HTMLButtonElement>('[data-ouvrir-mes-zones]')!.click();
    await stable();
    expect(harness.fixture.debugElement.query(By.css('mg-mes-zones')).injector.get(CatalogueIndicateursService)).toBe(duPage);
    frapper(hote, altChiffre('4'));
    await stable();
    expect(harness.fixture.debugElement.query(By.css('mg-panneau-analyse')).injector.get(CatalogueIndicateursService)).toBe(duPage);
  });

  it('sans lien : aucune géométrie demandée, aucun bouton DV360', async () => {
    const geometrie = vi.fn(() => of(ENTITE));
    const { hote } = await carteChargee({ zones: { geometrie } });
    expect(geometrie).not.toHaveBeenCalled();
    expect(hote.querySelector('button[data-script-dv360]')).toBeNull();
  });

  it('?customZone=<id> : ③ courante ; géométrie lue UNE fois carte prête, recadrage sur son emprise (60 px, 1 s), bouton DV360 nommé ; une autre navigation de requête ne relit rien', async () => {
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
    // `customZone` parti, l'étape ③ qu'il avait ouverte reste (elle est dans l'URL depuis l'ouverture).
    expect(TestBed.inject(Router).url).toBe('/carte?etape=zones');
  });

  it('changement d’organisation (badge de la barre) : la page émet `espaceChange` UNE fois et ne nettoie plus rien à la main — l’hôte la recrée (droits sur la carte, T3)', async () => {
    const { harness, hote, stable } = await carteChargee({ url: `/carte?customZone=${ID}`, zones: { geometrie: () => of(ENTITE) } });
    const page = harness.fixture.debugElement.query(By.directive(CartePage)).componentInstance as CartePage;
    const emis = vi.fn();
    page.espaceChange.subscribe(emis);
    // Preuve T7 (D-6) : la carte est retirée du registre AVANT que l'hôte détruise la page — aucun service de couche
    // ne relit une instance morte en se détruisant (`getLayer` de `retirerCoucheCouverture` levait).
    const couches = injecteurPage(harness).get(CouchesCarteService);
    const carteAuSignal: unknown[] = [];
    page.espaceChange.subscribe(() => carteAuSignal.push(couches.carteCourante()));
    const etat = injecteurPage(harness).get(EtatCarteService);
    const barre = harness.fixture.debugElement.query(By.css('mg-barre-parcours')).componentInstance as { orgChangee: { emit(v: string | null): void } };

    etat.filtre.set({ type: 'zone', code: ID, label: 'CIRFA BRETAGNE', bbox: [5, 43, 6, 44.5] });
    barre.orgChangee.emit('org-2');
    await stable();
    expect(emis).toHaveBeenCalledTimes(1);
    expect(carteAuSignal).toEqual([null]);
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
describe('CartePage — ⑤ suit un recalcul de sa zone (revue finale du lot 5, point 2)', () => {
  const Z = '0f8fad5b-d9cb-469f-a165-70867728950e';
  it('⑤ → ③ « Mes zones » → Recalculer → ⑤ : la date relue vide l’ancienne conversion, la nouvelle forme est relue et affichée', async () => {
    let maj = '2026-10-24T08:00:00Z';
    let population = 1000;
    const ligne = (): ZoneCustomResume => ({
      id: Z, name: 'Lyon 5 km', description: null, source_type: 'recette_rayon_point', source_metadata: {}, feature_count_iris: 3,
      feature_count_cp: 2, bbox: [4, 45, 5, 46], created_at: '2026-10-24T08:00:00Z', created_by: null, dept_codes: ['69'], region_codes: ['84'],
      updated_at: maj, recette: { v: 1, type: 'rayon_point', lon: 4.8357, lat: 45.764, rayon_m: 5000, part_retenue: 1 },
    });
    const couverture = vi.fn((zone: unknown, cible: unknown, decoupage: unknown) => of({
      zone_id: zone, cible, decoupage, population, surface_km2: 78, n_carreaux: 40, zone_maj: maj,
      lignes: [{ code: '69005', nom: null, commune: null, n_carreaux: 40, pop_en_zone: population, pop_totale: population, part: 100, part_brute: 100 }],
    }));
    const recalculer = vi.fn(() => {
      maj = '2026-10-24T09:00:00Z';
      population = 2500;
      return of(new HttpResponse({ status: 200, body: { zone_id: Z } }));
    });
    const plateformes = () => of({ plateformes: [{
      plateforme: 'dv360', maille: 'cp', libelle: 'Code postal', natif: true, disponible: true, limites: {}, doc_url: null,
      releve_le: '2026-10-14', a_verifier: false, note: null, ordre: 0,
    }] });
    const { hote, stable } = await ouvrir({
      url: `/carte?etape=jeu&zoneJeu=${Z}`, organisation: 'org-1', zones: { lister: () => of({ zones: [ligne()] }) },
      plateformes, couverture, recalculer,
    });
    const forme = () => hote.querySelector('mg-panneau-jeu [data-forme]')?.textContent?.replace(/\s/g, '') ?? '';
    expect(couverture).toHaveBeenCalledTimes(1);
    expect(couverture).toHaveBeenLastCalledWith(Z, 'ind', 'cp');
    expect(forme()).toContain('1000habitantscarroyés');

    // ③ : « Mes zones », puis « Recalculer » sur la zone convertie par ⑤.
    frapper(hote, altChiffre('3'));
    await stable();
    hote.querySelector<HTMLButtonElement>('[data-panneau-etape="zones"] [data-ouvrir-mes-zones]')!.click();
    await stable();
    hote.querySelector<HTMLButtonElement>('mg-mes-zones [data-recalculer]')!.click();
    await stable();
    expect(recalculer).toHaveBeenCalledWith(Z);

    // Retour en ⑤ : la nouvelle forme est relue (une seconde couverture), et c'est elle que l'écran montre.
    frapper(hote, altChiffre('5'));
    await stable();
    expect(couverture).toHaveBeenCalledTimes(2);
    expect(forme()).toContain('2500habitantscarroyés');
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

describe('CartePage — le bouton « Autres », hors du fil (T11b, Vincent 14/10)', () => {
  const autres = (hote: HTMLElement) => hote.querySelector<HTMLButtonElement>('mg-barre-parcours [data-autres]')!;
  const panneauAutres = (hote: HTMLElement) => hote.querySelector<HTMLElement>('[data-panneau-autres]');

  it('ouvre « Autres » dans le cadre du panneau d’étape : ?etape=autres, aucune étape courante ; une étape le referme', async () => {
    const { hote, stable } = await ouvrir({ url: '/carte?etape=zones' });
    expect(panneauAutres(hote)).toBeNull();
    autres(hote).click();
    await stable();
    expect(routeur().url).toBe('/carte?etape=autres');
    const cadre = hote.querySelector('mg-panneau-etape aside')!;
    expect(panneauAutres(hote)!.closest('mg-panneau-etape aside')).toBe(cadre);
    expect(panneauAutres(hote)!.hasAttribute('inert')).toBe(false);
    expect(panneauAutres(hote)!.querySelector('mg-panneau-autres')).not.toBeNull();
    expect(cadre.getAttribute('aria-label')).toBe('Autres, hors parcours');
    expect(panneauCourant(hote)).toBeNull();
    expect(etapeDuFil(hote)).toBeNull();
    expect(autres(hote).getAttribute('aria-current')).toBe('true');
    // L'Aide de la boîte à outils dit « Autres », pas l'étape d'en dessous (round 1, mineur 3).
    hote.querySelector<HTMLButtonElement>('mg-boite-outils [data-outil="aide"]')!.click();
    await stable();
    expect(hote.querySelector('[data-tiroir-outil] [data-aide-etape] h4')!.textContent!.trim()).toBe('Autres, hors parcours');
    hote.querySelector<HTMLButtonElement>('mg-boite-outils [data-outil="aide"]')!.click();
    await stable();
    // L'étape quittée est montée, inerte (A1) ; « Autres » aussi une fois quitté.
    expect(hote.querySelector('[data-panneau-etape="zones"]')!.hasAttribute('inert')).toBe(true);
    hote.querySelectorAll<HTMLButtonElement>('mg-fil-etapes nav button')[1].click();
    await stable();
    expect(routeur().url).toBe('/carte?etape=donnees');
    expect(panneauCourant(hote)).toBe('donnees');
    expect(panneauAutres(hote)!.hasAttribute('inert')).toBe(true);
    expect(panneauAutres(hote)!.classList).toContain('invisible');
    expect(autres(hote).getAttribute('aria-current')).toBeNull();
    // Alt+N referme « Autres » comme un clic sur l'étape.
    autres(hote).click();
    await stable();
    frapper(hote, altChiffre('4'));
    await stable();
    expect(routeur().url).toBe('/carte?etape=analyse');
    expect(panneauAutres(hote)!.hasAttribute('inert')).toBe(true);
  });

  it('/carte?etape=autres s’ouvre sur « Autres » ; les états OOH et radio survivent à la fermeture et à la réouverture', async () => {
    // Pré-vol P11 : une VRAIE campagne choisie avant la fermeture, pour que « l'état OOH survit » affirme quelque chose.
    const liste = { campagnes: [{ ...DETAIL_ESSAI.campagne, lignes: [] }], tronque: false };
    const campagneOoh = vi.fn(() => of(DETAIL_ESSAI));
    const { hote, stable } = await ouvrir({ url: '/carte?etape=autres', campagnesOoh: () => of(liste), campagneOoh });
    expect(panneauAutres(hote)!.hasAttribute('inert')).toBe(false);
    expect(hote.querySelectorAll('[data-panneau-etape]')).toHaveLength(0);
    (hote.querySelector('mg-section-ooh mg-entete-filtre') as HTMLElement).click();
    await stable();
    hote.querySelector<HTMLButtonElement>('mg-section-ooh [data-choisir-campagne="c1"]')!.click();
    (hote.querySelector('mg-section-radio mg-entete-filtre') as HTMLElement).click();
    await stable();
    hote.querySelector<HTMLButtonElement>('[data-basculer-radio]')!.click();
    await stable();
    expect(hote.querySelector('mg-section-ooh [data-campagne]')!.textContent).toContain('Campagne essai');
    expect(hote.querySelector('[data-basculer-radio]')!.getAttribute('aria-pressed')).toBe('true');
    const section = hote.querySelector('mg-section-ooh');
    frapper(hote, altChiffre('2'));
    await stable();
    // ② ne porte plus ni OOH ni radio, et la radio allumée n'y est pas un calque actif.
    const donnees = hote.querySelector('[data-panneau-etape="donnees"]')!;
    expect(donnees.querySelector('mg-section-ooh, mg-section-radio')).toBeNull();
    expect(donnees.textContent).not.toContain('Médias offline');
    expect(donnees.querySelector('[data-actif="radio"]')).toBeNull();
    autres(hote).click();
    await stable();
    expect(hote.querySelector('mg-section-ooh')).toBe(section);
    expect(hote.querySelector('mg-section-ooh [data-campagne]')!.textContent).toContain('Campagne essai');
    expect(hote.querySelector('mg-section-ooh [data-ligne="l1"]')).not.toBeNull();
    // Rien n'a été relu : l'état vit dans `CampagneOohService`, fourni par la page.
    expect(campagneOoh).toHaveBeenCalledTimes(1);
    expect(hote.querySelector('[data-basculer-radio]')!.getAttribute('aria-pressed')).toBe('true');
    expect(routeur().url).toBe('/carte?etape=autres');
  });
});

/** Les familles de ③ (lot 3) et ce que chacune doit montrer une fois dépliée (« Autour des POI » l'est d'emblée). */
const FAMILLES_RECETTES: readonly { famille: string; fonction: string; preuves: readonly string[] }[] = [
  { famille: 'poi', fonction: 'Autour des POI (rayon d’un point, rayon des POI, renvoi vers ④)', preuves: ['mg-creer-rayon', 'mg-recette-rayon-poi', '[data-aller-analyse]'] },
  { famille: 'seuil', fonction: 'Par seuil (carreaux, IRIS ou CP)', preuves: ['mg-recette-seuil-carreaux', 'mg-recette-seuil-territoire'] },
  { famille: 'main', fonction: 'À la main (dessin, import, codes postaux)', preuves: ['mg-creer-dessin', 'mg-recette-import', 'mg-creer-codes-postaux'] },
  { famille: 'capture', fonction: 'Capture', preuves: ['[data-capturer]'] },
  { famille: 'pied', fonction: 'Aperçu et enregistrement', preuves: ['mg-pied-recette'] },
];

type Lieu = { autres?: true; etape?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; outil?: 'analyses' | 'zones' | 'fond' | 'legende' | 'aide' | 'reglages' };
interface LigneInventaire {
  n: number;
  fonction: string;
  lieu: Lieu;
  /** Chaque sélecteur doit trouver au moins un élément ; `nombre` exige le compte exact du PREMIER. */
  preuves: readonly string[];
  nombre?: number;
  url?: string;
  /** Ce qu'il faut faire avant de chercher la preuve (B4) : publier la carte, cliquer un bouton. */
  avant?: (o: { hote: HTMLElement; cartes: CarteFactice[]; stable: () => Promise<void> }) => Promise<void>;
  /** Ce qu'il faut faire une fois RENDU au lieu (étape, « Autres », outil) : déplier une ligne de ②. */
  apres?: (o: { hote: HTMLElement; stable: () => Promise<void> }) => Promise<void>;
}

/**
 * Spec § 12 : « sans aucune perte ». Une ligne par fonction de l'ancienne carte (rail, barre du haut, boutons
 * flottants), avec sa nouvelle place dans le parcours (l'ordre en 8 étapes du 13/10 : ③ Zones, ④ Analyse, ⑥ Plan).
 * Ce que ce tableau ne prouve PAS lui-même, et où la preuve vit vraiment :
 * - 2. Pastille « filtre posé » → ce fichier, describe « filtre unique : panneau ①, pastille, fil d’Ariane (T5) » (`(renseignée)`) ;
 * - 5. Zones à risque industriel → ici, le point d'entrée dans ② (`mg-section-risque`, sous la ligne « Sites industriels
 *   (ICPE) et périmètres PPRT » dépliée ; croix et pastille : `panneaux/donnees/panneau-donnees.component.spec.ts`) ; le module lui-même, ouvert par
 *   `navigateByUrl` (`[data-module-risque]`, carte inerte, retour à l'étape quittée) : ce fichier, describe « le module
 *   risque, route ENFANT (T13, B2/B3) » ;
 * - 13. Back office → ici seulement « Accès » (`admin/acces`) ; « Health check » : `panneaux/reglages.component.spec.ts`
 *   (« « Health check » est ACTIF ») ;
 * - 19. Plan média (n) → ce fichier, describe « plan média des zones affichées (T15) » (`[data-rouvrir-plan]`, zone
 *   affichée, panneau fermé) ;
 * - 22. Badge de zoom → ici seulement `[data-badge-zoom]` ; détail IRIS, zone active et tiroir Street View : ce fichier,
 *   test « la barre porte logo, fil d’Ariane… » ; la météo : describe « météo (T11) ».
 * - 23-24. Panneaux OOH et Radio (anciennement Calques › Médias offline) : dans le panneau « Autres » de la barre, hors du
 *   fil (T11b, Vincent 14/10) — ces lignes échouent si l'une des deux sections quitte ce panneau.
 * - 25-32. Les 8 référentiels de ② (T13) : une ligne chacun dans le panneau Données, qu'une sélection recommandée range
 *   mais ne cache jamais (« Plus de données communes ») ; leur section dépliée : `panneau-donnees.component.spec.ts`.
 * - 33-37. Les familles de ③ (lot 3) ; 38. « Mes zones » : la ligne de recette et « Recalculer » sont prouvés par
 *   `panneaux/zones/mes-zones.component.spec.ts` et `carte-zone.component.spec.ts` (la liste est lue du serveur).
 * - 39. ④ Couverture d'une zone (lot 4, T8) : le chiffrage, le tableau et la couche sont prouvés par
 *   `panneaux/analyse/outil-couverture.component.spec.ts` et `couches/couverture.service.spec.ts`.
 * - 40. ④ Couverture par rayon (lot 4b, T12) : `outil-rayon.component.spec.ts`, `etat/couverture-rayon.service.spec.ts`.
 * - 41. (retirée) ④ Radio et trafic de la zone analysée (lot 4b, T13) : fonction RETIRÉE sur décision de Vincent
 *   (retours du 26/10, T5), pas perdue ; son absence est prouvée par `outil-couverture.component.spec.ts`.
 * - 42. ⑤ Jeu de zones (lot 5, T10) : colonnes, seuil et perte prouvés par `panneaux/jeu/panneau-jeu.component.spec.ts`
 *   et `colonne-plateforme.component.spec.ts`.
 * Une ligne qui échoue veut dire qu'une fonction a été PERDUE : la rétablir, jamais retirer la ligne.
 */
const INVENTAIRE: readonly LigneInventaire[] = [
  { n: 1, fonction: 'Filtre', lieu: { etape: 1 }, preuves: ['[data-panneau-etape="perimetre"] mg-panneau-filtre'] },
  { n: 3, fonction: 'Puce du filtre', lieu: {}, preuves: ['mg-barre-parcours mg-fil-ariane'] },
  { n: 4, fonction: 'Calques → Données', lieu: { etape: 2 }, preuves: ['[data-panneau-etape="donnees"] mg-panneau-donnees'] },
  {
    n: 5, fonction: 'Zones à risque industriel (entrée dans ②)', lieu: { etape: 2 },
    preuves: ['[data-panneau-etape="donnees"] [data-jeu="risques:icpe-pprt"] mg-section-risque'],
    apres: async ({ hote, stable }) => {
      hote.querySelector<HTMLButtonElement>('[data-panneau-etape="donnees"] [data-jeu="risques:icpe-pprt"] button[aria-expanded]:not([data-bouton-fiche])')!.click();
      await stable();
    },
  },
  { n: 6, fonction: 'Analyse', lieu: { etape: 4 }, preuves: ['[data-panneau-etape="analyse"] mg-panneau-analyse'] },
  { n: 7, fonction: 'Créer une zone', lieu: { etape: 3 }, preuves: ['[data-panneau-etape="zones"] mg-entete-section[data-famille="poi"]'] },
  { n: 8, fonction: 'Jeux de zones', lieu: { outil: 'zones' }, preuves: ['[data-tiroir-outil] mg-jeux-de-zones'] },
  { n: 9, fonction: 'Mes zones', lieu: { outil: 'zones' }, preuves: ['[data-tiroir-outil] mg-mes-zones'] },
  { n: 10, fonction: 'Mes analyses', lieu: { outil: 'analyses' }, preuves: ['[data-tiroir-outil] mg-mes-analyses'] },
  { n: 11, fonction: 'Fond de carte', lieu: { outil: 'fond' }, preuves: ['[data-tiroir-outil] mg-choix-fond'] },
  { n: 12, fonction: 'Apparence', lieu: { outil: 'reglages' }, preuves: ['mg-reglages [data-section="apparence"]', 'mg-barre-parcours mg-bascule-theme'] },
  { n: 13, fonction: 'Back office', lieu: { outil: 'reglages' }, preuves: ['mg-reglages a[href*="admin/acces"]'] },
  { n: 14, fonction: 'Raccourcis', lieu: { outil: 'aide' }, preuves: ['[data-tiroir-outil] mg-aide [data-raccourci]', '[data-aide-etape]'], nombre: 9 },
  { n: 15, fonction: 'Légende', lieu: {}, preuves: ['mg-legende-carte', 'mg-boite-outils [data-outil="legende"]'] },
  { n: 16, fonction: 'Tout effacer', lieu: {}, preuves: ['mg-barre-parcours [data-tout-effacer]'] },
  {
    n: 17, fonction: 'Mode immersif', lieu: {}, preuves: ['mg-boite-outils [data-quitter-immersif]'],
    avant: async ({ hote, stable }) => { hote.querySelector<HTMLButtonElement>('mg-barre-parcours [data-immersif]')!.click(); await stable(); },
  },
  {
    n: 18, fonction: 'Script bidding DV360', lieu: {}, preuves: ['mg-barre-parcours [data-script-dv360]'], url: `/carte?customZone=${ID_ZONE_DU_LIEN}`,
    // Le lien n'est lu qu'une fois la carte prête (`mapReady`) : publier la carte d'abord (B4).
    avant: async ({ cartes, stable }) => { cartes[0].emettre('load'); await stable(); },
  },
  { n: 20, fonction: 'Session', lieu: {}, preuves: ['mg-barre-parcours mg-badge-session'] },
  { n: 21, fonction: 'Campagne', lieu: { etape: 6 }, preuves: ['[data-panneau-etape="plan"] mg-panneau-plan mg-hall-campagnes', 'mg-barre-parcours mg-choix-campagne'] },
  { n: 22, fonction: 'Badge de zoom', lieu: {}, preuves: ['[data-badge-zoom]'] },
  { n: 23, fonction: 'Panneaux OOH (bouton « Autres »)', lieu: { autres: true }, preuves: ['[data-panneau-autres]:not([inert]) mg-panneau-autres mg-section-ooh'] },
  { n: 24, fonction: 'Radio FM/DAB+ (bouton « Autres »)', lieu: { autres: true }, preuves: ['[data-panneau-autres]:not([inert]) mg-panneau-autres mg-section-radio'] },
  ...JEUX_REFERENTIELS.map((j, i): LigneInventaire => ({
    n: 25 + i, fonction: `② › ${j.nom}`, lieu: { etape: 2 }, preuves: [`[data-panneau-etape="donnees"] [data-jeu="${j.cle}"]`],
  })),
  // Lot 3 (zones à recette) : ③ par familles. Les créateurs d'avant (rayon, dessin, CP) y restent ; isochrones et
  // bataille restent en ④ (C3, rien n'en est retiré) et ③ y renvoie.
  ...FAMILLES_RECETTES.map((f, i): LigneInventaire => ({
    n: 33 + i, fonction: `③ › ${f.fonction}`, lieu: { etape: 3 }, preuves: f.preuves.map((p) => `[data-panneau-etape="zones"] ${p}`),
    apres: f.famille === 'poi' || f.famille === 'pied' ? undefined : async ({ hote, stable }) => {
      hote.querySelector<HTMLElement>(`[data-panneau-etape="zones"] mg-entete-section[data-famille="${f.famille}"]`)!.click();
      await stable();
    },
  })),
  {
    n: 38, fonction: '« Mes zones » › recette et « Recalculer »', lieu: { outil: 'zones' },
    preuves: ['[data-tiroir-outil] mg-mes-zones'],
  },
  // Lot 4, T8 : la couverture d'une zone, en tête de ④ et ouverte (choix de zone, cible, découpage, « Chiffrer »).
  {
    n: 39, fonction: '④ › Couverture d’une zone', lieu: { etape: 4 },
    preuves: ['[data-panneau-etape="analyse"] mg-outil-couverture [data-outil-couverture] mg-choix-zone-analysee', '[data-panneau-etape="analyse"] [data-chiffrer]'],
  },
  { n: 40, fonction: '④ › Couverture par rayon', lieu: { etape: 4 }, preuves: ['[data-panneau-etape="analyse"] mg-outil-rayon mg-entete-outil'] },
  { n: 42, fonction: '⑤ › Jeu de zones', lieu: { etape: 5 }, preuves: ['[data-panneau-etape="jeu"] mg-panneau-jeu mg-choix-zone-analysee', '[data-panneau-etape="jeu"] [data-jeu-vide]'] },
];

describe('CartePage — aucune fonction perdue (spec § 12, lot 1)', () => {
  it.each(INVENTAIRE)('ligne $n : $fonction', async (l) => {
    const { hote, cartes, stable } = await ouvrir({ url: l.url, zones: l.url ? { geometrie: () => of(ZONE_DU_LIEN) } : undefined });
    if (l.avant) await l.avant({ hote, cartes, stable });
    if (l.lieu.etape) { frapper(hote, altChiffre(String(l.lieu.etape))); await stable(); }
    if (l.lieu.autres) { hote.querySelector<HTMLButtonElement>('mg-barre-parcours [data-autres]')!.click(); await stable(); }
    if (l.lieu.outil) { hote.querySelector<HTMLButtonElement>(`mg-boite-outils [data-outil="${l.lieu.outil}"]`)!.click(); await stable(); }
    if (l.apres) await l.apres({ hote, stable });
    for (const preuve of l.preuves) expect(hote.querySelector(preuve), `${l.n}. ${l.fonction} → ${preuve}`).not.toBeNull();
    if (l.nombre !== undefined) expect(hote.querySelectorAll(l.preuves[0]).length, `${l.n}. ${l.fonction}`).toBe(l.nombre);
  });
});
