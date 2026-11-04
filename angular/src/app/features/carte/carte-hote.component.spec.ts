import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NEVER, of } from 'rxjs';
import { FABRIQUE_CARTE } from '../../carte/fabrique-carte';
import { CarteFactice } from '../../carte/testing/carte-factice';
import { AuthService } from '../../core/auth/auth.service';
import { ConfigService } from '../../core/config/config.service';
import { CouleursService } from '../../core/theme/couleurs.service';
import { OrganisationsApi } from '../session/data/organisations.api';
import { ReferentielApi } from '../risques/data/referentiel.api';
import { SitesRisqueApi } from '../risques/data/sites-risque.api';
import { JeuxZonesApi } from '../risques/data/jeux-zones.api';
import { ZonesRisqueApi } from '../risques/data/zones-risque.api';
import { CarreauxApi } from './data/carreaux.api';
import { ProfilRisqueApi } from '../risques/data/profil-risque.api';
import { CouvertureApi } from './data/couverture.api';
import { JeuxApi } from './data/jeux.api';
import { PlanApi } from './data/plan.api';
import { ActivationApi } from './data/activation.api';
import { IrisApi } from './data/iris.api';
import { CarteApi } from './data/carte.api';
import { RadioApi } from './data/radio.api';
import { CiviqueApi } from './data/civique.api';
import { MeteoApi } from './data/meteo.api';
import { IsochronesApi } from './data/isochrones.api';
import { AnalysesApi } from './data/analyses.api';
import { ClusteringApi } from './data/clustering.api';
import { ZonesCustomApi } from './data/zones-custom.api';
import { ZonesApi } from './data/zones.api';
import { CarteHoteComponent } from './carte-hote.component';
import { CartePage } from './carte.page';
import { CataloguePoiService } from './etat/catalogue-poi.service';
import { CampagneOohService } from './couches/campagne-ooh.service';
import { SOURCE_CAMPAGNE_OOH } from './couches/couche-campagne-ooh';
import { EtatCarteService } from './etat/etat-carte.service';
import { LienZoneService } from './etat/lien-zone.service';
import { DETAIL_ESSAI } from './testing/campagnes-ooh.fixture';

@Component({ selector: 'mg-vide', template: '' })
class Vide {}

@Component({ selector: 'mg-module-factice', template: '' })
class ModuleFactice {}

class ObservateurFactice {
  observe = vi.fn();
  disconnect = vi.fn();
}

const attendre = () => new Promise((r) => setTimeout(r, 0));

/** Chaque méthode d'un faux service d'API devient un espion : on compte TOUT ce que la page demande. */
function espionner<T extends Record<string, unknown>>(faux: T): T {
  for (const cle of Object.keys(faux)) {
    const f = faux[cle];
    if (typeof f === 'function') (faux as Record<string, unknown>)[cle] = vi.fn(f as (...a: unknown[]) => unknown);
  }
  return faux;
}

const ID = '11111111-2222-3333-4444-555555555555';

/**
 * La route `carte` charge l'HÔTE, comme `app.routes.ts`. `CarteApi` est le VRAI service, sur `HttpTestingController` :
 * c'est lui qui lit `/api/map/categories`. Les autres API sont des faux espionnés.
 */
async function ouvrir(url = '/carte', avant?: () => void) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ObservateurFactice;
  const cartes: CarteFactice[] = [];
  const faux = {
    organisations: espionner({ lister: () => of({ organizations: [], active_org_id: null, is_super_admin: true }), changer: () => of({}) }),
    referentiel: espionner({ geo: () => of({ regions: [] }) }),
    zones: espionner({
      lister: () => of({ zones: [] }), stats: () => of({}), geometrie: () => of(), exporter: () => of(),
      totauxNationaux: () => of({ totals: {} }), audienceItems: () => of({ items: null }), zone: () => of({}), campagnesPlan: () => of({ campaigns: [] }),
    }),
    zonesRisque: espionner({ urlTuilesZones: () => '/api/tiles/zones-risque/{z}/{x}/{y}?profil=x', preparer: () => of({ classes: 1 }) }),
    jeux: espionner({ lister: () => of({ jeux: [] }) }),
    carreaux: espionner({ urlTuiles: () => '/api/tiles/{z}/{x}/{y}?v=19' }),
    iris: espionner({ urlTuiles: () => '/api/tiles/iris/{z}/{x}/{y}?v=2', bornes: () => of({}), detail: () => of() }),
    radio: espionner({ optionsFiltre: () => of({}), emetteurs: () => of({ type: 'FeatureCollection', features: [] }), stations: () => of({}) }),
    meteo: espionner({ donnees: () => of() }),
    sites: espionner({ carte: () => of(), exposition: () => of() }),
    civique: espionner({ geojsonVariable: () => of(), detailCp: () => of(), zones: () => of(), santeDepartement: () => of(), santeCp: () => of(), santeCommune: () => of() }),
  };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([
        { path: 'carte', component: CarteHoteComponent, children: [{ path: 'risques', component: ModuleFactice }] },
        { path: '', component: Vide },
      ]),
      { provide: FABRIQUE_CARTE, useValue: (o: never) => { const c = new CarteFactice(o); cartes.push(c); return c; } },
      {
        provide: AuthService,
        useValue: {
          session: signal({ access_token: 'j', user: { email: 'a@exemple.test', user_metadata: {} } }),
          connecte: computed(() => true), email: computed(() => 'a@exemple.test'),
          lireRole: async () => null, deconnecter: async () => undefined,
          lireProfil: async () => ({ role: null, nom: null, organisation: null }),
          oublierProfil: () => undefined,
        },
      },
      CarteApi,
      { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
      { provide: OrganisationsApi, useValue: faux.organisations },
      { provide: ReferentielApi, useValue: faux.referentiel },
      { provide: ZonesCustomApi, useValue: faux.zones },
      { provide: ZonesApi, useValue: {} },
      { provide: ZonesRisqueApi, useValue: faux.zonesRisque },
      { provide: JeuxZonesApi, useValue: faux.jeux },
      { provide: CarreauxApi, useValue: faux.carreaux },
      { provide: IrisApi, useValue: faux.iris },
      // ④ Couverture d'une zone (lot 4, T8) : jamais appelée sans « Chiffrer ».
      { provide: CouvertureApi, useValue: { couverture: () => NEVER } },
      // ⑤ (lot 5) : la page injecte l'état du jeu (pastille) ; rien n'est lu sans zone.
      { provide: JeuxApi, useValue: {} },
      // ⑥ Plan (lot 6) : `PlanCampagneService` naît avec la page (pastille de ⑥) ; sans `?campagne=`, rien n'est lu.
      { provide: PlanApi, useValue: {} },
      // ⑦ (lot 7) : sans `?campagne=` validée, `ActivationCampagneService` ne lit rien.
      { provide: ActivationApi, useValue: {} },
      { provide: ProfilRisqueApi, useValue: { cibles: () => NEVER } },
      { provide: RadioApi, useValue: faux.radio },
      { provide: MeteoApi, useValue: faux.meteo },
      { provide: IsochronesApi, useValue: {} },
      { provide: AnalysesApi, useValue: {} },
      { provide: ClusteringApi, useValue: {} },
      { provide: SitesRisqueApi, useValue: faux.sites },
      { provide: CiviqueApi, useValue: faux.civique },
    ],
  });
  avant?.();
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  const stable = async () => {
    for (let i = 0; i < 3; i++) { await attendre(); await harness.fixture.whenStable(); }
  };
  await stable();
  /** Tous les appels reçus par les faux, méthode par méthode. */
  const appels = (): Record<string, number> => {
    const r: Record<string, number> = {};
    for (const [nom, obj] of Object.entries(faux)) {
      for (const [m, f] of Object.entries(obj)) {
        const n = (f as { mock?: { calls: unknown[] } }).mock?.calls.length ?? 0;
        if (n) r[`${nom}.${m}`] = n;
      }
    }
    return r;
  };
  const page = () => harness.fixture.debugElement.query(By.directive(CartePage));
  /** Le changement d'espace tel que la page le reçoit : le badge de SA barre du parcours. */
  const changerEspace = (org: string | null) =>
    (page().query(By.css('mg-barre-parcours')).componentInstance as { orgChangee: { emit(v: string | null): void } }).orgChangee.emit(org);
  return { harness, cartes, stable, appels, page, changerEspace, http: TestBed.inject(HttpTestingController) };
}

describe('CarteHoteComponent — changer d’espace recrée la page carte', () => {
  it('(a) la page carte est rendue par l’hôte ; un changement d’espace la RECRÉE avec ses services (CataloguePoiService compris)', async () => {
    const { harness, stable, page, changerEspace, cartes } = await ouvrir();
    expect(harness.fixture.nativeElement.querySelectorAll('mg-carte-hote mg-carte-principale').length).toBe(1);
    const avant = page().componentInstance as CartePage;
    const catalogueAvant = page().injector.get(CataloguePoiService);
    const etatAvant = page().injector.get(EtatCarteService);
    etatAvant.poiSelectionnes.set(['bmw']);

    changerEspace('org-2');
    await stable();

    expect(harness.fixture.nativeElement.querySelectorAll('mg-carte-principale').length).toBe(1);
    expect(page().componentInstance).not.toBe(avant);
    expect(page().injector.get(CataloguePoiService)).not.toBe(catalogueAvant);
    // Les sélections de l'espace précédent ne survivent pas : l'état de la nouvelle page part de zéro.
    expect(page().injector.get(EtatCarteService).poiSelectionnes()).toEqual([]);
    // La carte MapLibre est recréée (équivalent du `reload` React), l'ancienne détruite.
    expect(cartes.length).toBe(2);
    expect(cartes[0].retiree).toBe(true);
  });

  it('(b) une lecture du catalogue EN COURS au changement est annulée ; la nouvelle page ne reçoit rien de l’ancien espace (Review Focus 5)', async () => {
    const { stable, page, changerEspace, http } = await ouvrir();
    page().injector.get(CataloguePoiService).chargerUneFois();
    const req = http.expectOne((r) => r.url.endsWith('/map/categories'));

    changerEspace('org-2');
    await stable();

    expect(req.cancelled).toBe(true);
    const nouveau = page().injector.get(CataloguePoiService);
    expect(nouveau.types()).toEqual([]);
    expect(nouveau.chargement()).toBe(false);
    http.expectNone((r) => r.url.endsWith('/map/categories'));
    http.verify();
  });

  it('(c) la recréation n’émet AUCUN appel de plus qu’une ouverture de carte (et aucun appel HTTP direct)', async () => {
    const { stable, appels, changerEspace, http } = await ouvrir();
    const ouverture = appels();

    changerEspace('org-2');
    await stable();

    const apres = appels();
    const recreation = Object.fromEntries(Object.entries(apres).map(([k, n]) => [k, n - (ouverture[k] ?? 0)]).filter(([, n]) => (n as number) > 0));
    expect(recreation).toEqual(ouverture);
    http.verify();
  });

  it('(d) ?customZone= appartient à l’ancien espace : retiré de l’URL AVANT la recréation, la nouvelle page ne relit pas la zone', async () => {
    const { stable, page, changerEspace, cartes } = await ouvrir(`/carte?customZone=${ID}&risque=abc`);
    const zones = TestBed.inject(ZonesCustomApi) as unknown as { geometrie: ReturnType<typeof vi.fn> };
    cartes[0].emettre('load');
    await stable();
    expect(zones.geometrie).toHaveBeenCalledTimes(1);
    const avant = page().componentInstance;

    changerEspace('org-2');
    await stable();
    expect(page().componentInstance).not.toBe(avant);
    expect(TestBed.inject(Router).url).toBe('/carte?risque=abc');
    cartes[cartes.length - 1].emettre('load');
    await stable();
    expect(zones.geometrie).toHaveBeenCalledTimes(1);
    // La zone du lien n'est pas re-peinte dans la page recréée (le bouton DV360 qui la montrait est retiré, O-3).
    expect(page().injector.get(LienZoneService).zoneDuLien()).toBeNull();
  });

  it('(e) le module risque (route enfant) reste rendu par l’outlet de la page recréée', async () => {
    const { harness, stable, page, changerEspace } = await ouvrir('/carte/risques');
    expect(harness.fixture.nativeElement.querySelector('mg-carte-principale mg-module-factice')).not.toBeNull();
    const avant = page().componentInstance;
    changerEspace('org-2');
    await stable();
    expect(page().componentInstance).not.toBe(avant);
    expect(harness.fixture.nativeElement.querySelectorAll('mg-module-factice').length).toBe(1);
    expect(harness.fixture.nativeElement.querySelector('mg-carte-principale mg-module-factice')).not.toBeNull();
  });

  it('(f) le focus, perdu avec le badge détruit, est rendu au badge d’espace de la NOUVELLE page — jamais à <body>', async () => {
    const { harness, stable, changerEspace } = await ouvrir();
    const el = harness.fixture.nativeElement as HTMLElement;
    const ancien = el.querySelector<HTMLButtonElement>('mg-carte-principale [data-declencheur="org"]')!;
    ancien.focus();
    expect(document.activeElement).toBe(ancien);

    changerEspace('org-2');
    await stable();

    const nouveau = el.querySelector<HTMLButtonElement>('mg-carte-principale [data-declencheur="org"]')!;
    expect(nouveau).not.toBe(ancien);
    expect(document.activeElement).toBe(nouveau);
  });

  it('(f bis) focus DÉJÀ perdu au changement (option du badge désactivée pendant le POST) : rendu au badge, pas à l’hôte', async () => {
    const { harness, stable, changerEspace } = await ouvrir();
    const el = harness.fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('mg-carte-principale [data-declencheur="org"]')!.focus();
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);

    changerEspace('org-2');
    await stable();

    expect(document.activeElement).toBe(el.querySelector('mg-carte-principale [data-declencheur="org"]'));
  });

  it('(f ter) un focus posé HORS de la carte n’est pas envoyé au badge (la page peut le reprendre à son ouverture, B10)', async () => {
    const { harness, stable, changerEspace } = await ouvrir();
    const dehors = document.createElement('input');
    document.body.appendChild(dehors);
    dehors.focus();
    changerEspace('org-2');
    await stable();
    expect(document.activeElement).not.toBe((harness.fixture.nativeElement as HTMLElement).querySelector('[data-declencheur="org"]'));
    dehors.remove();
  });

  it('(g) une navigation REJETÉE (retrait de customZone) est interceptée : aucun rejet non géré, la page est quand même recréée', async () => {
    const { stable, page, changerEspace } = await ouvrir(`/carte?customZone=${ID}`);
    const router = TestBed.inject(Router);
    const navigation = vi.spyOn(router, 'navigate').mockReturnValue(Promise.reject(new Error('garde')));
    const rejets: unknown[] = [];
    const surRejet = (e: PromiseRejectionEvent) => { rejets.push(e.reason); e.preventDefault(); };
    window.addEventListener('unhandledrejection', surRejet);
    const avant = page().componentInstance;

    changerEspace('org-2');
    await stable();

    window.removeEventListener('unhandledrejection', surRejet);
    expect(navigation).toHaveBeenCalledTimes(1);
    expect(rejets).toEqual([]);
    expect(page().componentInstance).not.toBe(avant);
  });

  it('(h) changer d’espace depuis ?etape=analyse&customZone= : UNE navigation, URL sans etape ni customZone, page recréée (Review Focus 3)', async () => {
    const { stable, page, changerEspace } = await ouvrir(`/carte?etape=analyse&customZone=${ID}`);
    const router = TestBed.inject(Router);
    const navigation = vi.spyOn(router, 'navigate');
    const avant = page().componentInstance;

    changerEspace('org-2');
    await stable();

    expect(navigation).toHaveBeenCalledTimes(1);
    expect(router.url).toBe('/carte');
    expect(page().componentInstance).not.toBe(avant);
  });

  it('(h bis) ?etape=zones seul : retiré lui aussi au changement d’espace (retour à ①)', async () => {
    const { stable, page, changerEspace } = await ouvrir('/carte?etape=zones');
    const avant = page().componentInstance;

    changerEspace('org-2');
    await stable();

    expect(TestBed.inject(Router).url).toBe('/carte');
    expect(page().componentInstance).not.toBe(avant);
  });

  it('(i) la campagne OOH de l’ancien espace disparaît : overlay, fiche et couche (revue de la tâche 10)', async () => {
    // Une palette qui rend une couleur pour tout jeton : sans feuille de style, le vrai service lève — et la couche
    // n'est peinte qu'avec une campagne affichée sur une carte chargée (pré-vol P1).
    const palette = (j: Record<string, string>) => signal(Object.fromEntries(Object.keys(j).map((k) => [k, 'rgb(78, 205, 196)'])));
    const { harness, stable, page, changerEspace, cartes, http } = await ouvrir('/carte?etape=autres', () =>
      TestBed.overrideProvider(CouleursService, { useValue: { palette, paletteDuTheme: (j: Record<string, string>) => palette(j)() } }));
    const el = harness.fixture.nativeElement as HTMLElement;
    cartes[0].emettre('load');
    await stable();
    (el.querySelector('mg-section-ooh mg-entete-filtre') as HTMLElement).click();
    await stable();
    http.expectOne((r) => r.url.endsWith('/map/ooh/campagnes')).flush({ campagnes: [{ ...DETAIL_ESSAI.campagne, lignes: [] }], tronque: false });
    await stable();
    el.querySelector<HTMLButtonElement>('[data-choisir-campagne="c1"]')!.click();
    http.expectOne((r) => r.url.endsWith('/map/ooh/campagnes/c1')).flush(DETAIL_ESSAI);
    await stable();
    const ancien = page().injector.get(CampagneOohService);
    ancien.selectionner('p2');
    await stable();
    expect(el.querySelector('mg-section-ooh [data-campagne]')).not.toBeNull();
    expect(el.querySelector('[data-fiche-emplacement-ooh]')).not.toBeNull();
    expect(cartes[0].getSource(SOURCE_CAMPAGNE_OOH)).toBeDefined();

    changerEspace('org-2');
    await stable();
    const nouvelle = cartes[cartes.length - 1];
    nouvelle.emettre('load');
    await stable();

    const service = page().injector.get(CampagneOohService);
    expect(service).not.toBe(ancien);
    expect(service.detail()).toBeNull();
    expect(service.campagnes()).toBeNull();
    expect(service.emplacementSelectionne()).toBeNull();
    expect(el.querySelector('[data-campagne]')).toBeNull();
    expect(el.querySelector('[data-fiche-emplacement-ooh]')).toBeNull();
    // L'ancienne carte est détruite avec sa couche ; la nouvelle n'en a aucune, et rien n'a été relu.
    expect(cartes[0].retiree).toBe(true);
    expect(nouvelle).not.toBe(cartes[0]);
    expect(nouvelle.getSource(SOURCE_CAMPAGNE_OOH)).toBeUndefined();
    http.expectNone((r) => r.url.includes('/map/ooh/campagnes'));
    http.verify();
  });
});
