import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AuthService } from '../../../../core/auth/auth.service';
import { ConfigService } from '../../../../core/config/config.service';
import { ChargementService } from '../../../../core/chargement/chargement.service';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { AnalysesApi } from '../../data/analyses.api';
import { CarteApi } from '../../data/carte.api';
import { ZonesApi } from '../../data/zones.api';
import { AnnonceService } from '../../etat/annonce.service';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { AtelierZoneService } from '../../etat/atelier-zone.service';
import { CaptureService } from '../../etat/capture.service';
import { CatalogueIndicateursService } from '../../etat/catalogue-indicateurs.service';
import { CataloguePoiService } from '../../etat/catalogue-poi.service';
import { CreationZoneService } from '../../etat/creation-zone.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import type { FiltreActif } from '../../logique/filtre';
import type { Recette } from '../../logique/zones/recette';
import { OutilsCarteService } from '../../outils/outils-carte.service';
import { ParcoursService } from '../../etat/parcours.service';
import { PileEchapService } from '../../etat/pile-echap.service';
import { CaptureComponent } from './capture.component';
import { CreerCodesPostauxComponent } from './creer-codes-postaux.component';
import { CreerDessinComponent } from './creer-dessin.component';
import { CreerPaysComponent } from './creer-pays.component';
import { CreerRayonComponent } from './creer-rayon.component';
import { PanneauZonesComponent } from './panneau-zones.component';
import { PiedRecetteComponent } from './pied-recette.component';
import { RecetteImportComponent } from './recette-import.component';
import { RecetteRayonPoiComponent } from './recette-rayon-poi.component';
import { RecetteSeuilCarreauxComponent } from './recette-seuil-carreaux.component';
import { RecetteSeuilTerritoireComponent } from './recette-seuil-territoire.component';

/** Créateurs et formulaires réduits à leur surface : ce spec vérifie le câblage, leurs specs le reste. */
@Component({ selector: 'mg-creer-codes-postaux', template: '' })
class CodesPostauxFactice { readonly cree = output<void>(); }
@Component({ selector: 'mg-creer-rayon', template: '' })
class RayonFactice { readonly cree = output<void>(); readonly enPause = input(false); }
/**
 * Le dessin factice prend la carte à sa création, la rend en PAUSE (famille repliée, T7 I-1) et à sa destruction, comme
 * le vrai (`suspendre` / `reprendre` / `arreter`).
 */
@Component({ selector: 'mg-creer-dessin', template: '' })
class DessinFactice {
  readonly cree = output<void>();
  readonly enPause = input(false);
  constructor() {
    const etat = inject(EtatCarteService);
    effect(() => {
      if (this.enPause()) etat.rendreCarte('dessin');
      else etat.prendreCarte('dessin');
    });
    inject(DestroyRef).onDestroy(() => etat.rendreCarte('dessin'));
  }
}
@Component({ selector: 'mg-creer-pays', template: '<button data-creer-pays>France métropolitaine</button><button data-creer-pays>France entière</button>' })
class PaysFactice { readonly cree = output<void>(); }
@Component({ selector: 'mg-capture', template: '' })
class CaptureFactice { readonly cree = output<void>(); readonly fermer = output<void>(); }
const R_POI: Recette = { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: { type: 'departement', code: '13' } };
const R_CARREAUX: Recette = { v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: { type: 'departement', code: '13' } };
@Component({ selector: 'mg-recette-rayon-poi', template: '' })
class RayonPoiFactice { readonly recette = computed(() => R_POI); }
@Component({ selector: 'mg-recette-seuil-carreaux', template: '' })
class CarreauxFactice { readonly recette = computed(() => R_CARREAUX); }
@Component({ selector: 'mg-recette-seuil-territoire', template: '' })
class TerritoireFactice { readonly recette = computed(() => null); }
@Component({ selector: 'mg-recette-import', template: '' })
class ImportFactice { readonly recette = computed(() => null); readonly geometrie = computed(() => undefined); }
@Component({ selector: 'mg-pied-recette', template: '' })
class PiedFactice { readonly recette = input<Recette | null>(null); readonly geometrie = input<GeoJSON.Geometry | undefined>(undefined); }

async function monter(filtre: FiltreActif | null = null) {
  // Les VRAIS services du panneau (ses `providers`), sur des dépendances factices : aucune requête ne part.
  const parcours = { choisir: vi.fn() };
  TestBed.configureTestingModule({ providers: [
    { provide: ParcoursService, useValue: parcours },
    OutilsCarteService, PileEchapService, CaptureService, EtatCarteService, AnnonceService, CouchesCarteService, ChargementService,
    { provide: ZonesApi, useValue: {} },
    { provide: AnalysesApi, useValue: {} },
    // Fourni par la PAGE (X4) : le test tient le rôle de la page.
    CatalogueIndicateursService,
    { provide: CouleursService, useValue: { palette: () => signal({ teal: '#4ecdc4' }) } },
    { provide: AuthService, useValue: { lireProfil: async () => ({ role: null, nom: null, organisation: 'org-1' }) } },
  ] });
  TestBed.overrideComponent(PanneauZonesComponent, {
    remove: {
      imports: [CaptureComponent, CreerCodesPostauxComponent, CreerDessinComponent, CreerPaysComponent, CreerRayonComponent, PiedRecetteComponent,
        RecetteImportComponent, RecetteRayonPoiComponent, RecetteSeuilCarreauxComponent, RecetteSeuilTerritoireComponent],
    },
    add: {
      imports: [CaptureFactice, CodesPostauxFactice, DessinFactice, PaysFactice, RayonFactice, PiedFactice, RayonPoiFactice, CarreauxFactice, TerritoireFactice, ImportFactice],
    },
  });
  TestBed.inject(EtatCarteService).filtre.set(filtre);
  const fixture = TestBed.createComponent(PanneauZonesComponent);
  await fixture.whenStable();
  const atelier = fixture.debugElement.injector.get(AtelierZoneService);
  const el = fixture.nativeElement as HTMLElement;
  const ouvrirFamille = async (f: string) => { el.querySelector<HTMLElement>(`mg-entete-section[data-famille="${f}"]`)!.click(); await fixture.whenStable(); };
  const pied = () => fixture.debugElement.query(By.directive(PiedFactice)).componentInstance as PiedFactice;
  return { fixture, el, parcours, outils: TestBed.inject(OutilsCarteService), etat: TestBed.inject(EtatCarteService), zoneCreee: atelier.zoneCreee, ouvrirFamille, pied };
}

describe('PanneauZonesComponent — ③ rangée par familles (lot 3, T10)', () => {
  it('le panneau fournit AtelierZoneService et CreationZoneService (pas la racine) ; le catalogue vient de la PAGE (X4)', async () => {
    const { fixture } = await monter();
    const injecteur = fixture.debugElement.injector;
    expect(injecteur.get(AtelierZoneService)).toBeInstanceOf(AtelierZoneService);
    expect(injecteur.get(CreationZoneService)).toBeInstanceOf(CreationZoneService);
    for (const s of [AtelierZoneService, CreationZoneService]) expect(() => TestBed.inject(s as never)).toThrow();
    // Le catalogue n'est plus fourni par le panneau : celui de ce test (le fournisseur de la page) est le même objet.
    expect(injecteur.get(CatalogueIndicateursService)).toBe(TestBed.inject(CatalogueIndicateursService));
  });

  it('quatre en-têtes dans l’ordre « Autour des POI », « Par seuil », « À la main », « Capture » ; seule la première ouverte', async () => {
    const { el } = await monter();
    expect([...el.querySelectorAll('mg-entete-section')].map((h) => h.textContent!.trim())).toEqual(['Autour des POI', 'Par seuil', 'À la main', 'Capture']);
    expect(el.querySelector('mg-recette-rayon-poi')).not.toBeNull();
    expect(el.querySelector('mg-creer-rayon')).not.toBeNull();
    expect(el.querySelector('mg-recette-seuil-carreaux')).toBeNull();
    expect(el.querySelector('[data-capturer]')).toBeNull();
  });

  it('la ligne de périmètre suit EtatCarteService.filtre', async () => {
    const { fixture, el, etat } = await monter();
    expect(el.querySelector('[data-perimetre]')!.textContent!.trim())
      .toBe('Aucun périmètre : les calculs par seuil et autour des POI sont désactivés. Choisissez-en un à l’étape ①.');
    etat.filtre.set({ type: 'departement', code: '13', label: 'Bouches-du-Rhône' });
    await fixture.whenStable();
    expect(el.querySelector('[data-perimetre]')!.textContent!.trim()).toBe('Périmètre : Bouches-du-Rhône');
    // La pastille « France Metro » (retours du 26/10, T3).
    etat.filtre.set({ type: 'france', code: 'metro', label: 'France métropolitaine' });
    await fixture.whenStable();
    expect(el.querySelector('[data-perimetre]')!.textContent!.trim())
      .toBe('Périmètre : France métropolitaine — « Autour des POI » s’y calcule ; « Par seuil » sur un département ou une région.');
  });

  it('le pied reçoit la recette du formulaire actif : le premier de la famille ouverte, puis le dernier touché', async () => {
    const { fixture, el, ouvrirFamille, pied } = await monter();
    expect(pied().recette()).toEqual(R_POI);
    await ouvrirFamille('seuil');
    expect(pied().recette()).toEqual(R_CARREAUX);
    el.querySelector<HTMLElement>('mg-recette-seuil-territoire')!.click();
    await fixture.whenStable();
    expect(pied().recette()).toBeNull();
    el.querySelector<HTMLElement>('mg-recette-seuil-carreaux')!.click();
    await fixture.whenStable();
    expect(pied().recette()).toEqual(R_CARREAUX);
    expect(el.querySelector('mg-recette-seuil-carreaux')!.classList).toContain('recette-active');
    // La famille de l'actif repliée : plus rien à lancer (T7 : tout est fermé).
    await ouvrirFamille('seuil');
    expect(pied().recette()).toBeNull();
    // Rouvrir « Autour des POI » rend son premier formulaire actif.
    await ouvrirFamille('poi');
    expect(pied().recette()).toEqual(R_POI);
  });

  it('« Capture » : le bouton existant, libellé inchangé', async () => {
    const { el, ouvrirFamille } = await monter();
    await ouvrirFamille('capture');
    expect(el.querySelector('[data-capturer]')!.textContent).toContain('Capturer zone custom');
  });

  it('replier « À la main » pendant un tracé libère la carte ; la rouvrir la reprend', async () => {
    const { etat, ouvrirFamille } = await monter();
    await ouvrirFamille('main');
    expect(etat.carteOccupee()).toBe(true);
    await ouvrirFamille('main');
    expect(etat.carteOccupee()).toBe(false);
    await ouvrirFamille('main');
    expect(etat.carteOccupee()).toBe(true);
    // Ouvrir une AUTRE famille met aussi le dessin en pause (tiroirs exclusifs).
    await ouvrirFamille('seuil');
    expect(etat.carteOccupee()).toBe(false);
  });

  it('une zone écrite par l’atelier, ou par un créateur, relit « Mes zones »', async () => {
    const { fixture, outils, zoneCreee } = await monter();
    expect(outils.revisionZones()).toBe(0);
    zoneCreee.next('z');
    expect(outils.revisionZones()).toBe(1);
    (fixture.debugElement.query(By.directive(RayonFactice)).componentInstance as RayonFactice).cree.emit();
    expect(outils.revisionZones()).toBe(2);
  });

  it('④ finitions (T6) : « À la main » offre la zone nationale ; une zone pays créée relit « Mes zones »', async () => {
    const { fixture, el, outils, ouvrirFamille } = await monter();
    expect(el.querySelector('mg-creer-pays')).toBeNull();
    await ouvrirFamille('main');
    expect([...el.querySelectorAll('[data-corps-famille="main"] [data-creer-pays]')].map((b) => b.textContent!.trim()))
      .toEqual(['France métropolitaine', 'France entière']);
    (fixture.debugElement.query(By.directive(PaysFactice)).componentInstance as PaysFactice).cree.emit();
    expect(outils.revisionZones()).toBe(1);
  });

  it('« Ouvrir « Mes zones » » ouvre l’outil, bouton neutre', async () => {
    const { el, outils } = await monter();
    const bouton = el.querySelector<HTMLButtonElement>('[data-ouvrir-mes-zones]')!;
    expect(bouton.className).not.toMatch(/teal/);
    bouton.click();
    expect(outils.outil()).toBe('zones');
  });

  it('lot 3 (T11) : « Autour des POI » renvoie vers ④ pour les isochrones et la bataille, sans les monter', async () => {
    const { el, parcours, ouvrirFamille } = await monter();
    const renvoi = el.querySelector('[data-renvoi-analyse]')!;
    expect(renvoi.textContent!.trim()).toBe('La bataille d’isochrones se lance à l’étape ④ ; capturez ensuite son résultat ici.');
    const bouton = el.querySelector<HTMLButtonElement>('[data-aller-analyse]')!;
    expect(bouton.textContent!.trim()).toBe('Aller à ④ Analyse');
    bouton.click();
    expect(parcours.choisir).toHaveBeenCalledWith('analyse');
    for (const f of ['seuil', 'main', 'capture']) await ouvrirFamille(f);
    expect(el.querySelector('mg-outil-isochrones')).toBeNull();
    expect(el.querySelector('mg-outil-bataille-v2')).toBeNull();
    // Une autre famille ouverte CACHE « Autour des POI », renvoi compris (T7 : monté, caché).
    expect(el.querySelector('[data-corps-famille="poi"]')!.classList).toContain('hidden');
  });

  describe('tiroirs exclusifs (retours du 26/10, T7)', () => {
    const corps = (el: HTMLElement, f: string) => el.querySelector(`[data-corps-famille="${f}"]`);

    it('ouvrir « Par seuil » ferme « Autour des POI » : son corps est caché, le créateur de rayon (qui tient la carte) en pause', async () => {
      const { fixture, el, ouvrirFamille } = await monter();
      await ouvrirFamille('seuil');
      expect(corps(el, 'poi')!.classList).toContain('hidden');
      expect((fixture.debugElement.query(By.directive(RayonFactice)).componentInstance as RayonFactice).enPause()).toBe(true);
      expect(corps(el, 'seuil')!.classList).not.toContain('hidden');
      expect([...el.querySelectorAll('mg-entete-section')].filter((h) => h.querySelector('[aria-expanded="true"]')).length).toBeLessThanOrEqual(1);
      // « À la main » jamais dépliée : rien n'est monté.
      expect(corps(el, 'main')).toBeNull();
    });

    it('rouvrir une famille retrouve le MÊME formulaire (saisie gardée) ; tout fermé, le pied n’a rien à lancer', async () => {
      const { fixture, el, ouvrirFamille, pied } = await monter();
      const avant = fixture.debugElement.query(By.directive(RayonPoiFactice)).componentInstance;
      await ouvrirFamille('main');
      await ouvrirFamille('poi');
      expect(fixture.debugElement.query(By.directive(RayonPoiFactice)).componentInstance).toBe(avant);
      await ouvrirFamille('poi');
      expect(pied().recette()).toBeNull();
      for (const f of ['poi', 'main']) expect(corps(el, f)!.classList).toContain('hidden');
    });
  });

  describe('tiroirs exclusifs, formulaires RÉELS (Review Focus 5)', () => {
    async function monterReel() {
      TestBed.configureTestingModule({ providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } },
        { provide: ParcoursService, useValue: { choisir: vi.fn() } },
        OutilsCarteService, PileEchapService, CaptureService, EtatCarteService, AnnonceService, CouchesCarteService, ChargementService,
        { provide: ZonesApi, useValue: {} },
        AnalysesApi, CarteApi, CatalogueIndicateursService, CataloguePoiService,
        { provide: CouleursService, useValue: { palette: () => signal({ teal: '#4ecdc4' }) } },
        { provide: AuthService, useValue: { lireProfil: async () => ({ role: null, nom: null, organisation: 'org-1' }) } },
      ] });
      TestBed.overrideComponent(PanneauZonesComponent, {
        remove: { imports: [CaptureComponent, CreerCodesPostauxComponent, CreerDessinComponent, CreerRayonComponent, PiedRecetteComponent] },
        add: { imports: [CaptureFactice, CodesPostauxFactice, DessinFactice, RayonFactice, PiedFactice] },
      });
      const http = TestBed.inject(HttpTestingController);
      const etat = TestBed.inject(EtatCarteService);
      etat.filtre.set({ type: 'departement', code: '13', label: 'Bouches-du-Rhône' });
      const fixture = TestBed.createComponent(PanneauZonesComponent);
      await fixture.whenStable();
      const el = fixture.nativeElement as HTMLElement;
      const ouvrirFamille = async (f: string) => { el.querySelector<HTMLElement>(`mg-entete-section[data-famille="${f}"]`)!.click(); await fixture.whenStable(); };
      return { fixture, el, http, etat, ouvrirFamille };
    }

    afterEach(() => TestBed.inject(HttpTestingController).verify());

    it('rouvrir « Par seuil » ne relit pas le catalogue ; un corps caché ne lit rien quand le filtre change', async () => {
      const { fixture, http, etat, ouvrirFamille } = await monterReel();
      // Ouverture : le catalogue des types de POI (rayon autour des POI), une fois.
      http.match((r) => r.url.includes('/map/categories')).forEach((r) => r.flush({ categories: [] }));
      await ouvrirFamille('seuil');
      http.expectOne((r) => r.url.includes('/cibles/indicators')).flush({ indicators: [] });
      await fixture.whenStable();
      await ouvrirFamille('main');
      await ouvrirFamille('seuil');
      await ouvrirFamille('poi');
      http.expectNone(() => true);
      etat.filtre.set({ type: 'region', code: '93', label: "Provence-Alpes-Côte d'Azur" });
      await fixture.whenStable();
      http.expectNone(() => true);
    });
  });

  describe('relecture T7 : I-1 et m-1', () => {
    it('I-1 : ouvrir une autre famille garde le rayon et le dessin MONTÉS (même instance), en pause ; une création qui aboutit relit « Mes zones »', async () => {
      const { fixture, outils, ouvrirFamille } = await monter();
      const rayon = () => fixture.debugElement.query(By.directive(RayonFactice)).componentInstance as RayonFactice;
      const avant = rayon();
      expect(avant.enPause()).toBe(false);
      await ouvrirFamille('main');
      const dessin = fixture.debugElement.query(By.directive(DessinFactice)).componentInstance as DessinFactice;
      await ouvrirFamille('seuil');
      expect(rayon()).toBe(avant);
      expect(rayon().enPause()).toBe(true);
      expect(fixture.debugElement.query(By.directive(DessinFactice)).componentInstance).toBe(dessin);
      expect(dessin.enPause()).toBe(true);
      const revision = outils.revisionZones();
      rayon().cree.emit();
      dessin.cree.emit();
      expect(outils.revisionZones()).toBe(revision + 2);
      await ouvrirFamille('poi');
      expect(rayon().enPause()).toBe(false);
    });

    it('m-1 : rouvrir une famille rend actif son DERNIER formulaire touché, pas le premier', async () => {
      const { fixture, el, ouvrirFamille } = await monter();
      await ouvrirFamille('seuil');
      el.querySelector<HTMLElement>('mg-recette-seuil-territoire')!.click();
      await fixture.whenStable();
      await ouvrirFamille('main');
      await ouvrirFamille('seuil');
      expect(el.querySelector('mg-recette-seuil-territoire')!.classList).toContain('recette-active');
      expect(el.querySelector('mg-recette-seuil-carreaux')!.classList).not.toContain('recette-active');
      // Replier puis rouvrir la même : idem.
      await ouvrirFamille('seuil');
      await ouvrirFamille('seuil');
      expect(el.querySelector('mg-recette-seuil-territoire')!.classList).toContain('recette-active');
    });
  });
});

describe('PanneauZonesComponent — le message de réussite s’efface (③ finitions, T6, A-9)', () => {
  it('au changement de famille, puis de formulaire actif ; pas sans changement', async () => {
    const { fixture, el, ouvrirFamille } = await monter();
    const atelier = fixture.debugElement.injector.get(AtelierZoneService);
    atelier.message.set('Zone « Z » enregistrée — 2 codes postaux touchés.');
    await fixture.whenStable();
    expect(atelier.message()).not.toBeNull();
    await ouvrirFamille('seuil');
    expect(atelier.message()).toBeNull();
    atelier.message.set('Zone « Z » enregistrée — 2 codes postaux touchés.');
    await fixture.whenStable();
    el.querySelector<HTMLElement>('mg-recette-seuil-carreaux')!.click();
    await fixture.whenStable();
    expect(atelier.message()).not.toBeNull();
    el.querySelector<HTMLElement>('mg-recette-seuil-territoire')!.click();
    await fixture.whenStable();
    expect(atelier.message()).toBeNull();
  });
});
