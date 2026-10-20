import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type { Observable, Subscription } from 'rxjs';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { MESSAGE_INTERROMPU, NIVEAUX_ACTIFS_INITIAUX } from '../../commun/import-flux';
import type { LigneJournal, NiveauJournal } from '../../commun/journal.component';
import {
  RadioAdminApi, type CibleSuppressionRadio, type EvenementImportRadio, type ImportRadio, type StatsRadio,
} from '../data/radio-admin.api';
import { ligneJournalPasse } from '../logique/radio';
import { RadioOngletsService } from './radio-onglets.service';

/** Progression d'un import (C5) : étape = la `phase` courante, pourcentage = le `percent` du flux. */
export interface EtatProgressionRadio {
  etape: string;
  pourcentage: number | null;
  traitees: number | null;
  termine: boolean;
  echec: string | null;
  /** Le message du `done` final (le bilan que la route écrit elle-même). */
  bilan: string | null;
}


const NIVEAUX: readonly LigneJournal['niveau'][] = ['debug', 'info', 'warn', 'error', 'success'];

/** Les deux façons dont React lit un flux : `launchImport` (ANFR, enrichissement) et `handleODSUpload`. */
interface Lecture {
  /** Niveau d'un événement sans `level` : `launchImport` déduit `error` du type, l'ODS dit toujours `info`. */
  niveauParDefaut: (evt: EvenementImportRadio) => string;
  /** Ligne d'un refus HTTP : `✗ Erreur : …` (lancement) ou `✗ …` (ODS). */
  prefixeRefus: string;
  titreRefus: string;
  titreTermine: string;
  /** Après la fin du flux ou un réseau coupé — jamais après un refus HTTP (React sort avant). */
  apres?: () => void;
}

/**
 * L'état de l'écran Radio (lot 6, T16) : ce que `app/admin/radio/page.tsx` garde au niveau de la PAGE
 * — stats, historique, journal, import en cours, suppression —, fourni par `RadioPage` et détruit avec
 * elle. Changer d'onglet (Radios, Statistiques en T17) ne perd donc ni le journal ni l'import, comme
 * React.
 *
 * - **Lectures** (stats, historique, journal passé, comptes de suppression) : annulées à la destruction.
 * - **Imports** (C13) : JAMAIS désabonnés — couper la requête peut interrompre l'écriture côté Next ;
 *   la destruction ou un import plus récent fait seulement ignorer la suite (`generation`).
 * - **Suppression confirmée** : une écriture, pas désabonnée non plus ; sa réponse est ignorée après
 *   destruction.
 */
@Injectable()
export class RadioImportService {
  private readonly api = inject(RadioAdminApi);
  private readonly notifications = inject(NotificationsService);
  /** Résultats gardés des onglets Radios et Statistiques : invalidés quand les données changent (Q-3). */
  private readonly onglets = inject(RadioOngletsService);

  readonly stats = signal<StatsRadio | null>(null);
  readonly historique = signal<ImportRadio[]>([]);
  readonly importEnCours = signal(false);
  readonly progression = signal<EtatProgressionRadio | null>(null);
  /** Identifiant du journal passé affiché (`viewingLogId`), `null` pour le journal de l'import. */
  readonly journalPasse = signal<string | null>(null);
  readonly cibleSuppression = signal<CibleSuppressionRadio | null>(null);
  readonly comptesSuppression = signal<Record<string, number> | null>(null);
  readonly suppressionEnCours = signal(false);
  /**
   * Filtre de niveaux du journal, tenu ici comme React le tient au niveau de la page : le journal est
   * sous un `@if` de l'onglet Import, et l'onglet lui-même est détruit au passage par Radios
   * (vague finale, A7).
   */
  readonly niveauxJournal = signal<ReadonlySet<NiveauJournal>>(new Set(NIVEAUX_ACTIFS_INITIAUX));

  private readonly lignesImport = signal<LigneJournal[]>([]);
  private readonly lignesPassees = signal<LigneJournal[]>([]);
  /** Ce que montre le journal : le journal passé s'il est ouvert, sinon celui de l'import. */
  readonly lignes = computed(() => (this.journalPasse() ? this.lignesPassees() : this.lignesImport()));

  private detruit = false;
  private generation = 0;
  private readonly lectures = new Map<string, Subscription>();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      for (const l of this.lectures.values()) l.unsubscribe();
    });
  }

  /** Les deux lectures du montage de la page (`useEffect(() => { fetchStats(); fetchImports(); })`). */
  charger(): void {
    this.lireStats();
    this.lireHistorique();
  }

  /** « Lancer l'import ANFR » / « Lancer l'enrichissement » (`launchImport`, `page.tsx:252-297`). */
  lancer(quoi: 'anfr' | 'enrichissement'): void {
    const libelle = quoi === 'anfr' ? 'Import ANFR' : 'Enrichissement';
    this.lire(`▶ ${libelle} lancé...`, quoi === 'anfr' ? this.api.importerAnfr() : this.api.enrichir(), {
      niveauParDefaut: (e) => (e.type === 'error' ? 'error' : 'info'),
      prefixeRefus: '✗ Erreur : ',
      titreRefus: 'Import échoué',
      titreTermine: 'Import terminé',
    });
  }

  /** « Importer » du référentiel ODS (`handleODSUpload`, `page.tsx:162-210`) ; `apres` vide le champ. */
  importerOds(fichier: File, apres: () => void): void {
    this.lire(`▶ Import ODS : ${fichier.name}`, this.api.importerOds(fichier), {
      niveauParDefaut: () => 'info',
      prefixeRefus: '✗ ',
      titreRefus: 'Import ODS échoué',
      titreTermine: 'Import ODS terminé',
      apres,
    });
  }

  /** « Voir » (`loadHistoryLogs`, `page.tsx:239-250`) : le journal passé REMPLACE celui de l'écran. */
  voirJournal(id: string): void {
    this.lireUneFois('journal', this.api.journal(id), (data) => {
      this.lignesPassees.set((data.entries ?? []).map((e) => ({
        message: ligneJournalPasse(e), niveau: niveau(e.level), phase: e.phase,
      })));
      this.journalPasse.set(id);
      // React remplace le journal : celui d'un import FINI disparaît. Celui d'un import en cours est gardé
      // à part (React y mêlait les lignes du flux), et revient à la fermeture.
      if (!this.importEnCours()) {
        this.lignesImport.set([]);
        this.progression.set(null);
      }
    });
  }

  /** « Fermer » (`page.tsx:490`). */
  fermerJournal(): void {
    this.journalPasse.set(null);
    this.lignesPassees.set([]);
  }

  /** « Supprimer … » : l'essai à blanc (`confirm: false`) compte sans rien effacer (`page.tsx:304-314`). */
  demanderSuppression(cible: CibleSuppressionRadio): void {
    this.lireUneFois('essai', this.api.supprimer(cible, false), (r) => {
      this.comptesSuppression.set(r.would_delete ?? {});
      this.cibleSuppression.set(cible);
    }, () => this.notifications.error('Erreur suppression'));
  }

  /** Confirmation (`handleDeleteConfirm`, `page.tsx:316-332`) : la seule requête qui EFFACE. */
  confirmerSuppression(): void {
    const cible = this.cibleSuppression();
    if (!cible || this.suppressionEnCours()) return;
    this.suppressionEnCours.set(true);
    const fin = () => {
      this.suppressionEnCours.set(false);
      this.annulerSuppression();
    };
    // Écriture : jamais désabonnée.
    this.api.supprimer(cible, true).subscribe({
      next: () => {
        if (this.detruit) return;
        this.notifications.success('Données supprimées');
        this.onglets.invalider();
        this.lireStats();
        fin();
      },
      error: () => {
        if (this.detruit) return;
        this.notifications.error('Erreur suppression');
        fin();
      },
    });
  }

  annulerSuppression(): void {
    this.cibleSuppression.set(null);
    this.comptesSuppression.set(null);
  }

  private lireStats(): void {
    this.lireUneFois('stats', this.api.stats(), (d) => this.stats.set(d));
  }

  private lireHistorique(): void {
    this.lireUneFois('historique', this.api.historique(), (d) => this.historique.set(d.imports ?? []));
  }

  /** Une lecture par sorte à la fois ; échec ignoré comme React (`catch { /* ignore *\/ }`) sauf `echec`. */
  private lireUneFois<T>(cle: string, lecture: Observable<T>, ok: (d: T) => void, echec?: () => void): void {
    this.lectures.get(cle)?.unsubscribe();
    this.lectures.set(cle, lecture.subscribe({ next: ok, error: () => echec?.() }));
  }

  private lire(premiere: string, flux: Observable<EvenementImportRadio>, l: Lecture): void {
    const generation = ++this.generation;
    const actuel = () => !this.detruit && generation === this.generation;
    let dernier: EvenementImportRadio | null = null;

    this.importEnCours.set(true);
    this.journalPasse.set(null);
    this.lignesPassees.set([]);
    this.lignesImport.set([{ message: premiere, niveau: 'info', phase: 'INIT' }]);
    this.progression.set({ etape: 'INIT', pourcentage: null, traitees: null, termine: false, echec: null, bilan: null });

    const terminer = () => {
      this.importEnCours.set(false);
      this.onglets.invalider();
      l.apres?.();
      this.lireStats();
      this.lireHistorique();
    };
    const echouer = (message: string) => this.progression.update((p) => (p ? { ...p, echec: message } : p));

    // Jamais désabonné (C13) : `actuel()` fait ignorer la suite après destruction ou nouvel import.
    flux.subscribe({
      next: (evt) => {
        if (!actuel()) return;
        dernier = evt;
        this.ajouter({ message: evt.message, niveau: niveau(evt.level ?? l.niveauParDefaut(evt)), phase: evt.phase });
        if (evt.type === 'error' && !evt.level) this.notifications.error('Erreur', evt.message);
        this.avancer(evt);
      },
      error: (e: unknown) => {
        if (!actuel()) return;
        const refus = e instanceof HttpErrorResponse && e.status !== 0 && (e.status < 200 || e.status >= 300);
        if (refus) {
          // `!res.ok` : la ligne, la notification, et React sort SANS relire les stats ni l'historique.
          const { ligne, message } = corpsRefus(e);
          this.ajouter({ message: `${l.prefixeRefus}${ligne}`, niveau: 'error' });
          this.notifications.error(l.titreRefus, message);
          echouer(ligne);
          this.importEnCours.set(false);
          return;
        }
        const message = e instanceof HttpErrorResponse ? 'Failed to fetch' : e instanceof Error ? e.message : String(e);
        this.ajouter({ message: `✗ ${message}`, niveau: 'error' });
        this.notifications.error('Import échoué', message);
        echouer(message);
        terminer();
      },
      complete: () => {
        if (!actuel()) return;
        const fin = dernier as EvenementImportRadio | null;
        if (fin?.type === 'done') {
          // UNE notification, au `done` FINAL : React notifiait à chaque phase finie (chaque `success`).
          this.notifications.success(l.titreTermine);
          this.progression.update((p) => (p ? { ...p, termine: true, pourcentage: 100, bilan: fin.raw_message ?? fin.message } : p));
        } else if (fin?.type === 'error') {
          echouer(fin.raw_message ?? fin.message);
        } else {
          this.ajouter({ message: `✗ ${MESSAGE_INTERROMPU}`, niveau: 'error' });
          echouer(MESSAGE_INTERROMPU);
        }
        terminer();
      },
    });
  }

  /** C5 : une nouvelle phase repart en barre indéterminée ; un `percent` (truthy, comme React) la détermine. */
  private avancer(evt: EvenementImportRadio): void {
    this.progression.update((p) => {
      if (!p) return p;
      let suivant = p;
      if (evt.phase && evt.phase !== p.etape) suivant = { ...suivant, etape: evt.phase, pourcentage: null, traitees: null };
      if (evt.percent) {
        const lignes = evt.deleted ?? (evt.inserted !== undefined || evt.updated !== undefined || evt.errors !== undefined
          ? (evt.inserted ?? 0) + (evt.updated ?? 0) + (evt.errors ?? 0)
          : null);
        suivant = { ...suivant, pourcentage: evt.percent, traitees: lignes };
      }
      return suivant;
    });
  }

  private ajouter(l: LigneJournal): void {
    this.lignesImport.update((a) => [...a, l]);
  }
}

/** Un niveau de la route, ramené à ceux du journal (`info` par défaut, comme la couleur de repli de React). */
function niveau(n: string | undefined): LigneJournal['niveau'] {
  return NIVEAUX.includes(n as LigneJournal['niveau']) ? (n as LigneJournal['niveau']) : 'info';
}

/**
 * Corps d'un refus, relu en texte (C4) comme `res.json().catch(() => ({ error: \`HTTP ${status}\` }))` :
 * la ligne porte `err.error ?? res.status`, la notification `err.error` (absente si la route n'en dit rien).
 * Un corps VIDE (`null` sous `HttpClient`, chaîne vide) est illisible pour `res.json()` comme un corps non
 * JSON : `HTTP <statut>` (vague finale C7 ; `null` donnait « Erreur : 500 »).
 */
function corpsRefus(e: HttpErrorResponse): { ligne: string; message: string | undefined } {
  let corps: unknown = e.error;
  if (corps === null || corps === undefined) return { ligne: `HTTP ${e.status}`, message: `HTTP ${e.status}` };
  if (typeof corps === 'string') {
    try {
      corps = JSON.parse(corps);
    } catch {
      return { ligne: `HTTP ${e.status}`, message: `HTTP ${e.status}` };
    }
  }
  const erreur = corps && typeof corps === 'object' ? (corps as { error?: unknown }).error : undefined;
  if (typeof erreur === 'string') return { ligne: erreur, message: erreur };
  return { ligne: String(e.status), message: undefined };
}
