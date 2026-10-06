import { ChangeDetectionStrategy, Component } from '@angular/core';
import { BadgeSessionComponent } from '../../../layout/badge-session.component';
import { BasculeThemeComponent } from '../../../layout/bascule-theme.component';
import { LogoComponent } from '../../../ui/logo/logo.component';
import { ENTREES_NAVIGATION, LARGEUR_RAIL } from '../logique/navigation';
import { PROCHAINEMENT } from './rail.component';

/** Hauteur de la barre — `MAP_TOPBAR_HEIGHT` de `components/map/MapTopBar.tsx`. */
export const HAUTEUR_BARRE_HAUT = 44;

/** Libellé de l'entrée Campagne, lu dans la source unique de la navigation (jamais recopié). */
const CAMPAGNE = ENTREES_NAVIGATION.find((e) => e.id === 'campagne')!.label;

/**
 * La barre du haut de la carte — portage de `components/map/MapTopBar.tsx` :
 * `[logo MAGELIAN] …… [Campagne / Carte] …… [thème] [session]`.
 *
 * - `absolute` dans l'hôte de la page (arbitrage B1), à droite du rail, `z-index` 45 comme React.
 * - La bascule Campagne / Carte relève du lot 5 (arbitrage B6) : rendue À L'IDENTIQUE de React sans
 *   campagne ouverte — « Carte » soulignée et pressée —, « Campagne » INERTE (« Disponible
 *   prochainement »). « Carte » ne fait rien, comme en React quand l'overlay est fermé.
 * - Thème et session : `mg-bascule-theme` et `mg-badge-session` de la coquille, les portages de
 *   `ThemeToggle` et `SessionBadge` que React pose ici aussi.
 * - Écart voulu : pas de `backdrop-filter` (le fond est opaque, le flou n'avait aucun effet visible ;
 *   « flat total », DESIGN_SYSTEM § 2).
 */
@Component({
  selector: 'mg-barre-haut',
  imports: [BadgeSessionComponent, BasculeThemeComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'banner',
    class: 'absolute right-0 top-0 z-[45] flex items-center justify-between gap-3 border-b-fin border-subtle bg-surface pl-4 pr-[14px]',
    '[style.left.px]': 'gauche',
    '[style.height.px]': 'hauteur',
  },
  template: `
    <div class="flex shrink-0 items-center">
      <mg-logo [hauteur]="18" class="block" />
    </div>

    <div class="absolute left-1/2 flex min-w-0 max-w-[46%] -translate-x-1/2 items-center gap-2.5">
      <div class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          data-bascule="campagne"
          aria-pressed="false"
          aria-disabled="true"
          [attr.title]="prochainement"
          class="cursor-default border-0 border-b-2 border-solid border-transparent bg-transparent px-[2px] py-1 text-[12px] font-medium text-tertiary"
        >{{ campagne }}</button>
        <span class="text-[12px] text-tertiary">/</span>
        <button
          type="button"
          data-bascule="carte"
          aria-pressed="true"
          title="Revenir à la carte (Alt+C)"
          class="cursor-pointer border-0 border-b-2 border-solid border-teal bg-transparent px-[2px] py-1 text-[12px] font-medium text-primary"
        >Carte</button>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-1.5">
      <mg-bascule-theme />
      <mg-badge-session />
    </div>
  `,
})
export class BarreHautComponent {
  protected readonly gauche = LARGEUR_RAIL;
  protected readonly hauteur = HAUTEUR_BARRE_HAUT;
  protected readonly campagne = CAMPAGNE;
  protected readonly prochainement = PROCHAINEMENT;
}
