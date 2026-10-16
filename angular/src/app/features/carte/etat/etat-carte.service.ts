import { Injectable, computed, inject, signal } from '@angular/core';
import { basculerDegrade as basculerDegradePur } from '../logique/calques-actifs';
import { type DegradeId, libelleDegrade } from '../logique/degrades';
import type { FiltreActif } from '../logique/filtre';
import { AnnonceService } from './annonce.service';

/**
 * L'état transverse de la carte principale — ce que `app/map/page.tsx` (l.140-260) et
 * `useMapLayers.ts` (l.1264-1271, `degradeActif`) tenaient dans des `useState`.
 *
 * L'étape du parcours n'est PAS ici : elle vit dans `ParcoursService` (et `?etape=`). Depuis le parcours de la carte
 * (2026-10-13), il n'y a plus d'entrée de rail à ouvrir ni à fermer.
 *
 * ── UN SEUL DÉGRADÉ DE COULEUR À LA FOIS ─────────────────────────────────
 * `basculerDegrade` reprend le contrat EXACT de `onDegrade` (`page.tsx:526-572`) : il rend l'id
 * évincé, appelle l'extinction que la couche évincée a inscrite (`surEviction`), puis annonce
 * « <libellé> a été masqué — un seul dégradé de couleur à la fois ». L'annonce part ICI, dans le
 * geste, jamais d'un `effect` qui recopierait `degradeActif` : celui-ci verrait aussi les remises à
 * zéro de « Tout effacer », qui n'annoncent rien (`page.tsx:740-743`).
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class EtatCarteService {
  private readonly annonce = inject(AnnonceService);

  /** Mode immersif : barre du parcours et panneau d'étape masqués. */
  readonly immersif = signal(false);
  /** Le filtre unique « où je regarde » (`lib/carte/filtre.ts`), posé par le panneau Filtre (T5). */
  readonly filtre = signal<FiltreActif | null>(null);
  /** POI sélectionnés : relevés ici pour survivre à la fermeture des panneaux (`page.tsx:197-200`). */
  readonly poiSelectionnes = signal<string[]>([]);
  /** Périmètre territorial (pastilles Métro / +DROM), même raison (`page.tsx:207-209`). */
  readonly perimetreScope = signal<'metro' | 'all' | null>(null);

  private readonly degrade = signal<DegradeId | null>(null);
  readonly degradeActif = this.degrade.asReadonly();
  private readonly evictions = new Map<DegradeId, () => void>();

  /**
   * Les outils qui PRENNENT les clics de la carte (dessin d'une zone, pose du centre d'un rayon, T16) : un seul reçoit
   * les clics à la fois, et le curseur de la carte reste le sien tant qu'il la tient.
   */
  private readonly outilsCarte = signal<readonly string[]>([]);
  readonly carteOccupee = computed(() => this.outilsCarte().length > 0);
  /**
   * L'outil qui reçoit les clics : le DERNIER à avoir pris la carte (revue 1). Un seul à la fois — sans quoi un même
   * clic posait à la fois le centre d'un rayon et un sommet du dessin. Rendre la carte la redonne au précédent.
   */
  readonly outilCarte = computed(() => this.outilsCarte().at(-1) ?? null);
  basculerDegrade(cible: DegradeId, next: boolean): DegradeId | null {
    const resultat = basculerDegradePur(this.degrade(), cible, next);
    this.degrade.set(resultat.degradeActif);
    const eteint = resultat.aEteindre;
    if (!eteint) return null;
    this.evictions.get(eteint)?.();
    this.annonce.annoncer(`${libelleDegrade(eteint)} a été masqué — un seul dégradé de couleur à la fois`);
    return eteint;
  }

  reinitialiserDegrade(): void {
    this.degrade.set(null);
  }

  /** Une couche s'abonne à l'éviction de SON dégradé. Ré-abonner remplace la fonction précédente. */
  surEviction(cible: DegradeId, eteindre: () => void): void {
    this.evictions.set(cible, eteindre);
  }

  prendreCarte(outil: string): void {
    this.outilsCarte.update((l) => [...l.filter((o) => o !== outil), outil]);
  }

  rendreCarte(outil: string): void {
    this.outilsCarte.update((l) => l.filter((o) => o !== outil));
  }
}
