import { DOCUMENT, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { FABRIQUE_POPUP } from '../../../carte/fabrique-carte';
import { CaptureService, type SourceCapture } from '../etat/capture.service';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import {
  type LegendeBataille, type PoiBataille, empriseAnneaux, filtreAnneaux, pointsBataille, poisDesAnneaux, stylerAnneaux,
  stylerPartiels,
} from '../logique/bataille/anneaux';
import type { AnneauBrut } from '../logique/bataille/flux';
import { COUCHE_APLAT, COUCHE_POINTS, type RenduBataille, afficherBataille, contenuPopupBataille, poserBataille, retirerBataille } from './couche-bataille';

/** Le contenu du créneau de bataille (`battleFeatures`, `battlePois`, `battleCacheKey` de `useMapDirectActions`). */
export interface CreneauBataille {
  anneaux: GeoJSON.Feature[];
  pois: PoiBataille[];
  /** La clé de cache des isochrones ; `cg__<id>` pour une zone enregistrée ouverte par le lien. */
  cle: string | null;
  /** `battleCategory` : la catégorie de POI, `custom_geo_zone` pour une zone. */
  categorie: string;
}

/** Ce que la découpe peint (`applyIsochroneBattle(ringData, borderData, category, poisForMap)`). */
export interface Peinture {
  anneaux: GeoJSON.Feature[];
  bordures?: GeoJSON.Feature[];
  categorie: string;
  /** Les POI à pointer ; à défaut, un par POI des anneaux. */
  poisCarte?: PoiBataille[];
}

/** Le recadrage sur une bataille peinte (`useMapLayers.ts:1155`). */
const RECADRAGE = { padding: 60, maxZoom: 12, duration: 1200 } as const;
const VIDE: RenduBataille = { anneaux: [], bordures: [], points: [] };

/**
 * Le CRÉNEAU DE BATAILLE de la carte principale : ce que React répartissait entre `useMapDirectActions` (POI, clé de
 * cache), `useMapLayers` (catégorie, légende, visibilité, « Voronoï », palier maximum, anneaux partiels) et
 * `applyIsochroneBattle` (le rendu). Un seul créneau : une nouvelle bataille — ou une zone ouverte par `?customZone=`
 * (T14) — REMPLACE la précédente.
 *
 * Défauts React corrigés : une bataille V2 laissait la clé `cg__` d'une zone ouverte avant elle (le bouton « Script
 * bidding DV360 » restait, au nom d'un POI de la bataille) ; une peinture sans bordures ni points gardait ceux de la
 * bataille précédente ; « Tout effacer » laissait la catégorie, donc le bouton « Bataille » de la carte.
 *
 * Re-posé sur la carte recréée par un changement de fond (B11) ; « Tout effacer » le vide (`page.tsx:732-734`).
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class BatailleService {
  private readonly couches = inject(CouchesCarteService);
  private readonly fabriquePopup = inject(FABRIQUE_POPUP);
  private readonly document = inject(DOCUMENT);

  private readonly rendu = signal<RenduBataille>(VIDE);
  private readonly _categorie = signal('');
  private readonly _legende = signal<LegendeBataille[]>([]);
  private readonly _pois = signal<PoiBataille[]>([]);
  private readonly _cle = signal<string | null>(null);
  /** Les anneaux bruts accumulés pendant un flux, remplacés par la découpe (`partialRingsRef`). */
  private partiels: GeoJSON.Feature[] = [];

  /** `battleCategory` : non vide dès qu'une bataille a été peinte (bouton « Bataille », légende). */
  readonly categorie = this._categorie.asReadonly();
  /** Une entrée par POI, dans sa teinte (`battlePois` de `useMapLayers`) — la légende. */
  readonly legende = this._legende.asReadonly();
  /** `battlePois` de `useMapDirectActions` : les POI de la bataille (bouton DV360, capture T16). */
  readonly pois = this._pois.asReadonly();
  /** `battleCacheKey`. */
  readonly cle = this._cle.asReadonly();
  /** `battleVisible` : « Masquer » et le bouton « Bataille » le basculent. */
  readonly visible = signal(false);
  /** `battleOuterFillVisible` : le palier 0 (« Voronoï » résiduel). */
  readonly contourVisible = signal(false);
  /** `battleMaxPalier` : la réglette de la légende. */
  readonly palierMax = signal(90);

  private readonly filtre = computed(() => filtreAnneaux(this.contourVisible(), this.palierMax()));
  private readonly presente = computed(() => {
    const r = this.rendu();
    return r.anneaux.length > 0 || r.bordures.length > 0 || r.points.length > 0;
  });
  /** L'instance où les couches sont POSÉES (null tant que rien n'est peint). */
  private readonly posee = signal<maplibregl.Map | null>(null);

  constructor() {
    this.couches.inscrireEffacement('bataille', () => this.effacer());
    // La capture des couches (T16) lit la bataille par sa clé : anneaux affichés, POI, catégorie.
    inject(CaptureService).declarer(computed(() => sourceCaptureBataille(this._cle(), this._pois(), this.rendu().anneaux, this._categorie())));

    // Pose : les données, sur la carte courante ; rejouée sur chaque nouvelle instance (B11). Vide → tout retiré.
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      const rendu = this.rendu();
      if (!carte) { this.posee.set(null); return; }
      if (!this.presente()) {
        untracked(() => retirerBataille(carte));
        this.posee.set(null);
        return;
      }
      nettoyer(quandStyleCharge(carte, () => untracked(() => {
        poserBataille(carte, rendu, this.filtre());
        this.posee.set(carte);
      })));
    });

    // Visibilité et filtre : sans toucher aux données (une bascule ne rejoue pas un `setData` de milliers d'anneaux).
    effect(() => {
      const carte = this.posee();
      if (carte) afficherBataille(carte, this.visible(), this.filtre());
    });

    // Popups au clic : anneau (avec son palier) et POI.
    effect((nettoyer) => {
      const carte = this.posee();
      if (carte) nettoyer(this.ecouter(carte));
    });
  }

  /** Une zone ouverte par le lien (T14) ou une bataille V2 : peinture, POI et clé REMPLACENT le créneau. */
  appliquer(creneau: CreneauBataille): void {
    this.peindre({ anneaux: creneau.anneaux, categorie: creneau.categorie, poisCarte: creneau.pois });
    this.retenir(creneau.pois, creneau.cle);
  }

  /** `applyIsochroneBattle` : anneaux stylés, bordures, points, catégorie, légende, visible, recadrage. */
  peindre(p: Peinture): void {
    const { anneaux, legende } = stylerAnneaux(p.anneaux);
    const pois = p.poisCarte?.length ? p.poisCarte : poisDesAnneaux(p.anneaux);
    this.partiels = [];
    this.rendu.set({ anneaux, bordures: p.bordures ?? [], points: pointsBataille(pois) });
    this._categorie.set(p.categorie);
    this._legende.set(legende);
    this.visible.set(true);
    // Synchrone, sur la carte COURANTE : un recadrage demandé ensuite (lien `customZone`) passe après, comme React.
    const emprise = empriseAnneaux(anneaux);
    if (emprise) this.couches.carteCourante()?.fitBounds(emprise, RECADRAGE);
  }

  /** Les POI et la clé du créneau (`setBattlePois`, `setBattleCacheKey`), sans toucher au rendu. */
  retenir(pois: PoiBataille[], cle: string | null): void {
    this._pois.set(pois);
    this._cle.set(cle);
  }

  /** Une bataille démarre : plus d'anneaux bruts (`clearBattlePartialRings`) — bordures et points restent, comme React. */
  viderPartiels(): void {
    this.partiels = [];
    this.rendu.update((r) => ({ ...r, anneaux: [] }));
  }

  /** Des anneaux bruts arrivent : affichés tout de suite, avant la découpe (`addBattlePartialRings`). */
  ajouterPartiels(bruts: readonly AnneauBrut[]): void {
    this.partiels = stylerPartiels(this.partiels, bruts);
    this.rendu.update((r) => ({ ...r, anneaux: this.partiels }));
    this.visible.set(true);
  }

  /** Vide le créneau : plus d'anneaux, de POI, de clé, de catégorie. */
  effacer(): void {
    this.partiels = [];
    this.rendu.set(VIDE);
    this._categorie.set('');
    this._legende.set([]);
    this._pois.set([]);
    this._cle.set(null);
    this.visible.set(false);
  }

  private ecouter(carte: maplibregl.Map): () => void {
    const doc = carte.getContainer().ownerDocument ?? this.document;
    const ouvrir = (anneau: boolean) => (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
      if (!p) return;
      this.fabriquePopup({ closeButton: true, maxWidth: anneau ? '250px' : '260px' })
        .setLngLat(e.lngLat).setDOMContent(contenuPopupBataille(p, doc, anneau)).addTo(carte);
    };
    const surAnneau = ouvrir(true);
    const surPoi = ouvrir(false);
    carte.on('click', COUCHE_APLAT, surAnneau);
    carte.on('click', COUCHE_POINTS, surPoi);
    return () => {
      carte.off('click', COUCHE_APLAT, surAnneau);
      carte.off('click', COUCHE_POINTS, surPoi);
    };
  }
}

/**
 * La source contributive de la capture (`CaptureLayers.tsx:107-158`, T16) : la bataille du créneau, par sa clé de
 * cache — sans clé, rien à capturer. La métadonnée porte les POI et les anneaux affichés : la capture en tire une
 * sous-zone par POI (`enrichissementBataille`). Le mode de déplacement se lit dans la clé (`battle_full__<cat>__<mode>__…`).
 */
function sourceCaptureBataille(
  cle: string | null, poisBataille: readonly PoiBataille[], anneaux: readonly GeoJSON.Feature[], categorie: string,
): SourceCapture | null {
  if (!cle) return null;
  const pois = poisBataille.map((p) => ({ poi_id: p.id, poi_name: p.nom, lat: p.lat, lng: p.lng }));
  const morceaux = cle.split('__');
  return {
    id: 'map-battle-isochrone', sourceType: 'isochrone_battle',
    label: pois.length > 1 ? `Battle isochrones (${pois.length} POI)` : 'Battle isochrones',
    metadata: {
      cache_key: cle, poi_count: pois.length, pois, battle_features: anneaux, category: categorie,
      mode: morceaux.length >= 3 ? morceaux[2] : null,
    },
    obtenir: { route: 'battle', corps: () => ({ cache_keys: [cle] }) },
  };
}
