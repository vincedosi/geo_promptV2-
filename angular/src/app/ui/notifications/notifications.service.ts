import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** Les quatre variantes de `components/ui/geo-toast.tsx`. */
export type VarianteNotification = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  readonly id: number;
  readonly titre: string;
  readonly message?: string;
  readonly variante: VarianteNotification;
  /** Vrai pendant la sortie animée (`EXIT_MS`) : la carte glisse, puis disparaît. */
  readonly sortie?: boolean;
}

/** `DURATION` de geo-toast.tsx. */
export const DUREE_NOTIFICATION = 4000;
/** `EXIT_MS` de geo-toast.tsx : durée de la sortie animée avant le retrait réel. */
export const DUREE_SORTIE = 280;
/** `MAX_VISIBLE` de geo-toast.tsx. */
export const MAX_NOTIFICATIONS = 3;

/**
 * Notifications, port de `useToast` (`components/ui/geo-toast.tsx`, arbitrage C7).
 *
 * `@Injectable()` SANS `providedIn` : fourni par le composant qui les affiche (le cadre admin, le
 * catalogue), détruit avec lui. Ses minuteries sont annulées à cette destruction (`DestroyRef`) —
 * React les laissait courir après le démontage.
 *
 * Mêmes règles que React : 4 s, puis une sortie animée de 280 ms ; 3 au plus, une quatrième
 * poussée retire la plus ancienne SANS attendre (`prev.slice(-(MAX_VISIBLE - 1))`).
 */
@Injectable()
export class NotificationsService {
  private readonly liste = signal<readonly Notification[]>([]);
  readonly notifications = this.liste.asReadonly();

  private suivant = 0;
  /** Minuterie de chaque notification : expiration (4 s) puis retrait (280 ms). */
  private readonly minuteries = new Map<number, ReturnType<typeof setTimeout>>();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const m of this.minuteries.values()) clearTimeout(m);
      this.minuteries.clear();
    });
  }

  success(titre: string, message?: string): void { this.pousser(titre, message, 'success'); }
  error(titre: string, message?: string): void { this.pousser(titre, message, 'error'); }
  warning(titre: string, message?: string): void { this.pousser(titre, message, 'warning'); }
  info(titre: string, message?: string): void { this.pousser(titre, message, 'info'); }

  /** Sortie animée, puis retrait (le `dismiss` de React). Sans effet sur un id inconnu. */
  retirer(id: number): void {
    const n = this.liste().find((x) => x.id === id);
    if (!n || n.sortie) return;
    this.annulerMinuterie(id);
    this.liste.update((l) => l.map((x) => (x.id === id ? { ...x, sortie: true } : x)));
    this.minuteries.set(id, setTimeout(() => {
      this.minuteries.delete(id);
      this.liste.update((l) => l.filter((x) => x.id !== id));
    }, DUREE_SORTIE));
  }

  private pousser(titre: string, message: string | undefined, variante: VarianteNotification): void {
    const id = ++this.suivant;
    const avant = this.liste();
    const gardees = avant.slice(-(MAX_NOTIFICATIONS - 1));
    for (const evincee of avant.slice(0, avant.length - gardees.length)) this.annulerMinuterie(evincee.id);
    const n: Notification = message === undefined ? { id, titre, variante } : { id, titre, message, variante };
    this.liste.set([...gardees, n]);
    this.minuteries.set(id, setTimeout(() => {
      this.minuteries.delete(id);
      this.retirer(id);
    }, DUREE_NOTIFICATION));
  }

  private annulerMinuterie(id: number): void {
    const m = this.minuteries.get(id);
    if (m !== undefined) clearTimeout(m);
    this.minuteries.delete(id);
  }
}
