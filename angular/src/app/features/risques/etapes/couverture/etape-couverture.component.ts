import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DonneesRisqueService } from '../../etat/donnees-risque.service';
import { peutDescendre, peutRemonter } from '../../logique/exploration';
import { TableauCouvertureComponent } from './tableau-couverture.component';

/**
 * ③ Couverture — le tableau des territoires et son exploration LOCALE. Portage de
 * `AnalysePopulationOverlay.tsx:1377-1457` (tableau, fil local) ; la mini-carte qui le suit arrive en T12.
 *
 * ── LE FILTRE DIT CE QU'ON ÉTUDIE, L'EXPLORATION CE QU'ON REGARDE ────────
 *
 * Descendre dans une région liste ses départements DANS CE TABLEAU, et nulle part ailleurs : ni le filtre Territoire,
 * ni l'URL, ni le bandeau KPI, ni la courbe ne bougent. Le tableau lit donc `bandesTableau` — l'exploré pendant une
 * exploration, sinon le calcul global — et JAMAIS le calcul global seul. Le second calcul ne part que pendant une
 * exploration : sans ce garde-fou il doublerait chaque calcul, 2,8 s sur le national.
 *
 * ⚠ L'état de l'exploration vit dans `DonneesRisqueService` et non ici : ce panneau est sous le `@switch` des étapes,
 * donc se démonte, alors que React garde l'exploration — et son calcul — à travers un aller-retour ② ↔ ③. Ce
 * composant en est la VUE : il relit `exploration`, `mailleTableau`, `bandesTableau`, `actif` et `selectionCarte`,
 * ré-exposés pour la mini-carte de T12.
 */
@Component({
  selector: 'mg-etape-couverture',
  imports: [TableauCouvertureComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <mg-tableau-couverture [resultat]="bandesTableau()" [maille]="mailleTableau()" [profil]="donnees.profilCalcul()"
                           [libelleCible]="donnees.libelleCible()" [descendable]="descendable()"
                           [remontable]="remontable()" [actif]="actif()"
                           (descendre)="donnees.descendreExploration($event.code, $event.nom)"
                           (remonter)="donnees.remonterExploration()" (selection)="donnees.selectionner($event)"
                           (survol)="donnees.survoler($event)" />

    <!-- Le fil d'Ariane LOCAL : sans lui, on lirait des départements sans savoir de quelle région, pendant que la
         barre du haut annonce « France entière ». Mot pour mot de React (l.1441-1456). -->
    @if (exploration().length > 0) {
      <p data-role="fil-exploration" class="mb-0 mt-[10px] text-[11px] text-tertiary">
        Exploration :
        <button type="button" class="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-teal"
                (click)="donnees.quitterExploration()">{{ racine() }}</button>@for (s of exploration(); track s.code) {<span> › {{ s.nom }}</span>} — le filtre Territoire de la barre, lui, n’a pas bougé.
      </p>
    }
  `,
})
export class EtapeCouvertureComponent {
  protected readonly donnees = inject(DonneesRisqueService);

  /** Les unités traversées par l'exploration (T12 : cadrage et filtre des contours). */
  readonly exploration = this.donnees.exploration;
  /** La maille réellement listée ET dessinée. */
  readonly mailleTableau = this.donnees.mailleTableau;
  /** Le résultat affiché : l'exploré s'il existe, sinon le global — la mini-carte lit CELUI-CI (T12). */
  readonly bandesTableau = this.donnees.bandesTableau;
  /** L'unité survolée, partagée tableau ↔ mini-carte. */
  readonly actif = this.donnees.actif;
  /** L'unité sur laquelle la mini-carte se cadre. */
  readonly selectionCarte = this.donnees.selectionCarte;

  protected readonly descendable = computed(() => peutDescendre(this.mailleTableau()));
  protected readonly remontable = computed(() => peutRemonter(this.exploration()));
  /** Le premier lien du fil local : le territoire du FILTRE, d'où l'exploration est partie. */
  protected readonly racine = computed(() => this.donnees.chemin().at(-1)?.nom ?? 'France entière');
}
