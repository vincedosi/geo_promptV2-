import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { of, throwError } from 'rxjs';
import { CarteFactice } from '../../../../carte/testing/carte-factice';
import { AuthService } from '../../../../core/auth/auth.service';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { SOURCE_APERCU_RAYON } from '../../couches/apercu-rayon';
import { ZonesCustomApi } from '../../data/zones-custom.api';
import { AnnonceService } from '../../etat/annonce.service';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { CreationZoneService } from '../../etat/creation-zone.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { CreerRayonComponent } from './creer-rayon.component';

const GEOMETRIE = { type: 'MultiPolygon', coordinates: [] };
const attendre = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function monter(api: Partial<Record<keyof ZonesCustomApi, unknown>> = {}) {
  const base = {
    depuisRayon: vi.fn(() => of({ geometry: GEOMETRIE, surface_km2: 760.4, part_retenue: 0.605 })),
    enregistrer: vi.fn(() => of(new HttpResponse({ status: 200, body: { zone_id: 'z', count_cp: 120 } }))),
    ...api,
  };
  TestBed.configureTestingModule({
    providers: [
      CreationZoneService, CouchesCarteService, EtatCarteService, AnnonceService,
      { provide: ZonesCustomApi, useValue: base },
      { provide: CouleursService, useValue: { palette: () => signal({ teal: '#4ecdc4' }) } },
      { provide: AuthService, useValue: { lireProfil: async () => ({ role: null, nom: null, organisation: 'org-1' }) } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  TestBed.inject(CouchesCarteService).publier(carte as unknown as maplibregl.Map);
  const fixture = TestBed.createComponent(CreerRayonComponent);
  const el = fixture.nativeElement as HTMLElement;
  const stable = async () => { for (let i = 0; i < 3; i++) { await attendre(); await fixture.whenStable(); } };
  return { fixture, el, api: base, stable, carte, etat: TestBed.inject(EtatCarteService) };
}

const bouton = (el: HTMLElement, sel: string) => el.querySelector<HTMLButtonElement>(sel)!;

async function poserMarseille(el: HTMLElement, carte: CarteFactice, stable: () => Promise<void>) {
  await stable();
  bouton(el, '[data-repli]').click();
  await stable();
  bouton(el, '[data-poser]').click();
  await stable();
  carte.emettre('click', { lngLat: { lng: 5.3698, lat: 43.2965 }, point: { x: 0, y: 0 } });
  await stable();
}

describe('CreerRayonComponent (CreerZoneRayon.tsx)', () => {
  it('poser le centre : viseur, carte PRISE (le clic ne ferme pas le panneau), puis coordonnées affichées', async () => {
    const { el, carte, stable, etat } = monter();
    await stable();
    bouton(el, '[data-repli]').click();
    await stable();
    expect(bouton(el, '[data-poser]').textContent!.trim()).toBe('Poser le centre sur la carte');
    bouton(el, '[data-poser]').click();
    await stable();
    expect(carte.getCanvas().style.cursor).toBe('crosshair');
    expect(etat.carteOccupee()).toBe(true);
    expect(bouton(el, '[data-poser]').textContent!.trim()).toBe('Cliquez sur la carte…');
    carte.emettre('click', { lngLat: { lng: 5.3698, lat: 43.2965 }, point: { x: 0, y: 0 } });
    await stable();
    expect(el.querySelector('[data-centre]')!.textContent!.trim()).toBe('43.2965, 5.3698');
    expect(carte.getCanvas().style.cursor).toBe('');
    expect(etat.carteOccupee()).toBe(false);
    expect(bouton(el, '[data-poser]').textContent!.trim()).toBe('Déplacer le centre');
  });

  it('aperçu LOCAL du cercle (aucune requête) ; le curseur le redessine', async () => {
    const { el, carte, api, stable } = monter();
    await poserMarseille(el, carte, stable);
    expect(carte.sources.has(SOURCE_APERCU_RAYON)).toBe(true);
    const curseur = el.querySelector<HTMLInputElement>('input[type=range]')!;
    expect([curseur.min, curseur.max, curseur.step, curseur.value]).toEqual(['500', '100000', '500', '10000']);
    curseur.value = '20000';
    curseur.dispatchEvent(new Event('input'));
    await stable();
    expect(el.querySelector('[data-rayon]')!.textContent!.trim()).toBe('20 km');
    expect(api.depuisRayon).not.toHaveBeenCalled();
  });

  it('Marseille 20 km → { lon, lat, rayon_m: 20000 } ; la part retenue est dite (61 % du cercle) et la zone ÉCRITE', async () => {
    const { el, carte, api, stable } = monter();
    await poserMarseille(el, carte, stable);
    const curseur = el.querySelector<HTMLInputElement>('input[type=range]')!;
    curseur.value = '20000';
    curseur.dispatchEvent(new Event('input'));
    await stable();
    bouton(el, '[data-creer]').click();
    await stable();
    expect(api.depuisRayon).toHaveBeenCalledWith({ lon: 5.3698, lat: 43.2965, rayon_m: 20000 });
    expect(api.enregistrer).toHaveBeenCalledWith({
      name: 'Rayon de 20 km', source_type: 'rayon',
      source_metadata: { rayon_m: 20000, centre: { lon: 5.3698, lat: 43.2965 }, surface_km2: 760.4, part_retenue: 0.605 },
      geometry: GEOMETRIE, org_id: 'org-1',
    });
    expect(el.querySelector('[data-message]')!.textContent).toContain('61 % du cercle retenus (le reste est hors territoire)');
    // Centre oublié : l'aperçu disparaît, le bouton repart à « Poser le centre ».
    expect(carte.sources.has(SOURCE_APERCU_RAYON)).toBe(false);
  });

  it('centre en mer (409) : le message de la route, rien d’enregistré', async () => {
    const { el, carte, api, stable } = monter({
      depuisRayon: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'rayon_vide', message: 'Ce rayon ne recouvre aucun territoire français — le centre est-il en mer ?' } }))),
    });
    await poserMarseille(el, carte, stable);
    bouton(el, '[data-creer]').click();
    await stable();
    expect(el.querySelector('[data-erreur]')!.textContent!.trim()).toBe('Ce rayon ne recouvre aucun territoire français — le centre est-il en mer ?');
    expect(api.enregistrer).not.toHaveBeenCalled();
  });

  it('replier l’outil retire l’aperçu et rend la carte', async () => {
    const { el, carte, stable, etat } = monter();
    await poserMarseille(el, carte, stable);
    bouton(el, '[data-poser]').click();
    await stable();
    bouton(el, '[data-repli]').click();
    await stable();
    expect(carte.sources.has(SOURCE_APERCU_RAYON)).toBe(false);
    expect(etat.carteOccupee()).toBe(false);
    expect(carte.getCanvas().style.cursor).toBe('');
  });

  it('un clic sur la carte HORS pose ne déplace pas le centre ; la pose prend la carte DANS le geste (pas après un rendu)', async () => {
    const { el, carte, stable, etat } = monter();
    await poserMarseille(el, carte, stable);
    carte.emettre('click', { lngLat: { lng: 2.35, lat: 48.85 }, point: { x: 0, y: 0 } });
    await stable();
    expect(el.querySelector('[data-centre]')!.textContent!.trim()).toBe('43.2965, 5.3698');
    bouton(el, '[data-poser]').click();
    expect(etat.carteOccupee()).toBe(true);
    // Clic immédiat, sans attendre de rendu : il est pris.
    carte.emettre('click', { lngLat: { lng: 5.37, lat: 43.3 }, point: { x: 0, y: 0 } });
    await stable();
    expect(el.querySelector('[data-centre]')!.textContent!.trim()).toBe('43.3000, 5.3700');
  });
});
