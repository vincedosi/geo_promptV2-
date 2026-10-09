import { DestroyRef, Injectable, type Signal, computed, inject, signal, untracked } from '@angular/core';
import type { Subscription } from 'rxjs';
import { EspacesApi } from '../data/espaces.api';
import { messageErreur } from '../logique/libelles';
import type { EspaceResume } from '../logique/types';

/**
 * État de la page « Espaces de travail » : la liste des espaces et le compteur du socle, lus
 * UNE fois par `GET admin/espaces` puis gardés (cache avant appel, règle d'I/O du lot 6) tant que
 * la page vit. Passer d'une fiche à l'autre ne relit rien ; seule une écriture qui change un
 * compteur appelle `recharger()`.
 *
 * `@Injectable()` SANS `providedIn` : fourni par `EspacesPage`, détruit avec elle (sa requête en
 * vol est alors abandonnée). Zoneless : tout passe par des signaux.
 */
@Injectable()
export class EspacesEtatService {
  private readonly api = inject(EspacesApi);
  private requete: Subscription | null = null;
  /** Vrai après une lecture RÉUSSIE : `charger()` ne relit plus. Une erreur ne compte pas. */
  private charge = false;

  private readonly liste = signal<readonly EspaceResume[]>([]);
  private readonly compteurSocle = signal<{ nb_jeux: number } | null>(null);
  private readonly enCours = signal(false);
  private readonly echec = signal<string | null>(null);

  readonly espaces: Signal<readonly EspaceResume[]> = this.liste.asReadonly();
  readonly socle: Signal<{ nb_jeux: number } | null> = this.compteurSocle.asReadonly();
  readonly chargement: Signal<boolean> = this.enCours.asReadonly();
  readonly erreur: Signal<string | null> = this.echec.asReadonly();

  /**
   * Un `computed` par identifiant, créé une seule fois puis réutilisé : appeler `espace(id)` depuis
   * un `computed` (une fiche qui suit l'`id` de sa route) ne recrée donc pas de signal à chaque
   * évaluation. La création elle-même passe sous `untracked`, hors du contexte réactif appelant.
   */
  private readonly parId = new Map<string, Signal<EspaceResume | null>>();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.requete?.unsubscribe());
  }

  /** Un GET `admin/espaces` ; ignoré si la liste est déjà chargée ou en cours de lecture. */
  charger(): void {
    if (this.charge || this.enCours()) return;
    this.lire();
  }

  /** Force la relecture (après une écriture qui change un compteur), en abandonnant une lecture en vol. */
  recharger(): void {
    this.requete?.unsubscribe();
    this.lire();
  }

  /** L'espace `id` de la liste, ou `null` — suit les relectures. */
  espace(id: string): Signal<EspaceResume | null> {
    let s = this.parId.get(id);
    if (!s) {
      s = untracked(() => computed(() => this.liste().find((e) => e.id === id) ?? null));
      this.parId.set(id, s);
    }
    return s;
  }

  private lire(): void {
    this.enCours.set(true);
    this.echec.set(null);
    this.requete = this.api.lister().subscribe({
      next: (r) => {
        this.liste.set(r.espaces ?? []);
        this.compteurSocle.set(r.socle ?? null);
        this.charge = true;
        this.enCours.set(false);
      },
      error: (e: unknown) => {
        this.liste.set([]);
        this.compteurSocle.set(null);
        this.echec.set(messageErreur(e));
        this.enCours.set(false);
      },
    });
  }
}
