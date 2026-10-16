import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AuthService } from '../../../../core/auth/auth.service';
import { ChargementService } from '../../../../core/chargement/chargement.service';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { AnalysesApi } from '../../data/analyses.api';
import { ZonesApi } from '../../data/zones.api';
import { AnnonceService } from '../../etat/annonce.service';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { AtelierZoneService } from '../../etat/atelier-zone.service';
import { CaptureService } from '../../etat/capture.service';
import { CatalogueIndicateursService } from '../../etat/catalogue-indicateurs.service';
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
class RayonFactice { readonly cree = output<void>(); }
/** Le dessin factice prend la carte à sa création et la rend à sa destruction, comme le vrai (`basculer` / `arreter`). */
@Component({ selector: 'mg-creer-dessin', template: '' })
class DessinFactice {
  readonly cree = output<void>();
  constructor() {
    const etat = inject(EtatCarteService);
    etat.prendreCarte('dessin');
    inject(DestroyRef).onDestroy(() => etat.rendreCarte('dessin'));
  }
}
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
      imports: [CaptureComponent, CreerCodesPostauxComponent, CreerDessinComponent, CreerRayonComponent, PiedRecetteComponent,
        RecetteImportComponent, RecetteRayonPoiComponent, RecetteSeuilCarreauxComponent, RecetteSeuilTerritoireComponent],
    },
    add: {
      imports: [CaptureFactice, CodesPostauxFactice, DessinFactice, RayonFactice, PiedFactice, RayonPoiFactice, CarreauxFactice, TerritoireFactice, ImportFactice],
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
  });

  it('le pied reçoit la recette du formulaire actif : le premier de la famille ouverte, puis le dernier touché', async () => {
    const { fixture, el, ouvrirFamille, pied } = await monter();
    expect(pied().recette()).toEqual(R_POI);
    await ouvrirFamille('seuil');
    expect(pied().recette()).toEqual(R_CARREAUX);
    el.querySelector<HTMLElement>('mg-recette-rayon-poi')!.click();
    await fixture.whenStable();
    expect(pied().recette()).toEqual(R_POI);
    expect(el.querySelector('mg-recette-rayon-poi')!.classList).toContain('recette-active');
    // La famille de l'actif repliée : plus rien à lancer.
    await ouvrirFamille('poi');
    expect(pied().recette()).toBeNull();
  });

  it('« Capture » : le bouton existant, libellé inchangé', async () => {
    const { el, ouvrirFamille } = await monter();
    await ouvrirFamille('capture');
    expect(el.querySelector('[data-capturer]')!.textContent).toContain('Capturer zone custom');
  });

  it('replier « À la main » pendant un tracé libère la carte', async () => {
    const { etat, ouvrirFamille } = await monter();
    await ouvrirFamille('main');
    expect(etat.carteOccupee()).toBe(true);
    await ouvrirFamille('main');
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
    expect(renvoi.textContent!.trim()).toBe('Isochrones et bataille : lancez-les à l’étape ④, puis capturez le résultat ici.');
    const bouton = el.querySelector<HTMLButtonElement>('[data-aller-analyse]')!;
    expect(bouton.textContent!.trim()).toBe('Aller à ④ Analyse');
    bouton.click();
    expect(parcours.choisir).toHaveBeenCalledWith('analyse');
    for (const f of ['seuil', 'main', 'capture']) await ouvrirFamille(f);
    expect(el.querySelector('mg-outil-isochrones')).toBeNull();
    expect(el.querySelector('mg-outil-bataille-v2')).toBeNull();
    // Replier « Autour des POI » retire aussi le renvoi.
    await ouvrirFamille('poi');
    expect(el.querySelector('[data-renvoi-analyse]')).toBeNull();
  });
});
