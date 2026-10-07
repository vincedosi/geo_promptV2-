import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ChargementService } from '../../core/chargement/chargement.service';
import { BarreProgressionComponent } from '../../ui/barre-progression/barre-progression.component';
import { ChampComponent } from '../../ui/champ/champ.component';
import { type EtapeAffichee, FilEtapesComponent } from '../../ui/fil-etapes/fil-etapes.component';
import { HexagoneComponent } from '../../ui/hexagone/hexagone.component';
import { LogoComponent } from '../../ui/logo/logo.component';
import { MarqueComponent } from '../../ui/marque/marque.component';
import { IconeComponent } from '../../ui/icone/icone.component';
import { ICONES, type NomIcone } from '../../ui/icone/icones';
import { EnteteSectionComponent } from '../../ui/entete-section/entete-section.component';
import { EntetePageComponent } from '../../ui/entete-page/entete-page.component';
import { TuileChiffreComponent } from '../../ui/tuile-chiffre/tuile-chiffre.component';
import { FilArianeComponent, type SegmentAriane } from '../../ui/fil-ariane/fil-ariane.component';
import { KpiComponent } from '../../ui/kpi/kpi.component';
import { PastilleComponent } from '../../ui/pastille/pastille.component';
import { PerimeDirective } from '../../ui/perime/perime.directive';
import { RegletteComponent } from '../../ui/reglette/reglette.component';
import { Cellule, EnteteCellule } from '../../ui/tableau/cellules';
import { ConfirmationComponent } from '../../ui/confirmation/confirmation.component';
import { NotificationsComponent } from '../../ui/notifications/notifications.component';
import { NotificationsService, type VarianteNotification } from '../../ui/notifications/notifications.service';
import { DepotFichiersComponent } from '../admin/commun/depot-fichiers.component';
import { JournalComponent, type LigneJournal } from '../admin/commun/journal.component';
import { ProgressionImportComponent } from '../admin/commun/progression-import.component';

/**
 * Chaque composant de ui/, dans son état réel, avec des données d'exemple
 * génériques. Sert à la relecture visuelle dans les deux thèmes, et de mode
 * d'emploi pour les lots suivants.
 */
@Component({
  selector: 'mg-catalogue',
  imports: [
    EnteteSectionComponent,
    EntetePageComponent,
    TuileChiffreComponent,
    BarreProgressionComponent, ChampComponent, FilEtapesComponent, FilArianeComponent,
    HexagoneComponent, IconeComponent, KpiComponent, LogoComponent, MarqueComponent, PastilleComponent, PerimeDirective, RegletteComponent, Cellule, EnteteCellule,
    NotificationsComponent, ConfirmationComponent, JournalComponent, ProgressionImportComponent, DepotFichiersComponent,
  ],
  providers: [ChargementService, NotificationsService],
  templateUrl: './catalogue.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CataloguePage {
  private readonly chargement = inject(ChargementService);

  protected readonly iconesPortees = Object.keys(ICONES) as NomIcone[];
  protected readonly taillesIcones = [14, 16, 20];
  protected readonly enCalcul = signal(false);
  protected readonly sectionOuverte = signal(true);
  protected readonly pastilles = signal<Record<string, boolean>>({ premier: true, second: false });
  protected readonly etapeCourante = signal('deux');
  protected readonly etapes: EtapeAffichee[] = [
    { cle: 'un', rang: 1, libelle: 'Choisir', renseignee: true },
    { cle: 'deux', rang: 2, libelle: 'Régler', renseignee: true },
    { cle: 'trois', rang: 3, libelle: 'Comparer', renseignee: false },
  ];
  protected readonly segments = signal<SegmentAriane[]>([
    { cle: 'racine', libelle: 'Ensemble' },
    { cle: 'groupe', libelle: 'Groupe A', titre: 'Niveau 1 — code A' },
    { cle: 'element', libelle: 'Élément 12', titre: 'Niveau 2 — code 12' },
  ]);
  protected readonly valeurReglette = signal(1000);
  protected readonly apercuReglette = signal<number | null>(null);

  // Planche « Administration » (lot 6, T2).
  private readonly notifications = inject(NotificationsService);
  protected readonly confirmation = signal<{ variante: 'danger' | 'defaut'; enCours: boolean } | null>(null);
  protected readonly titreConfirmation = computed(() =>
    this.confirmation()?.variante === 'danger' ? 'Supprimer cet élément ?' : 'Appliquer la modification ?');
  protected readonly libelleConfirmation = computed(() => (this.confirmation()?.variante === 'danger' ? 'Supprimer' : 'Confirmer'));
  protected readonly lignesJournal = signal<readonly LigneJournal[]>([
    { message: '[10:02:11] [INFO   ] [parsing     ] Lecture du fichier d’exemple', niveau: 'info' },
    { message: '[10:02:12] [DEBUG  ] [parsing     ] 12 colonnes détectées', niveau: 'debug' },
    { message: '[10:02:14] [WARN   ] [insertion   ] 3 lignes sans coordonnées ignorées', niveau: 'warn' },
    { message: '[10:02:15] [ERROR  ] [insertion   ] Ligne 418 : valeur illisible', niveau: 'error' },
    { message: '[10:02:19] [SUCCESS] [fin         ] 1 247 lignes écrites', niveau: 'success' },
  ]);
  protected readonly fichiersDeposes = signal<File[]>([]);
  protected readonly libelleDepot = computed(() => {
    const f = this.fichiersDeposes();
    return f.length ? f.map((x) => x.name).join(', ') : '// formats : .csv .tsv';
  });

  constructor() {
    this.chargement.suivre('catalogue', 'Calcul d’exemple', () => this.enCalcul());
  }

  protected notifier(variante: VarianteNotification): void {
    const exemples: Record<VarianteNotification, [string, string?]> = {
      success: ['Import terminé', '1 247 lignes écrites.'],
      error: ['Échec de l’import', 'Le serveur a répondu 500.'],
      warning: ['Données partielles', '3 lignes ignorées.'],
      info: ['Logs copiés'],
    };
    const [titre, message] = exemples[variante];
    this.notifications[variante](titre, message);
  }

  protected ouvrirConfirmation(variante: 'danger' | 'defaut', enCours = false): void {
    this.confirmation.set({ variante, enCours });
    // « En cours » bloque tous les gestes de fermeture : on le relâche après 3 s pour ne pas piéger la planche.
    if (enCours) setTimeout(() => this.confirmation.update((c) => (c ? { ...c, enCours: false } : c)), 3000);
  }

  protected ajouterLigne(): void {
    this.lignesJournal.update((l) => [...l, { message: `[10:03:${String(l.length).padStart(2, '0')}] [INFO   ] [insertion   ] Lot ${l.length} écrit`, niveau: 'info' }]);
  }

  protected basculerPastille(cle: string): void {
    this.pastilles.update((p) => ({ ...p, [cle]: !p[cle] }));
  }

  protected remonter(i: number): void {
    this.segments.update((s) => s.slice(0, i + 1));
  }

  protected formaterMetres(n: number): string {
    return n >= 1000 ? `${(n / 1000).toLocaleString('fr-FR')} km` : `${n} m`;
  }
}
