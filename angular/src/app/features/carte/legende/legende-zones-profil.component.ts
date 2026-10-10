import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { LegendeNiveauxComponent, type NiveauLegende } from '../../../carte/legende/legende-niveaux.component';
import { LIBELLE_NIVEAU, NIVEAUX, anneauxDuNiveau } from '../../risques/logique/profil';
import { ZonesRisqueService } from '../couches/zones-risque.service';
import { libelleDegrade } from '../logique/degrades';

/** Le jeton de chaque niveau (DOM : `var()` y est permis) — ceux que `ZonesRisqueService` lit pour MapLibre. */
const JETON_NIVEAU = { haut: 'niveau-haut', bas: 'niveau-bas', autres: 'niveau-autres' } as const;

/**
 * Le bloc « Zones de risque » de la légende de la carte principale : les zones ramenées par « Voir sur la carte »
 * (lot 4, T13). Défaut React corrigé : `ZonesRisqueLayer` ne réclamait pas son dégradé, et `LegendeCarte.tsx:168-172`
 * renvoyait la légende à une couche qui n'en dessinait aucune — les zones restaient sans légende sur `/map`.
 *
 * Le contenu est celui de la légende du module (`carte-risque.component.ts`) : par niveau, un carré par anneau à
 * l'opacité de sa bande (`mg-legende-niveaux`, le même composant), puis la convention de trait. Deux légendes qui
 * décrivent les mêmes tuiles disent la même chose.
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
    <div class="text-[9.5px] leading-[1.5] text-tertiary">Trait plein : périmètre publié par l’État. Tireté : rayon que nous calculons.</div>
  `,
})
export class LegendeZonesProfilComponent {
  private readonly zones = inject(ZonesRisqueService);
  protected readonly titre = libelleDegrade('zones-risque');

  protected readonly niveaux = computed<NiveauLegende[]>(() => {
    const z = this.zones.affichees();
    if (!z) return [];
    return NIVEAUX.map((n) => ({ libelle: LIBELLE_NIVEAU[n], jeton: JETON_NIVEAU[n], anneaux: anneauxDuNiveau(z.profil, n) }));
  });

  /** Le filtre de natures, s'il y en a un : sans lui, rien ne dirait que la carte n'en montre qu'une partie. */
  protected readonly natures = computed(() => {
    const n = this.zones.affichees()?.natures.length ?? 0;
    return n === 0 ? null : `${n} nature${n > 1 ? 's' : ''} de risque retenue${n > 1 ? 's' : ''}`;
  });
}
