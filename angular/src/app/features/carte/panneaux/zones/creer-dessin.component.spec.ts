import { HttpResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { of } from 'rxjs';
import { CarteFactice } from '../../../../carte/testing/carte-factice';
import { AuthService } from '../../../../core/auth/auth.service';
import { CouleursService } from '../../../../core/theme/couleurs.service';
import { DessinService, SOURCE_DESSIN } from '../../couches/dessin.service';
import { ZonesCustomApi } from '../../data/zones-custom.api';
import { ZonesApi } from '../../data/zones.api';
import { AnnonceService } from '../../etat/annonce.service';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { CreationZoneService } from '../../etat/creation-zone.service';
import { PileEchapService } from '../../etat/pile-echap.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { CreerDessinComponent } from './creer-dessin.component';

const REPARE = { type: 'MultiPolygon', coordinates: [] };
const attendre = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function monter() {
  const api = {
    depuisDessin: vi.fn(() => of({ geometry: REPARE, surface_km2: 163.24, corrige: true, part_retenue: 1 })),
    enregistrer: vi.fn(() => of(new HttpResponse({ status: 200, body: { zone_id: 'z', count_cp: 12 } }))),
  };
  TestBed.configureTestingModule({
    providers: [
      CreationZoneService, DessinService, CouchesCarteService, EtatCarteService, AnnonceService, PileEchapService,
      { provide: ZonesCustomApi, useValue: api },
      // `enregistrer` est celui de `ZonesApi` (POST /api/zones, lot 3) : le même faux sert aux deux.
      { provide: ZonesApi, useValue: api },
      { provide: CouleursService, useValue: { palette: () => signal({ teal: '#4ecdc4' }) } },
      { provide: AuthService, useValue: { lireProfil: async () => ({ role: null, nom: null, organisation: 'org-1' }) } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  TestBed.inject(CouchesCarteService).publier(carte as unknown as maplibregl.Map);
  const fixture = TestBed.createComponent(CreerDessinComponent);
  const el = fixture.nativeElement as HTMLElement;
  const stable = async () => { for (let i = 0; i < 3; i++) { await attendre(); await fixture.whenStable(); } };
  return { fixture, el, api, stable, carte };
}

const bouton = (el: HTMLElement, sel: string) => el.querySelector<HTMLButtonElement>(sel)!;
const clic = (c: CarteFactice, x: number, y: number) => c.emettre('click', { lngLat: { lng: x, lat: y }, point: { x, y } });

/** Un nœud papillon : le tracé se croise lui-même, la base le répare (`corrige`). */
async function tracerPapillon(c: CarteFactice) {
  clic(c, 0, 0);
  clic(c, 100, 100);
  clic(c, 100, 0);
  clic(c, 0, 100);
  clic(c, 0, 100);
  c.emettre('dblclick', { preventDefault: () => undefined });
}

describe('CreerDessinComponent (CreerZoneDessin.tsx + DessinLibre.tsx)', () => {
  it('ouvrir l’outil démarre le dessin ; « Quitter le dessin » l’arrête et replie', async () => {
    const { el, carte, stable } = monter();
    await stable();
    bouton(el, '[data-repli]').click();
    await stable();
    expect(carte.sources.has(SOURCE_DESSIN)).toBe(true);
    expect([...el.querySelectorAll('[data-mode]')].map((b) => b.textContent!.trim())).toEqual(['Polygone', 'Rectangle']);
    expect(el.querySelector('[data-aide]')!.textContent!.trim()).toBe('Cliquez pour poser les sommets, double-clic pour fermer');
    expect(bouton(el, '[data-effacer]').disabled).toBe(true);
    bouton(el, '[data-quitter]').click();
    await stable();
    expect(carte.sources.has(SOURCE_DESSIN)).toBe(false);
    expect(el.querySelector('[data-mode]')).toBeNull();
  });

  it('« Créer la zone » reste inactif tant que le tracé n’est pas FERMÉ', async () => {
    const { el, carte, stable } = monter();
    await stable();
    bouton(el, '[data-repli]').click();
    await stable();
    clic(carte, 0, 0);
    clic(carte, 100, 0);
    clic(carte, 100, 100);
    await stable();
    expect(el.querySelector('[data-aide]')!.textContent!.trim()).toBe('3 sommets tracés');
    expect(bouton(el, '[data-creer]').disabled).toBe(true);
  });

  it('polygone croisé fermé → le tracé TEL QUEL à /source/dessin, « tracé réparé » dit, zone ÉCRITE, tracé effacé', async () => {
    const { el, carte, api, stable } = monter();
    await stable();
    bouton(el, '[data-repli]').click();
    await stable();
    await tracerPapillon(carte);
    await stable();
    bouton(el, '[data-creer]').click();
    await stable();
    expect(api.depuisDessin).toHaveBeenCalledWith({ type: 'Polygon', coordinates: [[[0, 0], [100, 100], [100, 0], [0, 100], [0, 0]]] });
    // Forme figée : la géométrie RÉPARÉE de la route source part avec la recette `dessin`.
    expect(api.enregistrer).toHaveBeenCalledWith({
      nom: `Tracé de ${(163.24).toLocaleString('fr-FR')} km²`, recette: { v: 1, type: 'dessin' }, geometrie: REPARE,
    });
    expect(el.querySelector('[data-message]')!.textContent).toContain('tracé réparé (il se croisait lui-même)');
    expect(bouton(el, '[data-creer]').disabled).toBe(true);
    expect(el.querySelector('[data-aide]')!.textContent!.trim()).toBe('Cliquez pour poser les sommets, double-clic pour fermer');
  });

  it('le panneau se ferme (composant détruit) : le dessin s’arrête, la carte est rendue', async () => {
    const { fixture, el, carte, stable } = monter();
    await stable();
    bouton(el, '[data-repli]').click();
    await stable();
    fixture.destroy();
    TestBed.tick();
    expect(carte.sources.has(SOURCE_DESSIN)).toBe(false);
    expect(TestBed.inject(EtatCarteService).carteOccupee()).toBe(false);
  });
});
