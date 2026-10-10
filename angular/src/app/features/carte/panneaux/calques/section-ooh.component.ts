import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { OohService } from '../../couches/ooh.service';
import { OOH_REGIES } from '../../logique/constantes-calques';
import { EnteteFiltreComponent } from '../filtre/perimetre.component';
import { ListeMultipleComponent } from '../filtre/liste-multiple.component';
import { SelectionsCalquesService } from './selections-calques.service';
import { BOUTON_DESACTIVE, BOUTON_TEAL_ACTIF } from './section-transport.component';

/**
 * La section « Panneaux OOH et DOOH » du groupe Médias offline — portage de `filter-panel/OohSection.tsx`.
 *
 * Texte d'information repris tel quel (« 1 434 panneaux · Brest Métropole ») : c'est celui de React, écrit en dur — le
 * compte réel est celui de la légende « Analyse spatiale » une fois les panneaux affichés. Le bouton est toujours actif
 * chez React ; il est ici désactivé le temps de la requête, et l'échec est dit sous lui (React l'écrivait dans le
 * panneau de l'Assistant). Fond du bouton : `--text-primary` à 10 % (même raison que les POI).
 */
@Component({
  selector: 'mg-section-ooh',
  imports: [EnteteFiltreComponent, ListeMultipleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @keyframes fondu { from { opacity: 0; } to { opacity: 1; } }
    .fondu { animation: fondu 200ms var(--ease-out); }
  `,
  host: { class: 'flex flex-col gap-[10px]' },
  template: `
    <mg-entete-filtre libelle="Panneaux OOH et DOOH" [ouvert]="ouvert()" [compte]="choisies().length"
      (basculer)="selections.basculerSection('ooh')" />
    @if (ouvert()) {
      <div class="fondu" data-contenu-ooh>
        <div class="text-[12px] leading-[1.5] text-tertiary">
          <span class="text-secondary">1 434</span> panneaux · Brest Métropole<span class="text-tertiary"> · DECAUX, Clear Channel…</span>
        </div>
        <div>
          <div class="mb-1.5 flex items-center justify-between text-[11px] text-tertiary">
            <span>Filtrer par régie (optionnel)@if (choisies().length > 0) {<span class="text-secondary"> — {{ choisies().length }} sélectionnée{{ choisies().length > 1 ? 's' : '' }}</span>}</span>
            <span class="flex gap-1">
              <button type="button" data-tout title="Tout sélectionner" (click)="toutes()"
                class="cursor-pointer border-fin border-subtle bg-transparent px-1.5 py-px text-[11px] text-tertiary">Tout</button>
              <button type="button" data-aucune title="Tout désélectionner" (click)="selections.regiesOoh.set([])"
                class="cursor-pointer border-fin border-subtle bg-transparent px-[5px] py-px text-[10px] leading-none text-tertiary">✕</button>
            </span>
          </div>
          <mg-liste-multiple libelle="Toutes les régies" [items]="regies" [selection]="choisies()" (changer)="selections.regiesOoh.set($event)" />
        </div>
        <button type="button" data-afficher-ooh [disabled]="ooh.chargement()" (click)="afficher()"
          class="w-full rounded-[4px] border-fin px-[14px] py-[9px] text-[12px] transition-[background-color,border-color,color,opacity] duration-200 ease-[var(--ease-out)]"
          [class]="ooh.chargement() ? desactive : actif">{{ libelleBouton() }}</button>
        @if (ooh.erreur(); as e) {
          <div data-erreur class="mt-1.5 font-mono text-[10px] text-danger">! {{ e }}</div>
        }
      </div>
    }
  `,
})
export class SectionOohComponent {
  protected readonly selections = inject(SelectionsCalquesService);
  protected readonly ooh = inject(OohService);
  protected readonly regies = OOH_REGIES;
  protected readonly actif = BOUTON_TEAL_ACTIF;
  protected readonly desactive = BOUTON_DESACTIVE;
  protected readonly ouvert = computed(() => this.selections.sections()['ooh'] !== false);
  protected readonly choisies = this.selections.regiesOoh;
  protected readonly libelleBouton = computed(() => {
    const n = this.choisies().length;
    return n > 0 ? `Afficher — ${n} régie${n > 1 ? 's' : ''}` : 'Afficher tous les panneaux';
  });

  protected toutes(): void {
    this.selections.regiesOoh.set(OOH_REGIES.map((r) => r.id));
  }

  protected afficher(): void {
    const n = this.choisies();
    this.ooh.charger(n.length > 0 ? n : undefined);
  }
}
