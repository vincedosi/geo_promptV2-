import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { MESSAGES_REFUS } from '../../logique/zones/recette';
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
    expect(c.recette()).toEqual({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: { type: 'departement', code: '13' }, min_menages: 11 });
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

  it('seuil vidé : aucune recette (un champ vide n’est pas 0), « Saisissez un seuil positif. »', async () => {
    const { f, el, c } = monter({ type: 'departement', code: '13', label: 'Bouches-du-Rhône' });
    f.detectChanges(); await attendre();
    const seuil = el.querySelector<HTMLInputElement>('input[data-seuil]')!;
    seuil.value = ''; seuil.dispatchEvent(new Event('input'));
    f.detectChanges(); await attendre();
    expect(c.recette()).toBeNull();
    expect(el.querySelector('[data-garde]')!.textContent).toBe('Saisissez un seuil positif.');
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

  it('France métropolitaine (retours 26/10, T4) : aucune recette, le texte exact de seuil_metropole_differe', async () => {
    const { f, el, c } = monter({ type: 'france', code: 'metro', label: 'France métropolitaine' });
    f.detectChanges(); await attendre();
    expect(c.recette()).toBeNull();
    expect(el.querySelector('[data-garde]')!.textContent!.trim()).toBe(MESSAGES_REFUS.seuil_metropole_differe);
  });
});

describe('RecetteSeuilCarreauxComponent — minimum de ménages (③ finitions, T6, V-2)', () => {
  const saisir = async (f: { detectChanges(): void }, el: HTMLElement, v: string) => {
    const champ = el.querySelector<HTMLInputElement>('input[data-min-menages]')!;
    champ.value = v; champ.dispatchEvent(new Event('input'));
    f.detectChanges(); await attendre();
  };

  it('« Carreaux d’au moins 11 ménages » par défaut ; la recette porte le minimum saisi', async () => {
    const { f, el, c } = monter({ type: 'departement', code: '33', label: 'Gironde' });
    f.detectChanges(); await attendre();
    const champ = el.querySelector<HTMLInputElement>('input[data-min-menages]')!;
    expect(champ.value).toBe('11');
    expect(el.querySelector('[data-ligne-min-menages]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Carreaux d’au moins ménages');
    expect(c.recette()).toMatchObject({ min_menages: 11 });
    await saisir(f, el, '0');
    expect(c.recette()).toMatchObject({ min_menages: 0 });
    await saisir(f, el, '1000');
    expect(c.recette()).toMatchObject({ min_menages: 1000 });
  });

  it('vide, négatif, décimal ou au-delà de 1 000 : aucune recette, la raison dite', async () => {
    const { f, el, c } = monter({ type: 'departement', code: '33', label: 'Gironde' });
    f.detectChanges(); await attendre();
    for (const v of ['', '-1', '2.5', '1001']) {
      await saisir(f, el, v);
      expect(c.recette(), v).toBeNull();
      expect(el.querySelector('[data-garde]')!.textContent).toBe('Saisissez un nombre entier de ménages, de 0 à 1 000.');
    }
  });
});
