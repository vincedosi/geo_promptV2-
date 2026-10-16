import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { Subject, of, throwError } from 'rxjs';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { type ZoneCustomResume, ZonesCustomApi } from '../data/zones-custom.api';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { PALETTE_ZONES } from '../logique/palettes-donnees-carte';
import type { EntiteZone } from '../logique/zones/zone-du-lien';
import { ZonesCustomService } from './zones-custom.service';

const zone = (id: string, bbox: ZoneCustomResume['bbox'] = null): ZoneCustomResume => ({
  id, name: `Zone ${id}`, description: null, source_type: 'composite', source_metadata: {},
  feature_count_iris: 3, feature_count_cp: 2, bbox, created_at: '2026-09-03T10:00:00Z', created_by: null,
});
const entite = (id: string): EntiteZone => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[1, 2], [3, 2], [3, 5], [1, 5], [1, 2]]] },
  properties: { id, name: `Zone ${id}` },
});

function monter(geometrie: (id: string) => unknown = (id) => of(entite(id))) {
  const lire = vi.fn(geometrie);
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), ZonesCustomService, CouchesCarteService, { provide: ZonesCustomApi, useValue: { geometrie: lire } }],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  const couches = TestBed.inject(CouchesCarteService);
  couches.publier(carte as unknown as maplibregl.Map);
  const service = TestBed.inject(ZonesCustomService);
  TestBed.tick();
  return { service, carte, couches, lire };
}

const sourcesZones = (c: CarteFactice) => [...c.sources.keys()].filter((id) => id.startsWith('custom-zone-'));

describe('ZonesCustomService (zones enregistrées affichées, T14)', () => {
  it('afficher deux zones → deux sources, deux couches chacune, `zonesAffichees` de longueur 2, teintes de la palette en cycle', () => {
    const { service, carte } = monter();
    service.afficher(zone('a'));
    service.afficher(zone('b'));
    TestBed.tick();
    expect(sourcesZones(carte)).toEqual(['custom-zone-a', 'custom-zone-b']);
    expect(carte.couches.map((c) => c.couche['id'])).toEqual(['custom-zone-fill-a', 'custom-zone-line-a', 'custom-zone-fill-b', 'custom-zone-line-b']);
    expect(service.zonesAffichees()).toEqual([{ id: 'a', name: 'Zone a' }, { id: 'b', name: 'Zone b' }]);
    expect(service.couleurs().get('a')).toBe(PALETTE_ZONES[0]);
    expect(service.couleurs().get('b')).toBe(PALETTE_ZONES[1]);
    const aplat = carte.getLayer('custom-zone-fill-b') as { paint: Record<string, unknown> };
    expect(aplat.paint).toEqual({ 'fill-color': PALETTE_ZONES[1], 'fill-opacity': 0.25 });
    // La donnée porte nom et type de source de la liste, comme React (`properties: { name, source_type, ... }`).
    const spec = carte.sources.get('custom-zone-a')!.spec as { data: GeoJSON.Feature };
    expect(spec.data.properties).toMatchObject({ name: 'Zone a', source_type: 'composite', id: 'a' });
  });

  it('recadre sur la bbox de la liste si elle existe, sinon sur celle de la géométrie (50 px, 800 ms)', () => {
    const { service, carte } = monter();
    service.afficher(zone('a', [4, 43, 5, 44]));
    service.afficher(zone('b'));
    expect(carte.cadrages).toEqual([
      { cadre: [[4, 43], [5, 44]], options: { padding: 50, duration: 800 } },
      { cadre: [[1, 2], [3, 5]], options: { padding: 50, duration: 800 } },
    ]);
  });

  it('déjà affichée ou en lecture : aucune seconde requête', () => {
    const vol = new Subject<EntiteZone>();
    const { service, lire } = monter(() => vol);
    service.afficher(zone('a'));
    service.afficher(zone('a'));
    expect(lire).toHaveBeenCalledTimes(1);
    expect(service.enCours()).toBe('a');
    vol.next(entite('a'));
    vol.complete();
    expect(service.enCours()).toBeNull();
    service.afficher(zone('a'));
    expect(lire).toHaveBeenCalledTimes(1);
  });

  it('masquer → ses couches PUIS sa source retirées, `zonesAffichees` mis à jour', () => {
    const { service, carte } = monter();
    service.afficher(zone('a'));
    service.afficher(zone('b'));
    TestBed.tick();
    service.masquer('a');
    TestBed.tick();
    expect(sourcesZones(carte)).toEqual(['custom-zone-b']);
    expect(carte.retraits).toEqual(['couche:custom-zone-fill-a', 'couche:custom-zone-line-a', 'source:custom-zone-a']);
    expect(service.zonesAffichees()).toEqual([{ id: 'b', name: 'Zone b' }]);
  });

  it('« Tout effacer » → plus AUCUNE source `custom-zone-`, état vide (défaut React corrigé), lecture en vol abandonnée', () => {
    const vol = new Subject<EntiteZone>();
    let n = 0;
    const { service, carte, couches } = monter((id) => (n++ === 0 ? of(entite(id)) : vol));
    service.afficher(zone('a'));
    service.afficher(zone('b'));
    TestBed.tick();
    couches.toutEffacer();
    TestBed.tick();
    expect(sourcesZones(carte)).toEqual([]);
    expect(service.zonesAffichees()).toEqual([]);
    expect(service.enCours()).toBeNull();
    expect(vol.observed).toBe(false);
  });

  it('carte recréée par un changement de fond (B11) : les zones sont RE-POSÉES sur la nouvelle instance, sans nouvelle lecture', () => {
    const { service, couches, lire } = monter();
    service.afficher(zone('a'));
    service.afficher(zone('b'));
    TestBed.tick();
    couches.publier(null);
    TestBed.tick();
    const nouvelle = new CarteFactice();
    nouvelle.styleCharge = true;
    couches.publier(nouvelle as unknown as maplibregl.Map);
    TestBed.tick();
    expect(sourcesZones(nouvelle)).toEqual(['custom-zone-a', 'custom-zone-b']);
    expect(lire).toHaveBeenCalledTimes(2);
  });

  it('relire (recalcul d’une zone affichée) : forme et nom remplacés EN PLACE — teinte, rang et cadrage inchangés', () => {
    let version = 0;
    const { service, carte, lire } = monter((id) => of({
      ...entite(id),
      geometry: { type: 'Polygon' as const, coordinates: [[[1, 2], [3 + version, 2], [3 + version, 5], [1, 2]]] },
    }));
    service.afficher(zone('a', [4, 43, 5, 44]));
    service.afficher(zone('b'));
    service.afficher(zone('c'));
    TestBed.tick();
    const cadrages = carte.cadrages.length;
    const couleurs = [...service.couleurs()];
    version = 7;
    service.relire({ ...zone('a', [10, 40, 11, 41]), name: 'Zone a recalculée' });
    TestBed.tick();
    expect(lire).toHaveBeenCalledTimes(4);
    expect([...service.couleurs()]).toEqual(couleurs);
    expect(service.zonesAffichees()).toEqual([{ id: 'a', name: 'Zone a recalculée' }, { id: 'b', name: 'Zone b' }, { id: 'c', name: 'Zone c' }]);
    expect(carte.cadrages.length).toBe(cadrages);
    // La source existante reçoit la nouvelle forme ; ni retrait ni repose (l'empilement des couches ne bouge pas).
    expect(sourcesZones(carte)).toEqual(['custom-zone-a', 'custom-zone-b', 'custom-zone-c']);
    const envoye = carte.sources.get('custom-zone-a')!.donnees.at(-1) as GeoJSON.Feature;
    expect((envoye.geometry as GeoJSON.Polygon).coordinates[0][1]).toEqual([10, 2]);
    expect(envoye.properties).toMatchObject({ name: 'Zone a recalculée' });
  });

  it('relire une zone qui n’est pas affichée (ou masquée pendant la lecture) : rien', () => {
    const { service, lire } = monter();
    service.relire(zone('a'));
    expect(lire).not.toHaveBeenCalled();
    service.afficher(zone('a'));
    const vol = new Subject<EntiteZone>();
    lire.mockImplementationOnce(() => vol);
    service.relire(zone('a'));
    service.masquer('a');
    vol.next(entite('a'));
    expect(service.zonesAffichees()).toEqual([]);
  });

  it('géométrie en échec → « HTTP 404 », rien sur la carte', () => {
    const { service, carte } = monter(() => throwError(() => ({ status: 404 })));
    service.afficher(zone('a'));
    TestBed.tick();
    expect(service.erreur()).toBe('HTTP 404');
    expect(sourcesZones(carte)).toEqual([]);
    expect(service.enCours()).toBeNull();
  });
});
