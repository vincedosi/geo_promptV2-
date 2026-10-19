import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmationComponent } from '../../../ui/confirmation/confirmation.component';
import { ImportShapefileService } from '../carreaux-import/etat/import-shapefile.service';
import { OngletsRoutesComponent, type OngletRoute } from '../commun/onglets-routes.component';
import type { SortieConfirmable } from './quitter-importer.guard';

/**
 * Le choix du type d'import (amendement A7) : UN sous-onglet par écran d'import PORTÉ, jamais d'entrée
 * « bientôt ». Ordre cible : POI, Shapefile, IRIS, Radio — chaque tâche d'import ajoute le sien à sa
 * place. Aujourd'hui, l'ordre cible au complet : POI (T12, en tête : le plus courant), Shapefile (T14), IRIS (T15),
 * Radio (T16).
 */
export const ONGLETS_IMPORTER: readonly OngletRoute[] = [
  { chemin: 'poi', libelle: 'POI' },
  { chemin: 'shapefile', libelle: 'Shapefile' },
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
 * Rien ne se lit à l'ouverture. Chaque écran d'import garde son état, SAUF le Shapefile (vague finale, I-2 /
 * Q-2) : `ImportShapefileService` est fourni ICI, pour qu'un envoi par lots — un enchaînement de requêtes
 * mené par le navigateur — survive au passage par un autre type d'import. Quitter « Importer » pendant cet
 * envoi passe par `quitterImporterGuard` : une confirmation qui dit ce qui restera en base.
 */
@Component({
  selector: 'mg-importer',
  imports: [OngletsRoutesComponent, RouterOutlet, ConfirmationComponent],
  providers: [ImportShapefileService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mg-onglets-routes [onglets]="onglets" libelle="Type d’import" variante="ecran" />
    <div class="contenu">
      <router-outlet />
    </div>
    <mg-confirmation
      data-confirmation-sortie
      variante="danger"
      [ouvert]="sortieDemandee()"
      titre="Quitter l’import en cours ?"
      [message]="messageSortie()"
      libelleConfirmer="Quitter l’import"
      libelleAnnuler="Rester"
      (confirmer)="repondre(true)"
      (annuler)="repondre(false)"
    />
  `,
  styles: [`
    :host { display: block; }
    .contenu { padding-top: 20px; }
  `],
})
export class ImporterPage implements SortieConfirmable {
  protected readonly onglets = ONGLETS_IMPORTER;
  private readonly shapefile = inject(ImportShapefileService);

  protected readonly sortieDemandee = signal(false);
  protected readonly messageSortie = computed(() => {
    // Phase « Enregistrement » (revue des vagues, Minor 3) : tous les lots sont partis et la déclaration de la source
    // est déjà en vol — quitter n'en verra seulement pas la réponse.
    if (this.shapefile.phase() === 'Enregistrement') {
      return 'Un import Shapefile enregistre sa source : tous les lots sont envoyés et la déclaration est déjà partie. '
        + 'Le quitter n’en affichera pas la réponse — vérifiez ensuite dans Sources que la source y figure.';
    }
    const l = this.shapefile.lots();
    const avancement = l ? ` (${l.envoyes} / ${l.total} lots)` : '';
    return `Un import Shapefile est en cours${avancement}. Le quitter l’arrête : les lots déjà envoyés resteront en base sans source enregistrée.`;
  });
  private reponse: ((quitter: boolean) => void) | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.repondre(false));
  }

  /** Appelé par `quitterImporterGuard` : immédiat sans envoi en cours, sinon la réponse de la confirmation. */
  confirmerSortie(): boolean | Promise<boolean> {
    if (!this.shapefile.importEnCours()) return true;
    this.reponse?.(false);
    this.sortieDemandee.set(true);
    return new Promise<boolean>((resoudre) => {
      this.reponse = resoudre;
    });
  }

  protected repondre(quitter: boolean): void {
    this.sortieDemandee.set(false);
    const r = this.reponse;
    this.reponse = null;
    r?.(quitter);
  }
}

