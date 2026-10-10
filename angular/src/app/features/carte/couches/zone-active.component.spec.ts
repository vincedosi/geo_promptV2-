import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarteApi } from '../data/carte.api';
import { AnnonceService } from '../etat/annonce.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { PoisService } from './pois.service';
import { ZoneActiveComponent } from './zone-active.component';

describe('ZoneActiveComponent', () => {
  it('absent sans zone ; « ZONE_ACTIVE », le libellé de la zone, le rayon et le nombre de points', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(), PoisService, EtatCarteService, CouchesCarteService, AnnonceService,
        { provide: CarteApi, useValue: {} },
        { provide: CouleursService, useValue: { palette: () => signal({}) } },
      ],
    });
    const fixture = TestBed.createComponent(ZoneActiveComponent);
    const el = fixture.nativeElement as HTMLElement;
    const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
    await rendre();
    expect(el.querySelector('[data-zone-active]')).toBeNull();
    TestBed.inject(PoisService).definirZone({
      ville: 'Tous les panneaux OOH', rayon_metres: 2500, rayon_poi_metres: null, coordonnees: { lat: 0, lng: 0 }, pois: [],
      nb_pois: 1000, categories: { panneaux: 1000 },
    });
    await rendre();
    const badge = el.querySelector('[data-zone-active]')!;
    // Trois lignes, trois `<div>` (`MapPanel.tsx:158-167`) : lues une à une, le gabarit n'ayant aucun blanc entre elles.
    expect([...badge.children].map((l) => l.textContent!.replace(/\s+/g, ' ').trim()))
      .toEqual(['ZONE_ACTIVE', 'Tous les panneaux OOH', 'r=2.5km · 1000 POI']);
  });
});
