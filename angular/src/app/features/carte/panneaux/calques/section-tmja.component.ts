import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TmjaService } from '../../couches/tmja.service';
import { EnteteFiltreComponent } from '../filtre/perimetre.component';
import { SelectionsCalquesService } from './selections-calques.service';
import { BOUTON_TEAL_ACTIF, PASTILLE_INACTIVE } from './section-transport.component';

/** L'aide de l'en-tête (`TOOLTIPS.tmja`, `FilterSectionHeader.tsx:18`). */
export const AIDE_TMJA = 'Trafic Moyen Journalier Annuel — nombre de véhicules/jour sur un tronçon routier';

/**
 * La section « Flux routier (TMJA) » du groupe POI et mobilité — portage de `filter-panel/TmjaSection.tsx`.
 *
 * La case « Masquer le trafic faible » est cochée par défaut et ne fait qu'un `setFilter` ; « Afficher TMJA » allume la
 * couche (tuiles vectorielles de la carte visible), « Masquer » l'éteint. La légende des paliers est dans la légende
 * unique de la carte, comme React. Écart, de couleur seulement : le fond du bouton (`primaryBtn` ne sachant pas lire
 * `var()`, React posait un blanc translucide) devient `--text-primary` à 10 %, comme les autres sections (T8).
 */
@Component({
  selector: 'mg-section-tmja',
  imports: [EnteteFiltreComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @keyframes fondu { from { opacity: 0; } to { opacity: 1; } }
    .fondu { animation: fondu 200ms var(--ease-out); }
  `,
  host: { class: 'flex flex-col gap-[10px]' },
  template: `
    @if (!integre()) {
      <mg-entete-filtre libelle="Flux routier (TMJA)" [ouvert]="ouvert()" [compte]="tmja.visible() ? 1 : 0" [infobulle]="aide"
        (basculer)="selections.basculerSection('tmja')" />
    }
    @if (ouvert()) {
      <div class="fondu" data-contenu-tmja>
        <label title="Cache les tronçons à moins de 5 000 véh/j (allège le rendu)"
          class="flex cursor-pointer items-center gap-2 rounded-[4px] border-fin border-subtle bg-elevated px-2 py-1.5">
          <input type="checkbox" data-masquer-faible [checked]="tmja.masquerFaible()" (change)="tmja.masquerFaible.set($any($event.target).checked)"
            class="accent-[var(--brand-teal)]" />
          <span class="text-[11px] text-primary">Masquer le trafic faible (&lt; 5 000 véh/j)</span>
        </label>
        <div class="flex gap-1.5">
          <button type="button" data-afficher-tmja (click)="tmja.afficher()"
            class="flex-1 rounded-[4px] border-fin px-[14px] py-[9px] text-[12px] transition-[background-color,border-color,color,opacity] duration-200 ease-[var(--ease-out)]"
            [class]="actif">{{ tmja.visible() ? 'Actualiser' : 'Afficher TMJA' }}</button>
          @if (tmja.visible()) {
            <button type="button" data-masquer-tmja title="Masquer le flux routier" (click)="tmja.masquer()"
              class="shrink-0 cursor-pointer rounded-[4px] border-fin px-[9px] py-[5px] text-[11px] transition-[background-color,border-color,color,opacity] duration-200 ease-[var(--ease-out)]"
              [class]="pastille">Masquer</button>
          }
        </div>
        <div class="font-mono text-[9px] italic text-tertiary">Source : CEREMA — tronçons pour la zone visible</div>
      </div>
    }
  `,
})
export class SectionTmjaComponent {
  protected readonly selections = inject(SelectionsCalquesService);
  protected readonly tmja = inject(TmjaService);
  protected readonly aide = AIDE_TMJA;
  protected readonly actif = BOUTON_TEAL_ACTIF;
  protected readonly pastille = PASTILLE_INACTIVE;
  /** Rendue dans une ligne de ② (parcours, lot 2) : la ligne porte déjà le nom, l'en-tête interne n'est pas rendu et le contenu reste ouvert. */
  readonly integre = input(false);
  protected readonly ouvert = computed(() => this.integre() || this.selections.sections()['tmja'] !== false);
}
