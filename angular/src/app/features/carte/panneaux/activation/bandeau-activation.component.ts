import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { BandeauKpiComponent } from '../../../../ui/bandeau-kpi/bandeau-kpi.component';
import { KpiComponent } from '../../../../ui/kpi/kpi.component';
import { ActivationCampagneService } from '../../etat/activation-campagne.service';

/** La valeur d'une tuile tant que rien n'est lu. */
const NEUTRE = '—';

/**
 * ⑦ Activation — le bandeau de l'étape (lot 7, T5, A-12), sur le patron de `mg-bandeau-plan` (⑥) : plateformes cochées,
 * prêtes, poussées, en erreur, dernière poussée. Les chiffres sont ceux de `ActivationCampagneService.bandeau`
 * (`bandeauActivation`, pur) ; aucune requête à part.
 *
 * Aucune tuile en accent teal : un chiffre teal tombe à ≈ 1,8:1 sur le fond clair du bandeau (relecture 3).
 *
 * NEUTRE PENDANT LA LECTURE (relecture 2, M-1) : tant que `chargement` est vrai, chaque tuile vaut « — » — le pré-vol ou
 * l'historique d'avant (ou d'une autre campagne) ne sont jamais présentés comme ceux de la campagne ouverte.
 */
@Component({
  selector: 'mg-bandeau-activation',
  imports: [BandeauKpiComponent, KpiComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-bandeau-activation': '' },
  template: `
    <mg-bandeau-kpi>
      <mg-kpi data-kpi="plateformes" [taille]="22" [valeur]="v().plateformes" libelle="Plateformes" note="cochées à l’étape ⑥" />
      <mg-kpi data-kpi="pretes" [taille]="22" [valeur]="v().pretes" libelle="Prêtes" note="sans motif bloquant" />
      <mg-kpi data-kpi="poussees" [taille]="22" [valeur]="v().poussees" libelle="Poussées" note="un lot abouti, non annulé" />
      <mg-kpi data-kpi="erreur" [taille]="22" [valeur]="v().enErreur" libelle="En erreur" note="dernier lot en échec ou partiel" />
      <mg-kpi data-kpi="derniere" [taille]="22" [valeur]="v().derniere" libelle="Dernière poussée" note="lot le plus récent" />
    </mg-bandeau-kpi>
  `,
})
export class BandeauActivationComponent {
  private readonly activation = inject(ActivationCampagneService);

  protected readonly v = computed(() => {
    if (this.activation.chargement()) {
      return { plateformes: NEUTRE, pretes: NEUTRE, poussees: NEUTRE, enErreur: NEUTRE, derniere: NEUTRE };
    }
    const b = this.activation.bandeau();
    return {
      plateformes: formaterNombre(b.plateformes),
      pretes: formaterNombre(b.pretes),
      poussees: formaterNombre(b.poussees),
      enErreur: formaterNombre(b.enErreur),
      derniere: b.derniere ?? NEUTRE,
    };
  });
}
