import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { ActivationCampagneService } from '../../etat/activation-campagne.service';
import { PlanCampagneService } from '../../etat/plan-campagne.service';
import { libellePublication, motifDePublication } from '../../logique/activation/motifs';
import { BOUTON_TEAL, ENCART_PRET, SAISIE_MONO } from './styles-activation';

/** React, mot pour mot (`ActivationPanel.tsx:359-360`) : le geste est sortant et additif, il est dit AVANT. */
export const AVERTISSEMENT_ADDITIF =
  'La poussée ajoute le ciblage aux line items ; elle n’efface rien de ce qui s’y trouve déjà, et ne peut pas être défaite depuis dentsu.explore.';
export const MESSAGE_MODE_DEMO = 'Mode démo : rien ne part chez Google.';
export const MESSAGE_POUSSEE_AILLEURS = 'Une poussée est en cours sur une autre campagne.';

/**
 * ⑦ Activation — la poussée DV360, projetée dans la carte DV360 (lot 7, T4) : port du bloc « Pré-vol » actionnable de
 * `ActivationPanel.tsx` (publication à côté du motif qui la demande, A-9 ; annonceur et line items, A-8 ; bouton de
 * poussée et avertissement additif). L'annonceur est PRÉREMPLI de la liaison DV360 de ⑥ (`links.dv360.advertiser_id`)
 * et reste modifiable ; il repart de la liaison quand la campagne change. Les line items sont saisis à la main (Q-3).
 *
 * Une poussée en cours sur UNE AUTRE campagne désactive le bouton et le dit (A-10). En mode simulé (démo sans
 * connexion), le bouton dit « Simuler » et la note rappelle que rien ne part chez Google.
 */
@Component({
  selector: 'mg-poussee-dv360',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-2', 'data-poussee-dv360': '' },
  template: `
    @if (publiable()) {
      <button type="button" data-publier (click)="activation.publier()" [disabled]="activation.publication()" [class]="boutonTeal + ' self-start text-[11px]'">
        {{ activation.publication() ? 'Publication…' : libellePublication() }}
      </button>
    }
    @if (prevol()?.activable) {
      <div data-pret [class]="encartPret">
        Prêt à activer — v{{ prevol()?.version_publiee }} sur {{ nCp() }} codes postaux.
      </div>
      <input type="text" data-annonceur [value]="annonceur()" (input)="annonceur.set(valeur($event))"
             placeholder="Identifiant annonceur DV360" aria-label="Identifiant annonceur DV360" [class]="saisie" />
      <textarea data-line-items rows="2" [value]="lineItems()" (input)="lineItems.set(valeur($event))"
                placeholder="Identifiants de line items, séparés par des virgules ou des retours à la ligne"
                aria-label="Identifiants de line items" [class]="saisie + ' resize-y'"></textarea>
      <button type="button" data-pousser (click)="pousser()" [disabled]="!activable()" [class]="boutonTeal">{{ libelleBouton() }}</button>
      @if (ailleurs()) { <div data-poussee-ailleurs class="text-[11px] text-secondary">{{ messageAilleurs }}</div> }
      @if (simule()) { <div data-mode-demo class="text-[10px] leading-[1.5] text-tertiary">{{ messageDemo }}</div> }
      <div data-additif class="text-[10px] leading-[1.5] text-tertiary">{{ additif }}</div>
    }
  `,
})
export class PousseeDv360Component {
  protected readonly activation = inject(ActivationCampagneService);
  private readonly plan = inject(PlanCampagneService);
  protected readonly boutonTeal = BOUTON_TEAL;
  protected readonly encartPret = ENCART_PRET;
  protected readonly saisie = SAISIE_MONO;
  protected readonly additif = AVERTISSEMENT_ADDITIF;
  protected readonly messageDemo = MESSAGE_MODE_DEMO;
  protected readonly messageAilleurs = MESSAGE_POUSSEE_AILLEURS;

  protected readonly prevol = this.activation.prevol;
  /** L'annonceur de la liaison DV360 de ⑥, repris à chaque campagne (ou relecture de ses canaux). */
  protected readonly annonceur = linkedSignal(() => this.plan.canaux()?.selected.links?.['dv360']?.['advertiser_id'] ?? '');
  protected readonly lineItems = linkedSignal<string | null, string>({ source: () => this.plan.campagne(), computation: () => '' });

  protected readonly publiable = computed(() => {
    const p = this.prevol();
    return !!p?.strategie && p.motifs.some(motifDePublication);
  });
  protected readonly libellePublication = computed(() => libellePublication(this.prevol()?.version_publiee ?? null));
  protected readonly nCp = computed(() => formaterNombre(this.prevol()?.n_cp_dv360));
  protected readonly simule = computed(() => this.prevol()?.mode_dv360 === 'simule');
  private readonly ici = computed(() => this.activation.pousseeEnCours()?.campagne === this.plan.campagne());
  protected readonly ailleurs = computed(() => !!this.activation.pousseeEnCours() && !this.ici());
  protected readonly activable = computed(() =>
    !this.activation.pousseeEnCours() && !!this.annonceur().trim() && !!this.lineItems().trim());
  protected readonly libelleBouton = computed(() => {
    if (this.ici()) return 'Poussée en cours…';
    return this.simule() ? 'Simuler la poussée vers DV360' : 'Pousser le ciblage vers DV360';
  });

  protected valeur(e: Event): string {
    return (e.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected pousser(): void {
    this.activation.pousser(this.annonceur(), this.lineItems());
  }
}
