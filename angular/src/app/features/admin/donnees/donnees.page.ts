import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { EntetePageComponent } from '../../../ui/entete-page/entete-page.component';
import { OngletsRoutesComponent, type OngletRoute } from '../commun/onglets-routes.component';

/**
 * Onglets de la page Données, dans l'ordre cible (Sources, Importer, Historique, Qualité — A9) :
 * le flux de la donnée, d'où elle vient, comment elle entre, ce qui est entré, ce qu'elle vaut.
 * Jamais d'onglet « bientôt » (amendement du 2026-10-12). « Sources » = `/admin/sources` (T18 ; ses
 * panneaux par type en T19-T20) ; « Importer » = les écrans d'import portés (T15 : IRIS, A7) ;
 * « Historique » = `/admin/imports` (T11′). La racine de la page mène au PREMIER onglet, « Sources »
 * (T18) : une vue d'ensemble en lecture — pas un dépôt de fichier, qui inviterait à écrire.
 */
export const ONGLETS_DONNEES: readonly OngletRoute[] = [
  { chemin: 'sources', libelle: 'Sources' },
  { chemin: 'importer', libelle: 'Importer' },
  { chemin: 'historique', libelle: 'Historique' },
  { chemin: 'qualite', libelle: 'Qualité' },
];

/**
 * `admin/donnees` — la page « Données » (lot 6, T6, amendement du 2026-10-12 : l'administration
 * tient en trois pages à onglets, Accès, Données, Système). Pas de source React pour le cadre :
 * React a une page par fonction ; les ÉCRANS montés dans les onglets restent à la parité React
 * (« Qualité » = `/admin/qualite-donnees`, T5, inchangé).
 *
 * Aucun état propre : la page Qualité lit ses relevés à son ouverture, comme React.
 * Largeur 1 100 px pour la barre ET le contenu (minor T6 : la barre courait sur toute la largeur
 * au-dessus d'un contenu borné) : celle de Qualité React (`qualite-donnees/page.tsx:152`).
 */
@Component({
  selector: 'mg-donnees',
  imports: [EntetePageComponent, OngletsRoutesComponent, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="max-w-[1100px]">
      <mg-entete-page titre="Données" />
      <mg-onglets-routes [onglets]="onglets" libelle="Données" />
      <router-outlet />
    </div>
  `,
})
export class DonneesPage {
  protected readonly onglets = ONGLETS_DONNEES;
}
