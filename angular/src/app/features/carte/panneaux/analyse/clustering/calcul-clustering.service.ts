import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { messageErreurApi } from '../../../../../core/http/erreurs';
import { ClustersService } from '../../../couches/clusters.service';
import { ClusteringApi } from '../../../data/clustering.api';
import { type CorpsLancementClustering, INTERVALLE_SONDAGE_MS, STATUTS_FINAUX } from '../../../logique/clustering/assistant';

/**
 * Le job de calcul du clustering — le lancement (`handleLaunch`) et le sondage (`ClusteringWizard.tsx:176-196`) de
 * l'assistant React (lot 4, T20).
 *
 * ── POURQUOI UN SERVICE FOURNI PAR LE PANNEAU ANALYSE ────────────────────
 * Le lancement est le calcul LOURD : il ne part que de `mg-panneau-analyse`, APRÈS `verifierPerimetreOutil('clustering')`
 * (verrou structurel `panneau-analyse-garde.test.ts`). L'assistant, trois composants plus bas, n'appelle jamais
 * `lancer` : il émet le corps, le panneau garde puis lance, et l'assistant LIT l'état d'ici.
 *
 * ── LE SONDAGE S'ARRÊTE ──────────────────────────────────────────────────
 * - sur `done` / `failed` (React : `clearInterval` au statut final) ;
 * - quand l'assistant est détruit (✕, « Fermer », panneau fermé) : il appelle `reinitialiser` depuis son `DestroyRef`,
 *   comme le nettoyage de l'effet React ; un job encore en cours côté serveur n'est plus suivi, il n'est pas annulé ;
 * - quand ce service est détruit avec le panneau.
 * Un sondage en échec réseau est ignoré et retenté au tic suivant (`.catch(() => {})` de React).
 *
 * À `done`, la liste des modèles est relue (le nouveau modèle, s'il y en a un, y apparaît).
 */
@Injectable()
export class CalculClusteringService {
  private readonly api = inject(ClusteringApi);
  private readonly clusters = inject(ClustersService);

  private readonly _lancement = signal(false);
  private readonly _jobId = signal<string | null>(null);
  private readonly _statut = signal('');
  private readonly _journal = signal('');
  private readonly _termine = signal(false);
  private readonly _erreur = signal<string | null>(null);

  /** Le POST est en vol (« Lancement... »). */
  readonly lancement = this._lancement.asReadonly();
  /** L'identifiant du job créé ; `null` tant qu'aucun lancement n'a abouti. */
  readonly jobId = this._jobId.asReadonly();
  /** Le dernier statut lu (`pending`, `running`, `done`, `failed`) ; vide avant la première réponse. */
  readonly statut = this._statut.asReadonly();
  /** La fin du journal du script (`log_tail`). */
  readonly journal = this._journal.asReadonly();
  /** Un statut final a été lu : le sondage est arrêté. */
  readonly termine = this._termine.asReadonly();
  /** Le refus du serveur au lancement (503 « script absent », 400, 403…), tel quel. */
  readonly erreur = this._erreur.asReadonly();

  private envoi: Subscription | null = null;
  private lecture: Subscription | null = null;
  private minuterie: ReturnType<typeof setInterval> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.arreter());
  }

  /** ⚠ N'appeler qu'APRÈS la garde de périmètre du panneau Analyse : ce POST écrit en base et appelle ORS. */
  lancer(corps: CorpsLancementClustering): void {
    this.envoi?.unsubscribe();
    this._lancement.set(true);
    this._erreur.set(null);
    this.envoi = this.api.lancer(corps).subscribe({
      next: (id) => {
        this._lancement.set(false);
        this._jobId.set(id);
        this.sonder(id);
      },
      error: (e: unknown) => {
        this._lancement.set(false);
        this._erreur.set(messageErreurApi(e));
      },
    });
  }

  /** Tout oublier : l'assistant suivant repart d'un état vierge (React démontait le wizard et son état). */
  reinitialiser(): void {
    this.arreter();
    this._lancement.set(false);
    this._jobId.set(null);
    this._statut.set('');
    this._journal.set('');
    this._termine.set(false);
    this._erreur.set(null);
  }

  private sonder(id: string): void {
    this.arreterSondage();
    const lire = () => {
      this.lecture?.unsubscribe();
      this.lecture = this.api.statut(id).subscribe({
        next: (d) => {
          this._statut.set(d.status ?? '');
          this._journal.set(d.log_tail ?? '');
          if (!STATUTS_FINAUX.includes(d.status ?? '')) return;
          this.arreterSondage();
          this._termine.set(true);
          if (d.status === 'done') this.clusters.chargerModeles();
        },
        // Un tic manqué n'arrête rien : le suivant relit (`.catch(() => {})`).
        error: () => undefined,
      });
    };
    lire();
    this.minuterie = setInterval(lire, INTERVALLE_SONDAGE_MS);
  }

  private arreterSondage(): void {
    if (this.minuterie !== null) clearInterval(this.minuterie);
    this.minuterie = null;
  }

  private arreter(): void {
    this.arreterSondage();
    this.envoi?.unsubscribe();
    this.lecture?.unsubscribe();
  }
}
