import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { Subject } from 'rxjs';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { IrisApi } from '../data/iris.api';
import { JeuxApi } from '../data/jeux.api';
import { ZonesCustomApi } from '../data/zones-custom.api';
import { AnnonceService } from '../etat/annonce.service';
import { ContoursZonesService } from '../etat/contours-zones.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { JeuZonesService } from '../etat/jeu-zones.service';
import type { ChoixParPlateforme } from '../logique/jeu/mailles-url';
import { REGISTRE, Z1, Z2, couvertureCp, regle } from '../testing/jeu-factice';
import { COUCHES_JEU, COUCHE_JEU_UNITES_FOND, COUCHE_JEU_ZONE } from './couche-jeu';
import { JeuCarteService } from './jeu-carte.service';

const entite = { type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: [[[5, 43], [5.5, 43], [5.5, 43.5], [5, 43]]] }, properties: {} };
const contoursCp: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: ['13001', '13002', '13003', '75001'].map((code) => ({ type: 'Feature', geometry: entite.geometry, properties: { code } })),
};
const cercles = (n: number) => ({
  zone_id: Z1, cible: 'ind', rayon_m: 10000, seuil: 20, n_candidates: n, n_cercles: n, population: 1000, couverte: 900, manques: 100,
  hors_zone: 0, achetee: 900, taux_utile: 100, n_carreaux: 5, motif_vide: null,
  cercles: Array.from({ length: n }, (_, i) => ({ lon: 5 + i / 1000, lat: 43, pop_en_zone: 10, pop_totale: 12, part: 80 })),
});

function monter() {
  const zoneId = signal<string | null>(Z1);
  const choix = signal<ChoixParPlateforme>({ dv360: { maille: 'cp', seuil: 20 }, ttd: { maille: 'polygone', seuil: 20 } });
  const couvertures = signal<Record<string, unknown>>({ cp: couvertureCp });
  const pavages = signal<Record<string, unknown>>({});
  const registre = signal([...REGISTRE, regle({ plateforme: 'tiktok', maille: 'commune' })]);
  const geos: Array<{ id: string; s: Subject<typeof entite> }> = [];
  const zonesLues: Array<{ echelle: string; s: Subject<GeoJSON.FeatureCollection> }> = [];
  const communes: Array<{ codes: readonly string[]; s: Subject<unknown> }> = [];
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), JeuCarteService, CouchesCarteService, EtatCarteService,
      { provide: AnnonceService, useValue: { annoncer: () => undefined } },
      {
        provide: JeuZonesService,
        useValue: { zoneId, choix, couvertures, cercles: pavages, plateformes: registre, recette: signal(null) },
      },
      { provide: ZonesCustomApi, useValue: { geometrie: (id: string) => { const s = new Subject<typeof entite>(); geos.push({ id, s }); return s; } } },
      { provide: ContoursZonesService, useValue: { zones: (echelle: string) => { const s = new Subject<GeoJSON.FeatureCollection>(); zonesLues.push({ echelle, s }); return s; } } },
      { provide: JeuxApi, useValue: { contoursCommunes: (codes: readonly string[]) => { const s = new Subject<unknown>(); communes.push({ codes, s }); return s; } } },
      { provide: IrisApi, useValue: { urlTuiles: () => 'http://h/api/tiles/iris/{z}/{x}/{y}?v=1' } },
      { provide: CouleursService, useValue: { palette: () => signal({ s1: 'rgb(1, 1, 1)', s2: 'rgb(2, 2, 2)', s3: 'rgb(3, 3, 3)', s4: 'rgb(4, 4, 4)', s5: 'rgb(5, 5, 5)', absente: 'rgb(6, 6, 6)', trait: 'rgba(0, 0, 0, 0.2)', zone: 'rgb(7, 7, 7)' }) } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  TestBed.inject(CouchesCarteService).publier(carte as unknown as maplibregl.Map);
  const service = TestBed.inject(JeuCarteService);
  TestBed.tick();
  return { service, carte, zoneId, choix, couvertures, pavages, geos, zonesLues, communes, etat: TestBed.inject(EtatCarteService) };
}

const peintures = (carte: CarteFactice) => JSON.stringify(carte.couches.map((c) => c.couche['paint']));
const donnees = (carte: CarteFactice, source: string) => (carte.sources.get(source)?.spec as { data: GeoJSON.FeatureCollection }).data;

describe('JeuCarteService (lot 5, T11)', () => {
  it('sans « Voir sur la carte » : rien n’est lu, rien n’est posé', () => {
    const m = monter();
    expect(m.geos).toEqual([]);
    expect(m.zonesLues).toEqual([]);
    expect(m.carte.couches).toEqual([]);
  });

  it('DV360 au CP : contour de la zone lu une fois et recadré, contours CP lus, retenues teintées, aucune couleur `var(` ni `#`', () => {
    const m = monter();
    m.service.regarder('dv360');
    TestBed.tick();
    expect(m.geos.map((g) => g.id)).toEqual([Z1]);
    expect(m.zonesLues.map((z) => z.echelle)).toEqual(['cp']);
    m.geos[0].s.next(entite);
    m.zonesLues[0].s.next(contoursCp);
    TestBed.tick();
    expect(m.carte.cadrages).toHaveLength(1);
    expect(m.carte.getLayer(COUCHE_JEU_ZONE)).toBeDefined();
    expect(m.carte.getLayer(COUCHE_JEU_UNITES_FOND)!['filter']).toEqual(['==', ['get', 'retenue'], true]);
    // Les trois CP touchés, retenus à 20 % : 13001 (60) et 13002 (30) ; 13003 (10) non ; 75001 hors réponse.
    expect(donnees(m.carte, 'jeu-unites').features.map((f) => [f.properties?.['code'], f.properties?.['retenue']]))
      .toEqual([['13001', true], ['13002', true], ['13003', false]]);
    expect(peintures(m.carte)).not.toMatch(/var\(|#/);
  });

  it('changer de plateforme regardée retire les anciennes couches ; 200 cercles en UNE source ; une maille exacte : le contour seul', () => {
    const m = monter();
    m.service.regarder('dv360');
    TestBed.tick();
    m.geos[0].s.next(entite);
    m.zonesLues[0].s.next(contoursCp);
    TestBed.tick();
    m.choix.update((c) => ({ ...c, meta: { maille: 'cercle', seuil: 20, rayon_m: 10000 } }));
    m.pavages.set({ meta: cercles(200) });
    m.service.regarder('meta');
    TestBed.tick();
    expect(donnees(m.carte, 'jeu-unites').features).toHaveLength(200);
    expect(m.carte.couches.filter((c) => c.couche['id'] === COUCHE_JEU_UNITES_FOND)).toHaveLength(1);
    m.service.regarder('ttd');
    TestBed.tick();
    expect(m.carte.getLayer(COUCHE_JEU_UNITES_FOND)).toBeUndefined();
    expect(m.carte.getLayer(COUCHE_JEU_ZONE)).toBeDefined();
    expect(m.geos).toHaveLength(1);
  });

  it('communes : les RETENUES seulement, une lecture par jeu de codes ; revenir à un seuil déjà vu ne relit rien', () => {
    const m = monter();
    m.choix.update((c) => ({ ...c, tiktok: { maille: 'commune', seuil: 20 } }));
    m.couvertures.set({ commune: { ...couvertureCp, decoupage: 'commune' } });
    m.service.regarder('tiktok');
    TestBed.tick();
    expect(m.communes.map((c) => c.codes)).toEqual([['13001', '13002']]);
    m.communes[0].s.next({ communes: [{ code: '13001', nom: 'A', geometry: entite.geometry }], manquants: [] });
    TestBed.tick();
    expect(donnees(m.carte, 'jeu-unites').features.map((f) => f.properties?.['code'])).toEqual(['13001']);
    m.choix.update((c) => ({ ...c, tiktok: { maille: 'commune', seuil: 50 } }));
    TestBed.tick();
    m.choix.update((c) => ({ ...c, tiktok: { maille: 'commune', seuil: 20 } }));
    TestBed.tick();
    expect(m.communes.map((c) => c.codes)).toEqual([['13001', '13002'], ['13001']]);
  });

  it('④ puis ⑤ : la couverture est évincée (une choroplèthe) ; ⑤ évincé à son tour se retire, « Voir sur la carte » le rend', () => {
    const m = monter();
    const evincee = vi.fn();
    m.etat.surEviction('couverture', evincee);
    m.etat.basculerDegrade('couverture', true);
    m.service.regarder('ttd');
    TestBed.tick();
    expect(evincee).toHaveBeenCalledTimes(1);
    m.geos[0].s.next(entite);
    TestBed.tick();
    expect(m.carte.getLayer(COUCHE_JEU_ZONE)).toBeDefined();
    m.etat.basculerDegrade('couverture', true);
    TestBed.tick();
    expect(m.service.affichee()).toBe(false);
    expect(m.carte.getLayer(COUCHE_JEU_ZONE)).toBeUndefined();
    m.service.regarder('ttd');
    TestBed.tick();
    expect(m.carte.getLayer(COUCHE_JEU_ZONE)).toBeDefined();
  });

  it('zone quittée : plateforme oubliée, couches retirées, lecture en vol jetée ; destruction du SERVICE : couches retirées', () => {
    const m = monter();
    m.service.regarder('ttd');
    TestBed.tick();
    m.zoneId.set(Z2);
    TestBed.tick();
    expect(m.service.regardee()).toBeNull();
    expect(m.geos[0].s.observed).toBe(false);
    m.zoneId.set(Z1);
    m.service.regarder('ttd');
    TestBed.tick();
    m.geos[1].s.next(entite);
    TestBed.tick();
    expect(m.carte.getLayer(COUCHE_JEU_ZONE)).toBeDefined();
    TestBed.resetTestingModule();
    for (const id of COUCHES_JEU) expect(m.carte.getLayer(id)).toBeUndefined();
  });
});
