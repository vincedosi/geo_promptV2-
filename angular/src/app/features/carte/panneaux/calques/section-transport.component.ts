import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TransportService } from '../../couches/transport.service';
import { TRANSPORT_TYPES } from '../../logique/constantes-calques';
import { EnteteFiltreComponent } from '../filtre/perimetre.component';
import { SelectionsCalquesService } from './selections-calques.service';

/** `pill(actif, C.textSec)` (`styles.ts:15-21`), actif puis inactif. */
export const PASTILLE_ACTIVE = 'border-secondary text-secondary bg-[color-mix(in_srgb,var(--text-primary)_12%,transparent)]';
export const PASTILLE_INACTIVE = 'border-subtle text-tertiary bg-elevated';
/** `primaryBtn('var(--brand-teal)', …)` (`styles.ts:23-30`), actif puis désactivé. */
export const BOUTON_TEAL_ACTIF = 'cursor-pointer border-teal text-teal bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)]';
export const BOUTON_DESACTIVE = 'cursor-not-allowed border-subtle text-tertiary opacity-55 bg-[color-mix(in_srgb,var(--text-primary)_3%,transparent)]';

/**
 * La section « Arrêts de transport en commun » du groupe POI et mobilité — portage de `filter-panel/TransportSection.tsx`.
 *
 * Les types choisis vivent dans le panneau (`SelectionsCalquesService`) ; « Afficher arrêts » charge la carte VISIBLE
 * (`TransportService`). Écarts voulus, de couleur seulement : le fond des pastilles et du bouton — un blanc translucide
 * en React, `pill`/`primaryBtn` ne sachant pas lire `var()` — devient `--text-primary` au même pourcentage. Défaut
 * corrigé : un échec est dit sous le bouton (React le taisait).
 */
@Component({
  selector: 'mg-section-transport',
  imports: [EnteteFiltreComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @keyframes fondu { from { opacity: 0; } to { opacity: 1; } }
    .fondu { animation: fondu 200ms var(--ease-out); }
  `,
  host: { class: 'flex flex-col gap-[10px]' },
  template: `
    @if (!integre()) {
      <mg-entete-filtre libelle="Arrêts de transport en commun" [ouvert]="ouvert()" [compte]="choisis().length"
        (basculer)="selections.basculerSection('transport')" />
    }
    @if (ouvert()) {
      <div class="fondu" data-contenu-transport>
        <div>
          <div class="mb-1.5 flex items-center justify-between text-[11px] font-medium text-secondary">
            <span>Type de transport@if (choisis().length > 0) {<span class="text-secondary"> — {{ choisis().join(', ') }}</span>}</span>
            @if (choisis().length > 0) {
              <button type="button" data-tout-deselectionner title="Tout désélectionner" (click)="selections.typesTransport.set([])"
                class="cursor-pointer border-0 bg-transparent px-[2px] py-0 font-mono text-[10px] text-tertiary">✕</button>
            }
          </div>
          <div class="flex flex-wrap gap-[5px]">
            @for (t of types; track t.id) {
              <button type="button" [attr.data-type]="t.id" [attr.aria-pressed]="choisis().includes(t.id)" (click)="basculer(t.id)"
                class="shrink-0 cursor-pointer rounded-[4px] border-fin px-[9px] py-[5px] text-[11px] transition-[background-color,border-color,color,opacity] duration-200 ease-[var(--ease-out)]"
                [class]="choisis().includes(t.id) ? pastilleActive : pastilleInactive">{{ t.label }}</button>
            }
          </div>
          <div class="mt-[5px] font-mono text-[9px] italic text-tertiary">{{ choisis().length === 0 ? 'Tous les types' : '' }} · Chargé pour la zone visible</div>
        </div>
        <button type="button" data-afficher-transport [disabled]="transport.chargement()" (click)="transport.charger(choisis())"
          class="w-full rounded-[4px] border-fin px-[14px] py-[9px] text-[12px] transition-[background-color,border-color,color,opacity] duration-200 ease-[var(--ease-out)]"
          [class]="transport.chargement() ? desactive : actif">{{ transport.chargement() ? 'Chargement...' : 'Afficher arrêts' }}</button>
        @if (transport.erreur(); as e) {
          <div data-erreur class="mt-1.5 font-mono text-[10px] text-danger">! {{ e }}</div>
        }
      </div>
    }
  `,
})
export class SectionTransportComponent {
  protected readonly selections = inject(SelectionsCalquesService);
  protected readonly transport = inject(TransportService);
  protected readonly types = TRANSPORT_TYPES;
  protected readonly pastilleActive = PASTILLE_ACTIVE;
  protected readonly pastilleInactive = PASTILLE_INACTIVE;
  protected readonly actif = BOUTON_TEAL_ACTIF;
  protected readonly desactive = BOUTON_DESACTIVE;
  /** Rendue dans une ligne de ② (parcours, lot 2) : la ligne porte déjà le nom, l'en-tête interne n'est pas rendu et le contenu reste ouvert. */
  readonly integre = input(false);
  protected readonly ouvert = computed(() => this.integre() || this.selections.sections()['transport'] !== false);
  protected readonly choisis = this.selections.typesTransport;

  protected basculer(id: string): void {
    this.selections.typesTransport.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }
}
