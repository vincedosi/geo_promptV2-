import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { PastillesComponent } from './pastilles.component';
import { LIBELLE_CHAMP } from './styles-analyse';

const OPTIONS = [
  { cle: 'zone', valeur: true, libelle: 'La zone analysée' },
  { cle: 'filtre', valeur: false, libelle: 'Le périmètre de ①' },
] as const;

/**
 * ④ Analyse — « Sur : la zone analysée / le périmètre de ① », la bascule des outils qui savent lire une zone (score
 * composite T10, couverture par rayon T12). Le parent ne la monte que lorsqu'une zone est analysée.
 */
@Component({
  selector: 'mg-choix-sur-zone',
  imports: [PastillesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div [class]="libelleChamp">Sur</div>
    <mg-pastilles [libelle]="'Périmètre ' + objet()" [options]="options" [(valeur)]="surZone" />
  `,
})
export class ChoixSurZoneComponent {
  readonly surZone = model.required<boolean>();
  /** Le complément du libellé accessible : « du score », « de la couverture par rayon ». */
  readonly objet = input.required<string>();

  protected readonly libelleChamp = LIBELLE_CHAMP;
  protected readonly options = OPTIONS;
}
