import { Injectable, computed, inject, signal } from '@angular/core';
import { PoisService } from '../couches/pois.service';
import type { PoiCategorise } from '../logique/bataille/flux';
import { type ContexteBataille, territoireDuFiltre } from '../logique/bataille/parametres';
import { EtatCarteService } from './etat-carte.service';
import { ReferentielGeoService } from './referentiel-geo.service';

/**
 * Ce que les deux batailles d'isochrones (V1 et V2) partagent — la part commune de `use-isochrone-battle.ts` (lot 4,
 * T17) : le mode de transport choisi une fois pour les deux outils, la catégorie de POI (le seul type choisi), le
 * territoire dérivé du filtre unique, et l'affichage des POI de la bataille comme ZONE de points (`setZoneData`).
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class ContexteBatailleService {
  private readonly etat = inject(EtatCarteService);
  private readonly referentiel = inject(ReferentielGeoService);
  private readonly poisCarte = inject(PoisService);

  /** `transportMode` : « Voiture » par défaut. */
  readonly mode = signal('drive');
  /** Les outils n'existent qu'avec EXACTEMENT un type de POI (`exactlyOnePOI`). */
  readonly unPoi = computed(() => this.etat.poiSelectionnes().length === 1);
  /** Le référentiel des régions : la règle « toutes les régions » et le nom du territoire dans le journal. */
  readonly regions = this.referentiel.regions;
  readonly contexte = computed<ContexteBataille>(() => ({
    categorie: this.etat.poiSelectionnes()[0] ?? '',
    mode: this.mode(),
    territoire: territoireDuFiltre(this.etat.filtre()),
    nbRegionsRef: this.referentiel.regions().length,
  }));

  /**
   * Les POI de la bataille deviennent la zone de points affichée (`useMapDirectActions.ts:236-245,493-502`) :
   * marqueurs, badge ZONE_ACTIVE, catégorie dans la légende. Rien sans POI, comme React.
   */
  afficherPois(pois: readonly PoiCategorise[], categorie: string, ville: string | undefined): void {
    if (pois.length === 0) return;
    this.poisCarte.definirZone({
      coordonnees: { lat: pois[0].lat, lng: pois[0].lng },
      pois: [...pois],
      nb_pois: pois.length,
      categories: { [categorie]: pois.length },
      couleur_overrides: {},
      ville: ville ?? '',
      rayon_metres: null,
      rayon_poi_metres: null,
    });
  }
}
