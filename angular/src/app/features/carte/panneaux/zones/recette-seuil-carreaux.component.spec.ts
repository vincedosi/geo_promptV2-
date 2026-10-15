import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { RecetteSeuilCarreauxComponent } from './recette-seuil-carreaux.component';

const attendre = () => new Promise((r) => setTimeout(r, 0));

function monter(filtre: unknown) {
  TestBed.configureTestingModule({ providers: [{ provide: EtatCarteService, useValue: { filtre: signal(filtre) } }] });
  const f = TestBed.createComponent(RecetteSeuilCarreauxComponent);
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance };
}

describe('RecetteSeuilCarreauxComponent (lot 3, T10)', () => {
  it('13 indicateurs, « Part des ménages pauvres » par défaut, seuil 40 %', async () => {
    const { f, el } = monter({ type: 'departement', code: '13', label: 'Bouches-du-Rhône' });
    f.detectChanges(); await attendre();
    expect(el.querySelectorAll('select[data-indicateur] option')).toHaveLength(13);
    expect(el.querySelector<HTMLSelectElement>('select[data-indicateur]')!.value).toBe('part_men_pauv');
    expect((el.querySelector('input[data-seuil]') as HTMLInputElement).value).toBe('40');
    expect(el.querySelector('[data-unite]')!.textContent!.trim()).toBe('%');
  });

  it('compose la recette avec le périmètre de ① ; les champs la changent', async () => {
    const { f, el, c } = monter({ type: 'departement', code: '13', label: 'Bouches-du-Rhône' });
    f.detectChanges(); await attendre();
    expect(c.recette()).toEqual({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: { type: 'departement', code: '13' } });
    expect(el.querySelector('[data-garde]')).toBeNull();
    const ind = el.querySelector<HTMLSelectElement>('select[data-indicateur]')!;
    ind.value = 'densite_ind'; ind.dispatchEvent(new Event('change'));
    const op = el.querySelector<HTMLSelectElement>('select[data-operateur]')!;
    op.value = '<='; op.dispatchEvent(new Event('change'));
    const seuil = el.querySelector<HTMLInputElement>('input[data-seuil]')!;
    seuil.value = '5000'; seuil.dispatchEvent(new Event('input'));
    f.detectChanges(); await attendre();
    expect(c.recette()).toMatchObject({ indicateur: 'densite_ind', operateur: '<=', seuil: 5000 });
    expect(el.querySelector('[data-unite]')!.textContent!.trim()).toBe('hab./km²');
  });

  it('sans périmètre : aucune recette, la raison dite', async () => {
    const { f, el, c } = monter(null);
    f.detectChanges(); await attendre();
    expect(c.recette()).toBeNull();
    expect(el.querySelector('[data-garde]')!.textContent).toContain('étape ①');
  });

  it('France : aucune recette, message national', async () => {
    const { f, el, c } = monter({ type: 'france', code: 'france', label: 'France' });
    f.detectChanges(); await attendre();
    expect(c.recette()).toBeNull();
    expect(el.querySelector('[data-garde]')!.textContent).toContain('France entière');
  });

  it('une région à ① : aucune recette, « un département au plus » (A-4)', async () => {
    const { f, el, c } = monter({ type: 'region', code: '84', label: 'Auvergne-Rhône-Alpes' });
    f.detectChanges(); await attendre();
    expect(c.recette()).toBeNull();
    expect(el.querySelector('[data-garde]')!.textContent).toContain('un département au plus');
  });
});
