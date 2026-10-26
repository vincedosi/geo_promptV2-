import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { ConfirmationComponent } from '../../../../ui/confirmation/confirmation.component';
import { EnteteSectionComponent } from '../../../../ui/entete-section/entete-section.component';
import type { LotActivation } from '../../data/activation.api';
import { ActivationCampagneService } from '../../etat/activation-campagne.service';
import { PlanCampagneService } from '../../etat/plan-campagne.service';
import { dateHeureFr } from '../../../../core/format/date';
import { compteLineItems, compteStatut, libelleStatut } from '../../logique/activation/statuts';
import { BOUTON_NEUTRE, ENCART_MOTIF, POINT_STATUT } from './styles-activation';

/** La seconde ligne d'un lot (`ActivationPanel.tsx:424-426`) : version, nombre de line items, puis les comptes par
 * statut, libellés et accordés (`statuts.ts`, preuve C-2 : React écrivait « 2 pousse »). */
export function detailLot(l: LotActivation): string {
  const version = l.version_strategie != null ? `v${l.version_strategie} · ` : '';
  const cibles = Object.entries(l.cibles).map(([s, n]) => ` · ${compteStatut(n, s)}`).join('');
  return `${version}${compteLineItems(l.n_cibles)}${cibles}`;
}

/**
 * ⑦ Activation — l'historique des poussées de la campagne courante (lot 7, T4) : port de la section « Historique des
 * activations » de `ActivationPanel.tsx`. Le statut se lit par un libellé en texte primaire et un POINT de sa couleur
 * (contraste en thème clair) ; « Simulé » marque un lot de démo (sql/281). « Annuler ce lot » ouvre `mg-confirmation`
 * (« Marquer ce lot annulé ? ») ; le message d'annulation (`ActivationCampagneService.messageAnnulation`) dit ce que
 * l'annulation NE fait PAS (rien n'est retiré du DSP).
 */
@Component({
  selector: 'mg-historique-activation',
  imports: [ConfirmationComponent, EnteteSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col', 'data-historique-activation': '' },
  template: `
    <mg-entete-section libelle="Historique des activations" />
    <div class="flex flex-col gap-2 px-3.5 py-3">
      @for (l of lignes(); track l.lot.id) {
        <div [attr.data-lot]="l.lot.id" class="rounded-[6px] border-fin border-subtle bg-elevated p-2.5">
          <div class="flex items-center gap-2">
            <span data-canal class="font-mono text-[11px] text-primary">{{ l.canal }}</span>
            <span data-statut class="flex items-center gap-1.5 font-mono text-[10px] text-primary">
              <span [class]="'h-1.5 w-1.5 shrink-0 rounded-full ' + l.point"></span>{{ l.statut }}
            </span>
            @if (l.lot.mode === 'simule') {
              <span data-simule class="rounded-[4px] border-fin border-default bg-overlay px-1.5 py-px text-[10px] text-secondary">Simulé</span>
            }
            <span data-date class="ml-auto font-mono text-[10px] text-tertiary">{{ l.date }}</span>
          </div>
          <div data-detail class="mt-1 font-mono text-[10px] text-tertiary">{{ l.detail }}</div>
          @if (l.lot.statut !== 'annule') {
            <button type="button" data-annuler-lot (click)="aAnnuler.set(l.lot.id)" [class]="boutonNeutre + ' mt-2'">Annuler ce lot</button>
          }
        </div>
      } @empty {
        <div data-aucun-lot class="text-[11px] text-tertiary">Aucune activation pour cette campagne.</div>
      }
      @if (activation.messageAnnulation(); as m) { <div data-message-annulation role="status" [class]="encartMotif + ' mt-1'">{{ m }}</div> }
    </div>
    <mg-confirmation [ouvert]="aAnnuler() !== null" titre="Marquer ce lot annulé ?" libelleAnnuler="Non" variante="danger"
                     (confirmer)="confirmer()" (annuler)="aAnnuler.set(null)" />
  `,
})
export class HistoriqueActivationComponent {
  protected readonly activation = inject(ActivationCampagneService);
  private readonly plan = inject(PlanCampagneService);
  protected readonly boutonNeutre = BOUTON_NEUTRE;
  protected readonly encartMotif = ENCART_MOTIF;

  /** Le lot dont l'annulation est demandée ; oublié au changement de campagne. */
  protected readonly aAnnuler = linkedSignal<string | null, string | null>({ source: () => this.plan.campagne(), computation: () => null });

  protected readonly lignes = computed(() => this.activation.lots().map((lot) => ({
    lot,
    canal: this.plan.libelleCanal(lot.canal),
    statut: libelleStatut(lot.statut),
    point: POINT_STATUT[lot.statut] ?? 'bg-tertiary',
    date: dateHeureFr(lot.lance_le),
    detail: detailLot(lot),
  })));

  protected confirmer(): void {
    const lot = this.aAnnuler();
    this.aAnnuler.set(null);
    if (lot) this.activation.annuler(lot);
  }
}
