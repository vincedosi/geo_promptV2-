import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { libelleRayon } from '../../features/risques/logique/profil';
import { OPACITE_BANDES } from '../opacites-bandes';

/** Un niveau de la légende : son libellé, le jeton CSS de sa teinte (`niveau-haut`), les rayons de ses anneaux. */
export interface NiveauLegende {
  libelle: string;
  jeton: string;
  /** Rayons en mètres, du plus proche au plus lointain. */
  anneaux: readonly number[];
}


/**
 * Le contenu de légende du module risque : par niveau, un libellé et un carré par
 * anneau, à l'opacité de sa bande, suivi du rayon en mono (c'est un nombre). Ne liste
 * QUE les niveaux qui portent un anneau : une entrée vide se lirait « aucun habitant
 * à ce niveau », alors qu'elle signifie « ce niveau n'est pas calculé ». Les teintes
 * sont des `var()` DANS le DOM — pas dans un `paint` MapLibre —, donc elles suivent le thème seules.
 */
@Component({
  selector: 'mg-legende-niveaux',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (n of niveauxAffiches(); track n.jeton) {
      <div class="mb-[6px]">
        <div class="mb-[3px] text-[10.5px] text-secondary">{{ n.libelle }}</div>
        <div class="flex items-center gap-[3px]">
          @for (r of n.anneaux; track r; let i = $index) {
            <span class="flex items-center gap-[3px]">
              <span aria-hidden="true" class="h-[13px] w-[13px] rounded-[3px] border-fin"
                    [style.background]="'var(--' + n.jeton + ')'" [style.border-color]="'var(--' + n.jeton + ')'"
                    [style.opacity]="opacite(i)"></span>
              <span class="font-mono text-[9.5px] text-tertiary">{{ libelle(r) }}</span>
            </span>
          }
        </div>
      </div>
    }
  `,
  host: { class: 'block' },
})
export class LegendeNiveauxComponent {
  readonly niveaux = input.required<readonly NiveauLegende[]>();
  protected readonly libelle = libelleRayon;

  protected readonly niveauxAffiches = computed(() => this.niveaux().filter((n) => n.anneaux.length > 0));

  protected opacite(i: number): number {
    return OPACITE_BANDES[Math.min(i, OPACITE_BANDES.length - 1)];
  }
}
