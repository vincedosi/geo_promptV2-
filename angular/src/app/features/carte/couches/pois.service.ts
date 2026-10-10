import { HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT, DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { TimeoutError, finalize, type Observable, type Subscription } from 'rxjs';
import { FABRIQUE_MARQUEUR, FABRIQUE_POPUP, type MarqueurCarte, type PopupCarte } from '../../../carte/fabrique-carte';
import { messageErreurApi } from '../../../core/http/erreurs';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { cercleGeoJSON } from '../../risques/logique/cercle';
import { CarteApi, type CorpsPois, type SelectedBillboard, type ZoneData } from '../data/carte.api';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { bboxPourRequete } from '../logique/bbox-requete';
import type { POIStyle, POIStylesMap } from '../logique/constantes-calques';
import {
  CATEGORIES_PANNEAU, COUCHE_POIS_CERCLES, COUCHE_POIS_DENSITE, COUCHE_ZONE_CONTOUR, COUCHE_ZONE_FOND, JETONS_POIS,
  SOURCE_POIS, SOURCE_ZONE, TAILLE_EPINGLE_PX, cadrageDe, contenuPopupCercle, contenuPopupMarqueur, couleurNappe,
  couleurPoi, dessinerRayons, elementMarqueur, elementVille, entitesPois, modeRendu, montrerPois, panneauDePoi,
  panneauDeProprietes, peindrePois, poserCouchesPois,
} from './couche-pois';

/** La clé de `page.tsx:323,979` : le mode densité survit à un rechargement. */
export const CLE_MODE_DENSITE = 'genesis_density_mode';
/** Le style d'une épingle jamais réglée (`use-poi-styles.ts:16`). */
export const STYLE_EPINGLE_DEFAUT: POIStyle = { size: 'Standard', color: '#a0a0a0' };

/** Paramètres d'une recherche de POI : le corps de `/api/map/pois` sans la bbox, qu'ajoute le service. */
export type ParametresPois = Omit<CorpsPois, 'bbox'>;

/**
 * Le message d'un échec de requête de points, dans les mots de React (`useMapDirectActions.ts:75-86,102-116`) : le
 * `error` du corps s'il y en a un, sinon `Erreur <statut>` ; le délai dépassé a sa propre phrase.
 */
export function messagePoints(e: unknown, delai: string): string {
  if (e instanceof TimeoutError) return delai;
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0) return messageErreurApi(e);
    const corps = e.error as { error?: unknown } | null;
    if (corps && typeof corps.error === 'string' && corps.error) return corps.error;
    return `Erreur ${e.status}`;
  }
  return 'Erreur réseau';
}

/**
 * Les POI affichés sur la carte principale — l'état que `app/map/page.tsx` tenait (`zoneData`, `densityMode`,
 * `poiStyles`, `selectedBillboard`) et son rendu (`useMapMarkers.ts`, `useMapInit.ts:42-360`).
 *
 * ── UNE ZONE PARTAGÉE ────────────────────────────────────────────────────
 * Comme React, POI, panneaux OOH et arrêts de transport écrivent la MÊME zone (`definirZone`) : en afficher un remplace
 * l'autre. `OohService` et `TransportService` ne font que leur requête.
 *
 * ── CONTRAT DU REGISTRE (B11) ────────────────────────────────────────────
 * Les sources et couches (`couche-pois.ts`) sont posées à la PREMIÈRE zone, sur l'instance COURANTE, et re-posées sur
 * la carte recréée par un changement de fond, avec leurs marqueurs, leur canevas des rayons et leurs écoutes de clic.
 * Chaque couche s'insère à sa place dans l'ordre de React (`logique/ordre-couches.ts`) : la nappe et les cercles restent
 * SOUS les choroplèthes, quel que soit l'ordre des gestes.
 *
 * ── MARQUEURS DOM ────────────────────────────────────────────────────────
 * Créés par `document.createElement` du DOCUMENT DE LA CARTE (`FABRIQUE_MARQUEUR`), jamais un composant Angular
 * dynamique ; TOUS retirés à chaque nouveau rendu, à « Tout effacer » et quand la carte disparaît.
 *
 * Écarts à React, tous des défauts corrigés et listés au rapport T8 :
 * - changer une épingle ou le mode densité ne RE-CADRE plus la carte : seule une nouvelle zone (ou une carte recréée)
 *   la cadre — React rejouait `fitBounds` à chaque changement de couleur ;
 * - les épingles vivent ICI et non dans le panneau : React les remettait à zéro à chaque réouverture du panneau
 *   (`usePoiStyles` local, recopié vers la page par un effet), et les marqueurs perdaient leur couleur ;
 * - une zone vidée (nouvelle requête, échec, « Tout effacer ») retire ses marqueurs : React les laissait à l'écran
 *   pendant le chargement d'une autre zone, et après un échec, alors que la légende les disait partis.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class PoisService {
  private readonly etat = inject(EtatCarteService);
  private readonly couches = inject(CouchesCarteService);
  private readonly api = inject(CarteApi);
  private readonly fabriqueMarqueur = inject(FABRIQUE_MARQUEUR);
  private readonly fabriquePopup = inject(FABRIQUE_POPUP);
  private readonly document = inject(DOCUMENT);
  private readonly couleurs = inject(CouleursService).palette(JETONS_POIS);

  private readonly zoneCourante = signal<ZoneData | null>(null);
  /** Les points affichés — POI, panneaux OOH ou arrêts de transport (`zoneData` de React). */
  readonly zone = this.zoneCourante.asReadonly();
  /** Nappe de densité forcée, relue de `localStorage['genesis_density_mode']`. */
  readonly modeDensite = signal(this.lireDensite());
  /** Taille et couleur d'épingle, par catégorie (`usePoiStyles`). */
  readonly styles = signal<POIStylesMap>({});
  /** Le panneau cliqué, ouvert dans le tiroir Street View. */
  readonly panneauSelectionne = signal<SelectedBillboard | null>(null);
  /** Une recherche de POI en cours (bouton « CHARGEMENT... »). */
  readonly chargement = signal(false);
  /** L'échec de la dernière recherche de POI, dit dans la section (React l'écrivait dans le panneau de l'Assistant). */
  readonly erreur = signal<string | null>(null);

  /** L'instance où les couches sont POSÉES (null avant la première zone, et dès que la carte disparaît). */
  private readonly posee = signal<maplibregl.Map | null>(null);
  private marqueurs: MarqueurCarte[] = [];
  private canevas: HTMLCanvasElement | null = null;
  /** La popup du dernier cercle cliqué, fermée par « Tout effacer » (revue 1). */
  private popupCercle: PopupCarte | null = null;
  private lecture: Subscription | null = null;

  constructor() {
    this.couches.inscrireEffacement('pois', () => this.effacer());
    inject(DestroyRef).onDestroy(() => {
      this.lecture?.unsubscribe();
      this.retirerMarqueurs();
    });

    // Pose : sur la carte courante, dès qu'une zone existe ; rejouée sur chaque nouvelle instance (B11).
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (!carte) {
        this.retirerMarqueurs();
        this.posee.set(null);
        return;
      }
      if (!this.zone() || untracked(this.posee) === carte) return;
      nettoyer(quandStyleCharge(carte, () => {
        untracked(() => { const c = this.couleurs(); poserCouchesPois(carte, { contour: c['contour'], teal: c['teal'] }); });
        this.posee.set(carte);
      }));
    });

    // Écoutes de la carte posée : clic et curseur sur les cercles, canevas des rayons.
    effect((nettoyer) => {
      const carte = this.posee();
      if (!carte) return;
      nettoyer(this.ecouter(carte));
    });

    // Rendu : données, rendu selon le volume, couleur de la nappe, cercle de zone, marqueurs.
    effect(() => {
      const carte = this.posee();
      if (!carte) return;
      const zone = this.zone();
      const densite = this.modeDensite();
      const styles = this.styles();
      const palette = this.couleurs();
      untracked(() => this.rendre(carte, zone, densite, styles, palette));
    });

    // Couleurs d'interface (cerne, teal) : repeintes au changement de thème, sans recréer la source.
    effect(() => {
      // La carte AVANT la palette : un jeton n'est lu (donc résolu) que si la couche existe.
      const carte = this.posee();
      if (!carte) return;
      const c = this.couleurs();
      peindrePois(carte, COUCHE_POIS_CERCLES, 'circle-stroke-color', c['contour']);
      peindrePois(carte, COUCHE_ZONE_FOND, 'fill-color', c['teal']);
      peindrePois(carte, COUCHE_ZONE_CONTOUR, 'line-color', c['teal']);
    });

    // Cadrage : à chaque NOUVELLE zone, ou sur une carte recréée — jamais sur un changement d'épingle (défaut corrigé).
    effect(() => {
      const carte = this.posee();
      const zone = this.zone();
      if (!carte || !zone?.coordonnees) return;
      const c = cadrageDe(zone, modeRendu(zone.pois.length, untracked(this.modeDensite)));
      if (c.type === 'emprise') carte.fitBounds(c.cadre, { padding: 40, maxZoom: c.maxZoom, duration: 1200 });
      else carte.flyTo({ center: c.centre, zoom: c.zoom, duration: 1200 });
    });

    // Le mode densité survit à un rechargement (`page.tsx:979`).
    effect(() => {
      const v = this.modeDensite();
      try { this.document.defaultView?.localStorage.setItem(CLE_MODE_DENSITE, String(v)); } catch { /* stockage bloqué */ }
    });
  }

  /** Le style d'une épingle, ou le défaut. */
  styleDe(categorie: string): POIStyle {
    return this.styles()[categorie] ?? STYLE_EPINGLE_DEFAUT;
  }

  /** Règle la taille ou la couleur de l'épingle d'une catégorie. */
  reglerStyle(categorie: string, patch: Partial<POIStyle>): void {
    this.styles.update((s) => ({ ...s, [categorie]: { ...(s[categorie] ?? STYLE_EPINGLE_DEFAUT), ...patch } }));
  }

  /** Oublie l'épingle d'une catégorie retirée (`PoiSection.tsx:123`). */
  oublierStyle(categorie: string): void {
    this.styles.update((s) => {
      const n = { ...s };
      delete n[categorie];
      return n;
    });
  }

  /** La zone affichée ; `null` la vide. Écrite aussi par `OohService` et `TransportService`. */
  definirZone(zone: ZoneData | null): void {
    this.zoneCourante.set(zone);
  }

  /**
   * « AFFICHER LES POI SUR LA CARTE » (`useMapDirectActions.ts:91-118`) : la bbox ne part QUE si un filtre géographique
   * est actif (`bboxPourRequete`), jamais la métropole par défaut.
   */
  chercher(params: ParametresPois): void {
    const bbox = bboxPourRequete(this.etat.filtre());
    this.lancer(this.api.pois({ ...params, ...(bbox ? { bbox } : {}) }), this.chargement, this.erreur,
      'Base de données lente — réessayez dans quelques instants',
      (data) => (data.pois?.length ? null : `Aucun POI trouvé pour "${params.poi_types.join(', ')}"`));
  }

  /**
   * Une requête qui REMPLACE la zone (`setZoneData(null)` puis la réponse) : POI et panneaux OOH. Le corps d'une
   * réponse 200 peut porter `error` ; `vide` dit pourquoi une réponse sans point n'est pas affichée.
   */
  lancer(
    requete: Observable<ZoneData>, chargement: { set(v: boolean): void }, erreur: { set(v: string | null): void },
    delai: string, vide: (data: ZoneData) => string | null = () => null,
  ): Subscription {
    this.lecture?.unsubscribe();
    erreur.set(null);
    this.definirZone(null);
    chargement.set(true);
    // `finalize` : la requête ANNULÉE par une autre (POI ↔ OOH partagent cette lecture) ou par « Tout effacer » rend son
    // propre bouton — sans lui, son `chargement` restait vrai jusqu'au rechargement (revue 1).
    this.lecture = requete.pipe(finalize(() => chargement.set(false))).subscribe({
      next: (data) => {
        chargement.set(false);
        const err = (data as ZoneData & { error?: string }).error;
        const raison = err ?? vide(data);
        if (raison) erreur.set(raison);
        else this.definirZone(data);
      },
      error: (e: unknown) => {
        chargement.set(false);
        erreur.set(messagePoints(e, delai));
      },
    });
    return this.lecture;
  }

  /** « Tout effacer » (`page.tsx:684-686,731,751`) : zone et tiroir vidés, marqueurs retirés. */
  private effacer(): void {
    this.lecture?.unsubscribe();
    this.chargement.set(false);
    this.erreur.set(null);
    this.definirZone(null);
    this.panneauSelectionne.set(null);
    this.retirerMarqueurs();
    this.popupCercle?.remove();
    this.popupCercle = null;
  }

  private retirerMarqueurs(): void {
    for (const m of this.marqueurs) m.remove();
    this.marqueurs = [];
  }

  private rendre(
    carte: maplibregl.Map, zone: ZoneData | null, densite: boolean, styles: POIStylesMap, palette: Record<string, string>,
  ): void {
    this.retirerMarqueurs();
    const source = carte.getSource(SOURCE_POIS) as maplibregl.GeoJSONSource | undefined;
    const zoneSource = carte.getSource(SOURCE_ZONE) as maplibregl.GeoJSONSource | undefined;
    this.redessinerRayons(carte);
    if (!zone) {
      source?.setData({ type: 'FeatureCollection', features: [] });
      zoneSource?.setData({ type: 'FeatureCollection', features: [] });
      montrerPois(carte, COUCHE_POIS_DENSITE, false);
      montrerPois(carte, COUCHE_POIS_CERCLES, false);
      return;
    }
    const mode = modeRendu(zone.pois.length, densite);
    source?.setData(entitesPois(zone, styles, palette));
    montrerPois(carte, COUCHE_POIS_DENSITE, mode === 'densite');
    montrerPois(carte, COUCHE_POIS_CERCLES, mode !== 'marqueurs');
    if (mode === 'densite') {
      const couleur = couleurNappe(zone, styles, palette);
      if (couleur) peindrePois(carte, COUCHE_POIS_DENSITE, 'heatmap-color', couleur);
    }
    const { lat, lng } = zone.coordonnees;
    zoneSource?.setData({
      type: 'FeatureCollection', features: zone.rayon_metres ? [cercleGeoJSON(lng, lat, zone.rayon_metres)] : [],
    });
    carte.triggerRepaint();

    const doc = carte.getContainer().ownerDocument ?? this.document;
    if (mode === 'marqueurs') {
      for (const p of zone.pois) {
        const brute = couleurPoi(p, styles, zone);
        const taille = TAILLE_EPINGLE_PX[styles[p.categorie]?.size ?? 'Standard'] ?? 12;
        const el = elementMarqueur(doc, brute, taille, p.rank);
        const popup = this.fabriquePopup({ offset: 12, closeButton: false }).setDOMContent(contenuPopupMarqueur(p, brute, doc));
        const m = this.fabriqueMarqueur({ element: el, anchor: 'center' }).setLngLat([p.lng, p.lat]).setPopup(popup).addTo(carte);
        this.marqueurs.push(m);
        if (CATEGORIES_PANNEAU.has(p.categorie)) {
          el.addEventListener('click', () => this.panneauSelectionne.set(panneauDePoi(p)));
        }
      }
    }
    this.marqueurs.push(
      this.fabriqueMarqueur({ element: elementVille(doc), anchor: 'center' }).setLngLat([lng, lat]).addTo(carte),
    );
  }

  /** Clic et curseur sur les cercles GPU (`useMapInit.ts:295-360`), canevas des rayons (`:149-153,182-186`). */
  private ecouter(carte: maplibregl.Map): () => void {
    const clic = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const props = e.features?.[0]?.properties as Record<string, unknown> | undefined;
      if (!props) return;
      if (CATEGORIES_PANNEAU.has(String(props['categorie'] ?? '').toLowerCase())) {
        const panneau = panneauDeProprietes(props, e.lngLat);
        if (panneau) this.panneauSelectionne.set(panneau);
        return;
      }
      const doc = carte.getContainer().ownerDocument ?? this.document;
      this.popupCercle = this.fabriquePopup({ closeButton: true, maxWidth: '260px' })
        .setLngLat(e.lngLat).setDOMContent(contenuPopupCercle(props, doc)).addTo(carte);
    };
    const survol = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const cat = String(e.features?.[0]?.properties?.['categorie'] ?? '').toLowerCase();
      carte.getCanvas().style.cursor = CATEGORIES_PANNEAU.has(cat) ? 'pointer' : '';
    };
    const sortie = () => { carte.getCanvas().style.cursor = ''; };

    const conteneur = carte.getContainer();
    const canevas = (conteneur.ownerDocument ?? this.document).createElement('canvas');
    canevas.setAttribute('data-rayons-poi', '');
    canevas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1';
    conteneur.appendChild(canevas);
    this.canevas = canevas;
    const dessiner = () => this.redessinerRayons(carte);

    carte.on('click', COUCHE_POIS_CERCLES, clic);
    carte.on('mousemove', COUCHE_POIS_CERCLES, survol);
    carte.on('mouseleave', COUCHE_POIS_CERCLES, sortie);
    carte.on('moveend', dessiner);
    carte.on('zoomend', dessiner);
    carte.once('idle', dessiner);
    return () => {
      carte.off('click', COUCHE_POIS_CERCLES, clic);
      carte.off('mousemove', COUCHE_POIS_CERCLES, survol);
      carte.off('mouseleave', COUCHE_POIS_CERCLES, sortie);
      carte.off('moveend', dessiner);
      carte.off('zoomend', dessiner);
      carte.off('idle', dessiner);
      canevas.remove();
      if (this.canevas === canevas) this.canevas = null;
    };
  }

  private redessinerRayons(carte: maplibregl.Map): void {
    if (this.canevas) dessinerRayons(carte, this.zone(), this.canevas, carte.getContainer());
  }

  private lireDensite(): boolean {
    try {
      return this.document.defaultView?.localStorage.getItem(CLE_MODE_DENSITE) === 'true';
    } catch {
      return false;
    }
  }
}

