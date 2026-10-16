import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { EntetePageComponent } from '../../../ui/entete-page/entete-page.component';
import { OngletsRoutesComponent, type OngletRoute } from '../commun/onglets-routes.component';

/**
 * Onglets de la page Données, dans l'ordre cible (Sources, Importer, Historique, Qualité — A9).
 * « Sources » (T18-T20) et « Importer » (T12-T17) s'ajouteront ici quand leur écran sera porté —
 * jamais d'onglet « bientôt » (amendement du 2026-10-12). « Historique » = `/admin/imports` (T11′).
 * La racine de la page mène toujours à « Qualité » (le premier écran porté).
 */
export const ONGLETS_DONNEES: readonly OngletRoute[] = [
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
