import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { EnteteSectionComponent } from '../../../../ui/entete-section/entete-section.component';
import { ActivationCampagneService } from '../../etat/activation-campagne.service';
import { ParcoursService } from '../../etat/parcours.service';
import { PlanCampagneService } from '../../etat/plan-campagne.service';
import { ENCART_ERREUR } from '../analyse/styles-analyse';
import { CartePlateformeComponent } from './carte-plateforme.component';
import { FluxPousseeComponent } from './flux-poussee.component';
import { HistoriqueActivationComponent } from './historique-activation.component';
import { PousseeDv360Component } from './poussee-dv360.component';

export const MESSAGE_SANS_CAMPAGNE = 'Choisissez une campagne dans la barre, ou créez-la à l’étape ⑥.';
export const MESSAGE_SANS_PLAN = 'Cette campagne n’a pas encore de plan : lancez-la à l’étape ⑥.';

/**
 * ⑦ Activation — le panneau de l'étape (lot 7, T4) : port quasi tel quel d'`ActivationPanel.tsx` (onglet Activation de
 * l'overlay React), découpé par plateforme (A-4) :
 *
 * - sans `?campagne=` : le renvoi vers ⑥ ; une campagne d'un autre espace a déjà été retirée par `PlanCampagneService`,
 *   dont le message est dit ;
 * - accès refusé : le message de `PlanCampagneService`, et rien n'est lu ;
 * - campagne sans plan (aucune stratégie) : le renvoi vers ⑥ ;
 * - sinon : le pré-vol (version publiée, codes postaux, canaux connectés — React, sans la ligne « Stratégie », E4), une
 *   carte par plateforme cochée en ⑥ (la carte DV360 porte la poussée), le flux de la poussée, l'historique.
 *
 * Tout l'état vit dans `ActivationCampagneService` (page) ; le panneau reste MONTÉ quand on quitte l'étape (A1) — une
 * poussée en cours lui survit, et au service de toute façon.
 */
@Component({
  selector: 'mg-panneau-activation',
  imports: [CartePlateformeComponent, NgTemplateOutlet, EnteteSectionComponent, FluxPousseeComponent, HistoriqueActivationComponent, PousseeDv360Component],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col', 'data-panneau-activation': '' },
  template: `
    @if (!plan.campagne() || plan.accesRefuse()) {
      @if (plan.erreur(); as e) { <div data-erreur-activation role="alert" [class]="'mx-4 mt-3 ' + encartErreur">{{ e }}</div> }
      @if (!plan.campagne()) { <ng-container [ngTemplateOutlet]="renvoi" [ngTemplateOutletContext]="{ $implicit: messageSansCampagne }" /> }
    } @else {
      @if (activation.erreur(); as e) { <div data-erreur-activation role="alert" [class]="'mx-4 mt-3 ' + encartErreur">{{ e }}</div> }
      @if (!prevol() && !activation.erreur()) {
        <div data-chargement-activation class="px-4 py-3 font-mono text-[12px] text-tertiary">Pré-vol en cours…</div>
      }
      @if (prevol(); as p) {
        @if (!p.strategie) {
          <ng-container [ngTemplateOutlet]="renvoi" [ngTemplateOutletContext]="{ $implicit: messageSansPlan }" />
        } @else {
          <mg-entete-section libelle="Pré-vol" class="mt-2" />
          <div data-prevol class="px-3.5 py-3 font-mono text-[11px] leading-[1.8] text-secondary">
            <div>Version publiée : {{ p.version_publiee != null ? 'v' + p.version_publiee : 'jamais publiée' }}</div>
            <div>Codes postaux : {{ nCp() }}</div>
            <div>Canaux connectés : {{ canauxConnectes() }}</div>
          </div>
          <div data-cartes class="flex flex-col gap-2.5 px-3.5 pb-3">
            @for (c of activation.cartes(); track c.canal) {
              <mg-carte-plateforme [carte]="c">
                @if (c.plateforme === 'dv360' && c.maille === 'cp') { <mg-poussee-dv360 /> }
              </mg-carte-plateforme>
            } @empty {
              <div data-aucune-plateforme class="text-[11px] text-tertiary">Aucune plateforme cochée à l’étape ⑥.</div>
            }
          </div>
          <mg-flux-poussee />
          <mg-historique-activation />
        }
      }
    }
    <ng-template #renvoi let-message>
      <p data-renvoi-plan class="m-0 px-4 pt-3 text-[12px] leading-[1.5] text-secondary">{{ message }}</p>
      <button type="button" data-aller-plan (click)="parcours.choisir('plan')"
              class="mx-4 mb-3 mt-2 self-start cursor-pointer rounded-[6px] border-fin border-default bg-transparent px-3 py-1.5 text-[12px] text-secondary hover:border-hover hover:bg-elevated hover:text-primary">Aller à ⑥ Plan</button>
    </ng-template>
  `,
})
export class PanneauActivationComponent {
  protected readonly plan = inject(PlanCampagneService);
  protected readonly activation = inject(ActivationCampagneService);
  protected readonly parcours = inject(ParcoursService);
  protected readonly encartErreur = ENCART_ERREUR;
  protected readonly messageSansCampagne = MESSAGE_SANS_CAMPAGNE;
  protected readonly messageSansPlan = MESSAGE_SANS_PLAN;

  protected readonly prevol = this.activation.prevol;
  protected readonly nCp = computed(() => formaterNombre(this.prevol()?.n_codes_postaux));
  protected readonly canauxConnectes = computed(() => {
    const c = this.prevol()?.canaux_connectes ?? [];
    return c.length ? c.map((x) => x.provider).join(', ') : 'aucun';
  });
}
