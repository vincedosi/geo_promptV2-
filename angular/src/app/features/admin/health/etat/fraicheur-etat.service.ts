import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import type { Subscription } from 'rxjs';
import { FraicheurApi, type ReponseFraicheur } from '../data/fraicheur.api';

/** Message d'un échec : le `error` du corps (celui du SERVEUR, 429 compris), sinon le repli de React. */
function messageEchec(e: unknown, repli: string): string {
  const corps = e instanceof HttpErrorResponse ? (e.error as { error?: unknown } | null) : null;
  return corps && typeof corps === 'object' && typeof corps.error === 'string' && corps.error ? corps.error : repli;
}

/**
 * État de l'onglet « Fraîcheur des données » de la page Système : le relevé persisté et les mesures.
 *
 * Fourni par `SystemePage` et détruit avec elle (`@Injectable()` sans `providedIn`). L'écran
 * `mg-fraicheur` est une sous-route, détruite quand on change d'onglet : le relevé vit ici, lu à la
 * PREMIÈRE ouverture de l'onglet puis gardé — un aller-retour d'onglets ne le relit pas (T4 :
 * React démontait le panneau et relisait à chaque retour, défaut corrigé). Une mesure lancée
 * survit à un changement d'onglet ; tout est annulé avec la page.
 */
@Injectable()
export class FraicheurEtatService {
  private readonly api = inject(FraicheurApi);
  private lecture: Subscription | null = null;
  private mesure: Subscription | null = null;

  readonly donnees = signal<ReponseFraicheur | null>(null);
  readonly chargement = signal(true);
  readonly mesureEnCours = signal<'leger' | 'lourd' | null>(null);
  readonly erreur = signal<string | null>(null);
  /** Boutons désactivés : `mesureEnCours !== null || chargement` (`FraicheurPanel.tsx:237, 335`). */
  readonly occupe = computed(() => this.mesureEnCours() !== null || this.chargement());

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.lecture?.unsubscribe();
      this.mesure?.unsubscribe();
    });
  }

  /** UNE lecture du relevé (GET), à la première ouverture de l'onglet ; aucune mesure. */
  assurer(): void {
    if (this.lecture) return;
    this.lecture = this.api.lire().subscribe({
      next: (r) => {
        this.donnees.set(r);
        this.chargement.set(false);
      },
      error: (e: unknown) => {
        this.erreur.set(messageEchec(e, 'Lecture impossible.'));
        this.chargement.set(false);
      },
    });
  }

  /** `mesurer` (`FraicheurPanel.tsx:157-176`) : UNE mesure à la fois ; jamais de relance automatique. */
  mesurer(inclureLourd: boolean): void {
    if (this.occupe()) return;
    this.mesureEnCours.set(inclureLourd ? 'lourd' : 'leger');
    this.erreur.set(null);
    this.mesure = this.api.mesurer(inclureLourd).subscribe({
      next: (r) => {
        this.donnees.set(r);
        if (r.persiste === false) {
          this.erreur.set('Mesure faite, mais elle n’a pas pu être enregistrée : elle sera perdue au rechargement.');
        }
        this.mesureEnCours.set(null);
      },
      error: (e: unknown) => {
        this.erreur.set(messageEchec(e, 'La mesure a échoué.'));
        this.mesureEnCours.set(null);
      },
    });
  }
}
