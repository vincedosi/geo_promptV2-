import { Injectable, computed, inject, signal } from '@angular/core';
import { basculerDegrade as basculerDegradePur } from '../logique/calques-actifs';
import { type DegradeId, libelleDegrade } from '../logique/degrades';
import type { FiltreActif } from '../logique/filtre';
import { ENTREES_NAVIGATION, type EntreeId } from '../logique/navigation';
import { AnnonceService } from './annonce.service';

/**
 * L'état transverse de la carte principale — ce que `app/map/page.tsx` (l.140-260) et
 * `useMapLayers.ts` (l.1264-1271, `degradeActif`) tenaient dans des `useState`.
 *
 * ── ENTRÉES DU RAIL ──────────────────────────────────────────────────────
 * `choisirEntree` route selon le TYPE de l'entrée (`page.tsx:180-196`), jamais selon son id :
 * - `overlay-plein-ecran` (Campagne) : rien — l'overlay MAGELIAN relève du lot 5 (arbitrage B6) ;
 * - l'Assistant (`tiroir-droit`) : rien — décision du propriétaire (2026-10-04), il n'est JAMAIS porté ;
 * - le reste bascule : re-choisir l'entrée ouverte la referme.
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

  private readonly entree = signal<EntreeId | null>(null);
  readonly entreeActive = this.entree.asReadonly();
  /** Mode immersif : rail et barre du haut masqués. */
  readonly railMasque = signal(false);
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
   * Les outils qui PRENNENT les clics de la carte (dessin d'une zone, pose du centre d'un rayon, T16). Tant qu'il y en
   * a un, un clic sur la carte appartient à l'outil et ne ferme pas le panneau qui le porte — React le fermait, et
   * l'outil disparaissait avec son tracé au premier clic (`OverlayPanel.tsx:107-117`).
   */
  private readonly outilsCarte = signal<ReadonlySet<string>>(new Set());
  readonly carteOccupee = computed(() => this.outilsCarte().size > 0);

  choisirEntree(id: EntreeId): void {
    const entree = ENTREES_NAVIGATION.find((e) => e.id === id);
    if (!entree) return;
    if (entree.type === 'overlay-plein-ecran' || entree.type === 'tiroir-droit') return;
    this.entree.update((courante) => (courante === id ? null : id));
  }

  fermerEntree(): void {
    this.entree.set(null);
  }

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
    this.outilsCarte.update((s) => new Set(s).add(outil));
  }

  rendreCarte(outil: string): void {
    this.outilsCarte.update((s) => {
      const suite = new Set(s);
      suite.delete(outil);
      return suite;
    });
  }
}
