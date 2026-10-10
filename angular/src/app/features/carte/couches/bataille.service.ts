import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { type PoiBataille, pointsBataille, stylerAnneaux } from '../logique/bataille/anneaux';
import { poserBataille, retirerBataille } from './couche-bataille';

/** Le contenu du créneau de bataille (`battleFeatures`, `battlePois`, `battleCacheKey` de `useMapDirectActions`). */
export interface CreneauBataille {
  anneaux: GeoJSON.Feature[];
  pois: PoiBataille[];
  /** La clé de cache des isochrones ; `cg__<id>` pour une zone enregistrée ouverte par le lien. */
  cle: string | null;
  /** `battleCategory` : la catégorie de POI, `custom_geo_zone` pour une zone. */
  categorie: string;
}

/**
 * Le CRÉNEAU DE BATAILLE de la carte principale : ce que React répartissait entre `useMapDirectActions` (anneaux, POI,
 * clé de cache) et `applyIsochroneBattle` (`useMapLayers.ts:1029-1159`, le rendu). Un seul créneau : une nouvelle
 * bataille — ou une zone ouverte par `?customZone=` — REMPLACE la précédente, comme dans React.
 *
 * La tâche 14 le crée pour le lien `customZone` (T14) ; la tâche 17 y branchera les batailles V1/V2, leurs bordures,
 * le palier maximum et la légende. Les consommateurs lisent `cle` (bouton « Script bidding DV360 », capture T16) et
 * `pois`.
 *
 * Re-posé sur la carte recréée par un changement de fond (B11) ; « Tout effacer » le vide (`page.tsx:732-734`).
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class BatailleService {
  private readonly couches = inject(CouchesCarteService);

  private readonly creneau = signal<CreneauBataille | null>(null);
  /** `battleCacheKey`. */
  readonly cle = computed(() => this.creneau()?.cle ?? null);
  /** `battlePois`. */
  readonly pois = computed(() => this.creneau()?.pois ?? []);
  /** Ce que la carte peint : anneaux colorés, légende par POI, points. */
  private readonly rendu = computed(() => {
    const c = this.creneau();
    if (!c) return null;
    const { anneaux, legende } = stylerAnneaux(c.anneaux);
    return { anneaux, legende, points: pointsBataille(c.pois) };
  });
  /** Une entrée par POI, dans sa teinte — la légende de bataille (T17). */
  readonly legende = computed(() => this.rendu()?.legende ?? []);

  constructor() {
    this.couches.inscrireEffacement('bataille', () => this.effacer());

    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      const rendu = this.rendu();
      if (!carte) return;
      if (!rendu) {
        untracked(() => retirerBataille(carte));
        return;
      }
      nettoyer(quandStyleCharge(carte, () => untracked(() => poserBataille(carte, rendu.anneaux, rendu.points))));
    });
  }

  /** Remplit le créneau (`setBattleFeatures` + `setBattlePois` + `setBattleCacheKey` + `applyIsochroneBattle`). */
  appliquer(creneau: CreneauBataille): void {
    this.creneau.set(creneau);
  }

  /** Vide le créneau : plus d'anneaux, plus de POI, plus de clé. */
  effacer(): void {
    this.creneau.set(null);
  }
}
