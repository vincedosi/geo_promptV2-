/**
 * La couche du flux routier (TMJA) de la carte principale (lot 4, T9) : état, lecture sur la carte visible,
 * pose, filtre « Masquer le trafic faible » et peinture par paliers.
 */
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { CarteApi } from '../data/carte.api';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { avantDe } from '../logique/ordre-couches';
import { LARGEUR_TMJA_PAR_ZOOM, OPACITE_TMJA_PAR_ZOOM, PALIERS_TMJA, SOURCE_TMJA } from '../logique/palettes-donnees-carte';

export const SOURCE_TMJA_ID = 'tmja-source';
export const COUCHE_TMJA = 'tmja-lines';
/** « Masquer le trafic faible » (`page.tsx:470-478`) : seuls les tronçons à 5 000 véh/j et plus restent. */
export const FILTRE_TRAFIC_FAIBLE = ['>=', ['get', 'tmja'], 5000] as const;

type CarteTmja = Pick<maplibregl.Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer' | 'setLayoutProperty' | 'setFilter'>;

/** `['step', ['get','tmja'], bleu, 5000, jaune, 15000, orange, 40000, rouge]` (`useMapInit.ts:406-412`). */
function couleurTmja(): unknown[] {
  const [premier, ...suite] = PALIERS_TMJA;
  return ['step', ['get', 'tmja'], premier.couleur, ...suite.flatMap((p) => [p.seuil, p.couleur])];
}

const interpolationZoom = (paires: ReadonlyArray<readonly [number, number]>) =>
  ['interpolate', ['linear'], ['zoom'], ...paires.flat()];

/**
 * Le flux routier (TMJA, comptages routiers CEREMA) — la sentinelle `tmjaGeoJSON` de `page.tsx:242-255,468-504` et la
 * couche `tmja-lines` de `useMapInit.ts:385-418`.
 *
 * Tuiles vectorielles (`/api/tmja-tiles/{z}/{x}/{y}?v=v10`, `minzoom 5`) : MapLibre ne demande que les tuiles de la carte
 * visible, et rien sous le zoom 5. React posait la source au `load`, masquée ; ici elle est posée à la PREMIÈRE
 * visibilité, sur l'instance courante, et re-posée sur une carte recréée par un changement de fond (B11). « Masquer le
 * trafic faible » (coché par défaut, `page.tsx:255`) n'est qu'un `setFilter` : aucune tuile redemandée.
 *
 * React montrait « Chargement... » le temps d'un appel synchrone, donc jamais : pas d'état de chargement ici.
 * « Tout effacer » masque la couche (`page.tsx:735`) et garde le choix du filtre, comme React.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class TmjaService {
  private readonly couches = inject(CouchesCarteService);
  private readonly api = inject(CarteApi);

  /** La couche est affichée (`!!tmjaGeoJSON`). */
  readonly visible = signal(false);
  /** « Masquer le trafic faible (< 5 000 véh/j) », coché par défaut. */
  readonly masquerFaible = signal(true);

  private readonly posee = signal<maplibregl.Map | null>(null);

  constructor() {
    this.couches.inscrireEffacement('tmja', () => this.visible.set(false));

    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (!carte) {
        this.posee.set(null);
        return;
      }
      if (!this.visible() || untracked(this.posee) === carte) return;
      nettoyer(quandStyleCharge(carte, () => {
        poserCoucheTmja(carte, this.api.urlTuilesTmja());
        this.posee.set(carte);
      }));
    });

    // Visibilité et filtre (`page.tsx:468-479`) : jamais une tuile redemandée.
    effect(() => {
      const carte = this.posee();
      if (!carte || !carte.getLayer(COUCHE_TMJA)) return;
      carte.setLayoutProperty(COUCHE_TMJA, 'visibility', this.visible() ? 'visible' : 'none');
      carte.setFilter(COUCHE_TMJA, this.masquerFaible() ? (FILTRE_TRAFIC_FAIBLE as unknown as maplibregl.FilterSpecification) : null);
    });
  }

  /** « Afficher TMJA » / « Actualiser ». */
  afficher(): void {
    this.visible.set(true);
  }

  /** « Masquer » (`onClearTMJA`). */
  masquer(): void {
    this.visible.set(false);
  }
}

/** La source et sa couche (`useMapInit.ts:391-418`), IDEMPOTENT, insérée à sa place dans l'ordre de React (`avantDe`). */
export function poserCoucheTmja(carte: CarteTmja, urlTuiles: string): void {
  if (!carte.getSource(SOURCE_TMJA_ID)) {
    carte.addSource(SOURCE_TMJA_ID, {
      type: 'vector', tiles: [urlTuiles], minzoom: SOURCE_TMJA.minzoom, maxzoom: SOURCE_TMJA.maxzoom,
    });
  }
  if (!carte.getLayer(COUCHE_TMJA)) {
    carte.addLayer({
      id: COUCHE_TMJA, type: 'line', source: SOURCE_TMJA_ID, 'source-layer': 'tmja',
      paint: {
        'line-width': interpolationZoom(LARGEUR_TMJA_PAR_ZOOM),
        'line-color': couleurTmja(),
        'line-opacity': interpolationZoom(OPACITE_TMJA_PAR_ZOOM),
      },
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_TMJA));
  }
}
