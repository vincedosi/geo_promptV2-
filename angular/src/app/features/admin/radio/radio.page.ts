import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { OngletsRoutesComponent, type OngletRoute } from '../commun/onglets-routes.component';
import { RadioImportService } from './etat/radio-import.service';

/**
 * Les onglets PROPRES à l'écran Radio (`page.tsx:356-366` : Import, Radios, Statistiques), en
 * sous-routes relatives ; seuls les portés sont listés — Import (T16). Radios et Statistiques : T17.
 */
export const ONGLETS_RADIO: readonly OngletRoute[] = [
  { chemin: 'import', libelle: 'Import' },
];

/**
 * `admin/donnees/importer/radio` — portage de `app/admin/radio/page.tsx` (lot 6, T16), type « Radio » de
 * l'onglet « Importer » de la page Données (amendement A7) ; `admin/radio` y redirige.
 *
 * Le cadre de l'écran : badge et sous-titre de React, puis SES onglets (sous-routes relatives, lien
 * partageable). Il fournit `RadioImportService`, l'état que React tient au niveau de la PAGE : changer
 * d'onglet ne perd ni le journal ni un import en cours. Les deux lectures du montage de React (stats,
 * historique) partent ici, quel que soit l'onglet ouvert ; les onglets Radios et Statistiques (T17)
 * liront les leurs à leur ouverture.
 *
 * Écarts à React, voulus : titre « Radio FM/DAB+ » porté par le cadre (« Données », onglet « Importer »,
 * type « Radio ») ; onglets `role="tab"` et liens (React : boutons d'état).
 */
@Component({
  selector: 'mg-radio',
  imports: [OngletsRoutesComponent, RouterOutlet],
  providers: [RadioImportService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="entete" data-entete>
      <div class="badges"><span class="badge" data-badge>Admin</span></div>
      <p class="sous-titre" data-sous-titre>Import, classification, audience et tarifs des émetteurs radio</p>
    </div>
    <mg-onglets-routes [onglets]="onglets" libelle="Radio FM/DAB+" variante="large" />
    <router-outlet />
  `,
  styles: [`
    :host { display: block; font-family: var(--font-sans); }
    .entete { margin-bottom: 24px; }
    .badges { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
    .badge {
      font-size: 10px; padding: 2px 8px; background: var(--bg-level-3); border: 0.5px solid var(--border-default);
      border-radius: 4px; color: var(--text-tertiary);
    }
    .sous-titre { font-size: 13px; color: var(--text-tertiary); margin: 0; }
  `],
})
export class RadioPage {
  protected readonly onglets = ONGLETS_RADIO;

  constructor() {
    inject(RadioImportService).charger();
  }
}
