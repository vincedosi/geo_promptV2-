import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { BadgeSessionComponent } from './badge-session.component';
import { BasculeThemeComponent } from './bascule-theme.component';

/**
 * `components/layout/TopRightChrome.tsx` porté : bascule de thème puis badge de
 * session, `gap 8px`, `padding 8px 12px`. React le pose en `position: fixed`
 * (haut-droite de la fenêtre, z 200) ; ici la COQUILLE le place dans une rangée
 * `sticky` de hauteur nulle, en tête de son conteneur défilant (`fixed` interdit de l'isolation : un élément fixe se positionnerait
 * sur la fenêtre de l'HÔTE, par-dessus son menu).
 */
@Component({
  selector: 'mg-chrome-haut',
  imports: [BasculeThemeComponent, BadgeSessionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex items-center gap-2 px-3 py-2' },
  template: `
    <mg-bascule-theme />
    <mg-badge-session (orgChangee)="orgChangee.emit($event)" />
  `,
})
export class ChromeHautComponent {
  /** Relais du badge : l'organisation active a changé. */
  readonly orgChangee = output<string | null>();
}
