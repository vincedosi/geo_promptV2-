import { Injectable, type Signal, effect, inject, signal } from '@angular/core';
import { PileEchapService } from '../etat/pile-echap.service';

/** Les outils qui ouvrent un tiroir. La légende et le mode immersif sont des bascules, pas des tiroirs. */
export type OutilCarte = 'analyses' | 'zones' | 'fond' | 'aide' | 'reglages';
/** L'id du tiroir dans la pile Échap : un seul tiroir à la fois (spec § 6). */
export const PILE_OUTIL = 'outil';

/**
 * La boîte à outils de la carte (spec § 6) : l'outil ouvert, les outils déjà ouverts une fois (leur contenu reste monté,
 * ruling AT-6), l'affichage de la légende, et un compteur que « Créer une zone » (④) incrémente pour que « Mes zones »,
 * ouvert dans le tiroir, se relise sans être recréé.
 * `@Injectable()` sans `providedIn` : fourni par la page carte.
 */
@Injectable()
export class OutilsCarteService {
  private readonly pile = inject(PileEchapService);
  private readonly _outil = signal<OutilCarte | null>(null);
  readonly outil: Signal<OutilCarte | null> = this._outil.asReadonly();
  private readonly _visites = signal<ReadonlySet<OutilCarte>>(new Set());
  /** Les outils ouverts au moins une fois : leur contenu est monté à la première ouverture, puis gardé (AT-6, comme A1). */
  readonly visites: Signal<ReadonlySet<OutilCarte>> = this._visites.asReadonly();
  readonly legendeVisible = signal(true);
  private readonly _revisionZones = signal(0);
  readonly revisionZones: Signal<number> = this._revisionZones.asReadonly();

  constructor() {
    effect((nettoyer) => {
      if (!this._outil()) return;
      this.pile.empiler(PILE_OUTIL, () => this.fermer());
      nettoyer(() => this.pile.depiler(PILE_OUTIL));
    });
  }

  basculer(o: OutilCarte): void {
    if (this._outil() === o) this.fermer();
    else this.ouvrir(o);
  }

  ouvrir(o: OutilCarte): void {
    this._outil.set(o);
    if (!this._visites().has(o)) this._visites.update((v) => new Set([...v, o]));
  }

  fermer(): void {
    this._outil.set(null);
  }

  zonesModifiees(): void {
    this._revisionZones.update((n) => n + 1);
  }
}
