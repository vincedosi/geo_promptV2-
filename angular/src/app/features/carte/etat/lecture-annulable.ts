import { DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import type { Observable, Subscription } from 'rxjs';

/**
 * Une lecture HTTP annulable (P-c) — le cycle commun des lectures de ④ (lot 4, T12, relecture I3 ; vague finale n° 10) :
 * zone analysée, score composite, couverture par rayon, contours, catalogue des cibles, liste des zones. Une lecture relancée ou annulée est DÉSABONNÉE (la requête part à la
 * corbeille) et son jeton invalidé : une réponse qui arriverait quand même n'est jamais affichée. Désabonnée au
 * `DestroyRef` de son propriétaire : à créer dans un contexte d'injection (initialiseur de champ).
 */
export class LectureAnnulable<T> {
  readonly resultat = signal<T | null>(null);
  readonly enCours = signal(false);
  readonly erreur = signal<string | null>(null);
  private jeton = 0;
  private abonnement: Subscription | null = null;

  /** `message` traduit l'échec ; il est lu AVANT `surEchec` (qui peut tout effacer, ex. zone introuvable). */
  constructor(private readonly message: (e: unknown) => string) {
    inject(DestroyRef).onDestroy(() => this.annuler());
  }

  /** Annule la lecture en vol, puis lit `source`. Le résultat précédent reste affiché jusqu'à la réponse. */
  lancer(source: Observable<T>, surSucces?: (r: T) => void, surEchec?: (e: unknown) => void): void {
    this.annuler();
    const jeton = this.jeton;
    this.enCours.set(true);
    this.erreur.set(null);
    this.abonnement = source.subscribe({
      next: (r) => {
        if (jeton !== this.jeton) return;
        this.abonnement = null;
        surSucces?.(r);
        this.resultat.set(r);
        this.enCours.set(false);
      },
      error: (e: unknown) => {
        if (jeton !== this.jeton) return;
        this.abonnement = null;
        const message = this.message(e);
        surEchec?.(e);
        this.enCours.set(false);
        this.erreur.set(message);
      },
    });
  }

  /** Lit `source()` s'il n'y a ni résultat ni lecture en vol : une lecture par propriétaire, un échec se relit au prochain appel. */
  chargerUneFois(source: () => Observable<T>): void {
    if (this.resultat() === null && !this.enCours()) this.lancer(source());
  }

  /** Un refus dit par l'écran, sans requête : la lecture en vol est annulée, le résultat effacé, le message posé. */
  refuser(message: string): void {
    this.perimer();
    this.erreur.set(message);
  }

  /** Désabonne la lecture en vol et invalide son jeton ; le résultat et le message restent. */
  annuler(): void {
    this.abonnement?.unsubscribe();
    this.abonnement = null;
    this.jeton++;
    this.enCours.set(false);
  }

  /** Annule, et efface résultat et message. */
  perimer(): void {
    this.annuler();
    this.resultat.set(null);
    this.erreur.set(null);
  }
}

/**
 * Appelle `agir` à chaque CHANGEMENT de `source` — jamais pour sa valeur initiale (P-a : l'effet ne fait que lire,
 * `agir` écrit hors suivi). À appeler dans un contexte d'injection.
 */
export function surChangement<V>(source: () => V, agir: () => void): void {
  let derniere = untracked(source);
  effect(() => {
    const v = source();
    untracked(() => {
      if (v === derniere) return;
      derniere = v;
      agir();
    });
  });
}
