import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IndicateursCiviquesService } from '../../couches/indicateurs-civiques.service';
import type { CodeVariableCivique } from '../../logique/palettes-donnees-carte';
import { SectionCiviqueComponent } from './section-civique.component';
import { SelectionsCalquesService } from './selections-calques.service';

function monter() {
  const variable = signal<CodeVariableCivique | null>(null);
  const erreur = signal<string | null>(null);
  const chargement = signal(false);
  const choix: (CodeVariableCivique | null)[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), SelectionsCalquesService,
      {
        provide: IndicateursCiviquesService,
        useValue: { variable, erreur, chargement, choisir: (c: CodeVariableCivique | null) => { choix.push(c); variable.set(c); } },
      },
    ],
  });
  const fixture = TestBed.createComponent(SectionCiviqueComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return { el, rendre, selections: TestBed.inject(SelectionsCalquesService), variable, erreur, choix };
}

describe('SectionCiviqueComponent', () => {
  it('repliée dans le panneau Calques (mode overlay) ; ouverte : le sélecteur et ses deux options de React', async () => {
    const { el, rendre, selections } = monter();
    await rendre();
    expect(el.textContent).toContain('Indicateurs civiques');
    expect(el.querySelector('select')).toBeNull();
    selections.basculerSection('civic');
    await rendre();
    expect(el.textContent).toContain('Variable à afficher');
    const options = [...el.querySelectorAll('option')].map((o) => [o.value, o.textContent!.trim()]);
    expect(options).toEqual([
      ['', '— Aucune (layer désactivé) —'],
      ['abstention_pres_2022', '🗳️ Taux d\'abstention (Présidentielle 2022)'],
    ]);
    expect(el.textContent).not.toContain('Source : data.gouv.fr');
  });

  it('choisir l’abstention : appel du service, compte 1, source affichée ; « Aucune » rend null', async () => {
    const { el, rendre, selections, choix } = monter();
    selections.basculerSection('civic');
    await rendre();
    const select = el.querySelector('select') as HTMLSelectElement;
    select.value = 'abstention_pres_2022';
    select.dispatchEvent(new Event('change'));
    await rendre();
    expect(choix).toEqual(['abstention_pres_2022']);
    expect(el.querySelector('[data-compte]')!.textContent!.trim()).toBe('1');
    expect(el.textContent).toContain('Source : data.gouv.fr — Ministère de l\'Intérieur · 6 186 codes postaux (France métro + DROM)');
    select.value = '';
    select.dispatchEvent(new Event('change'));
    expect(choix).toEqual(['abstention_pres_2022', null]);
  });

  it('un échec de lecture est DIT sous le sélecteur', async () => {
    const { el, rendre, selections, variable, erreur } = monter();
    selections.basculerSection('civic');
    variable.set('abstention_pres_2022');
    erreur.set('Erreur 500');
    await rendre();
    expect(el.querySelector('[data-erreur-civique]')!.textContent).toContain('Erreur 500');
  });
});
