/**
 * La couche d'aperçu des POI que l'assistant de clustering va traiter (lot 4, T20) : son service, fourni par la
 * page carte, et ses identifiants de source et de couche.
 */
import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { type Subscription, timeout } from 'rxjs';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarteApi } from '../data/carte.api';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { avantDe } from '../logique/ordre-couches';

export const SOURCE_APERCU = 'wizard-highlight';
export const COUCHE_APERCU = 'wizard-highlight-layer';

/** Le délai de l'aperçu (`AbortSignal.timeout(15000)`, `page.tsx:420`) : en deçà des 25 s de `CarteApi.pois`. */
const DELAI_APERCU_MS = 15000;

const VIDE: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * L'aperçu des POI que l'assistant de clustering va traiter — `handleWizardHighlight` (`page.tsx:410-436`) et la couche
 * `wizard-highlight-layer` (`useMapInit.ts:746-760`), lot 4, T20.
 *
 * Fourni par la PAGE (la couche vit sur la carte, comme `ClustersService`), piloté par l'assistant : `afficher` à chaque
 * changement de types ou de « métropolitaine uniquement », `effacer` à sa fermeture (`onWizardClose`). Best effort :
 * un échec n'affiche rien et ne bloque pas le calcul.
 *
 * Teintes : l'ambre `#f59e0b` de React → `--warning`, le cerne `#050505` → `--brand-teal-fg` (le même `#050505`,
 * invariant) — valeurs CALCULÉES par `CouleursService`, repeintes au changement de thème.
 *
 * Défauts React corrigés : vider la sélection laissait l'aperçu précédent sur la carte — il s'efface ; deux sélections
 * rapprochées pouvaient se croiser — la précédente est annulée ; resélectionner les mêmes types relisait jusqu'à
 * 10 000 POI — la réponse est gardée le temps de l'écran (règle « cache avant appel », CLAUDE.md).
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class ApercuClusteringService {
  private readonly api = inject(CarteApi);
  private readonly couches = inject(CouchesCarteService);
  private readonly palette = inject(CouleursService).palette({ remplissage: 'warning', cerne: 'brand-teal-fg' });

  private readonly donnees = signal<GeoJSON.FeatureCollection | null>(null);
  private readonly cache = new Map<string, GeoJSON.FeatureCollection | null>();
  private lecture: Subscription | null = null;
  /** L'instance où la couche est POSÉE. */
  private readonly posee = signal<maplibregl.Map | null>(null);

  constructor() {
    this.couches.inscrireEffacement('apercu-clustering', () => this.effacer());
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());

    // Pose à la première donnée, re-pose sur une carte recréée (B11) — la palette lue À LA POSE seulement.
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (!carte) { this.posee.set(null); return; }
      if (!this.donnees() || untracked(this.posee) === carte) return;
      nettoyer(quandStyleCharge(carte, () => untracked(() => {
        poserCoucheApercu(carte, this.palette());
        this.posee.set(carte);
      })));
    });

    // Données et visibilité ensemble : l'aperçu n'a pas de bascule propre, il est visible tant qu'il a des points.
    effect(() => {
      const carte = this.posee();
      if (!carte?.getLayer(COUCHE_APERCU)) return;
      const donnees = this.donnees();
      (carte.getSource(SOURCE_APERCU) as maplibregl.GeoJSONSource | undefined)?.setData(donnees ?? VIDE);
      carte.setLayoutProperty(COUCHE_APERCU, 'visibility', donnees ? 'visible' : 'none');
    });

    // Thème : repeindre, sans toucher aux données.
    effect(() => {
      const carte = this.posee();
      if (!carte?.getLayer(COUCHE_APERCU)) return;
      const p = this.palette();
      carte.setPaintProperty(COUCHE_APERCU, 'circle-color', p.remplissage);
      carte.setPaintProperty(COUCHE_APERCU, 'circle-stroke-color', p.cerne);
    });
  }

  /** Les POI de ces types, sur la métropole ou toute la France (`scope`), sans autre filtre — le corps de React. */
  afficher(types: readonly string[], metropolitaine: boolean): void {
    this.lecture?.unsubscribe();
    if (types.length === 0) { this.donnees.set(null); return; }
    const cle = `${metropolitaine ? 'metro' : 'all'}|${[...types].sort().join(',')}`;
    if (this.cache.has(cle)) { this.donnees.set(this.cache.get(cle)!); return; }
    this.lecture = this.api.pois({
      poi_types: [...types], scope: metropolitaine ? 'metro' : 'all', regions: [], depts: [], ville: '', rayon_poi: null, poi_natures: {},
    }).pipe(timeout(DELAI_APERCU_MS)).subscribe({
      next: (r) => {
        const pois = r.pois ?? [];
        const collection: GeoJSON.FeatureCollection | null = pois.length ? {
          type: 'FeatureCollection',
          features: pois.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { id: p.id, nom: p.nom } })),
        } : null;
        this.cache.set(cle, collection);
        this.donnees.set(collection);
      },
      // Best effort (`catch {}`) : l'aperçu manque, le calcul reste possible.
      error: () => undefined,
    });
  }

  /** L'assistant se ferme, ou « Tout effacer » : plus d'aperçu (`setWizardHighlightGeoJSON(null)`). */
  effacer(): void {
    this.lecture?.unsubscribe();
    this.donnees.set(null);
  }
}

type CarteApercu = Pick<maplibregl.Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer'>;

/** La source et la couche de l'aperçu, IDEMPOTENTES, à leur rang de React (`avantDe`) ; masquées jusqu'aux données. */
export function poserCoucheApercu(carte: CarteApercu, p: { remplissage: string; cerne: string }): void {
  if (!carte.getSource(SOURCE_APERCU)) carte.addSource(SOURCE_APERCU, { type: 'geojson', data: VIDE });
  if (!carte.getLayer(COUCHE_APERCU)) {
    carte.addLayer({
      id: COUCHE_APERCU, type: 'circle', source: SOURCE_APERCU,
      paint: { 'circle-color': p.remplissage, 'circle-radius': 5, 'circle-opacity': 0.8, 'circle-stroke-width': 1.5, 'circle-stroke-color': p.cerne },
      layout: { visibility: 'none' },
    }, avantDe(carte, COUCHE_APERCU));
  }
}
