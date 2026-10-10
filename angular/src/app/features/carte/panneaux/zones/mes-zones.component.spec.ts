import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type maplibregl from 'maplibre-gl';
import { of, throwError } from 'rxjs';
import { CarteFactice } from '../../../../carte/testing/carte-factice';
import { AuthService } from '../../../../core/auth/auth.service';
import { ENREGISTRER_FICHIER } from '../../../../core/http/telecharger';
import { ZonesCustomService } from '../../couches/zones-custom.service';
import { type ZoneCustomResume, ZonesCustomApi } from '../../data/zones-custom.api';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { ExportZoneService } from '../../etat/export-zone.service';
import { MesZonesComponent } from './mes-zones.component';

const zone = (id: string, nom: string, source_type = 'composite'): ZoneCustomResume => ({
  id, name: nom, description: null, source_type, source_metadata: {}, feature_count_iris: 12, feature_count_cp: 4,
  bbox: [1, 2, 3, 4], created_at: '2026-09-03T10:00:00Z', created_by: null, dept_codes: ['29', '56'], region_codes: ['53'],
});
const ZONES = [zone('a', 'CIRFA BRETAGNE', 'admin_filter'), zone('b', 'Cible composite (2 zones)')];

const attendre = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function monter(o: { organisation?: string | null; api?: Partial<Record<keyof ZonesCustomApi, unknown>> } = {}) {
  const base = {
    lister: vi.fn(() => of({ zones: ZONES })),
    stats: vi.fn(() => of({ total: 7, total_iris: 1234, total_cp: 56 })),
    geometrie: vi.fn(() => of({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[1, 2], [3, 4], [1, 2]]] }, properties: { id: 'a' } })),
    supprimer: vi.fn(() => of({ deleted: true, id: 'a' })),
    exporter: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404, error: { error: 'zone_not_found' } }))),
  };
  TestBed.configureTestingModule({
    providers: [
      ZonesCustomService, CouchesCarteService, ExportZoneService,
      { provide: ZonesCustomApi, useValue: { ...base, ...o.api } },
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

const cartes = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('mg-carte-zone')];

describe('MesZonesComponent (ZonesOverlay.tsx, T14)', () => {
  it('sans organisation active : « Aucun workspace actif. », aucune requête', async () => {
    const { el, api, stable } = await monter({ organisation: null });
    await stable();
    expect(el.textContent).toContain('Aucun workspace actif.');
    expect(api.lister).not.toHaveBeenCalled();
  });

  it('liste ET chiffres lus ensemble avec l’organisation et un horodatage ; chiffres, cartes et puces rendus comme React', async () => {
    const { el, api, stable } = await monter();
    await stable();
    expect(api.lister).toHaveBeenCalledTimes(1);
    const params = (api.lister.mock.calls[0] as unknown as [URLSearchParams])[0];
    expect([...params.keys()]).toEqual(['org_id', '_t']);
    expect(params.get('org_id')).toBe('org-1');
    expect(api.stats).toHaveBeenCalledWith('org-1', Number(params.get('_t')));
    expect([...el.querySelectorAll('[data-stats] > span')].map((s) => s.textContent!.trim())).toEqual(['7 zones', `${(1234).toLocaleString('fr-FR')} IRIS`, '56 CP']);
    const [premiere] = cartes(el);
    expect(premiere.textContent).toContain('CIRFA BRETAGNE');
    expect(premiere.querySelector('[data-comptes]')!.textContent).toBe('12 IRIS · 4 CP');
    expect(premiere.querySelector('[data-codes]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Dept: 29, 56·Région: 53');
    expect([...el.querySelectorAll('[data-puce]')].map((b) => b.textContent?.trim())).toEqual(['Tous', 'Filtre territorial', 'Composite multi-layers']);
  });

  it('une puce relit la liste avec `source_type` ; la recherche part après 200 ms, avec `q`', async () => {
    const { el, api, stable } = await monter();
    await stable();
    el.querySelector<HTMLButtonElement>('[data-puce="admin_filter"]')!.click();
    await stable();
    expect((api.lister.mock.calls.at(-1) as unknown as [URLSearchParams])[0].get('source_type')).toBe('admin_filter');
    const champ = el.querySelector<HTMLInputElement>('input[data-recherche]')!;
    for (const q of ['c', 'ci', 'cir']) {
      champ.value = q;
      champ.dispatchEvent(new Event('input'));
    }
    const avant = api.lister.mock.calls.length;
    await stable();
    expect(api.lister.mock.calls.length).toBe(avant);
    await stable(80);
    expect(api.lister.mock.calls.length).toBe(avant + 1);
    expect((api.lister.mock.calls.at(-1) as unknown as [URLSearchParams])[0].get('q')).toBe('cir');
  });

  it('cocher deux zones : rangs 1 et 2 dans l’ordre de cochage, barre des opérations', async () => {
    const { el, stable } = await monter();
    await stable();
    const [a, b] = cartes(el);
    b.querySelector<HTMLInputElement>('input[data-selection]')!.click();
    a.querySelector<HTMLInputElement>('input[data-selection]')!.click();
    await stable();
    expect(b.querySelector('[data-rang]')!.textContent).toBe('1');
    expect(a.querySelector('[data-rang]')!.textContent).toBe('2');
    expect(el.querySelector('mg-operations-zones [data-base]')!.textContent).toContain('Cible composite (2 zones)');
  });

  it('Afficher → la zone est sur la carte, sa carte passe à « Masquer » avec sa teinte ; Masquer la retire', async () => {
    const { el, stable, carte } = await monter();
    await stable();
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-afficher]')!.click();
    await stable();
    expect(carte.sources.has('custom-zone-a')).toBe(true);
    const premiere = cartes(el)[0];
    expect(premiere.querySelector('button[data-masquer]')).not.toBeNull();
    expect(premiere.querySelector('[data-point]')).not.toBeNull();
    premiere.querySelector<HTMLButtonElement>('button[data-masquer]')!.click();
    await stable();
    expect(carte.sources.has('custom-zone-a')).toBe(false);
  });

  it('Supprimer : dialogue, confirmation → DELETE, zone retirée de la carte, liste relue ; un 409 reste dans le dialogue', async () => {
    let echec = true;
    const supprimer = vi.fn(() => (echec ? throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'zone_member_of_composite' } })) : of({ deleted: true, id: 'a' })));
    const { el, api, stable } = await monter({ api: { supprimer } });
    await stable();
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-supprimer]')!.click();
    await stable();
    const dialogue = el.querySelector('mg-dialogue-suppression-zone')!;
    expect(dialogue.textContent).toContain('Supprimer CIRFA BRETAGNE ?');
    dialogue.querySelector<HTMLButtonElement>('button[data-confirmer]')!.click();
    await stable();
    expect(dialogue.querySelector('[data-erreur]')!.textContent).toBe('HTTP 409');
    echec = false;
    const lectures = api.lister.mock.calls.length;
    dialogue.querySelector<HTMLButtonElement>('button[data-confirmer]')!.click();
    await stable();
    expect(supprimer).toHaveBeenLastCalledWith('a');
    expect(el.querySelector('mg-dialogue-suppression-zone')).toBeNull();
    expect(api.lister.mock.calls.length).toBe(lectures + 1);
  });

  it('script DV360 d’une carte : export `bidding_script` ; un échec s’affiche (React se taisait)', async () => {
    const { el, api, stable } = await monter();
    await stable();
    cartes(el)[0].querySelector<HTMLButtonElement>('button[data-export="bidding_script"]')!.click();
    await stable();
    expect(api.exporter).toHaveBeenCalledWith('a', 'bidding_script');
    expect(el.querySelector('[data-erreur]')!.textContent).toBe('zone_not_found');
  });

  it('liste en échec → « HTTP 500 » ; chiffres en échec → liste quand même', async () => {
    const { el, stable } = await monter({ api: { stats: () => throwError(() => new HttpErrorResponse({ status: 500 })) } });
    await stable();
    expect(cartes(el).length).toBe(2);
    expect(el.querySelector('[data-stats]')).toBeNull();
    TestBed.resetTestingModule();
    const autre = await monter({ api: { lister: () => throwError(() => new HttpErrorResponse({ status: 500 })) } });
    await autre.stable();
    expect(autre.el.querySelector('[data-erreur]')!.textContent).toBe('HTTP 500');
    expect(autre.el.textContent).toContain('Aucune zone sauvegardée.');
  });
});
