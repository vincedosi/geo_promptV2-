import { DestroyRef, inject, signal } from '@angular/core';
import type { Observable, Subscription } from 'rxjs';

interface Tache {
  cle: string;
  source: () => Observable<unknown>;
  succes: (r: unknown) => void;
  echec: (e: unknown) => void;
}

/**
 * Une FILE de lectures HTTP, une à la fois (lot 5, T9) — les conversions de ⑤ : chacune peut lire ≈ 100 000 accès
 * (sql/275, sql/276), et quatre colonnes ouvertes ensemble ne doivent pas en lancer quatre (≤ 3 appels simultanés,
 * `CLAUDE.md`). Chaque tâche porte une CLÉ : en ajouter une de même clé remplace la précédente — en file, elle est
 * retirée ; en vol, elle est DÉSABONNÉE et son jeton invalidé (P-c : la réponse d'un rayon quitté n'est jamais lue).
 * `vider` annule tout (changement de zone) ; le `DestroyRef` du propriétaire aussi (à créer dans un contexte
 * d'injection). Même cycle que `LectureAnnulable`, pour plusieurs lectures ordonnées au lieu d'une.
 */
export class FileLectures {
  /** Les clés en file ou en vol : l'écran dit « en cours » par plateforme. */
  readonly cles = signal<ReadonlySet<string>>(new Set());
  private readonly attente: Tache[] = [];
  private enVol: { cle: string; jeton: number; abonnement: Subscription | null } | null = null;
  private jeton = 0;
  private detruite = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.detruite = true;
      this.vider();
    });
  }

  /** Met `source` en file sous `cle` (une tâche de même clé est remplacée). Rien après destruction. */
  ajouter<T>(cle: string, source: () => Observable<T>, succes: (r: T) => void, echec: (e: unknown) => void): void {
    if (this.detruite) return;
    this.retirer(cle);
    this.attente.push({ cle, source, succes: succes as (r: unknown) => void, echec });
    this.suivante();
  }

  contient(cle: string): boolean {
    return this.cles().has(cle);
  }

  /** Retire la tâche `cle`, en file ou en vol (désabonnée). */
  retirer(cle: string): void {
    const i = this.attente.findIndex((t) => t.cle === cle);
    if (i >= 0) this.attente.splice(i, 1);
    if (this.enVol?.cle === cle) this.annulerEnVol();
    this.publier();
  }

  /** Annule tout : la file et la lecture en vol. */
  vider(): void {
    this.attente.length = 0;
    this.annulerEnVol();
    this.publier();
  }

  private annulerEnVol(): void {
    this.enVol?.abonnement?.unsubscribe();
    this.enVol = null;
    this.jeton++;
  }

  private suivante(): void {
    if (this.enVol || this.detruite) return this.publier();
    const tache = this.attente.shift();
    if (!tache) return this.publier();
    const jeton = ++this.jeton;
    const vol: { cle: string; jeton: number; abonnement: Subscription | null } = { cle: tache.cle, jeton, abonnement: null };
    this.enVol = vol;
    this.publier();
    const terminer = (agir: () => void) => {
      if (this.enVol?.jeton !== jeton) return;
      this.enVol = null;
      agir();
      this.suivante();
    };
    // Une source qui répond pendant `subscribe` (synchrone) a déjà libéré la place : on ne garde pas son abonnement.
    const abonnement = tache.source().subscribe({
      next: (r) => terminer(() => tache.succes(r)),
      error: (e: unknown) => terminer(() => tache.echec(e)),
      // Terminée sans valeur : la place se libère quand même (après `next`, le jeton ne correspond déjà plus).
      complete: () => terminer(() => undefined),
    });
    if (this.enVol === vol) vol.abonnement = abonnement;
  }

  private publier(): void {
    this.cles.set(new Set([...(this.enVol ? [this.enVol.cle] : []), ...this.attente.map((t) => t.cle)]));
  }
}
