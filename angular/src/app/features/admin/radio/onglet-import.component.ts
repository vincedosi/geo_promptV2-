import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ConfirmationComponent } from '../../../ui/confirmation/confirmation.component';
import { EnteteSectionComponent } from '../../../ui/entete-section/entete-section.component';
import { JournalComponent } from '../commun/journal.component';
import { ProgressionImportComponent } from '../commun/progression-import.component';
import { RadioImportService } from './etat/radio-import.service';
import {
  daysAgo, detailsImport, dureeImport, fmtDate, messageSuppression, teinteFraicheur, teinteStatut, titreSuppression,
} from './logique/radio';

/**
 * Onglet « Import » de l'écran Radio (`admin/donnees/importer/radio/import`) — portage de
 * `app/admin/radio/page.tsx:369-597` et `:899-916` (lot 6, T16). Tout son état vit dans
 * `RadioImportService`, fourni par `RadioPage` (l'état de PAGE de React).
 *
 * Écarts à React, voulus et listés au rapport :
 * - **progression** (C5) : `mg-progression-import` à la place du filet de 4 px — étape = `phase` courante,
 *   barre au `percent` du flux (ANFR) et indéterminée sans lui (enrichissement, ODS), lignes traitées,
 *   bilan = le message du `done` final. Une nouvelle phase repart indéterminée (React gardait le 100 %
 *   de la phase précédente).
 * - **« Import terminé »** notifié UNE fois, au `done` final ; React notifiait à chaque phase finie
 *   (chaque `success` du journal est un `done`) et remettait la barre à 100 % en cours de route.
 * - **flux tronqué** : `✗ Le flux s’est interrompu avant la fin.` et un échec nommé ; React se taisait.
 * - **« Importer » (ODS)** s'active quand un fichier est choisi ; React lisait `files.length` au rendu
 *   sans re-rendre au choix (le bouton restait coupé jusqu'au rendu suivant).
 * - **journal passé pendant un import** : affiché à part, l'import continue dans le sien (React mêlait
 *   les lignes du flux au journal relu) ; défilement par `scrollTop` (C14).
 * - **suppression** : un essai à blanc ou une confirmation qui échoue dit « Erreur suppression » et
 *   ferme la confirmation (React : rien pour l'essai, et une confirmation bloquée sur un réseau coupé).
 * - **couleurs** (C9) : palette du journal → jetons (`mg-journal`) ; `#080808` → `--bg-level-0` ;
 *   `rgba(255,87,87,…)` → `--danger` à 8 / 15 / 30 % ; statut : `${color}15` / `30` de React sont
 *   INVALIDES sur un `var()` (aucun fond, aucun bord rendu) → `color-mix` à 8 et 19 %, l'intention.
 * - **teal lisible en clair** : le texte teal des boutons (« Lancer l'import ANFR », « Importer », survol
 *   de « Voir ») passe à `--teal-texte` du cadre admin (`light-dark(teal mêlé à 45 % de --text-primary,
 *   teal)`, F-3) — ≥ 5:1 sur la carte claire au lieu de 1,8:1 ; inchangé en sombre.
 */
@Component({
  selector: 'mg-radio-import',
  imports: [ConfirmationComponent, EnteteSectionComponent, JournalComponent, ProgressionImportComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './onglet-import.component.html',
  styleUrl: './onglet-import.component.css',
})
export class OngletImportComponent {
  protected readonly etat = inject(RadioImportService);
  protected readonly colonnes = ['Date', 'Type', 'Statut', 'Durée', 'Détails', 'Logs'] as const;

  /** Le fichier ODS choisi (le champ `<input type="file">`, lu au choix et non au rendu). */
  protected readonly fichierOds = signal<File | null>(null);
  protected readonly importEnCours = this.etat.importEnCours;
  protected readonly lignes = this.etat.lignes;

  /** La progression ne s'affiche que pour le journal de l'import, jamais pour un journal relu. */
  protected readonly progression = computed(() => (this.etat.journalPasse() ? null : this.etat.progression()));

  protected readonly fraicheur = computed(() => {
    const d = this.etat.stats()?.derniere_maj_anfr ?? null;
    const jours = daysAgo(d);
    return {
      teinte: teinteFraicheur(jours),
      texte: d ? `Dernier import : ${fmtDate(d)} (${jours}j)` : 'Aucun import',
    };
  });

  protected readonly etatEnrichissement = computed(() => {
    const s = this.etat.stats();
    return s ? `${s.emetteurs_matches} matchés / ${s.total_emetteurs} total` : '—';
  });

  protected readonly etatOds = computed(() => {
    const s = this.etat.stats();
    return s ? `${s.total_radios} radios en base` : '—';
  });

  protected readonly libelleSection = computed(() => {
    const id = this.etat.journalPasse();
    return id ? `Logs de l'import ${id.slice(0, 8)}` : 'Progression';
  });

  protected readonly lignesHistorique = computed(() =>
    this.etat.historique().map((imp) => {
      const duree = dureeImport(imp);
      const details = detailsImport(imp);
      return {
        id: imp.id,
        date: fmtDate(imp.started_at),
        type: imp.type.toUpperCase(),
        statut: imp.status,
        teinte: teinteStatut(imp.status),
        duree: duree !== null ? `${duree}s` : '—',
        details: details.texte,
        erreur: details.erreur,
      };
    }));

  protected readonly titreSuppression = computed(() => titreSuppression(this.etat.cibleSuppression()));
  protected readonly messageSuppression = computed(() => messageSuppression(this.etat.comptesSuppression()));

  protected choisirOds(champ: HTMLInputElement): void {
    this.fichierOds.set(champ.files?.[0] ?? null);
  }

  /** `handleODSUpload` : le champ est remis à vide à la fin de l'envoi, comme React. */
  protected importerOds(champ: HTMLInputElement): void {
    const fichier = this.fichierOds();
    if (!fichier || this.importEnCours()) return;
    this.etat.importerOds(fichier, () => {
      champ.value = '';
      this.fichierOds.set(null);
    });
  }
}
