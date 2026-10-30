import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { CarteFactice } from '../../../carte/testing/carte-factice';
import { AuthService } from '../../../core/auth/auth.service';
import { ENREGISTRER_FICHIER } from '../../../core/http/telecharger';
import { ZonesCustomService } from '../couches/zones-custom.service';
import { type ZoneCustomResume, ZonesCustomApi } from '../data/zones-custom.api';
import { ZonesApi } from '../data/zones.api';
import { AnalysesApi } from '../data/analyses.api';
import { CatalogueIndicateursService } from '../etat/catalogue-indicateurs.service';
import { CouchesCarteService } from '../etat/couches-carte.service';
import { ExportZoneService } from '../etat/export-zone.service';
import { MesZonesComponent } from '../panneaux/zones/mes-zones.component';

/**
 * Le montage de « Mes zones » partagé par ses specs (`mes-zones.component.spec.ts`, et « Dupliquer » dans
 * `mes-zones-dupliquer.component.spec.ts` — scindé à la relecture 2 des finitions de ③ pour tenir sous 400 lignes).
 */
export const zone = (id: string, nom: string, source_type = 'composite'): ZoneCustomResume => ({
  id, name: nom, description: null, source_type, source_metadata: {}, feature_count_iris: 12, feature_count_cp: 4,
  bbox: [1, 2, 3, 4], created_at: '2026-09-03T10:00:00Z', created_by: null, dept_codes: ['29', '56'], region_codes: ['53'],
});
export const ZONES = [zone('a', 'CIRFA BRETAGNE', 'admin_filter'), zone('b', 'Cible composite (2 zones)')];

export const attendre = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export const RECETTES: ZoneCustomResume[] = [
  { ...zone('z1', 'Lycées Gironde', 'recette_rayon_poi'), recette: { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: { type: 'departement', code: '33' } } },
  { ...zone('z2', 'Dessin', 'recette_dessin'), recette: { v: 1, type: 'dessin' } },
];

export function monter(o: {
  organisation?: string | null; zones?: ZoneCustomResume[]; recalculer?: unknown; dupliquer?: unknown; indicateurs?: unknown;
  api?: Partial<Record<keyof ZonesCustomApi, unknown>>;
} = {}) {
  const base = {
    lister: vi.fn(() => of({ zones: o.zones ?? ZONES })),
    stats: vi.fn(() => of({ total: 7, total_iris: 1234, total_cp: 56 })),
    geometrie: vi.fn(() => of({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[1, 2], [3, 4], [1, 2]]] }, properties: { id: 'a' } })),
    supprimer: vi.fn(() => of({ deleted: true, id: 'a' })),
    exporter: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404, error: { error: 'zone_not_found' } }))),
  };
  TestBed.configureTestingModule({
    providers: [
      ZonesCustomService, CouchesCarteService, ExportZoneService,
      // Fourni par la PAGE carte (lot 3, X4) : le test tient le rôle de la page.
      CatalogueIndicateursService,
      { provide: ZonesCustomApi, useValue: { ...base, ...o.api } },
      // Les opérations écrivent par `ZonesApi` (recette `combinaison`, lot 3).
      { provide: ZonesApi, useValue: { recalculer: o.recalculer ?? vi.fn(), dupliquer: o.dupliquer ?? vi.fn() } },
      { provide: AnalysesApi, useValue: { indicateurs: o.indicateurs ?? vi.fn(() => of({ indicators: [] })) } },
      { provide: ENREGISTRER_FICHIER, useValue: vi.fn() },
      { provide: AuthService, useValue: { lireProfil: async () => ({ role: null, nom: null, organisation: o.organisation === undefined ? 'org-1' : o.organisation }) } },
    ],
  });
  const carte = new CarteFactice();
  carte.styleCharge = true;
  TestBed.inject(CouchesCarteService).publier(carte as unknown as maplibregl.Map);
  const fixture = TestBed.createComponent(MesZonesComponent);
  const el = fixture.nativeElement as HTMLElement;
  const stable = async (ms = 0) => {
    for (let i = 0; i < 3; i++) { await attendre(ms); await fixture.whenStable(); }
  };
  return { fixture, el, api: base, stable, carte };
}

export const cartes = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('mg-carte-zone')];
