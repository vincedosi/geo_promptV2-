import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarteApi, type CorpsOoh, type ZoneData } from '../data/carte.api';
import { AnnonceService } from '../etat/annonce.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { BBOX_METRO } from '../logique/filtre';
import { OohService } from './ooh.service';
import { PoisService } from './pois.service';

function monter() {
  const corps: CorpsOoh[] = [];
  const reponses = new Subject<ZoneData>();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), OohService, PoisService, EtatCarteService, CouchesCarteService, AnnonceService,
      { provide: CarteApi, useValue: { ooh: (c: CorpsOoh) => { corps.push(c); return reponses; } } },
      { provide: CouleursService, useValue: { palette: () => signal({}) } },
    ],
  });
  return { ooh: TestBed.inject(OohService), pois: TestBed.inject(PoisService), etat: TestBed.inject(EtatCarteService), corps, reponses };
}

const panneaux: ZoneData = {
  ville: 'Tous les panneaux OOH', rayon_metres: null, rayon_poi_metres: null, coordonnees: { lat: 48.4, lng: -4.5 },
  pois: [{ id: 'a', nom: 'DECAUX — 4x3', lat: 48.4, lng: -4.5, categorie: 'panneaux' }], nb_pois: 1, categories: { panneaux: 1 },
};

describe('OohService', () => {
  it('sans régie ni filtre : { regies: [] }, AUCUNE bbox ; la réponse devient la zone partagée', () => {
    const { ooh, pois, corps, reponses } = monter();
    ooh.charger();
    expect(corps[0]).toEqual({ regies: [] });
    expect(ooh.chargement()).toBe(true);
    reponses.next(panneaux);
    expect(pois.zone()).toBe(panneaux);
    expect(ooh.chargement()).toBe(false);
  });

  it('régies choisies + filtre département → les régies et BBOX_METRO', () => {
    const { ooh, etat, corps } = monter();
    etat.filtre.set({ type: 'departement', code: '29', label: 'Finistère' });
    ooh.charger(['DECAUX']);
    expect(corps[0]).toEqual({ regies: ['DECAUX'], bbox: BBOX_METRO });
  });

  it('la zone précédente est vidée au lancement ; 404 « Aucun panneau trouvé » est dit', () => {
    const { ooh, pois, reponses } = monter();
    pois.definirZone(panneaux);
    ooh.charger();
    expect(pois.zone()).toBeNull();
    reponses.error(new HttpErrorResponse({ status: 404, error: { error: 'Aucun panneau trouvé' } }));
    expect(ooh.erreur()).toBe('Aucun panneau trouvé');
  });
});
