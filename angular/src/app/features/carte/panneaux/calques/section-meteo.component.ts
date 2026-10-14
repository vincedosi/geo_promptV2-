import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MeteoService } from '../../couches/meteo.service';
import { EnteteFiltreComponent } from '../filtre/perimetre.component';
import { SelectionsCalquesService } from './selections-calques.service';
import { BOUTON_TEAL_ACTIF, PASTILLE_INACTIVE } from './section-transport.component';

/**
 * La section « Météo » du groupe Environnement — portage de `filter-panel/MeteoSection.tsx`.
 *
 * Elle ne fait que renvoyer au dialogue de configuration (`mg-dialogue-meteo`, monté par la page) et masquer la couche
 * active : « Configurer la météo » / « Modifier la météo », le badge « <variable> actif », « Masquer » (qui rend le
 * dégradé ET vide la couche, `page.tsx:1040`). Repliée à l'ouverture du panneau, comme les autres sections du mode
 * overlay. Écart, de couleur seulement : le fond du bouton (`primaryBtn` ne sachant pas lire `var()`, React posait un
 * blanc translucide) devient `--text-primary` à 10 %, comme les autres sections (T8, T9).
 */
@Component({
  selector: 'mg-section-meteo',
  imports: [EnteteFiltreComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @keyframes fondu { from { opacity: 0; } to { opacity: 1; } }
    .fondu { animation: fondu 200ms var(--ease-out); }
  `,
  host: { class: 'flex flex-col gap-[10px]' },
  template: `
    @if (!integre()) {
      <mg-entete-filtre libelle="Météo" [ouvert]="ouvert()" [compte]="meteo.visible() ? 1 : 0"
        (basculer)="selections.basculerSection('meteo')" />
    }
    @if (ouvert()) {
      <div class="fondu" data-contenu-meteo>
        <div class="mb-2 text-[11px] leading-[1.45] text-tertiary">
          Données Open-Meteo agrégées par zone au choix — code postal, département ou région (précipitations, température, vent, ensoleillement). Historique 90 jours · prévisions 16 jours.
        </div>
        @if (badge(); as b) {
          <div data-badge-meteo class="mb-2 rounded-[4px] border-fin border-teal bg-elevated px-2 py-1 font-mono text-[10px] text-teal">{{ b }}</div>
        }
        <div class="flex gap-1.5">
          <button type="button" data-ouvrir-meteo (click)="meteo.ouvrirDialogue()"
            class="w-full flex-1 rounded-[4px] border-fin px-[14px] py-[9px] text-[12px] transition-[background-color,border-color,color,opacity] duration-200 ease-[var(--ease-out)]"
            [class]="actif">{{ meteo.visible() ? 'Modifier la météo' : 'Configurer la météo' }}</button>
          @if (meteo.visible()) {
            <button type="button" data-masquer-meteo title="Masquer la couche météo" (click)="meteo.masquer()"
              class="shrink-0 cursor-pointer rounded-[4px] border-fin px-[9px] py-[5px] text-[11px] transition-[background-color,border-color,color,opacity] duration-200 ease-[var(--ease-out)]"
              [class]="pastille">Masquer</button>
          }
        </div>
      </div>
    }
  `,
})
export class SectionMeteoComponent {
  protected readonly selections = inject(SelectionsCalquesService);
  protected readonly meteo = inject(MeteoService);
  protected readonly actif = BOUTON_TEAL_ACTIF;
  protected readonly pastille = PASTILLE_INACTIVE;
  /** Rendue dans une ligne de ② (parcours, lot 2) : la ligne porte déjà le nom, l'en-tête interne n'est pas rendu et le contenu reste ouvert. */
  readonly integre = input(false);
  protected readonly ouvert = computed(() => this.integre() || this.selections.sections()['meteo'] !== false);
  /** `{meteoVisible && meteoLabel && <div>{meteoLabel} actif</div>}` (`MeteoSection.tsx:50-62`). */
  protected readonly badge = computed(() => {
    const l = this.meteo.libelle();
    return this.meteo.visible() && l ? `${l} actif` : null;
  });
}
