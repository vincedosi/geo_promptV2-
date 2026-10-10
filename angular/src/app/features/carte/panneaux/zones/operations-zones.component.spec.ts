import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ZonesCustomApi } from '../../data/zones-custom.api';
import { OperationsZonesComponent } from './operations-zones.component';

@Component({
  imports: [OperationsZonesComponent],
  template: `<mg-operations-zones [selection]="selection()" [noms]="noms" org="org-1" (termine)="termines = termines + 1" />`,
})
class Hote {
  readonly selection = signal<string[]>([]);
  readonly noms = new Map([['a', 'Bretagne'], ['b', 'Finistère'], ['c', 'Morbihan']]);
  termines = 0;
}

function monter(api: { operation: unknown; enregistrer: unknown }) {
  TestBed.configureTestingModule({ providers: [{ provide: ZonesCustomApi, useValue: api }] });
  const fixture = TestBed.createComponent(Hote);
  const el = fixture.nativeElement as HTMLElement;
  const stable = async () => { await fixture.whenStable(); };
  return { fixture, el, stable };
}

const bouton = (el: HTMLElement, op: string) => el.querySelector<HTMLButtonElement>(`button[data-operation="${op}"]`)!;

describe('OperationsZonesComponent (ZonesOperations.tsx, T14)', () => {
  it('rien sans sélection ; une zone : compte, aide, boutons inactifs ; deux : base nommée, boutons actifs', async () => {
    const { fixture, el, stable } = monter({ operation: vi.fn(), enregistrer: vi.fn() });
    await stable();
    expect(el.querySelector('[data-barre]')).toBeNull();
    fixture.componentInstance.selection.set(['b']);
    await stable();
    expect(el.querySelector('[data-compte]')!.textContent).toBe('1 zone sélectionnée');
    expect(el.querySelector('[data-aide]')!.textContent).toContain('Cochez au moins deux zones');
    expect(bouton(el, 'union').disabled).toBe(true);
    fixture.componentInstance.selection.set(['b', 'a']);
    await stable();
    expect(el.querySelector('[data-compte]')!.textContent).toBe('2 zones sélectionnées');
    expect(el.querySelector('[data-base]')!.textContent).toContain('Finistère');
    expect([...el.querySelectorAll('button[data-operation]')].map((b) => b.textContent?.trim())).toEqual(['Fusionner', 'Restreindre à', 'Soustraire']);
    expect(bouton(el, 'difference').title).toBe('la première, moins toutes les autres');
    expect(bouton(el, 'union').disabled).toBe(false);
  });

  it('intersection 409 → le message de la route, AUCUNE sauvegarde, sélection gardée', async () => {
    const enregistrer = vi.fn();
    const operation = vi.fn(() => throwError(() => new HttpErrorResponse({
      status: 409, error: { error: 'intersection_vide', message: 'Ces zones n’ont aucune surface en commun.' },
    })));
    const { fixture, el, stable } = monter({ operation, enregistrer });
    fixture.componentInstance.selection.set(['a', 'b']);
    await stable();
    bouton(el, 'intersection').click();
    await stable();
    expect(operation).toHaveBeenCalledWith('intersection', { zone_ids: ['a', 'b'] });
    expect(enregistrer).not.toHaveBeenCalled();
    expect(el.querySelector('[data-erreur]')!.textContent).toBe('Ces zones n’ont aucune surface en commun.');
    expect(fixture.componentInstance.termines).toBe(0);
  });

  it('soustraire → base puis retirées, zone enregistrée avec sa composition, message, `termine` ; le message reste après la sélection vidée', async () => {
    const operation = vi.fn(() => of({ geometry: { type: 'Polygon', coordinates: [] }, surface_km2: 56.7 }));
    const enregistrer = vi.fn(() => of(new HttpResponse({ status: 200, body: { zone_id: 'n', count_cp: 1234 } })));
    const { fixture, el, stable } = monter({ operation, enregistrer });
    fixture.componentInstance.selection.set(['a', 'b', 'c']);
    await stable();
    bouton(el, 'difference').click();
    await stable();
    expect(operation).toHaveBeenCalledWith('difference', { zone_base: 'a', zones_retirees: ['b', 'c'] });
    expect(enregistrer).toHaveBeenCalledWith({
      name: 'Bretagne — moins 2 zones',
      source_type: 'difference',
      source_metadata: {
        operation: 'difference', member_zone_ids: ['a', 'b', 'c'], member_zone_names: ['Bretagne', 'Finistère', 'Morbihan'], surface_km2: 56.7,
      },
      geometry: { type: 'Polygon', coordinates: [] },
      org_id: 'org-1',
    });
    expect(fixture.componentInstance.termines).toBe(1);
    fixture.componentInstance.selection.set([]);
    await stable();
    expect(el.querySelector('[data-barre]')).toBeNull();
    expect(el.querySelector('[data-message]')!.textContent).toBe(`Zone créée : ${(1234).toLocaleString('fr-FR')} codes postaux · 56,7 km²`);
  });

  it('207 → « Zone créée, mais la résolution… », pas de `termine`', async () => {
    const { fixture, el, stable } = monter({
      operation: () => of({ geometry: { type: 'Polygon', coordinates: [] }, surface_km2: null }),
      enregistrer: () => of(new HttpResponse({ status: 207, body: { zone_id: 'n', warning: 'zone_created_but_resolution_failed' } })),
    });
    fixture.componentInstance.selection.set(['a', 'b']);
    await stable();
    bouton(el, 'union').click();
    await stable();
    expect(el.querySelector('[data-erreur]')!.textContent).toContain('la résolution des codes postaux a échoué');
    expect(fixture.componentInstance.termines).toBe(0);
  });

  it('sauvegarde en échec → « Sauvegarde de la zone échouée. »', async () => {
    const { fixture, el, stable } = monter({
      operation: () => of({ geometry: { type: 'Polygon', coordinates: [] } }),
      enregistrer: () => throwError(() => new HttpErrorResponse({ status: 500, error: { error: 'Internal server error' } })),
    });
    fixture.componentInstance.selection.set(['a', 'b']);
    await stable();
    bouton(el, 'union').click();
    await stable();
    expect(el.querySelector('[data-erreur]')!.textContent).toBe('Sauvegarde de la zone échouée.');
  });
});
