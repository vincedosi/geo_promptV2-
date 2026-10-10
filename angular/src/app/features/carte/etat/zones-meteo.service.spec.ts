import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { CiviqueApi } from '../data/civique.api';
import type { MeteoScale } from '../logique/meteo/types';
import { ZonesMeteoService } from './zones-meteo.service';

function monter() {
  const demandes: MeteoScale[] = [];
  const reponses: Subject<GeoJSON.FeatureCollection>[] = [];
  TestBed.configureTestingModule({
    providers: [
      ZonesMeteoService,
      {
        provide: CiviqueApi,
        useValue: {
          zones: (e: MeteoScale) => { demandes.push(e); const s = new Subject<GeoJSON.FeatureCollection>(); reponses.push(s); return s; },
        },
      },
    ],
  });
  return { zones: TestBed.inject(ZonesMeteoService), demandes, reponses };
}

const fc = (code: string): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { code } }],
});

describe('ZonesMeteoService', () => {
  it('une lecture par échelle : deux abonnés (santé, météo) partagent la même requête, même EN VOL', () => {
    const { zones, demandes, reponses } = monter();
    const a: GeoJSON.FeatureCollection[] = [];
    const b: GeoJSON.FeatureCollection[] = [];
    zones.zones('departement').subscribe((z) => a.push(z));
    zones.zones('departement').subscribe((z) => b.push(z));
    expect(demandes).toEqual(['departement']);
    reponses[0].next(fc('13'));
    reponses[0].complete();
    const c: GeoJSON.FeatureCollection[] = [];
    zones.zones('departement').subscribe((z) => c.push(z));
    expect(demandes).toEqual(['departement']);
    expect([a.length, b.length, c.length]).toEqual([1, 1, 1]);
    expect(c[0].features[0].properties?.['code']).toBe('13');
  });

  it('une échelle différente : une autre lecture (région, département, code postal)', () => {
    const { zones, demandes } = monter();
    zones.zones('region').subscribe();
    zones.zones('cp').subscribe();
    zones.zones('departement').subscribe();
    expect(demandes).toEqual(['region', 'cp', 'departement']);
  });

  it('un échec n’est pas mis en cache : l’appel suivant relit', () => {
    const { zones, demandes, reponses } = monter();
    let erreur = false;
    zones.zones('cp').subscribe({ error: () => { erreur = true; } });
    reponses[0].error(new Error('500'));
    expect(erreur).toBe(true);
    zones.zones('cp').subscribe();
    expect(demandes).toEqual(['cp', 'cp']);
  });
});
