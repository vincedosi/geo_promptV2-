import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { Subject } from 'rxjs';
import type { Bbox } from '../../../carte/bbox';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarteApi, type ZoneData } from '../data/carte.api';
import { AnnonceService } from '../etat/annonce.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { PoisService } from './pois.service';
import { TransportService, mentionArretsTronques } from './transport.service';

function monter() {
  const appels: { b: Bbox; types: readonly string[] }[] = [];
  const reponses = new Subject<ZoneData>();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), TransportService, PoisService, EtatCarteService, CouchesCarteService, AnnonceService,
      { provide: CarteApi, useValue: { transport: (b: Bbox, types: readonly string[]) => { appels.push({ b, types }); return reponses; } } },
      { provide: CouleursService, useValue: { palette: () => signal({}) } },
    ],
  });
  return {
    transport: TestBed.inject(TransportService), pois: TestBed.inject(PoisService), couches: TestBed.inject(CouchesCarteService),
    appels, reponses,
  };
}

describe('TransportService', () => {
  it('sans carte : rien ne part', () => {
    const { transport, appels } = monter();
    transport.charger(['bus']);
    expect(appels).toEqual([]);
  });

  it('la bbox de la carte VISIBLE (jamais la France), les types choisis ; la réponse devient la zone', () => {
    const { transport, pois, couches, appels, reponses } = monter();
    const carte = new CarteFactice();
    carte.cadre = [5.3, 43.2, 5.5, 43.4];
    couches.publier(carte as unknown as maplibregl.Map);
    transport.charger(['bus', 'tram']);
    expect(appels).toEqual([{ b: [5.3, 43.2, 5.5, 43.4], types: ['bus', 'tram'] }]);
    const z = { ville: 'Zone visible', pois: [], categories: { arret_transport: 0 } } as unknown as ZoneData;
    reponses.next(z);
    expect(pois.zone()).toBe(z);
    expect(transport.chargement()).toBe(false);
  });

  it('un échec est DIT (React le taisait) et la zone précédente reste', () => {
    const { transport, pois, couches, reponses } = monter();
    couches.publier(new CarteFactice() as unknown as maplibregl.Map);
    const avant = { pois: [] } as unknown as ZoneData;
    pois.definirZone(avant);
    transport.charger([]);
    reponses.error(new HttpErrorResponse({ status: 500, error: { error: 'Paramètres bbox invalides' } }));
    expect(transport.erreur()).toBe('Paramètres bbox invalides');
    expect(pois.zone()).toBe(avant);
  });
});

describe('mentionArretsTronques (revue finale I-2b : `tronque` lu, défaut React corrigé)', () => {
  const zone = (z: Partial<ZoneData>) => ({ categorie_poi: 'arret_transport', nb_pois: 5000, ...z }) as ZoneData;

  it('liste coupée par la route : le nombre affiché, formaté fr-FR, et la consigne', () => {
    expect(mentionArretsTronques(zone({ tronque: true }))!.replace(/\s/g, ' '))
      .toBe('5 000 arrêts affichés, liste tronquée — zoomez pour tout voir');
  });

  it('liste complète, champ absent, autre zone que des arrêts, ou aucune zone : rien', () => {
    expect(mentionArretsTronques(zone({ tronque: false }))).toBeNull();
    expect(mentionArretsTronques(zone({}))).toBeNull();
    expect(mentionArretsTronques(zone({ tronque: true, categorie_poi: 'lycee' }))).toBeNull();
    expect(mentionArretsTronques(null)).toBeNull();
  });
});
