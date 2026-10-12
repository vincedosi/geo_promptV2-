/**
 * L'état du panneau de résultats du clustering (lot 4, T19) : onglet, comparaison, historique, durées, filtre —
 * partagé par le panneau et ses sous-composants.
 */
import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { Subscription } from 'rxjs';
import { messageErreurApi } from '../../../../../core/http/erreurs';
import { ClustersService } from '../../../couches/clusters.service';
import { ClusteringApi } from '../../../data/clustering.api';
import { EtatCarteService } from '../../../etat/etat-carte.service';
import { PileEchapService } from '../../../etat/pile-echap.service';
import { clustersTries, emprise, lignesPoi, profilsParDuree } from '../../../logique/clustering/panneau';
import type { EntreeHistorique, PoiCluster } from '../../../logique/clustering/types';

export type OngletClusters = 'legend' | 'table' | 'compare';
export type ModeComparaison = 'idle' | 'selecting' | 'comparing';

/** L'identifiant du mode comparaison dans la pile Échap (`PILE_ID_COMPARE`, `ClusterPanel.tsx:9`). */
export const PILE_COMPARAISON = 'cluster-compare';
/** L'identifiant sous lequel le panneau RÉSERVE les clics sur les points (`EtatCarteService.reserverClics`). */
const RESERVATION = 'clusters';

/**
 * L'état du panneau de clusters — les `useState` de `ClusterPanel.tsx:223-235` et leurs fonctions (comparaison,
 * historique, durées, filtre), partagés par le panneau et ses sous-composants (fiche, comparaisons). Fourni PAR LE
 * COMPOSANT `mg-panneau-clusters` : il naît et meurt avec lui, comme l'état React du panneau.
 *
 * Le clic sur un point de la carte arrive par `ClustersService.ecouterSelection` (React : `genesis:cluster-select` sur
 * `window`) : en mode sélection, c'est le POI B de la comparaison ; sinon, le POI sélectionné.
 *
 * Défaut React corrigé : un clic sur la carte ferme le panneau d'outils (clic « hors » du panneau) — le clic sur un
 * point, qui devait ouvrir sa fiche ou désigner le POI B, démontait le panneau et son état : fiche, historique,
 * durées et comparaison étaient injoignables. Clusters chargés, le panneau RÉSERVE les seuls clics sur un point des
 * clusters (`reserverClics`) — tout autre clic sur la carte le ferme comme avant (revue 1 : la première version prenait
 * la carte entière) ; il les libère à sa destruction ou quand les clusters sont effacés.
 */
@Injectable()
export class EtatPanneauClustersService {
  private readonly clusters = inject(ClustersService);
  private readonly api = inject(ClusteringApi);
  private readonly pile = inject(PileEchapService);
  private readonly etatCarte = inject(EtatCarteService);

  readonly onglet = signal<OngletClusters>('legend');
  readonly selection = signal<PoiCluster | null>(null);
  readonly modeComparaison = signal<ModeComparaison>('idle');
  readonly comparaisonA = signal<PoiCluster | null>(null);
  readonly comparaisonB = signal<PoiCluster | null>(null);
  readonly filtreCluster = signal<number | null>(null);

  readonly historique = signal<EntreeHistorique[]>([]);
  /** Le POI dont l'historique a été demandé ; affiché si `historiqueVisible`. */
  readonly historiquePoi = signal<string | null>(null);
  readonly historiqueVisible = signal(false);
  /** Pourquoi l'historique n'a pas pu être lu (React avalait l'erreur : le bouton restait sans effet). */
  readonly historiqueErreur = signal<string | null>(null);

  /** Le POI dont on compare les durées ; `null` = vue fermée. */
  readonly dureesPoi = signal<string | null>(null);
  readonly dureesChargement = signal(false);
  readonly dureesDonnees = signal<Record<number, Record<string, number>> | null>(null);
  /** Pourquoi les profils n'ont pas pu être lus — distinct de « aucune donnée multi-durée » (React les confondait). */
  readonly dureesErreur = signal<string | null>(null);

  /** Les six premières variables du modèle (`featKeys`). */
  readonly cles = computed(() => (this.clusters.donnees()?.metadata.feature_names ?? []).slice(0, 6));
  readonly resume = computed(() => this.clusters.donnees()?.metadata.cluster_summary ?? {});
  readonly clustersTries = computed(() => clustersTries(this.resume()));
  readonly lignes = computed(() => lignesPoi(this.clusters.donnees(), this.filtreCluster()));

  private lectureDurees: Subscription | null = null;
  private lectureHistorique: Subscription | null = null;

  constructor() {
    const desinscrire = this.clusters.ecouterSelection((p) => this.surClicCarte(p));
    const destruction = inject(DestroyRef);
    destruction.onDestroy(() => {
      desinscrire();
      this.lectureDurees?.unsubscribe();
      this.lectureHistorique?.unsubscribe();
    });

    // Échap ferme la comparaison avant le panneau qui la contient (`ClusterPanel.tsx:256-260`).
    effect((nettoyer) => {
      if (this.modeComparaison() === 'idle') return;
      untracked(() => this.pile.empiler(PILE_COMPARAISON, () => this.quitterComparaison()));
      nettoyer(() => this.pile.depiler(PILE_COMPARAISON));
    });
    destruction.onDestroy(() => this.pile.depiler(PILE_COMPARAISON));

    // Clusters chargés : un clic sur un POINT appartient au panneau (fiche, POI B), il ne le ferme pas.
    effect(() => {
      if (this.clusters.donnees()) untracked(() => this.etatCarte.reserverClics(RESERVATION, (e) => this.clusters.pointSous(e)));
      else untracked(() => this.etatCarte.libererClics(RESERVATION));
    });
    destruction.onDestroy(() => this.etatCarte.libererClics(RESERVATION));
  }

  /** « Comparer » dans la fiche : le POI sélectionné devient A, on attend un clic sur la carte. */
  commencerComparaison(): void {
    this.comparaisonA.set(this.selection());
    this.modeComparaison.set('selecting');
  }

  /** `exitCompare` : Annuler, Fermer, Échap. */
  quitterComparaison(): void {
    this.modeComparaison.set('idle');
    this.comparaisonA.set(null);
    this.comparaisonB.set(null);
    this.onglet.set('legend');
  }

  /** Un cluster de la légende : cadrage sur ses POI, filtre de la table, onglet POI (`fitCluster`). */
  choisirCluster(cid: string): void {
    const e = emprise(this.clusters.donnees(), cid);
    if (!e) return;
    this.clusters.cadrer(e);
    this.filtreCluster.set(Number(cid));
    this.onglet.set('table');
  }

  /**
   * « Historique » : relu à chaque demande ; un second clic sur le même POI le replie (`loadHistory`). La lecture
   * précédente est ANNULÉE (revue 1) : sans cela, la réponse tardive d'un POI A s'affichait dans la fiche d'un POI B.
   */
  basculerHistorique(poiId: string): void {
    if (this.historiquePoi() === poiId && this.historiqueVisible()) {
      this.historiqueVisible.set(false);
      return;
    }
    this.lectureHistorique?.unsubscribe();
    this.historiquePoi.set(poiId);
    this.historiqueVisible.set(false);
    this.historiqueErreur.set(null);
    this.lectureHistorique = this.api.historique(poiId).subscribe({
      next: (h) => {
        if (this.historiquePoi() !== poiId) return;
        this.historique.set(h);
        this.historiqueVisible.set(true);
      },
      error: (e: unknown) => {
        if (this.historiquePoi() === poiId) this.historiqueErreur.set(`Historique indisponible — ${messageErreurApi(e)}`);
      },
    });
  }

  /** « Durées » : les profils du POI pour chaque durée calculée ; un second clic ferme la vue (`loadDurCompare`). */
  basculerDurees(poiId: string): void {
    if (this.dureesPoi() === poiId && this.dureesDonnees()) {
      this.fermerDurees(false);
      return;
    }
    this.dureesPoi.set(poiId);
    this.dureesChargement.set(true);
    this.dureesDonnees.set(null);
    this.dureesErreur.set(null);
    this.onglet.set('compare');
    this.lectureDurees?.unsubscribe();
    this.lectureDurees = this.api.profilsPoi(poiId).subscribe({
      next: (r) => {
        this.dureesDonnees.set(profilsParDuree(r));
        this.dureesChargement.set(false);
      },
      error: (e: unknown) => {
        this.dureesChargement.set(false);
        this.dureesErreur.set(`Profils multi-durées indisponibles — ${messageErreurApi(e)}`);
      },
    });
  }

  /** « Fermer » de la vue des durées : retour à la légende (le second clic sur « Durées » ne change pas d'onglet). */
  fermerDurees(versLegende = true): void {
    this.lectureDurees?.unsubscribe();
    this.dureesPoi.set(null);
    this.dureesChargement.set(false);
    this.dureesDonnees.set(null);
    this.dureesErreur.set(null);
    if (versLegende) this.onglet.set('legend');
  }

  private surClicCarte(p: PoiCluster): void {
    if (this.modeComparaison() === 'selecting') {
      this.comparaisonB.set(p);
      this.modeComparaison.set('comparing');
      this.onglet.set('compare');
    } else {
      this.selection.set(p);
    }
  }
}
