import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { CarteActivation, ModeCarte } from '../../logique/activation/cartes';
import { CADRE, ENCART_MOTIF } from './styles-activation';

/** Le nom affiché du mode d'envoi d'une carte (A-5). */
export const LIBELLE_MODE: Readonly<Record<ModeCarte, string>> = { api: 'API', simule: 'Simulé', fichier: 'Fichier' };

/**
 * ⑦ Activation — UNE plateforme cochée en ⑥ (lot 7, T4, A-4, A-5, A-13) : son nom, son mode d'envoi, la conversion en
 * unités retenues, ce qui l'empêche d'envoyer (encart ambre, comme les `blocages` de React), puis ses avertissements
 * écrits (aucune case à cocher, Q-2). Le contenu PROPRE à la plateforme est projeté en dessous : la poussée DV360 (T4),
 * les fichiers (T5). Présentationnel : tout vient de `carte`, calculée par `cartesActivation`.
 *
 * L'entrée s'appelle `carte` (aucun attribut natif masqué).
 */
@Component({
  selector: 'mg-carte-plateforme',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-carte-plateforme]': 'carte().canal', '[class]': 'cadre' },
  template: `
    <div class="flex items-center gap-2">
      <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-teal"></span>
      <span data-libelle class="text-[12px] font-medium text-primary">{{ carte().libelle }}</span>
      <span data-mode class="ml-auto rounded-[4px] border-fin border-default bg-overlay px-2 py-0.5 text-[10px] text-secondary">{{ libelleMode[carte().mode] }}</span>
    </div>
    @if (carte().nature) { <div data-nature class="font-mono text-[11px] leading-[1.8] text-secondary">{{ carte().nature }}</div> }
    @if (carte().motifs.length) {
      <div data-motifs [class]="encartMotif">
        @for (m of carte().motifs; track m) { <div>· {{ m }}</div> }
      </div>
    }
    <ng-content />
    @if (carte().avertissements.length) {
      <ul data-avertissements class="m-0 flex list-none flex-col gap-1 p-0 text-[10px] leading-[1.5] text-tertiary">
        @for (a of carte().avertissements; track a) { <li>{{ a }}</li> }
      </ul>
    }
  `,
})
export class CartePlateformeComponent {
  readonly carte = input.required<CarteActivation>();
  protected readonly libelleMode = LIBELLE_MODE;
  protected readonly encartMotif = ENCART_MOTIF;
  protected readonly cadre = CADRE;
}
