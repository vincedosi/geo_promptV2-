import { Injectable } from '@angular/core';

/**
 * Un seul Échap, un ordre garanti : dernier ouvert = premier fermé.
 *
 * Même logique que `lib/carte/pile-echap.ts` (React), à une différence près, voulue
 * (arbitrage B10 du lot 4) : la pile n'est PLUS un tableau de module partagé par
 * toute l'application, mais l'état d'un service fourni PAR LA PAGE carte. Deux
 * pages, ou une page recréée, n'ont donc aucune entrée commune — et une remote
 * montée dans un shell n'a pas d'état global qui survivrait à son écran.
 *
 * ⚠ Ré-empiler un id EXISTANT met à jour sa fonction de fermeture SANS changer sa
 * position ; seul un id NOUVEAU part au sommet (round de correction 1 côté React :
 * un Assistant re-rendu à chaque jeton de streaming reprenait sinon le sommet sur
 * une Campagne ouverte par-dessus, et Échap fermait le mauvais panneau).
 *
 * `@Injectable()` sans `providedIn` : à fournir dans les `providers` de la page.
 */
interface Entree {
  readonly id: string;
  fermer: () => void;
}

@Injectable()
export class PileEchapService {
  private readonly pile: Entree[] = [];

  empiler(id: string, fermer: () => void): void {
    const existante = this.pile.find((e) => e.id === id);
    if (existante) {
      existante.fermer = fermer;
      return;
    }
    this.pile.push({ id, fermer });
  }

  depiler(id: string): void {
    const i = this.pile.findIndex((e) => e.id === id);
    if (i !== -1) this.pile.splice(i, 1);
  }

  /** Ferme l'entrée la plus haute. Sans effet si la pile est vide. */
  fermerLePlusHaut(): void {
    const haut = this.pile.pop();
    haut?.fermer();
  }

  /** Vue de la pile, du bas vers le haut — pour les specs. Une copie : la muter ne change rien. */
  etat(): readonly { id: string }[] {
    return this.pile.map((e) => ({ id: e.id }));
  }
}
