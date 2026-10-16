import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { IndicateursCiviquesService } from '../../couches/indicateurs-civiques.service';
import type { CodeVariableCivique } from '../../logique/palettes-donnees-carte';
import { EnteteFiltreComponent } from '../filtre/perimetre.component';
import { SelectionsCalquesService } from './selections-calques.service';

/**
 * La section « Indicateurs civiques » du groupe Environnement — portage de `filter-panel/CivicIndicatorsSection.tsx`.
 *
 * Un sélecteur, deux options (« Aucune » éteint le calque) ; la variable choisie, le cadre et le texte passent au teal,
 * la source s'affiche dessous. La légende n'est pas ici : c'est la légende unique de la carte (`mg-legende-carte`).
 * Repliée à l'ouverture du panneau Calques (mode overlay, `use-filter-sections.ts`), comme React.
 *
 * Écart, défaut corrigé : un échec de lecture est dit sous le sélecteur (React : carte vide, rien d'écrit).
 */
@Component({
  selector: 'mg-section-civique',
  imports: [EnteteFiltreComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @keyframes fondu { from { opacity: 0; } to { opacity: 1; } }
    .fondu { animation: fondu 200ms var(--ease-out); }
  `,
  host: { class: 'flex flex-col gap-[10px]' },
  template: `
    @if (!integre()) {
      <mg-entete-filtre libelle="Indicateurs civiques" [ouvert]="ouvert()" [compte]="c.variable() ? 1 : 0"
        (basculer)="selections.basculerSection('civic')" />
    }
    @if (ouvert()) {
      <div class="fondu" data-contenu-civique>
        <div class="mb-1 text-[11px] font-medium text-secondary">Variable à afficher</div>
        <div class="relative">
          <select
            aria-label="Variable à afficher"
            [value]="c.variable() ?? ''"
            (change)="choisir($any($event.target).value)"
            class="w-full cursor-pointer appearance-none rounded-[4px] border-fin bg-elevated py-2 pl-[11px] pr-7 text-[13px] outline-none transition-[border-color,color] duration-200 ease-[var(--ease-out)]"
            [class.border-teal]="actif()"
            [class.text-teal]="actif()"
            [class.border-subtle]="!actif()"
            [class.text-primary]="!actif()"
          >
            <option value="" [selected]="!actif()">— Aucune (layer désactivé) —</option>
            <option value="abstention_pres_2022" [selected]="actif()">🗳️ Taux d'abstention (Présidentielle 2022)</option>
          </select>
          <span aria-hidden="true" class="pointer-events-none absolute right-[10px] top-1/2 -translate-y-1/2 text-[10px] text-tertiary">▾</span>
        </div>
        @if (c.erreur(); as e) {
          <div data-erreur-civique class="mt-1.5 text-[11px] text-danger">{{ e }}</div>
        }
        @if (actif()) {
          <div class="mt-[10px] font-mono text-[9px] italic text-tertiary">
            Source : data.gouv.fr — Ministère de l'Intérieur · 6 186 codes postaux (France métro + DROM)
          </div>
        }
      </div>
    }
  `,
})
export class SectionCiviqueComponent {
  protected readonly selections = inject(SelectionsCalquesService);
  protected readonly c = inject(IndicateursCiviquesService);
  /** Rendue dans une ligne de ② (parcours, lot 2) : la ligne porte déjà le nom, l'en-tête interne n'est pas rendu et le contenu reste ouvert. */
  readonly integre = input(false);
  /** `sectionsOpen.civic !== false` (`CivicIndicatorsSection.tsx:56`). */
  protected readonly ouvert = computed(() => this.integre() || this.selections.sections()['civic'] !== false);
  protected readonly actif = computed(() => this.c.variable() === 'abstention_pres_2022');

  protected choisir(valeur: string): void {
    this.c.choisir((valeur || null) as CodeVariableCivique | null);
  }
}
