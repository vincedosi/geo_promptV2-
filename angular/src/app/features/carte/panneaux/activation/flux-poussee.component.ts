import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { EnteteSectionComponent } from '../../../../ui/entete-section/entete-section.component';
import type { LigneFlux } from '../../data/activation.api';
import { ActivationCampagneService } from '../../etat/activation-campagne.service';
import { PlanCampagneService } from '../../etat/plan-campagne.service';
import { compteLineItems, compteStatut, statutMinuscule } from '../../logique/activation/statuts';

/**
 * Le texte d'une ligne du flux, ceux de React (`ActivationPanel.tsx:382-384`), statuts libellés et comptes accordés
 * (`statuts.ts`, preuve C-2 : React écrivait « · en_cours », « 2 poussé(s) »). `total` vient de la ligne `debut` :
 * la route ne le répète que sur la ligne `en_cours` d'une cible, pas sur son issue (`pousse`/`echec`), où React
 * affichait « [1/undefined] ».
 */
export function texteLigneFlux(l: LigneFlux, total: number | undefined): string {
  if (l.etape === 'debut') return `Départ — ${compteLineItems(l.total ?? 0)}`;
  if (l.etape === 'cible') {
    return `[${l.n}/${l.total ?? total}] ${l.line_item_id} · ${statutMinuscule(l.statut ?? '')}${l.erreur ? ` — ${l.erreur}` : ''}`;
  }
  if (l.etape === 'fin') return `Terminé — ${compteStatut(l.pousses ?? 0, 'pousse')}, ${compteStatut(l.echecs ?? 0, 'echec')}`;
  return '';
}

/**
 * ⑦ Activation — le flux de la poussée de la campagne courante (lot 7, T4) : une ligne par line item, au fil de l'eau
 * (règle CLAUDE.md : jamais de traitement silencieux), et une barre au rapport cibles traitées / total. Le flux reste
 * lié à SA campagne (A-10) : il réapparaît quand on revient sur elle.
 *
 * La barre est déterminée, donc écrite ici : `mg-barre-progression` est une barre d'attente sans rapport (elle lit un
 * `ChargementService`, sans valeur).
 */
@Component({
  selector: 'mg-flux-poussee',
  imports: [EnteteSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col', 'data-flux-poussee': '' },
  template: `
    @if (activation.flux().length) {
      <mg-entete-section [libelle]="enCours() ? 'Poussée en cours' : 'Poussée terminée'" />
      <div class="flex flex-col gap-2 px-3.5 py-3">
        <div role="progressbar" aria-label="Line items traités" aria-valuemin="0" [attr.aria-valuemax]="total() ?? 0" [attr.aria-valuenow]="traites()"
             class="h-[3px] overflow-hidden rounded-[2px] bg-overlay">
          <div data-barre class="h-full bg-teal transition-[width] duration-200 ease-linear" [style.width.%]="pourcent()"></div>
        </div>
        <div data-lignes class="max-h-[220px] overflow-y-auto font-mono text-[10px] leading-[1.7] text-tertiary">
          @for (l of lignes(); track $index) {
            <div [class.text-danger]="l.echec">{{ l.texte }}</div>
          }
        </div>
      </div>
    }
  `,
})
export class FluxPousseeComponent {
  protected readonly activation = inject(ActivationCampagneService);
  private readonly plan = inject(PlanCampagneService);

  protected readonly enCours = computed(() => this.activation.pousseeEnCours()?.campagne === this.plan.campagne());
  protected readonly total = computed(() => this.activation.flux().find((l) => l.etape === 'debut')?.total);
  /** Les cibles dont l'issue est connue (une ligne `pousse` ou `echec`), ou toutes à la fin. */
  protected readonly traites = computed(() => {
    const f = this.activation.flux();
    if (f.some((l) => l.etape === 'fin')) return this.total() ?? 0;
    return f.filter((l) => l.etape === 'cible' && l.statut !== 'en_cours').length;
  });
  protected readonly pourcent = computed(() => {
    const t = this.total();
    return t ? Math.min(100, (this.traites() / t) * 100) : 0;
  });
  protected readonly lignes = computed(() => {
    const total = this.total();
    return this.activation.flux().map((l) => ({ texte: texteLigneFlux(l, total), echec: l.statut === 'echec' }));
  });
}
