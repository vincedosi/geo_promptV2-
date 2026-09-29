import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { type Chargement, type Piste, agregerChargement } from './chargement';

/**
 * Registre des pistes de chargement d'UN écran. Pas `providedIn: 'root'` :
 * l'écran le fournit (`providers: [ChargementService]`), et ses composants
 * enfants y déclarent leurs pistes. Équivalent de ContexteChargement côté React.
 */
@Injectable()
export class ChargementService {
  private readonly pistes = signal<Piste[]>([]);

  readonly etat = computed<Chargement>(() => agregerChargement(this.pistes()));

  declarer(p: Piste): void {
    this.pistes.update((liste) => {
      const i = liste.findIndex((x) => x.cle === p.cle);
      if (i >= 0 && liste[i].actif === p.actif && liste[i].libelle === p.libelle) return liste;
      if (i < 0) return [...liste, p];
      const copie = [...liste];
      copie[i] = p;
      return copie;
    });
  }

  retirer(cle: string): void {
    this.pistes.update((liste) => (liste.some((x) => x.cle === cle) ? liste.filter((x) => x.cle !== cle) : liste));
  }

  /**
   * Déclare une piste qui suit `actif` et disparaît avec le composant appelant.
   * À appeler dans un contexte d'injection (constructeur ou initialiseur de champ).
   */
  suivre(cle: string, libelle: string, actif: () => boolean): void {
    effect(() => this.declarer({ cle, libelle, actif: actif() }));
    inject(DestroyRef).onDestroy(() => this.retirer(cle));
  }
}
