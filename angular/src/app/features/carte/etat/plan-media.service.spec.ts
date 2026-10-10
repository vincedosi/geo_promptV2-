import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { ZonesCustomService } from '../couches/zones-custom.service';
import { ZonesCustomApi } from '../data/zones-custom.api';
import { PlanMediaService } from './plan-media.service';

const attendre = () => new Promise((r) => setTimeout(r, 0));

function preparer(api: Partial<Record<keyof ZonesCustomApi, unknown>> = {}) {
  const zones = signal<{ id: string; name: string }[]>([]);
  const appels = {
    totaux: vi.fn(() => of({ totals: { total: 68_000_000 } })),
    items: vi.fn((id: string) => of(id === 'bataille'
      ? { items: [{ poi_id: 'p1', poi_name: 'CIRFA Rennes', values: { total: 10 } }, { poi_id: 'p2', poi_name: 'CIRFA Brest', values: { total: 30 } }] }
      : { items: null })),
    zone: vi.fn(() => of({ audience_stats: { population: { total: 500, by_age: {} } } })),
  };
  TestBed.configureTestingModule({
    providers: [
      PlanMediaService,
      { provide: ZonesCustomService, useValue: { zonesAffichees: zones } },
      { provide: ZonesCustomApi, useValue: { totauxNationaux: appels.totaux, audienceItems: appels.items, zone: appels.zone, ...api } },
    ],
  });
  const service = TestBed.inject(PlanMediaService);
  const stable = async () => { await attendre(); TestBed.tick(); await attendre(); };
  return { service, zones, appels, stable };
}

describe('PlanMediaService — ouverture du panneau (page.tsx:274-280)', () => {
  it('première zone affichée → ouvert ; fermé par la croix, il RESTE fermé quand une 2e zone arrive ; zéro zone → fermé', async () => {
    const { service, zones, stable } = preparer();
    await stable();
    expect(service.visible()).toBe(false);

    zones.set([{ id: 'a', name: 'A' }]);
    await stable();
    expect(service.visible()).toBe(true);

    service.ouvert.set(false);
    zones.set([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    await stable();
    expect(service.visible()).toBe(false);
    service.ouvert.set(true);
    expect(service.visible()).toBe(true);

    zones.set([]);
    await stable();
    expect(service.visible()).toBe(false);
    expect(service.ouvert()).toBe(false);

    zones.set([{ id: 'c', name: 'C' }]);
    await stable();
    expect(service.visible()).toBe(true);
  });
});

describe('PlanMediaService — audiences et totaux', () => {
  it('les totaux nationaux sont lus UNE fois, même panneau fermé puis rouvert', async () => {
    const { service, zones, appels, stable } = preparer();
    zones.set([{ id: 'a', name: 'A' }]);
    await stable();
    service.ouvert.set(false);
    await stable();
    service.ouvert.set(true);
    await stable();
    expect(appels.totaux).toHaveBeenCalledTimes(1);
    expect(service.totaux()).toEqual({ total: 68_000_000 });
  });

  it('une ligne par item (zone de bataille), repli sur la zone entière sinon, dans l’ordre d’affichage', async () => {
    const { service, zones, appels, stable } = preparer();
    zones.set([{ id: 'bataille', name: 'CIRFA BRETAGNE' }, { id: 'seuil', name: 'Revenu' }]);
    await stable();
    expect(service.lignes()).toEqual([
      { id: 'bataille:p1', name: 'CIRFA Rennes', values: { total: 10 } },
      { id: 'bataille:p2', name: 'CIRFA Brest', values: { total: 30 } },
      expect.objectContaining({ id: 'seuil', name: 'Revenu', values: expect.objectContaining({ total: 500 }) }),
    ]);
    expect(appels.zone).toHaveBeenCalledTimes(1);
    expect(appels.zone).toHaveBeenCalledWith('seuil');
    expect(service.chargement()).toBe(false);
  });

  it('cache par zone : ajouter une zone ne relit QUE la nouvelle ; en retirer une ne relit rien', async () => {
    const { service, zones, appels, stable } = preparer();
    zones.set([{ id: 'bataille', name: 'B' }]);
    await stable();
    zones.set([{ id: 'bataille', name: 'B' }, { id: 'seuil', name: 'S' }]);
    await stable();
    expect(appels.items.mock.calls.map((c) => c[0])).toEqual(['bataille', 'seuil']);
    zones.set([{ id: 'seuil', name: 'S' }]);
    await stable();
    expect(appels.items).toHaveBeenCalledTimes(2);
    expect(service.lignes().map((l) => l.id)).toEqual(['seuil']);
  });

  it('panneau fermé : aucune lecture d’audience ; « Chargement des audiences… » pendant une lecture', async () => {
    const reponse = new Subject<{ items: null }>();
    const { service, zones, appels, stable } = preparer({ audienceItems: vi.fn(() => reponse) });
    zones.set([{ id: 'a', name: 'A' }]);
    await stable();
    expect(service.chargement()).toBe(true);
    reponse.next({ items: null });
    reponse.complete();
    await stable();
    expect(service.chargement()).toBe(false);

    service.ouvert.set(false);
    zones.set([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    await stable();
    expect(appels.zone).toHaveBeenCalledTimes(1);
  });

  it('une audience illisible donne une ligne sans valeur (« n/d »), jamais une ligne perdue', async () => {
    const { service, zones, stable } = preparer({
      audienceItems: vi.fn(() => throwError(() => new Error('500'))),
      zone: vi.fn(() => throwError(() => new Error('404'))),
    });
    zones.set([{ id: 'a', name: 'A' }]);
    await stable();
    expect(service.lignes()).toEqual([{ id: 'a', name: 'A', values: null }]);
  });
});
