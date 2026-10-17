import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { OngletsRoutesComponent, type OngletRoute } from '../commun/onglets-routes.component';

/**
 * Le choix du type d'import (amendement A7) : UN sous-onglet par écran d'import PORTÉ, jamais d'entrée
 * « bientôt ». Ordre cible : POI, Shapefile, IRIS, Radio — chaque tâche d'import ajoute le sien à sa
 * place (T14 `shapefile`). Aujourd'hui : POI (T12, en tête : le plus courant), IRIS (T15), Radio (T16).
 */
export const ONGLETS_IMPORTER: readonly OngletRoute[] = [
  { chemin: 'poi', libelle: 'POI' },
  { chemin: 'iris', libelle: 'IRIS' },
  { chemin: 'radio', libelle: 'Radio' },
];

/**
 * `admin/donnees/importer` — l'onglet « Importer » de la page Données (lot 6, T15, amendement A7). Pas de
 * source React : React a une page par import (`/admin/import`, `/admin/carreaux-import`,
 * `/dashboard/iris-crawler`, `/admin/radio`), regroupées ici comme sous-onglets RELATIFS (lien
 * partageable, retour arrière juste). Rendu de la barre : variante `ecran`, celle des sous-onglets de
 * Connexions API (T9) ; la racine mène au premier type porté, par la route.
 *
 * Aucun état propre : chaque écran d'import garde le sien, et rien ne se lit à l'ouverture.
 */
@Component({
  selector: 'mg-importer',
  imports: [OngletsRoutesComponent, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mg-onglets-routes [onglets]="onglets" libelle="Type d’import" variante="ecran" />
    <div class="contenu">
      <router-outlet />
    </div>
  `,
  styles: [`
    :host { display: block; }
    .contenu { padding-top: 20px; }
  `],
})
export class ImporterPage {
  protected readonly onglets = ONGLETS_IMPORTER;
}
