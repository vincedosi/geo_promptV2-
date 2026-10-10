import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { Subject } from 'rxjs';
import type { Bbox } from '../../../../carte/bbox';
import { CarteFactice } from '../../../../carte/testing/carte-factice';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { PoisService } from '../../couches/pois.service';
import { TransportService } from '../../couches/transport.service';
import { CarteApi, type ZoneData } from '../../data/carte.api';
import { AnnonceService } from '../../etat/annonce.service';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { SectionTransportComponent } from './section-transport.component';
import { SelectionsCalquesService } from './selections-calques.service';

function monter() {
  const appels: { b: Bbox; types: readonly string[] }[] = [];
  const reponses = new Subject<ZoneData>();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), TransportService, PoisService, SelectionsCalquesService, EtatCarteService,
      CouchesCarteService, AnnonceService,
      { provide: CarteApi, useValue: { transport: (b: Bbox, types: readonly string[]) => { appels.push({ b, types }); return reponses; } } },
      { provide: CouleursService, useValue: { palette: () => signal({}) } },
    ],
  });
  TestBed.inject(CouchesCarteService).publier(new CarteFactice() as unknown as maplibregl.Map);
  const fixture = TestBed.createComponent(SectionTransportComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return { el, rendre, appels, reponses, selections: TestBed.inject(SelectionsCalquesService) };
}

describe('SectionTransportComponent', () => {
  it('repliée par défaut ; ouverte : quatre pastilles, « Tous les types · Chargé pour la zone visible »', async () => {
    const { el, rendre, selections } = monter();
    await rendre();
    expect(el.textContent).toContain('Arrêts de transport en commun');
    expect(el.querySelector('[data-contenu-transport]')).toBeNull();
    selections.basculerSection('transport');
    await rendre();
    expect([...el.querySelectorAll('[data-type]')].map((b) => b.textContent!.trim())).toEqual(['Bus', 'Train', 'Tramway', 'Métro']);
    expect(el.textContent).toContain('Tous les types · Chargé pour la zone visible');
  });

  it('pastilles bascule ; « Afficher arrêts » charge la carte visible avec les types ; « Chargement... » pendant', async () => {
    const { el, rendre, selections, appels, reponses } = monter();
    selections.basculerSection('transport');
    await rendre();
    (el.querySelector('[data-type="bus"]') as HTMLButtonElement).click();
    (el.querySelector('[data-type="tram"]') as HTMLButtonElement).click();
    await rendre();
    expect(el.textContent).toContain('Type de transport — bus, tram');
    expect(el.querySelector('[data-type="bus"]')!.getAttribute('aria-pressed')).toBe('true');
    (el.querySelector('[data-afficher-transport]') as HTMLButtonElement).click();
    await rendre();
    expect(appels[0].types).toEqual(['bus', 'tram']);
    expect(el.querySelector('[data-afficher-transport]')!.textContent).toContain('Chargement...');
    reponses.next({ pois: [] } as unknown as ZoneData);
    await rendre();
    expect(el.querySelector('[data-afficher-transport]')!.textContent).toContain('Afficher arrêts');
    (el.querySelector('[data-tout-deselectionner]') as HTMLButtonElement).click();
    expect(selections.typesTransport()).toEqual([]);
  });
});
