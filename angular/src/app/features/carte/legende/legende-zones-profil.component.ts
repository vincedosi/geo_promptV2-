import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { LegendeNiveauxComponent } from '../../../carte/legende/legende-niveaux.component';
import { CONVENTION_TRAIT, niveauxLegende } from '../../risques/logique/legende-niveaux';
import { ZonesRisqueService } from '../couches/zones-risque.service';
import { libelleDegrade } from '../logique/degrades';

/**
 * Le bloc « Zones de risque » de la légende de la carte principale : les zones ramenées par « Voir sur la carte »
 * (lot 4, T13). Défaut React corrigé : `ZonesRisqueLayer` ne réclamait pas son dégradé, et `LegendeCarte.tsx:168-172`
 * renvoyait la légende à une couche qui n'en dessinait aucune — les zones restaient sans légende sur `/map`.
 *
 * Niveaux et convention de trait viennent de `risques/logique/legende-niveaux.ts`, la source de la légende du module
 * (`carte-risque.component.ts`) : deux légendes des mêmes tuiles disent la même chose, rendues par le même
 * `mg-legende-niveaux`.
 */
@Component({
  selector: 'mg-legende-zones-profil',
  imports: [LegendeNiveauxComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-bloc': 'zones-profil' },
  template: `
    <div class="mb-1 text-[11px] font-medium text-secondary">{{ titre }}</div>
    <mg-legende-niveaux [niveaux]="niveaux()" />
    @if (natures(); as n) {
      <div data-natures class="mb-1 font-mono text-[10px] leading-[1.4] text-tertiary">{{ n }}</div>
    }
    <div class="text-[9.5px] leading-[1.5] text-tertiary">{{ conventionTrait }}</div>
  `,
})
export class LegendeZonesProfilComponent {
  private readonly zones = inject(ZonesRisqueService);
  protected readonly titre = libelleDegrade('zones-risque');
  protected readonly conventionTrait = CONVENTION_TRAIT;

  protected readonly niveaux = computed(() => {
    const z = this.zones.affichees();
    return z ? niveauxLegende(z.profil) : [];
  });

  /** Le filtre de natures, s'il y en a un : sans lui, rien ne dirait que la carte n'en montre qu'une partie. */
  protected readonly natures = computed(() => {
    const n = this.zones.affichees()?.natures.length ?? 0;
    return n === 0 ? null : `${n} nature${n > 1 ? 's' : ''} de risque retenue${n > 1 ? 's' : ''}`;
  });
}
