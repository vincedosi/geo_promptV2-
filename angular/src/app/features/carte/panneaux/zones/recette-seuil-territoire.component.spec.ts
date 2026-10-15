import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { CatalogueIndicateursService } from '../../etat/catalogue-indicateurs.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { RecetteSeuilTerritoireComponent } from './recette-seuil-territoire.component';

const attendre = () => new Promise((r) => setTimeout(r, 0));
const BDR = { type: 'departement', code: '13', label: 'Bouches-du-Rhône' };
const CATALOGUE = [
  { indicator_code: 'taux_pauvrete', label: 'Taux de pauvreté', famille: 'Revenus', unit: '%' },
  { indicator_code: 'revenu_median', label: 'Revenu médian', famille: 'Revenus', unit: '€' },
  { indicator_code: 'part_65', label: 'Part des 65 ans et plus', famille: 'Âges', unit: '%' },
];

function monter(filtre: unknown, charger = vi.fn(() => of(CATALOGUE))) {
  TestBed.configureTestingModule({ providers: [
    { provide: EtatCarteService, useValue: { filtre: signal(filtre) } },
    { provide: CatalogueIndicateursService, useValue: { charger } },
  ] });
  const f = TestBed.createComponent(RecetteSeuilTerritoireComponent);
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance, charger };
}

describe('RecetteSeuilTerritoireComponent (lot 3, T10)', () => {
  it('catalogue lu UNE fois, indicateurs groupés par famille', async () => {
    const { f, el, charger } = monter(BDR);
    f.detectChanges(); await attendre(); f.detectChanges();
    expect(charger).toHaveBeenCalledTimes(1);
    expect([...el.querySelectorAll('optgroup')].map((g) => g.getAttribute('label'))).toEqual(['Revenus', 'Âges']);
    expect(el.querySelectorAll('optgroup')[0].querySelectorAll('option')).toHaveLength(2);
    expect(el.querySelector('[data-unite]')!.textContent!.trim()).toBe('%');
  });

  it('opérateur ≥ / ≤, seuil 20 par défaut → { v: 1, type: seuil_territoire, … }', async () => {
    const { f, el, c } = monter(BDR);
    f.detectChanges(); await attendre(); f.detectChanges();
    expect([...el.querySelectorAll('select[data-operateur] option')].map((o) => o.textContent)).toEqual(['≥', '≤']);
    expect(el.querySelector<HTMLInputElement>('input[data-seuil]')!.value).toBe('20');
    expect(c.recette()).toEqual({ v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20, perimetre: { type: 'departement', code: '13' } });
    const op = el.querySelector<HTMLSelectElement>('select[data-operateur]')!;
    op.value = '<='; op.dispatchEvent(new Event('change'));
    expect(c.recette()).toMatchObject({ operateur: '<=' });
  });

  it('seuil vidé : aucune recette (un champ vide n’est pas 0), « Saisissez un seuil. »', async () => {
    const { f, el, c } = monter(BDR);
    f.detectChanges(); await attendre(); f.detectChanges();
    const seuil = el.querySelector<HTMLInputElement>('input[data-seuil]')!;
    seuil.value = ''; seuil.dispatchEvent(new Event('input'));
    f.detectChanges(); await attendre();
    expect(c.recette()).toBeNull();
    expect(el.querySelector('[data-garde]')!.textContent).toBe('Saisissez un seuil.');
    seuil.value = '-3'; seuil.dispatchEvent(new Event('input'));
    expect(c.recette()).toMatchObject({ seuil: -3 });
  });

  it('lecture du catalogue en échec : « Indicateurs indisponibles. », aucune recette', async () => {
    const { f, el, c } = monter(BDR, vi.fn(() => throwError(() => new Error('500'))));
    f.detectChanges(); await attendre(); f.detectChanges();
    expect(c.recette()).toBeNull();
    expect(el.querySelector('[data-garde]')!.textContent).toBe('Indicateurs indisponibles.');
  });

  it('France : aucune recette, message national', async () => {
    const { f, el, c } = monter({ type: 'france', code: 'france', label: 'France' });
    f.detectChanges(); await attendre(); f.detectChanges();
    expect(c.recette()).toBeNull();
    expect(el.querySelector('[data-garde]')!.textContent).toContain('France entière');
  });
});
