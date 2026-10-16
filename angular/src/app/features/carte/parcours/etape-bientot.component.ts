import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ConfigService } from '../../../core/config/config.service';
import { type EtapeCarte, lienApplicationReact } from '../logique/parcours';

/**
 * Le panneau d'une étape pas encore portée (⑤ Jeu de zones, ⑥ Plan, ⑦ Activation, ⑧ Live — spec § 12 et § 15) : un lien
 * vers l'écran React qui le fait aujourd'hui (`/map?tab=…`, nouvel onglet). Sans origine React connue — hôte AIDA,
 * configuration pas encore lue — aucun lien : on n'invente pas une adresse. ⑤ n'a pas d'écran React équivalent (hors
 * module risque) : jamais de lien, « Bientôt dans le parcours. » (`lienApplicationReact` rend `null`). Ce que l'étape fera (sa consigne) est dit UNE fois, par
 * l'en-tête du panneau d'étape (`mg-panneau-etape`) — le répéter ici l'affichait deux fois (relecture T4).
 */
@Component({
  selector: 'mg-etape-bientot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-3 px-5 py-4' },
  template: `
    <div [attr.data-etape-bientot]="etape()" class="flex flex-col gap-3">
      @if (lien(); as href) {
        <a [href]="href" target="_blank" rel="noopener noreferrer"
           class="self-start rounded-[6px] border-fin border-teal px-4 py-2 text-[12px] font-medium text-teal no-underline transition-colors duration-150 ease-[var(--ease-hover)] hover:bg-teal-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-teal-50)]">
          Ouvrir dans l’application actuelle
        </a>
      } @else {
        <p class="m-0 text-[12px] text-tertiary">Bientôt dans le parcours.</p>
      }
    </div>
  `,
})
export class EtapeBientotComponent {
  readonly etape = input.required<EtapeCarte>();
  private readonly config = inject(ConfigService);
  protected readonly lien = computed(() => lienApplicationReact(this.origine(), this.etape()));

  /** `valeur` lève tant que la configuration n'est pas chargée : pas d'origine, pas de lien. */
  private origine(): string | undefined {
    try {
      return this.config.valeur.urlApplicationReact;
    } catch {
      return undefined;
    }
  }
}
