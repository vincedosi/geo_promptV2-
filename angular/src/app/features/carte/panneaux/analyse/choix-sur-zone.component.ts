import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { LIBELLE_CHAMP, PASTILLE, PASTILLE_INACTIVE, PASTILLE_PRIMAIRE_ACTIVE } from './styles-analyse';

/**
 * ④ Analyse — « Sur : la zone analysée / le périmètre de ① », la bascule des outils qui savent lire une zone (score
 * composite T10, couverture par rayon T12). Le parent ne la monte que lorsqu'une zone est analysée.
 */
@Component({
  selector: 'mg-choix-sur-zone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div [class]="libelleChamp">Sur</div>
    <div class="flex gap-[5px]" role="group" [attr.aria-label]="'Périmètre ' + objet()">
      <button type="button" data-sur="zone" [attr.aria-pressed]="surZone()" (click)="surZone.set(true)"
        [class]="pastille + ' flex-1 text-center ' + (surZone() ? pastilleActive : pastilleInactive)">La zone analysée</button>
      <button type="button" data-sur="filtre" [attr.aria-pressed]="!surZone()" (click)="surZone.set(false)"
        [class]="pastille + ' flex-1 text-center ' + (surZone() ? pastilleInactive : pastilleActive)">Le périmètre de ①</button>
    </div>
  `,
})
export class ChoixSurZoneComponent {
  readonly surZone = model.required<boolean>();
  /** Le complément du libellé accessible : « du score », « de la couverture par rayon ». */
  readonly objet = input.required<string>();

  protected readonly libelleChamp = LIBELLE_CHAMP;
  protected readonly pastille = PASTILLE;
  protected readonly pastilleActive = PASTILLE_PRIMAIRE_ACTIVE;
  protected readonly pastilleInactive = PASTILLE_INACTIVE;
}
