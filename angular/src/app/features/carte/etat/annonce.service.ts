import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** Une annonce affichée : l'identifiant sert au `track` du gabarit et au retrait. */
export interface Annonce {
  readonly id: number;
  readonly texte: string;
  /** Instant d'émission (ms) : la barre de progression part de là. */
  readonly emise: number;
}

/** Durée d'affichage d'une annonce — `DURATION` de `components/ui/geo-toast.tsx`. */
export const DUREE_ANNONCE_MS = 4000;
/** Au plus trois cartes à l'écran, la plus ancienne part la première — `MAX_VISIBLE` de geo-toast. */
const MAX_VISIBLES = 3;

/**
 * Les annonces de l'écran carte (arbitrage B14 du lot 4) : le `toast.info(...)` de React
 * (`app/map/page.tsx:571`), réduit à ce que la carte en fait — une phrase d'information,
 * quatre secondes, trois au plus.
 *
 * Pas de service GLOBAL de notifications (reporté aux lots 5-6 par le lot 1) : celui-ci est
 * fourni PAR LA PAGE carte, `@Injectable()` sans `providedIn`, et détruit avec elle — ses
 * minuteries comprises.
 */
@Injectable()
export class AnnonceService {
  private readonly liste = signal<readonly Annonce[]>([]);
  readonly annonces = this.liste.asReadonly();
  private suivant = 0;
  private readonly minuteries = new Map<number, ReturnType<typeof setTimeout>>();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const t of this.minuteries.values()) clearTimeout(t);
      this.minuteries.clear();
    });
  }

  annoncer(texte: string): void {
    const id = ++this.suivant;
    this.liste.update((l) => [...l.slice(-(MAX_VISIBLES - 1)), { id, texte, emise: Date.now() }]);
    this.minuteries.set(id, setTimeout(() => this.retirer(id), DUREE_ANNONCE_MS));
  }

  retirer(id: number): void {
    clearTimeout(this.minuteries.get(id));
    this.minuteries.delete(id);
    this.liste.update((l) => l.filter((a) => a.id !== id));
  }
}
