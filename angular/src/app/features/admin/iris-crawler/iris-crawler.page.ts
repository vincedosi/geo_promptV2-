import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { formaterNombre } from '../../../core/format/nombre';
import { DepotFichiersComponent } from '../commun/depot-fichiers.component';
import { JournalComponent, type LigneJournal } from '../commun/journal.component';
import { ProgressionImportComponent } from '../commun/progression-import.component';
import { IrisCrawlerApi, type EvenementImportIris, type ResultatDepotIris } from './data/iris-crawler.api';

/** Les trois sortes de ligne de React (`kind`, `page.tsx:80`). */
type Sorte = 'log' | 'error' | 'success';

/**
 * Couleur d'une ligne : React peint `log` en `C.textSec` = `var(--text-tertiary)` (`page.tsx:18,285`).
 * `mg-journal` peint ce ton-là sous le niveau `debug` (son niveau `log` est en `--text-secondary`) ;
 * le journal n'est pas filtrable ici, donc rien n'est masqué.
 */
const NIVEAUX: Record<Sorte, LigneJournal['niveau']> = { log: 'debug', error: 'error', success: 'success' };

/** `addLog` garde les 300 dernières lignes (`prev.slice(-299)` puis l'ajout, `page.tsx:88-89`). */
const LIGNES_MAX = 300;

/** Étapes nommées de la progression (C5), d'après les événements de la route. */
const ETAPE_PREPARATION = 'Préparation';
const ETAPE_MISE_A_JOUR = 'Mise à jour des IRIS';
/** Règle du lot 3 : un flux fini sans événement final est un échec, jamais un succès silencieux. */
const MESSAGE_INTERROMPU = 'Le flux s’est interrompu avant la fin.';

interface EtatProgression {
  etape: string;
  pourcentage: number | null;
  traitees: number | null;
  termine: boolean;
  echec: string | null;
  /** `done` au statut `partial` : fini avec des erreurs (vague finale F1). */
  avertissement: boolean;
  bilan: { inseres: number; erreurs: number; statut: string } | null;
}

/**
 * Message d'un dépôt refusé, au texte de React (`page.tsx:105-113`) : `data.error ?? 'Erreur upload'` ;
 * un `fetch` qui échoue donne `String(e)`, soit « TypeError: Failed to fetch ».
 */
function messageDepot(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0) return 'TypeError: Failed to fetch';
    const corps = e.error as { error?: unknown } | null;
    if (corps && typeof corps === 'object' && typeof corps.error === 'string' && corps.error) return corps.error;
    return 'Erreur upload';
  }
  return String(e);
}

/**
 * Message d'un import refusé (HTTP ≠ 2xx), au texte de React (`page.tsx:132-135`) :
 * `err.error ?? \`HTTP ${status}\``. Le flux est demandé en texte (C4) : son corps d'erreur aussi, relu
 * par `JSON.parse`.
 */
function messageImport(e: unknown): string {
  if (!(e instanceof HttpErrorResponse)) return String(e);
  if (e.status === 0) return 'TypeError: Failed to fetch';
  let corps: unknown = e.error;
  if (typeof corps === 'string') {
    try {
      corps = JSON.parse(corps);
    } catch {
      corps = null;
    }
  }
  const erreur = corps && typeof corps === 'object' ? (corps as { error?: unknown }).error : null;
  return typeof erreur === 'string' && erreur ? erreur : `HTTP ${e.status}`;
}

/**
 * `admin/donnees/importer/iris` — portage de `app/dashboard/iris-crawler/page.tsx` (lot 6, T15), type
 * « IRIS » de l'onglet « Importer » de la page Données (amendement A7) ; `admin/iris-crawler` y redirige.
 *
 * Déroulé de React : déposer un CSV (`manual-upload`, multipart) → résultat et correspondance des
 * colonnes cœur calculée par `autoMap` → « IMPORTER N COLONNES » (`manual-import`, flux NDJSON) →
 * journal, puis « NOUVEAU FICHIER ». Rien ne part à l'ouverture.
 *
 * Écarts à React, voulus :
 * - **progression** (C5, règle « jamais de traitement DB silencieux ») : React n'a qu'un journal ;
 *   `mg-progression-import` ajoute une étape nommée (« Préparation » jusqu'au premier lot, puis « Mise à
 *   jour des IRIS »), une barre DÉTERMINÉE par le `percent` que la route envoie à chaque lot (aucun
 *   total de lignes dans le flux : le pourcentage n'est pas recalculé ici), les lignes traitées
 *   (`totalInserted + totalErrors`) et le bilan de `done` (mis à jour, erreurs, statut).
 * - **flux tronqué** (fin sans `done` ni `error`) : « ! Le flux s’est interrompu avant la fin. » — React
 *   ne disait rien et rendait le bouton, comme si de rien n'était.
 * - **en-tête « geo.prompt › IMPORT IRIS » retiré** : nom de l'ancien copilote, disparu (DESIGN_SYSTEM
 *   § 1) ; le cadre porte « Données », l'onglet « Importer » et le type « IRIS ». Le fond, le
 *   `minHeight` et les marges de page (`24px 28px`, 1 400 px) sont ceux du cadre (1 100 px).
 * - **journal** : `mg-journal` (C14) au lieu du `div` de React — 11 px au lieu de 9, rayon 6, bords 0,5,
 *   fond `--bg-level-0` au lieu du littéral `#020205` (C9) ; mêmes couleurs de ligne, même hauteur
 *   (180 px), défilement par `scrollTop`.
 * - **couleurs** (C9) : `#3dffa0` → `--success`, `rgba(78,205,196,0.2)` → `color-mix` du teal à 20 %,
 *   `rgba(61,255,160,0.10)` → `--success` à 10 %, `${C.green}66` → `--success` à 40 %.
 * - **nouveau fichier pendant un import** : le flux précédent n'est PAS coupé (C13) mais ne réécrit plus
 *   l'écran (React y ajoutait ses lignes au journal du nouveau fichier, et gardait « IMPORT EN COURS… »).
 * - **destruction** : un dépôt en vol est annulé (rien en base) ; un import en vol N'EST PAS annulé
 *   (C13 : couper la requête peut interrompre l'écriture côté Next), sa suite est seulement ignorée.
 * - zone de dépôt focalisable et ouverte au clavier (`mg-depot-fichiers`).
 * - **`done` en échec ou partiel** (vague finale F1) : React n'avait que le journal, toujours « ✓ Import
 *   terminé ». La carte de progression suit le `status` de la route : `error` → « ! Import en échec — N
 *   erreurs » (barre en danger), `partial` → « ⚠ Import terminé avec erreurs » (avertissement). Le journal
 *   et le bouton gardent les textes de React.
 * - **un nouveau dépôt annule le précédent** (vague finale F2) : un second fichier déposé pendant l'envoi
 *   du premier coupe cet envoi (lecture seule côté base : le dépôt n'écrit qu'un fichier temporaire) ;
 *   React laissait les deux réponses se croiser et la dernière arrivée gagnait.
 *
 * Gardés par parité : textes en capitales de React (« UPLOAD EN COURS… », « IMPORTER N COLONNES »…),
 * bords 1 px et rayon 2 px, tailles 9 / 7,5 / 8 px, « (0.0 Mo) » de `toFixed(1)`, le nombre BRUT de
 * « ✓ Import terminé — N lignes traitées » (React n'y appelle pas `toLocaleString`), la correspondance en
 * lecture seule (React n'offre aucun moyen de la changer : elle est tenue par l'écran et envoyée telle
 * quelle, colonnes `ignore` comprises).
 */
@Component({
  selector: 'mg-iris-crawler',
  imports: [DepotFichiersComponent, JournalComponent, ProgressionImportComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './iris-crawler.page.html',
  styles: [`
    :host { display: flex; flex-direction: column; gap: 16px; font-family: var(--font-sans); color: var(--text-primary); }
    .consigne { font-family: var(--font-sans); font-size: 10px; color: var(--text-secondary); letter-spacing: 0.12em; margin-bottom: 8px; }
    .consigne.survol { color: var(--brand-teal); }
    .aide { font-family: var(--font-mono); font-size: 9px; color: var(--text-tertiary); }
    .aide + .aide { margin-top: 4px; }
    .resultat { border: 1px solid color-mix(in srgb, var(--brand-teal) 20%, transparent); border-radius: 2px; overflow: hidden; }
    .entete {
      background: var(--bg-level-2); padding: 10px 16px; display: flex; align-items: center; gap: 12px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .fichier { font-family: var(--font-sans); font-size: 9px; color: var(--brand-teal); letter-spacing: 0.12em; }
    .mesure { font-family: var(--font-mono); font-size: 9px; color: var(--text-tertiary); }
    .mesure.mappees { color: var(--success); }
    .correspondance { padding: 12px 16px; background: var(--bg-level-2); }
    .titre-correspondance {
      font-family: var(--font-sans); font-size: 7.5px; color: var(--text-tertiary); letter-spacing: 0.14em; margin-bottom: 8px;
    }
    .puces { display: flex; flex-wrap: wrap; gap: 6px; }
    .puce {
      background: var(--bg-level-2); border: 1px solid var(--border-subtle); border-radius: 2px; padding: 4px 10px;
      display: flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 9px;
    }
    .puce .csv { color: var(--text-secondary); }
    .puce .fleche { color: var(--text-tertiary); }
    .puce .cible { color: var(--success); font-weight: 700; }
    .actions { padding: 12px 16px; border-top: 1px solid var(--border-subtle); display: flex; align-items: center; gap: 12px; }
    .importer {
      padding: 8px 20px; border-radius: 2px; background: var(--brand-teal-10);
      border: 1px solid color-mix(in srgb, var(--brand-teal) 20%, transparent); color: var(--brand-teal);
      font-family: var(--font-sans); font-size: 9px; letter-spacing: 0.12em; cursor: pointer;
    }
    .importer.termine {
      background: color-mix(in srgb, var(--success) 10%, transparent);
      border-color: color-mix(in srgb, var(--success) 40%, transparent); color: var(--success);
    }
    .importer:disabled { cursor: not-allowed; }
    .nouveau {
      padding: 8px 14px; border-radius: 2px; background: transparent; border: 1px solid var(--border-subtle);
      color: var(--text-secondary); font-family: var(--font-sans); font-size: 8px; letter-spacing: 0.1em; cursor: pointer;
    }
    .importer:focus-visible, .nouveau:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 1px; }
    .compteurs { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }
  `],
})
export class IrisCrawlerPage {
  private readonly api = inject(IrisCrawlerApi);

  protected readonly televersement = signal(false);
  protected readonly importEnCours = signal(false);
  protected readonly termine = signal(false);
  protected readonly resultat = signal<ResultatDepotIris | null>(null);
  /** La correspondance et la colonne clé TENUES par l'écran (`mapping`, `keyCol` de React), envoyées à l'import. */
  private readonly correspondance = signal<Record<string, string>>({});
  private readonly colonneCle = signal('IRIS');
  private readonly lignes = signal<{ message: string; sorte: Sorte }[]>([]);
  protected readonly progression = signal<EtatProgression | null>(null);

  /** Un fichier déposé ouvre une nouvelle « génération » : les événements d'un import antérieur sont ignorés. */
  private generation = 0;
  private detruit = false;
  private depot: Subscription | null = null;

  protected readonly journal = computed<LigneJournal[]>(() =>
    this.lignes().map((l) => ({ message: l.message, niveau: NIVEAUX[l.sorte] })));

  protected readonly consigne = computed(() =>
    (this.televersement() ? 'UPLOAD EN COURS…' : 'GLISSER UN FICHIER CSV / CLIQUER POUR PARCOURIR'));

  /** Les colonnes montrées : ni `ignore` ni vides (`page.tsx:238-239`). */
  protected readonly colonnesMappees = computed(() =>
    Object.entries(this.correspondance())
      .filter(([, v]) => v !== 'ignore' && v !== '')
      .map(([csv, cible]) => ({ csv, cible })));

  protected readonly entete = computed(() => {
    const r = this.resultat();
    if (!r) return null;
    return {
      fichier: r.filename,
      dimensions: `${formaterNombre(r.totalRows)} lignes · ${r.headers.length} colonnes`,
      mappees: `${r.autoMapResult.coreCols.length} colonnes IRIS mappées`,
      jsonb: `${r.autoMapResult.jsonbCols.length} colonnes JSONB`,
    };
  });

  protected readonly libelleImport = computed(() => {
    if (this.importEnCours()) return 'IMPORT EN COURS…';
    if (this.termine()) return '✓ IMPORT TERMINÉ';
    return `IMPORTER ${this.colonnesMappees().length} COLONNES`;
  });

  protected readonly compteurs = computed(() => {
    const b = this.progression()?.bilan;
    if (!b) return null;
    return `${formaterNombre(b.inseres)} IRIS mis à jour · ${formaterNombre(b.erreurs)} ${b.erreurs > 1 ? 'erreurs' : 'erreur'} · statut ${b.statut}`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      // Le dépôt n'écrit rien en base : l'annuler est sans risque. L'import, lui, n'est JAMAIS désabonné (C13).
      this.depot?.unsubscribe();
    });
  }

  /** `handleFile` (`page.tsx:91-117`). */
  protected deposer(fichiers: File[]): void {
    const fichier = fichiers[0];
    if (!fichier) return;
    this.generation++;
    this.depot?.unsubscribe();
    this.resultat.set(null);
    this.lignes.set([]);
    this.termine.set(false);
    this.importEnCours.set(false);
    this.progression.set(null);
    this.televersement.set(true);
    this.ajouter(`Upload de ${fichier.name} (${(fichier.size / 1024 / 1024).toFixed(1)} Mo)…`);

    this.depot = this.api.deposer(fichier).subscribe({
      next: (data) => {
        this.resultat.set(data);
        this.correspondance.set(data.autoMapResult.mapping);
        this.colonneCle.set(data.autoMapResult.irisKeyCol);
        this.ajouter(`✓ ${formaterNombre(data.totalRows)} lignes — ${data.autoMapResult.coreCols.length} colonnes mappées`, 'success');
        for (const w of data.parseWarnings ?? []) this.ajouter(`! ${w}`, 'error');
        this.televersement.set(false);
      },
      error: (e: unknown) => {
        this.ajouter(`! ${messageDepot(e)}`, 'error');
        this.televersement.set(false);
      },
    });
  }

  /** `handleImport` (`page.tsx:119-168`). */
  protected importer(): void {
    const r = this.resultat();
    if (!r || this.importEnCours() || this.termine()) return;
    const generation = this.generation;
    const actuel = () => !this.detruit && generation === this.generation;
    let fin = false;

    this.importEnCours.set(true);
    this.termine.set(false);
    this.ajouter('Lancement de l\'import…');
    this.progression.set({ etape: ETAPE_PREPARATION, pourcentage: null, traitees: null, termine: false, echec: null, avertissement: false, bilan: null });

    const echouer = (message: string) => {
      this.progression.update((p) => (p ? { ...p, echec: message } : p));
      this.importEnCours.set(false);
    };

    // Jamais désabonné, ni par `DestroyRef` ni par un nouveau fichier (C13) : `actuel()` fait ignorer la suite.
    this.api.importer({ sessionId: r.sessionId, irisKeyCol: this.colonneCle(), mapping: this.correspondance() }).subscribe({
      next: (evt) => {
        if (!actuel()) return;
        this.evenement(evt, echouer, () => (fin = true));
      },
      error: (e: unknown) => {
        if (!actuel()) return;
        const message = messageImport(e);
        this.ajouter(`! ${message}`, 'error');
        echouer(message);
      },
      complete: () => {
        if (!actuel()) return;
        if (!fin) {
          this.ajouter(`! ${MESSAGE_INTERROMPU}`, 'error');
          echouer(MESSAGE_INTERROMPU);
        }
        this.importEnCours.set(false);
      },
    });
  }

  /** « NOUVEAU FICHIER » (`page.tsx:271`) : l'écran repart vide. */
  protected nouveauFichier(): void {
    this.resultat.set(null);
    this.lignes.set([]);
    this.termine.set(false);
    this.progression.set(null);
  }

  /** Un événement du flux, lu comme React (`page.tsx:150-159`), plus la progression (C5). */
  private evenement(evt: EvenementImportIris, echouer: (m: string) => void, finir: () => void): void {
    switch (evt.type) {
      case 'log':
      case 'status':
        this.ajouter(evt.message);
        break;
      case 'progress':
        this.ajouter(evt.message);
        this.progression.update((p) => (p ? {
          ...p, etape: ETAPE_MISE_A_JOUR, pourcentage: evt.percent, traitees: (evt.totalInserted ?? 0) + (evt.totalErrors ?? 0),
        } : p));
        break;
      case 'error':
        this.ajouter(`! ${evt.message}`, 'error');
        finir();
        echouer(evt.message);
        break;
      case 'done': {
        const n = evt.totalInserted ?? 0;
        this.ajouter(`✓ Import terminé — ${n} lignes traitées`, 'success');
        finir();
        this.termine.set(true);
        const erreurs = evt.totalErrors ?? 0;
        // Vague finale F1 : `error` (aucune ligne écrite) échoue, `partial` avertit ; seul `success` est « ✓ ».
        this.progression.update((p) => (p ? {
          ...p, termine: true, bilan: { inseres: n, erreurs, statut: evt.status },
          echec: evt.status === 'error' ? `Import en échec — ${formaterNombre(erreurs)} ${erreurs > 1 ? 'erreurs' : 'erreur'}` : p.echec,
          avertissement: evt.status === 'partial',
        } : p));
        break;
      }
    }
  }

  private ajouter(message: string, sorte: Sorte = 'log'): void {
    this.lignes.update((l) => [...l.slice(-(LIGNES_MAX - 1)), { message, sorte }]);
  }
}
