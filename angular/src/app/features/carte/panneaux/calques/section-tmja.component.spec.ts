import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TmjaService } from '../../couches/tmja.service';
import { CarteApi } from '../../data/carte.api';
import { CouchesCarteService } from '../../etat/couches-carte.service';
import { AIDE_TMJA, SectionTmjaComponent } from './section-tmja.component';
import { SelectionsCalquesService } from './selections-calques.service';

function monter() {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), TmjaService, CouchesCarteService, SelectionsCalquesService,
      { provide: CarteApi, useValue: { urlTuilesTmja: () => 'http://hote/api/tmja-tiles/{z}/{x}/{y}?v=v10' } },
    ],
  });
  const fixture = TestBed.createComponent(SectionTmjaComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return { fixture, el, rendre, selections: TestBed.inject(SelectionsCalquesService), tmja: TestBed.inject(TmjaService) };
}

describe('SectionTmjaComponent', () => {
  it('repliée par défaut, avec l’aide de React ; ouverte : case cochée, « Afficher TMJA », la source', async () => {
    const { el, rendre, selections } = monter();
    await rendre();
    expect(el.textContent).toContain('Flux routier (TMJA)');
    expect(el.querySelector('[data-infobulle]')!.getAttribute('title')).toBe(AIDE_TMJA);
    expect(el.querySelector('[data-contenu-tmja]')).toBeNull();
    selections.basculerSection('tmja');
    await rendre();
    expect((el.querySelector('[data-masquer-faible]') as HTMLInputElement).checked).toBe(true);
    expect(el.textContent).toContain('Masquer le trafic faible (< 5 000 véh/j)');
    expect(el.querySelector('[data-afficher-tmja]')!.textContent!.trim()).toBe('Afficher TMJA');
    expect(el.querySelector('[data-masquer-tmja]')).toBeNull();
    expect(el.textContent).toContain('Source : CEREMA — tronçons pour la zone visible');
  });

  it('« Afficher TMJA » allume (compte 1, « Actualiser », « Masquer ») ; la case pilote le filtre ; « Masquer » éteint', async () => {
    const { el, rendre, selections, tmja } = monter();
    selections.basculerSection('tmja');
    await rendre();
    (el.querySelector('[data-afficher-tmja]') as HTMLButtonElement).click();
    await rendre();
    expect(tmja.visible()).toBe(true);
    expect(el.querySelector('[data-compte]')!.textContent!.trim()).toBe('1');
    expect(el.querySelector('[data-afficher-tmja]')!.textContent!.trim()).toBe('Actualiser');
    const caseFaible = el.querySelector('[data-masquer-faible]') as HTMLInputElement;
    caseFaible.click();
    expect(tmja.masquerFaible()).toBe(false);
    (el.querySelector('[data-masquer-tmja]') as HTMLButtonElement).click();
    await rendre();
    expect(tmja.visible()).toBe(false);
    expect(el.querySelector('[data-compte]')).toBeNull();
  });

  it('intégrée à une ligne de ② : aucun en-tête interne, contenu rendu même section repliée', async () => {
    const { fixture, el, rendre, selections } = monter();
    fixture.componentRef.setInput('integre', true);
    selections.sections.update((s) => ({ ...s, tmja: false }));
    await rendre();
    expect(selections.sections()['tmja']).toBe(false);
    expect(el.querySelector('mg-entete-filtre')).toBeNull();
    expect(el.querySelector('[data-contenu-tmja]')).not.toBeNull();
  });
});
