import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { FABRIQUE_MARQUEUR, FABRIQUE_POPUP } from '../../../carte/fabrique-carte';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { ConfigService } from '../../../core/config/config.service';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarteApi, type ZoneData } from '../data/carte.api';
import { AnnonceService } from '../etat/annonce.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { COUCHE_POIS_CERCLES } from './couche-pois';
import { PoisService } from './pois.service';
import { TiroirPanneauComponent, VARIABLE_CLE_GOOGLE, adresseStreetView } from './tiroir-panneau.component';

function monter(googleMapsKey?: string) {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), PoisService, EtatCarteService, CouchesCarteService, AnnonceService,
      { provide: CarteApi, useValue: {} },
      { provide: ConfigService, useValue: { valeur: { supabaseUrl: '', supabaseAnonKey: '', apiBaseUrl: '', ...(googleMapsKey ? { googleMapsKey } : {}) } } },
      { provide: CouleursService, useValue: { palette: () => signal({ contour: '#ffffff', teal: '#4ecdc4', 'brand-teal': '#4ecdc4' }) } },
      { provide: FABRIQUE_MARQUEUR, useValue: () => ({ setLngLat() { return this; }, setPopup() { return this; }, addTo() { return this; }, remove() { return this; } }) },
      { provide: FABRIQUE_POPUP, useValue: () => ({ setLngLat() { return this; }, setDOMContent() { return this; }, addTo() { return this; }, remove() { return this; } }) },
    ],
  });
  const fixture = TestBed.createComponent(TiroirPanneauComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return { el, rendre, pois: TestBed.inject(PoisService), couches: TestBed.inject(CouchesCarteService) };
}

/** 1 434 panneaux : la nappe et les cercles GPU (au-delà de 500), comme les panneaux OOH de React. */
const oohZone = (): ZoneData => ({
  ville: 'Tous les panneaux OOH', rayon_metres: null, rayon_poi_metres: null, coordonnees: { lat: 48.4, lng: -4.5 },
  pois: Array.from({ length: 1434 }, (_, i) => ({ id: `o${i}`, nom: 'DECAUX — 4x3', lat: 48.4, lng: -4.5, categorie: 'panneaux' })),
  nb_pois: 1434, categories: { panneaux: 1434 },
});

describe('TiroirPanneauComponent', () => {
  it('fermé tant qu’aucun panneau n’est cliqué', async () => {
    const { el, rendre } = monter();
    await rendre();
    expect(el.querySelector('[data-tiroir-panneau]')).toBeNull();
  });

  it('clic sur un panneau OOH (cercle GPU) → tiroir ouvert ; SANS clé → le bandeau qui nomme la variable, aucun iframe', async () => {
    const { el, rendre, pois, couches } = monter();
    const carte = new CarteFactice();
    carte.styleCharge = true;
    couches.publier(carte as unknown as maplibregl.Map);
    pois.definirZone(oohZone());
    TestBed.tick();
    carte.emettreSurCouche('click', COUCHE_POIS_CERCLES, {
      lngLat: { lat: 48.4, lng: -4.5 }, features: [{ properties: { id: 'o7', nom: 'DECAUX — 4x3', categorie: 'panneaux', lat: 48.4, lng: -4.5 } }],
    });
    await rendre();
    const tiroir = el.querySelector('[data-tiroir-panneau]')!;
    expect(tiroir.textContent).toContain('STREET_VIEW');
    expect(el.querySelector('[data-infos]')!.textContent).toContain('o7');
    expect(el.querySelector('[data-infos]')!.textContent).toContain('AUD —');
    expect(el.querySelector('[data-cle-manquante]')!.textContent).toContain(`${VARIABLE_CLE_GOOGLE} manquante.`);
    expect(el.querySelector('iframe')).toBeNull();
    (el.querySelector('[data-fermer]') as HTMLButtonElement).click();
    await rendre();
    expect(pois.panneauSelectionne()).toBeNull();
    expect(el.querySelector('[data-tiroir-panneau]')).toBeNull();
  });

  it('AVEC clé → l’iframe Street View du point, audience au format fr-FR', async () => {
    const { el, rendre, pois } = monter('cle-test');
    pois.panneauSelectionne.set({ id: 'p', nom: 'Panneau', lat: 43.3, lng: 5.4, audience: 12345 });
    await rendre();
    const iframe = el.querySelector('iframe[data-street-view]') as HTMLIFrameElement;
    expect(iframe.src).toBe(adresseStreetView('cle-test', 43.3, 5.4));
    expect(el.querySelector('[data-cle-manquante]')).toBeNull();
    expect(el.querySelector('[data-infos]')!.textContent).toContain((12345).toLocaleString('fr-FR'));
  });
});
