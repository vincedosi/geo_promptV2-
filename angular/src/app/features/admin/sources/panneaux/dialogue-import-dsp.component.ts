import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, output, signal, viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { formaterNombre } from '../../../../core/format/nombre';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { DepotFichiersComponent } from '../../commun/depot-fichiers.component';
import { MESSAGE_INTERROMPU } from '../../commun/import-flux';
import { ProgressionImportComponent } from '../../commun/progression-import.component';
import { SourcesAdminApi, type EvenementImportDsp, type RapportImportDsp } from '../data/sources-admin.api';
import { ECHEC_RESEAU, erreurDuCorps, estCoupure } from '../../commun/erreurs-http';

/** Sources proposées par React (`DSP_SOURCES`, `DspPanel.tsx:35`), dans son ordre. */
const SOURCES_DSP = ['adform', 'dv360', 'ttd', 'xandr', 'amazon_dsp', 'other'] as const;

/** Étapes nommées de la progression (C5), une par `type` d'événement de la route. */
const ETAPES: Record<'parsing' | 'progress' | 'matching' | 'rollups', string> = {
  parsing: 'Analyse du fichier',
  progress: 'Insertion des lignes',
  matching: 'Rattachement aux IRIS',
  rollups: 'Agrégats de suivi',
};


/** Une ligne de la liste d'événements : `info` (gris), `error` (rouge), `complete` (vert), comme React. */
interface LigneEvenement {
  texte: string;
  sorte: 'info' | 'error' | 'complete';
}

interface EtatProgression {
  etape: string;
  traitees: number | null;
  total: number | null;
  termine: boolean;
  echec: string | null;
}

let compteur = 0;

/**
 * « Importer une campagne DSP » — portage du `Dialog` de `DspPanel.tsx:100-191` et de
 * `handleDspImport` (`useDspImport.ts:79-113`), lot 6, T20.
 *
 * `<dialog>` natif (C6), patron de `mg-dialogue-nouvel-espace` : monté par le parent (`@if`) à chaque
 * ouverture, donc VIERGE à chaque fois (le `resetDspModal` de React), ouvert à son premier rendu.
 *
 * Fermeture — gestes du `Dialog` Radix (Échap, clic sur le fond, croix, « Annuler », « Fermer »), tous
 * REFUSÉS pendant l'import (`onOpenChange` ignoré tant que `dspImporting`, `DspPanel.tsx:100`) :
 * l'événement `cancel` est toujours empêché (sinon le DOM et l'état divergeraient), la croix et
 * « Annuler » sont désactivés, le clic sur le fond est ignoré.
 *
 * Import : multipart aux trois champs de React, flux SSE lu par `lignesSse` (C4). Chaque événement
 * s'ajoute à la liste au texte de React (`message`, ou `✓ N lignes, N IRIS (N%)` pour `complete`) ;
 * `complete` → rapport « Import réussi », notification « Import terminé » / « N lignes », `importe` émis
 * (le parent relit la liste) ; `error` → notification « Erreur ».
 *
 * Écarts à React, voulus :
 * - **progression** (C5) : `mg-progression-import` au lieu de la barre de 4 px de React (affichée
 *   seulement au-dessus de 0 %). Étape NOMMÉE d'après le `type` de l'événement (Analyse du fichier,
 *   Insertion des lignes, Rattachement aux IRIS, Agrégats de suivi) ; barre DÉTERMINÉE seulement pendant
 *   l'insertion, la seule étape qui porte un compteur (`processed` / `total`) — le rattachement et les
 *   agrégats sont UN appel de RPC chacun, leur barre est indéterminée. Fin : « ✓ Import terminé ».
 * - **flux tronqué** (ni `complete` ni `error`) : « Le flux s’est interrompu avant la fin. » en rouge
 *   et l'échec nommé ; React rendait le bouton sans rien dire.
 * - **refus HTTP** : la notification « Import échoué » porte l'`error` de la route quand il y en a un
 *   (« Aucun mapping trouvé pour… » d'une source sans mapping en base) ; React n'écrivait que
 *   `HTTP <statut>`, qui reste le repli.
 * - **zone de dépôt désactivée pendant l'import** (React la laissait cliquable : le fichier changeait
 *   sous un import en cours), focalisable et ouverte au clavier (`mg-depot-fichiers`).
 * - **destruction pendant l'import** (C13) : la requête n'est PAS annulée — couper le flux peut
 *   interrompre l'écriture côté Next —, sa suite est ignorée.
 * - couleurs (C9) : `rgba(61,255,160,0.2)` → `--success` à 20 % ; teal du nom de fichier lisible en
 *   clair par `--teal-texte` du cadre admin (Q-9 tranchée, F-3) ; voile noir à 80 %
 *   (`bg-black/80` de Radix), sans ombre (flat total : Radix pose `shadow-lg`).
 *
 * Gardés par parité : textes (« Ex: Adform Q1 2026 » est un nom de DSP, pas une marque d'annonceur),
 * largeur 520 px, nombre BRUT de la notification (`${total_rows} lignes`) et de la ligne `complete`.
 */
@Component({
  selector: 'mg-dialogue-import-dsp',
  imports: [DepotFichiersComponent, IconeComponent, ProgressionImportComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dialogue-import-dsp.component.html',
  styleUrl: './dialogue-import-dsp.component.css',
})
export class DialogueImportDspComponent {
  private readonly api = inject(SourcesAdminApi);
  private readonly notifications = inject(NotificationsService);
  private readonly hote = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Un `close` natif peut suivre le retrait du nœud, et un flux non annulé (C13) peut finir après : plus rien une fois détruit. */
  private detruit = false;
  /** Chaque lancement ouvre une « génération » : les événements d'un import antérieur sont ignorés. */
  private generation = 0;

  protected readonly idTitre = `mg-import-dsp-titre-${++compteur}`;
  protected readonly sources = SOURCES_DSP;
  readonly fermer = output<void>();
  readonly importe = output<RapportImportDsp>();

  protected readonly fichier = signal<File | null>(null);
  protected readonly source = signal<string>('adform');
  protected readonly nom = signal('');
  protected readonly importEnCours = signal(false);
  protected readonly lignes = signal<LigneEvenement[]>([]);
  protected readonly progression = signal<EtatProgression | null>(null);
  protected readonly rapport = signal<RapportImportDsp | null>(null);

  protected readonly peutLancer = computed(() => this.fichier() !== null && !this.importEnCours());
  protected readonly libelleLancer = computed(() => (this.importEnCours() ? 'Import en cours…' : 'Lancer l\'import'));
  /** Cellules du rapport, dans l'ordre de la grille de React (`DspPanel.tsx:161-166`). */
  protected readonly cellules = computed(() => {
    const r = this.rapport();
    if (!r) return [];
    return [
      { libelle: 'Lignes', valeur: formaterNombre(r.total_rows), succes: false },
      { libelle: 'Pays', valeur: r.countries.join(', '), succes: false },
      { libelle: 'France', valeur: formaterNombre(r.total_france), succes: false },
      { libelle: 'IRIS', valeur: `${formaterNombre(r.matched_iris)} (${r.pct_matched}%)`, succes: true },
    ];
  });

  private readonly dialogue = viewChild.required<ElementRef<HTMLDialogElement>>('dialogue');

  constructor() {
    afterNextRender(() => {
      const d = this.dialogue().nativeElement;
      if (!d.open) d.showModal();
    });
    const noeud = this.hote.nativeElement;
    inject(DestroyRef).onDestroy(() => {
      // L'import N'EST PAS désabonné (C13) : `detruit` en fait ignorer la suite.
      this.detruit = true;
      const d = noeud.querySelector('dialog');
      if (d?.open) d.close();
    });
  }

  protected choisirFichier(fichiers: File[]): void {
    if (fichiers[0]) this.fichier.set(fichiers[0]);
  }

  protected choisirSource(e: Event): void {
    this.source.set((e.target as HTMLSelectElement).value);
  }

  protected saisirNom(e: Event): void {
    this.nom.set((e.target as HTMLInputElement).value);
  }

  /** `handleDspImport` (`useDspImport.ts:79-113`). */
  protected lancer(): void {
    const fichier = this.fichier();
    if (!fichier || this.importEnCours()) return;
    const generation = ++this.generation;
    const actuel = () => !this.detruit && generation === this.generation;
    let fini = false;

    this.importEnCours.set(true);
    this.lignes.set([]);
    this.rapport.set(null);
    this.progression.set({ etape: ETAPES.parsing, traitees: null, total: null, termine: false, echec: null });

    const echouer = (message: string) => {
      this.progression.update((p) => (p ? { ...p, echec: message } : p));
      this.importEnCours.set(false);
    };

    // Jamais désabonné, ni par `DestroyRef` ni par un nouveau lancement (C13) : `actuel()` fait ignorer la suite.
    this.api.importerCampagne({ fichier, source: this.source(), nom: this.nom() }).subscribe({
      next: (evt) => {
        if (!actuel()) return;
        if (evt.type === 'complete' || evt.type === 'error') fini = true;
        this.evenement(evt, echouer);
      },
      error: (e: unknown) => {
        if (!actuel()) return;
        if (estCoupure(e)) {
          this.notifications.error('Erreur réseau', ECHEC_RESEAU);
          echouer(ECHEC_RESEAU);
          return;
        }
        const message = e instanceof HttpErrorResponse ? (erreurDuCorps(e) ?? `HTTP ${e.status}`) : String(e);
        this.notifications.error('Import échoué', message);
        echouer(message);
      },
      complete: () => {
        if (!actuel()) return;
        if (!fini) {
          this.ajouter(MESSAGE_INTERROMPU, 'error');
          echouer(MESSAGE_INTERROMPU);
        }
        this.importEnCours.set(false);
      },
    });
  }

  /** Un événement du flux, lu comme React (`useDspImport.ts:99-104`), plus la progression (C5). */
  private evenement(evt: EvenementImportDsp, echouer: (m: string) => void): void {
    switch (evt.type) {
      case 'parsing':
      case 'rollups':
        this.ajouter(evt.message);
        this.etape({ etape: ETAPES[evt.type], traitees: null, total: null });
        break;
      case 'progress':
        this.ajouter(evt.message);
        this.etape({ etape: ETAPES.progress, traitees: evt.processed, total: evt.total });
        break;
      case 'matching':
        this.ajouter(evt.message);
        this.etape({ etape: ETAPES.matching, traitees: null, total: null });
        break;
      case 'error':
        this.ajouter(evt.message, 'error');
        this.notifications.error('Erreur', evt.message);
        echouer(evt.message);
        break;
      case 'complete': {
        const r = evt.report;
        this.ajouter(`✓ ${r.total_rows} lignes, ${r.matched_iris} IRIS (${r.pct_matched}%)`, 'complete');
        this.rapport.set(r);
        this.progression.update((p) => (p ? { ...p, termine: true } : p));
        this.notifications.success('Import terminé', `${r.total_rows} lignes`);
        this.importe.emit(r);
        break;
      }
    }
  }

  private etape(e: Pick<EtatProgression, 'etape' | 'traitees' | 'total'>): void {
    this.progression.update((p) => (p ? { ...p, ...e } : p));
  }

  private ajouter(texte: string, sorte: LigneEvenement['sorte'] = 'info'): void {
    this.lignes.update((l) => [...l, { texte, sorte }]);
  }

  protected demanderFermeture(): void {
    if (!this.importEnCours()) this.fermer.emit();
  }

  protected surAnnulationNative(e: Event): void {
    e.preventDefault();
    this.demanderFermeture();
  }

  /**
   * Fermeture native qu'on n'a pas pu empêcher (Chrome laisse passer un second Échap sans activation de
   * l'utilisateur) : pendant l'import, le dialogue est ROUVERT — il ne se ferme pas tant que le flux
   * court ; sinon `fermer` resynchronise le parent.
   */
  protected surFermeture(): void {
    if (this.detruit) return;
    if (this.importEnCours()) this.dialogue().nativeElement.showModal();
    else this.fermer.emit();
  }

  protected surClic(e: MouseEvent): void {
    if (e.target === this.dialogue().nativeElement) this.demanderFermeture();
  }
}
