import { DOCUMENT, DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import type { Subscription } from 'rxjs';
import { FABRIQUE_POPUP } from '../../../carte/fabrique-carte';
import { messageErreurApi } from '../../../core/http/erreurs';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { ClusteringApi } from '../data/clustering.api';
import { CaptureService, type SourceCapture } from '../etat/capture.service';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { type Emprise, messageAucunModele, poiDepuisClic } from '../logique/clustering/panneau';
import type { ClustersGeoJSON, PoiCluster, ResumeModele } from '../logique/clustering/types';
import { COLLECTION_VIDE, COUCHE_CLUSTERS, SOURCE_CLUSTERS, contenuPopupCluster, poserCoucheClusters } from './couche-clusters';

export { COUCHE_CLUSTERS, SOURCE_CLUSTERS } from './couche-clusters';

/** La durée d'exposition au premier chargement (`useState(60)`, `page.tsx:249`). */
export const DUREE_INITIALE = 60;

/**
 * Le clustering POI × Filosofi sur la carte principale — l'état que `page.tsx:245-470` tenait (`clusterGeoJSON`,
 * `clustersVisible`, `clusterLoading`, `clusterDuration`), la couche de `useMapInit.ts:762-830`, et la liste des
 * modèles de `ClusteringSection.tsx`. Fourni par la PAGE : fermer le panneau Analyse laisse les clusters sur la carte.
 *
 * ── TROIS SYNCHRONISATIONS SÉPARÉES (`page.tsx:367-398`) ───────────────────
 * Pose de la couche, DONNÉES (`setData`) et VISIBILITÉ (`setLayoutProperty`) sont trois effets distincts : une bascule
 * de visibilité ne rejoue jamais un `setData` de milliers de points, et un changement de thème ne fait que repeindre
 * le cerne. Sur une carte recréée par un changement de fond (B11), la couche se re-pose avec les données en mémoire,
 * sans requête.
 *
 * ── LE CLIC SUR UN POINT ─────────────────────────────────────────────────
 * React émettait un `CustomEvent` sur `window` (`genesis:cluster-select`) que `ClusterPanel` écoutait. `window` est
 * celui du shell AIDA : ici le panneau s'INSCRIT auprès du service (`ecouterSelection`) et se désinscrit à sa
 * destruction — comme l'écoute React, panneau fermé, un clic n'atteint personne.
 *
 * Défauts React corrigés : une durée sans modèle (404) ne disait rien — message nommant les durées calculées ; une
 * durée sans modèle laissait le sélecteur sur la durée DEMANDÉE alors que la carte montrait toujours l'ancien modèle —
 * il revient sur celle du modèle affiché ; deux requêtes rapprochées pouvaient se croiser — la précédente est annulée ;
 * « Tout effacer » vidait la source mais gardait les données et l'état « visible » dans le panneau — tout est remis à
 * zéro.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class ClustersService {
  private readonly api = inject(ClusteringApi);
  private readonly couches = inject(CouchesCarteService);
  private readonly fabriquePopup = inject(FABRIQUE_POPUP);
  private readonly document = inject(DOCUMENT);
  private readonly palette = inject(CouleursService).palette({ contour: 'poi-contour' });

  private readonly _donnees = signal<ClustersGeoJSON | null>(null);
  private readonly _visible = signal(false);
  private readonly _chargement = signal(false);
  private readonly _duree = signal(DUREE_INITIALE);
  private readonly _erreur = signal<string | null>(null);
  private readonly _modeles = signal<ResumeModele[]>([]);
  private readonly _chargementModeles = signal(false);
  private readonly _erreurModeles = signal<string | null>(null);

  /** `clusterGeoJSON` : le dernier modèle chargé, ses POI en points. */
  readonly donnees = this._donnees.asReadonly();
  /** `clustersVisible`. */
  readonly visible = this._visible.asReadonly();
  /** `clusterLoading`. */
  readonly chargement = this._chargement.asReadonly();
  /** `clusterDuration` : 30, 45 ou 60 min. */
  readonly duree = this._duree.asReadonly();
  /** Pourquoi rien ne s'affiche (aucun modèle à cette durée, refus, panne) ; `null` sinon. */
  readonly erreur = this._erreur.asReadonly();
  /** Les modèles calculés (`GET /api/poi-clusters/models`). */
  readonly modeles = this._modeles.asReadonly();
  readonly chargementModeles = this._chargementModeles.asReadonly();
  readonly erreurModeles = this._erreurModeles.asReadonly();

  private readonly ecouteurs = new Set<(p: PoiCluster) => void>();
  private lecture: Subscription | null = null;
  /** L'instance où la couche est POSÉE (null tant qu'aucune donnée n'est arrivée). */
  private readonly posee = signal<maplibregl.Map | null>(null);

  constructor() {
    this.couches.inscrireEffacement('clusters', () => this.effacer());
    inject(CaptureService).declarer(computed(() => sourceCaptureClusters(this._donnees(), this._visible())));
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());

    // 1. Pose : à la première donnée, sur la carte courante ; rejouée sur chaque nouvelle instance (B11).
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (!carte) { this.posee.set(null); return; }
      if (!this._donnees() || untracked(this.posee) === carte) return;
      nettoyer(quandStyleCharge(carte, () => untracked(() => {
        poserCoucheClusters(carte, this.palette().contour);
        this.posee.set(carte);
      })));
    });

    // 2. Données : `setData` quand elles changent — et seulement alors (`page.tsx:387-392`).
    effect(() => {
      const carte = this.posee();
      const donnees = this._donnees();
      if (carte) (carte.getSource(SOURCE_CLUSTERS) as maplibregl.GeoJSONSource | undefined)?.setData((donnees ?? COLLECTION_VIDE) as GeoJSON.FeatureCollection);
    });

    // 3. Visibilité (`page.tsx:394-398`) : aucun `setData`.
    effect(() => {
      const carte = this.posee();
      if (carte?.getLayer(COUCHE_CLUSTERS)) carte.setLayoutProperty(COUCHE_CLUSTERS, 'visibility', this._visible() ? 'visible' : 'none');
    });

    // Thème : le cerne seulement — la palette n'est lue qu'une fois la couche posée (aucun jeton lu pour rien).
    effect(() => {
      const carte = this.posee();
      if (carte?.getLayer(COUCHE_CLUSTERS)) carte.setPaintProperty(COUCHE_CLUSTERS, 'circle-stroke-color', this.palette().contour);
    });

    // Clic, survol : une écoute par instance où la couche est posée.
    effect((nettoyer) => {
      const carte = this.posee();
      if (carte) nettoyer(this.ecouter(carte));
    });
  }

  /**
   * « Charger les clusters » (`handleToggleClusters`, `page.tsx:438-452`) : la première fois, lit le modèle de la durée
   * courante et l'affiche ; ensuite, bascule. ⚠ N'appeler qu'APRÈS la garde de périmètre du panneau Analyse.
   */
  charger(): void {
    if (this._visible() || this._donnees()) {
      this._visible.update((v) => !v);
      return;
    }
    this.lire(this._duree());
  }

  /** « Visible » / « Masqué » : la couche seule, sans relire (les données sont là quand le bouton existe). */
  basculerVisibilite(): void {
    this._visible.update((v) => !v);
  }

  /** Une autre durée : d'autres clusters, donc une nouvelle lecture (`handleClusterDurationChange`). */
  changerDuree(duree: number): void {
    this._duree.set(duree);
    this.lire(duree);
  }

  /** La liste des modèles, relue à chaque ouverture de la section (`ClusteringSection.tsx:85-93`). */
  chargerModeles(): void {
    this._chargementModeles.set(true);
    this._erreurModeles.set(null);
    this.api.modeles().subscribe({
      next: (m) => this._modeles.set(m),
      error: (e: unknown) => {
        this._erreurModeles.set(messageErreurApi(e));
        this._chargementModeles.set(false);
      },
      complete: () => this._chargementModeles.set(false),
    });
  }

  /** S'inscrire aux clics sur un point ; rend de quoi se désinscrire. */
  ecouterSelection(rappel: (p: PoiCluster) => void): () => void {
    this.ecouteurs.add(rappel);
    return () => this.ecouteurs.delete(rappel);
  }

  /** Une ligne de la table : la carte vole jusqu'au POI (`handleFlyTo`, `page.tsx:482-484`). */
  voler(lat: number, lng: number, zoom = 12): void {
    this.couches.carteCourante()?.flyTo({ center: [lng, lat], zoom, duration: 1000 });
  }

  /**
   * Un point des clusters est-il sous ce clic ? — la réservation étroite des clics du panneau (`EtatCarteService
   * .reserverClics`) : seul un clic sur un point lui appartient. Couche absente ou masquée : jamais.
   */
  pointSous(e: MouseEvent): boolean {
    const carte = this.posee();
    if (!carte || !this._visible() || !carte.getLayer(COUCHE_CLUSTERS)) return false;
    const cadre = carte.getCanvas().getBoundingClientRect();
    return carte.queryRenderedFeatures([e.clientX - cadre.left, e.clientY - cadre.top], { layers: [COUCHE_CLUSTERS] }).length > 0;
  }

  /** Un cluster de la légende : la carte cadre ses POI (`handleFitBounds`, `page.tsx:401-408`). */
  cadrer(e: Emprise): void {
    this.couches.carteCourante()?.fitBounds(e, { padding: 60, duration: 1000 });
  }

  private lire(duree: number): void {
    this.lecture?.unsubscribe();
    this._chargement.set(true);
    this._erreur.set(null);
    this.lecture = this.api.clusters(duree).subscribe({
      next: (d) => {
        this._donnees.set(d);
        this._visible.set(true);
        this._chargement.set(false);
      },
      error: (e: unknown) => {
        this._chargement.set(false);
        const actuelle = this._donnees()?.metadata.duration_minutes;
        if (actuelle !== undefined) this._duree.set(actuelle);
        const introuvable = (e as { status?: number }).status === 404;
        this._erreur.set(introuvable ? messageAucunModele(duree, this._modeles().map((m) => m.duration_minutes)) : messageErreurApi(e));
      },
    });
  }

  private effacer(): void {
    this.lecture?.unsubscribe();
    this._donnees.set(null);
    this._visible.set(false);
    this._chargement.set(false);
    this._erreur.set(null);
  }

  private ecouter(carte: maplibregl.Map): () => void {
    const doc = carte.getContainer().ownerDocument ?? this.document;
    const surClic = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
      if (!p) return;
      const poi = poiDepuisClic(p, e.lngLat);
      for (const rappel of [...this.ecouteurs]) rappel(poi);
      this.fabriquePopup({ closeButton: true, maxWidth: '220px' }).setLngLat(e.lngLat).setDOMContent(contenuPopupCluster(p, doc)).addTo(carte);
    };
    const survol = () => { carte.getCanvas().style.cursor = 'pointer'; };
    const sortie = () => { carte.getCanvas().style.cursor = ''; };
    carte.on('click', COUCHE_CLUSTERS, surClic);
    carte.on('mousemove', COUCHE_CLUSTERS, survol);
    carte.on('mouseleave', COUCHE_CLUSTERS, sortie);
    return () => {
      carte.off('click', COUCHE_CLUSTERS, surClic);
      carte.off('mousemove', COUCHE_CLUSTERS, survol);
      carte.off('mouseleave', COUCHE_CLUSTERS, sortie);
    };
  }
}

/**
 * La source contributive de la capture (`CaptureLayers.tsx:290-312`) : les points déjà chargés côté client, rendus
 * TELS QUELS (les renvoyer au serveur serait un aller-retour pour rien) — seulement couche visible et non vide.
 */
function sourceCaptureClusters(donnees: ClustersGeoJSON | null, visible: boolean): SourceCapture | null {
  if (!visible || !donnees || donnees.features.length === 0) return null;
  return {
    id: 'map-poi-clusters', sourceType: 'poi_clusters',
    label: `Clusters POI (${donnees.features.length} groupes)`,
    metadata: { cluster_count: donnees.features.length },
    obtenir: { locale: () => donnees.features.map((f) => f.geometry as GeoJSON.Geometry) },
  };
}
