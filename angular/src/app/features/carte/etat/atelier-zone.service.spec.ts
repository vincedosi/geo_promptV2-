import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { ZonesApi } from '../data/zones.api';
import { AtelierZoneService } from './atelier-zone.service';
import { CouchesCarteService } from './couches-carte.service';
import { ChargementService } from '../../../core/chargement/chargement.service';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { signal } from '@angular/core';
import { CarteFactice } from '../../../carte/testing/carte-factice';

const CARRE: GeoJSON.MultiPolygon = { type: 'MultiPolygon', coordinates: [[[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43.1], [5, 43]]]] };
const RECETTE = { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: { type: 'departement', code: '13' } } as const;
const APERCU = { geometry: CARRE, surface_km2: 3, compte: 40, part_retenue: 1, population: null };

function monter(api: Partial<Record<keyof ZonesApi, unknown>>, carte: CarteFactice | null = null) {
  TestBed.configureTestingModule({ providers: [
    AtelierZoneService,
    ChargementService,
    { provide: ZonesApi, useValue: api },
    { provide: CouchesCarteService, useValue: { carteCourante: signal(carte) } },
    { provide: CouleursService, useValue: { palette: () => signal({ teal: '#4ecdc4' }) } },
  ] });
  return TestBed.inject(AtelierZoneService);
}

function carteChargee(): CarteFactice {
  const c = new CarteFactice();
  c.styleCharge = true;
  return c;
}

describe('AtelierZoneService', () => {
  it('aperçu : la forme et ses chiffres ; « Enregistrer » envoie la RECETTE et le nom', () => {
    const enregistrer = vi.fn(() => of(new HttpResponse({ status: 200, body: { zone_id: 'z1', count_cp: 12 } })));
    const s = monter({ apercu: () => of(APERCU), enregistrer });
    const creees: string[] = [];
    s.zoneCreee.subscribe((id) => creees.push(id));
    s.apercevoir(RECETTE);
    expect(s.apercu()?.compte).toBe(40);
    s.enregistrer('Lycées 13');
    expect(enregistrer).toHaveBeenCalledWith({ nom: 'Lycées 13', recette: RECETTE });
    expect(creees).toEqual(['z1']);
    expect(s.message()).toBe('Zone « Lycées 13 » enregistrée — 12 codes postaux touchés.');
    // second clic après succès : rien ne part (pas de doublon)
    s.enregistrer('Lycées 13');
    expect(enregistrer).toHaveBeenCalledTimes(1);
    expect(s.apercu()).toBeNull();
  });

  it('un seul code postal : « 1 code postal touché » (pluriel)', () => {
    const s = monter({
      apercu: () => of({ geometry: CARRE, surface_km2: 1, compte: 1, part_retenue: 1, population: null }),
      enregistrer: () => of(new HttpResponse({ status: 200, body: { zone_id: 'z9', count_cp: 1 } })),
    });
    s.apercevoir(RECETTE);
    s.enregistrer('Petite');
    expect(s.message()).toBe('Zone « Petite » enregistrée — 1 code postal touché.');
  });

  it('une recette lourde sans périmètre : refus local, AUCUN appel', () => {
    const apercu = vi.fn();
    const s = monter({ apercu });
    s.apercevoir({ ...RECETTE, perimetre: null });
    expect(apercu).not.toHaveBeenCalled();
    expect(s.erreur()).toBe('Choisissez un périmètre à l’étape ① avant ce calcul.');
  });

  it('un second aperçu annule le premier : la réponse tardive n’est jamais dessinée', () => {
    const premiere = new Subject<unknown>();
    const reponses = [premiere, of({ geometry: CARRE, surface_km2: 1, compte: 2, part_retenue: 1, population: null })];
    const s = monter({ apercu: () => reponses.shift() });
    s.apercevoir(RECETTE);
    s.apercevoir({ ...RECETTE, rayon_m: 1000 });
    premiere.next({ geometry: CARRE, surface_km2: 99, compte: 999, part_retenue: 1, population: null });
    expect(s.apercu()?.compte).toBe(2);
  });

  it('refus serveur 422 : son message, l’aperçu effacé', () => {
    const s = monter({ apercu: () => throwError(() => new HttpErrorResponse({ status: 422, error: { error: 'Plus de 20 000 carreaux retenus : resserrez le périmètre ou relevez le seuil.' } })) });
    s.apercevoir(RECETTE);
    expect(s.apercu()).toBeNull();
    expect(s.erreur()).toMatch(/^Plus de 20 000/);
  });

  it('207 : la zone EXISTE — message de résolution manquée, atelier vidé comme un succès, aucun second envoi', () => {
    const enregistrer = vi.fn(() => of(new HttpResponse({ status: 207, body: { zone_id: 'z2', warning: 'codes_non_resolus', message: 'Zone créée ; ses codes postaux n’ont pas pu être résolus.' } })));
    const s = monter({ apercu: () => of(APERCU), enregistrer });
    const creees: string[] = [];
    s.zoneCreee.subscribe((id) => creees.push(id));
    s.apercevoir(RECETTE);
    s.enregistrer('Z');
    expect(s.message()).toBe('Zone créée ; ses codes postaux n’ont pas pu être résolus.');
    expect(s.erreur()).toBeNull();
    expect(creees).toEqual(['z2']);
    expect([s.apercu(), s.recette()]).toEqual([null, null]);
    s.enregistrer('Z');
    expect(enregistrer).toHaveBeenCalledTimes(1);
    // T10 : le pied propose le recalcul (« Mes zones »), jamais un second envoi ; vidé par « Effacer ».
    expect(s.nonResolue()).toEqual({ id: 'z2', recalculable: true });
    s.effacer();
    expect(s.nonResolue()).toBeNull();
  });

  it('enregistrer sans aperçu ou sans nom : rien ne part', () => {
    const enregistrer = vi.fn();
    const s = monter({ apercu: () => of(APERCU), enregistrer });
    s.enregistrer('Z');
    expect(enregistrer).not.toHaveBeenCalled();
    s.apercevoir(RECETTE);
    s.enregistrer('');
    s.enregistrer('   ');
    expect(enregistrer).not.toHaveBeenCalled();
  });

  it('POST /api/zones n’est pas idempotent : un second « Enregistrer » pendant l’envoi ne part pas', () => {
    const vol = new Subject<HttpResponse<unknown>>();
    const enregistrer = vi.fn(() => vol);
    const s = monter({ apercu: () => of(APERCU), enregistrer });
    s.apercevoir(RECETTE);
    s.enregistrer('Z');
    s.enregistrer('Z');
    s.enregistrer('Autre nom');
    expect(enregistrer).toHaveBeenCalledTimes(1);
    expect(s.enCours()).toBe(true);
    // Un nouvel aperçu ne coupe pas non plus l'écriture en vol : la zone serait créée sans que l'écran le sache.
    s.apercevoir(RECETTE);
    expect(vol.observed).toBe(true);
    vol.next(new HttpResponse({ status: 200, body: { zone_id: 'z5', count_cp: 2 } }));
    vol.complete();
    expect(s.message()).toBe('Zone « Z » enregistrée — 2 codes postaux touchés.');
    expect(s.enCours()).toBe(false);
  });

  it('échec d’écriture : son message, l’aperçu GARDÉ pour réessayer', () => {
    const s = monter({
      apercu: () => of(APERCU),
      enregistrer: () => throwError(() => new HttpErrorResponse({ status: 429, error: {} })),
    });
    s.apercevoir(RECETTE);
    s.enregistrer('Z');
    expect(s.erreur()).toBe('Trop de calculs à la suite : patientez une minute.');
    expect(s.apercu()?.compte).toBe(40);
    expect(s.enCours()).toBe(false);
  });

  it('forme figée : la géométrie lue part avec la recette', () => {
    const enregistrer = vi.fn(() => of(new HttpResponse({ status: 200, body: { zone_id: 'z3' } })));
    const s = monter({ apercu: () => of({ geometry: CARRE, surface_km2: 3, compte: null, part_retenue: 0.8, population: null }), enregistrer });
    s.apercevoir({ v: 1, type: 'import', format: 'kml', fichier: 'a.kml' }, CARRE);
    s.enregistrer('Import');
    expect(enregistrer).toHaveBeenCalledWith({ nom: 'Import', recette: { v: 1, type: 'import', format: 'kml', fichier: 'a.kml' }, geometrie: CARRE });
  });

  it('dessine l’aperçu sur la carte courante, et l’efface', () => {
    const carte = carteChargee();
    const s = monter({ apercu: () => of(APERCU) }, carte);
    s.apercevoir(RECETTE);
    TestBed.tick();
    expect(carte.sources.has('apercu-zone')).toBe(true);
    expect(carte.getLayer('apercu-zone-fill')).toBeDefined();
    expect(carte.getLayer('apercu-zone-line')).toBeDefined();
    s.effacer();
    TestBed.tick();
    expect(carte.sources.has('apercu-zone')).toBe(false);
  });

  it('la barre de progression suit le calcul (piste « atelier-zone »)', () => {
    const vol = new Subject<unknown>();
    const s = monter({ apercu: () => vol });
    const chargement = TestBed.inject(ChargementService);
    s.apercevoir(RECETTE);
    TestBed.tick();
    expect(chargement.etat().actif).toBe(true);
    vol.next(APERCU);
    TestBed.tick();
    expect(chargement.etat().actif).toBe(false);
  });

  // Review Focus 4 : l'atelier est fourni par le panneau, que la page porte ; un changement d'espace recrée la page.
  it('page détruite pendant un aperçu en vol : la requête est coupée, rien n’est dessiné', () => {
    const carte = carteChargee();
    const vol = new Subject<unknown>();
    const s = monter({ apercu: () => vol }, carte);
    s.apercevoir(RECETTE);
    TestBed.tick();
    TestBed.resetTestingModule();
    expect(vol.observed).toBe(false);
    vol.next(APERCU);
    expect(s.apercu()).toBeNull();
    expect(carte.sources.has('apercu-zone')).toBe(false);
  });

  it('changement d’espace pendant un aperçu en vol : la réponse de l’ancien espace n’est ni gardée ni dessinée dans le nouveau', () => {
    const carte = carteChargee();
    const ancien = new Subject<unknown>();
    const enregistrer = vi.fn();
    monter({ apercu: () => ancien, enregistrer }, carte).apercevoir(RECETTE);
    TestBed.tick();
    // L'espace change : la page — donc le panneau et son atelier — est recréée, sur la même carte.
    TestBed.resetTestingModule();
    const nouvel = monter({ apercu: () => new Subject(), enregistrer }, carte);
    TestBed.tick();
    ancien.next({ ...APERCU, compte: 999 });
    TestBed.tick();
    expect(nouvel.apercu()).toBeNull();
    expect(nouvel.recette()).toBeNull();
    expect(carte.sources.has('apercu-zone')).toBe(false);
    nouvel.enregistrer('Z');
    expect(enregistrer).not.toHaveBeenCalled();
  });
});
