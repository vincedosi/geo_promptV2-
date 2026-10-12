import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { EntetePageComponent } from '../../../ui/entete-page/entete-page.component';
import { OngletsRoutesComponent, type OngletRoute } from '../commun/onglets-routes.component';

/**
 * Onglets de la page Données, dans l'ordre. « Sources » (T18-T20), « Importer » (T11-T17) et
 * « Historique » (`/admin/imports`) s'ajouteront ici quand leur écran sera porté — jamais d'onglet
 * « bientôt » (amendement du 2026-10-12).
 */
export const ONGLETS_DONNEES: readonly OngletRoute[] = [
  { chemin: 'qualite', libelle: 'Qualité' },
];

/**
 * `admin/donnees` — la page « Données » (lot 6, T6, amendement du 2026-10-12 : l'administration
 * tient en trois pages à onglets, Accès, Données, Système). Pas de source React pour le cadre :
 * React a une page par fonction ; les ÉCRANS montés dans les onglets restent à la parité React
 * (« Qualité » = `/admin/qualite-donnees`, T5, inchangé).
 *
 * Aucun état propre : la page Qualité lit ses relevés à son ouverture, comme React.
 */
@Component({
  selector: 'mg-donnees',
  imports: [EntetePageComponent, OngletsRoutesComponent, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mg-entete-page titre="Données" />
    <mg-onglets-routes [onglets]="onglets" libelle="Données" />
    <router-outlet />
  `,
})
export class DonneesPage {
  protected readonly onglets = ONGLETS_DONNEES;
}
