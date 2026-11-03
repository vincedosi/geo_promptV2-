import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { ZonesCustomApi } from '../../data/zones-custom.api';
import { ZonesApi } from '../../data/zones.api';
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

function monter(enregistrer: unknown) {
  // L'ancienne API (route d'opération + /save) : un faux qui échoue s'il est appelé.
  const ancienne = { operation: vi.fn(), enregistrer: vi.fn() };
  TestBed.configureTestingModule({ providers: [{ provide: ZonesApi, useValue: { enregistrer } }, { provide: ZonesCustomApi, useValue: ancienne }] });
  const fixture = TestBed.createComponent(Hote);
  const el = fixture.nativeElement as HTMLElement;
  const stable = async () => { await fixture.whenStable(); };
  return { fixture, el, stable, ancienne };
}

const bouton = (el: HTMLElement, op: string) => el.querySelector<HTMLButtonElement>(`button[data-operation="${op}"]`)!;
const ok = (corps: object, status = 200) => vi.fn(() => of(new HttpResponse({ status, body: corps })));

describe('OperationsZonesComponent (ZonesOperations.tsx, T14 ; recette `combinaison`, lot 3)', () => {
  it('rien sans sélection ; une zone : compte, aide, boutons inactifs ; deux : base nommée, boutons actifs', async () => {
    const { fixture, el, stable } = monter(vi.fn());
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

  it('« Fusionner » deux zones → POST /api/zones avec la recette combinaison, et plus AUCUN appel à l’ancienne API', async () => {
    const enregistrer = ok({ zone_id: 'n', count_cp: 1234, surface_km2: 56.7 });
    const { fixture, el, stable, ancienne } = monter(enregistrer);
    fixture.componentInstance.selection.set(['a', 'b']);
    await stable();
    bouton(el, 'union').click();
    await stable();
    expect(enregistrer).toHaveBeenCalledWith({ nom: 'Fusion de 2 zones — Bretagne…', recette: { v: 1, type: 'combinaison', operation: 'union', zones: ['a', 'b'] } });
    expect(ancienne.operation).not.toHaveBeenCalled();
    expect(ancienne.enregistrer).not.toHaveBeenCalled();
    expect(fixture.componentInstance.termines).toBe(1);
    fixture.componentInstance.selection.set([]);
    await stable();
    expect(el.querySelector('[data-barre]')).toBeNull();
    expect(el.querySelector('[data-message]')!.textContent).toBe(`Zone créée : ${(1234).toLocaleString('fr-FR')} codes postaux · 56,7 km²`);
  });

  it('« Soustraire » trois zones : la sélection DANS L’ORDRE (la première est la base), nom de React', async () => {
    const enregistrer = ok({ zone_id: 'n', count_cp: 3 });
    const { fixture, el, stable } = monter(enregistrer);
    fixture.componentInstance.selection.set(['a', 'b', 'c']);
    await stable();
    bouton(el, 'difference').click();
    await stable();
    expect(enregistrer).toHaveBeenCalledWith({
      nom: 'Bretagne — moins 2 zones', recette: { v: 1, type: 'combinaison', operation: 'difference', zones: ['a', 'b', 'c'] },
    });
  });

  it('« Restreindre à » : actif de deux zones à plus (C20, intersection de TOUTES), l’aide le dit', async () => {
    const enregistrer = ok({ zone_id: 'n' }, 201);
    const { fixture, el, stable } = monter(enregistrer);
    fixture.componentInstance.selection.set(['a']);
    await stable();
    expect(bouton(el, 'intersection').disabled).toBe(true);
    fixture.componentInstance.selection.set(['a', 'b', 'c']);
    await stable();
    expect(bouton(el, 'intersection').disabled).toBe(false);
    expect(bouton(el, 'intersection').title).toBe('ce que toutes les zones cochées ont en commun');
    bouton(el, 'intersection').click();
    await stable();
    expect(enregistrer).toHaveBeenCalledWith({
      nom: 'Bretagne — restreinte à 2 zones', recette: { v: 1, type: 'combinaison', operation: 'intersection', zones: ['a', 'b', 'c'] },
    });
  });

  it('404 → le message de la route, sélection gardée, pas de `termine`', async () => {
    const enregistrer = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404, error: { error: 'Zone introuvable dans cet espace.', refus: 'zone_introuvable' } })));
    const { fixture, el, stable } = monter(enregistrer);
    fixture.componentInstance.selection.set(['a', 'b']);
    await stable();
    bouton(el, 'intersection').click();
    await stable();
    expect(el.querySelector('[data-erreur]')!.textContent).toBe('Zone introuvable dans cet espace.');
    expect(fixture.componentInstance.termines).toBe(0);
  });

  it('207 → la zone EXISTE : `termine` (liste relue, sélection vidée), le message de la route, aucun second envoi', async () => {
    const enregistrer = ok({ zone_id: 'n', warning: 'codes_non_resolus', message: 'Zone créée ; ses codes postaux n’ont pas pu être résolus.' }, 207);
    const { fixture, el, stable } = monter(enregistrer);
    fixture.componentInstance.selection.set(['a', 'b']);
    await stable();
    bouton(el, 'union').click();
    await stable();
    expect(fixture.componentInstance.termines).toBe(1);
    // Le parent vide la sélection sur `termine` : la barre disparaît, le message reste.
    fixture.componentInstance.selection.set([]);
    await stable();
    expect(el.querySelector('[data-barre]')).toBeNull();
    expect(el.querySelector('[data-message]')!.textContent).toBe('Zone créée ; ses codes postaux n’ont pas pu être résolus.');
    expect(el.querySelector('[data-erreur]')).toBeNull();
    expect(enregistrer).toHaveBeenCalledTimes(1);
  });

  it('207 sans message dans le corps : le repli dit que la zone existe', async () => {
    const enregistrer = ok({ zone_id: 'n', warning: 'codes_non_resolus' }, 207);
    const { fixture, el, stable } = monter(enregistrer);
    fixture.componentInstance.selection.set(['a', 'b']);
    await stable();
    bouton(el, 'union').click();
    await stable();
    expect(fixture.componentInstance.termines).toBe(1);
    expect(el.querySelector('[data-message]')!.textContent).toContain('la résolution des codes postaux a échoué');
  });

  it('pendant l’écriture, les boutons sont inactifs : un second clic n’envoie rien', async () => {
    const enregistrer = vi.fn(() => NEVER);
    const { fixture, el, stable } = monter(enregistrer);
    fixture.componentInstance.selection.set(['a', 'b']);
    await stable();
    bouton(el, 'union').click();
    await stable();
    expect(bouton(el, 'union').disabled).toBe(true);
    bouton(el, 'union').click();
    expect(enregistrer).toHaveBeenCalledTimes(1);
  });
});
