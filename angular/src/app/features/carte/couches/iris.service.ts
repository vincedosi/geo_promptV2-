import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import type { Subscription } from 'rxjs';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { type IrisDetailData, IrisApi } from '../data/iris.api';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { type BornesIris, type CatalogueBornesIris, niveauAuZoom } from '../logique/iris-echelle';
import { IRIS_ZOOM_PLANCHER } from '../logique/versions';
import { PITCH_RELIEF } from './carreaux.service';
import { peindre } from './couche-carreaux';
import {
  COUCHE_IRIS_FOND, COUCHE_IRIS_RELIEF, COUCHE_IRIS_TRAIT, COULEUR_PROVISOIRE_IRIS, JETONS_IRIS, expressionCouleurIris,
  expressionHauteurIris, filtreVraisIris, filtrerCouchesIris, montrerCouchesIris, opaciteTraitIris, poserCouchesIris,
} from './couche-iris';

/** L'état du chargement des bornes nationales : une seule lecture par écran, retentée après un échec. */
type EtatBornes = 'attente' | 'chargement' | 'pret' | 'erreur';

/**
 * La choroplèthe IRIS en cascade — l'état que `useMapLayers.ts:175-211, 617-866` tenait pour la carte, sa
 * synchronisation avec l'instance MapLibre, et le détail d'un IRIS cliqué (`app/map/_hooks/useIrisDetail.ts`).
 *
 * ── CONTRAT DU REGISTRE (`CouchesCarteService`, B11) ─────────────────────
 * Même contrat que `CarreauxService` : posée à la PREMIÈRE visibilité sur l'instance COURANTE, re-posée d'elle-même
 * sur chaque nouvelle instance (changement de fond) avec son indicateur, sa palette, son opacité, son relief et son
 * filtre ; chaque réglage n'est ensuite qu'un `setPaintProperty` / `setLayoutProperty` / `setFilter`.
 *
 * ── UNE COLONNE À LA FOIS, ZÉRO REQUÊTE AU CHANGEMENT D'INDICATEUR ────────
 * La tuile porte toutes les colonnes ; les bornes de TOUTES les colonnes arrivent en UN appel (`/api/iris/bornes`),
 * lu à la première visibilité puis gardé pour l'écran (`irisBornesCacheRef` de React). Changer d'indicateur ne fait
 * qu'une nouvelle expression.
 *
 * ── LE PLANCHER DE ZOOM ──────────────────────────────────────────────────
 * Sous `IRIS_ZOOM_PLANCHER`, MapLibre ne demande AUCUNE tuile et n'émet aucune erreur : allumer remonte la caméra au
 * plancher (`setIrisVisible`, `useMapLayers.ts:687-697`) — seul le zoom bouge, et seulement à l'ALLUMAGE.
 *
 * ── UN SEUL DÉGRADÉ ──────────────────────────────────────────────────────
 * `basculer(true)` réclame l'exclusivité (`PanneauCalques.tsx:297-301`) : les carreaux allumés s'éteignent et
 * l'annonce les nomme. « Tout effacer » masque la couche ET ferme le détail (`page.tsx:725,749-750`).
 *
 * Deux écarts à React, corrigés et listés au rapport T7 :
 * - une colonne SANS bornes (vide en base) peint tout en gris « donnée absente » : React gardait l'expression de
 *   l'indicateur PRÉCÉDENT, donc une carte d'une autre colonne sous la légende « Aucune donnée » ;
 * - le chargement des bornes est distingué de leur absence (`bornes() === undefined`) : React affichait
 *   « ! Aucune donnée pour cet indicateur » pendant le premier chargement, et pour toujours après un échec réseau.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class IrisService {
  private readonly etat = inject(EtatCarteService);
  private readonly couches = inject(CouchesCarteService);
  private readonly api = inject(IrisApi);
  private readonly couleurs = inject(CouleursService).palette(JETONS_IRIS);

  readonly visible = signal(false);
  readonly indicateur = signal('pop_15_29');
  readonly palette = signal('bleu');
  readonly opacite = signal(0.45);
  readonly relief = signal(false);
  /** Exagération du relief, en multiples de la maille (jamais en mètres : un IRIS parisien fait 0,06 km², un rural 30). */
  readonly hauteur = signal(1.5);
  /** « Vrais IRIS uniquement » — DÉCOCHÉ par défaut : `is_true_iris` sert l'analyse, jamais l'affichage (CLAUDE.md). */
  readonly vraisSeulement = signal(false);

  private readonly catalogue = signal<CatalogueBornesIris | null>(null);
  private readonly etatBornes = signal<EtatBornes>('attente');
  /** Le chargement des bornes a échoué : la légende le dit, et le prochain allumage retente. */
  readonly bornesEnErreur = computed(() => this.etatBornes() === 'erreur');
  /**
   * Bornes nationales de l'indicateur : `undefined` tant que le catalogue n'est pas arrivé, `null` pour une colonne
   * sans donnée (quatre colonnes proposées sont vides en base), sinon la ligne d'`iris_bornes_echelle`.
   */
  readonly bornes = computed<BornesIris | null | undefined>(() => {
    const cat = this.catalogue();
    return cat ? (cat[this.indicateur()] ?? null) : undefined;
  });

  private readonly zoom = signal<number | null>(null);
  /** Zoom courant de la carte, relevé à chaque `zoomend` (`useMapLayers.ts:762-770`) ; `null` sans carte. */
  readonly zoomCourant = this.zoom.asReadonly();
  /** Le palier de la cascade servi à ce zoom, `floor` compris (`niveauAuZoom`). */
  readonly niveau = computed(() => {
    const z = this.zoom();
    return z === null ? null : niveauAuZoom(Math.floor(z));
  });
  /** Couche allumée, carte sous le plancher : rien ne s'affiche, et la section le dit (`IrisSection.tsx:70-74`). */
  readonly sousLePlancher = computed(() => {
    const z = this.zoom();
    return this.visible() && z !== null && z < IRIS_ZOOM_PLANCHER;
  });

  // ── Détail d'un IRIS cliqué (`useIrisDetail.ts`) ─────────────────────────
  private readonly code = signal<string | null>(null);
  readonly codeSelectionne = this.code.asReadonly();
  private readonly donnees = signal<IrisDetailData | null>(null);
  readonly detail = this.donnees.asReadonly();
  private readonly chargement = signal(false);
  readonly chargementDetail = this.chargement.asReadonly();
  private readonly erreur = signal(false);
  /** Le détail n'a pas pu être lu : le panneau le dit (React le refermait sans un mot). */
  readonly erreurDetail = this.erreur.asReadonly();

  /** L'opacité a-t-elle été réglée ? Avant, le contour garde l'interpolation par zoom de `useMapInit`. */
  private readonly opaciteReglee = signal(false);
  /** L'instance où la couche est POSÉE (null avant la première visibilité, et dès que la carte disparaît). */
  private readonly posee = signal<maplibregl.Map | null>(null);
  private readonly couleur = computed<unknown>(() => {
    const b = this.bornes();
    // Bornes en route : la teinte provisoire de React ; bornes introuvables (échec) : le gris, rien n'est mesurable.
    if (b === undefined) return this.bornesEnErreur() ? this.couleurs().absente : COULEUR_PROVISOIRE_IRIS;
    if (b === null) return this.couleurs().absente;
    return expressionCouleurIris(b, this.palette(), this.couleurs().absente);
  });
  private readonly hauteurExpr = computed<unknown>(() => {
    const b = this.bornes();
    return b ? expressionHauteurIris(b, this.hauteur()) : 0;
  });
  private readonly traitOpacite = computed(() => opaciteTraitIris(this.opacite(), this.opaciteReglee()));
  private readonly filtre = computed(() => filtreVraisIris(this.vraisSeulement()));
  private pitchAvant = 0;
  private lectureBornes: Subscription | null = null;
  private lectureDetail: Subscription | null = null;

  constructor() {
    this.etat.surEviction('iris', () => this.visible.set(false));
    this.couches.inscrireEffacement('iris', () => {
      this.visible.set(false);
      this.fermerDetail();
    });
    inject(DestroyRef).onDestroy(() => {
      this.lectureBornes?.unsubscribe();
      this.lectureDetail?.unsubscribe();
    });

    // Les bornes : UNE lecture, à la première visibilité (la couche masquée ne coûte rien).
    effect(() => {
      if (!this.visible() || this.etatBornes() !== 'attente') return;
      untracked(() => this.lireBornes());
    });

    // Pose : sur la carte courante, dès que la couche est visible ; rejouée sur chaque nouvelle instance.
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (!carte) {
        this.posee.set(null);
        return;
      }
      if (!this.visible() || untracked(this.posee) === carte) return;
      nettoyer(quandStyleCharge(carte, () => {
        untracked(() => poserCouchesIris(carte, this.api.urlTuiles(), {
          couleur: this.couleur(), opacite: this.opacite(), traitOpacite: this.traitOpacite(), hauteur: this.hauteurExpr(),
          trait: this.couleurs().trait, filtre: this.filtre(), visible: this.visible(), relief: this.relief(),
        }));
        this.posee.set(carte);
      }));
    });

    // Zoom courant et clic sur un IRIS : écoutés sur CHAQUE instance publiée, retirés avec elle.
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (!carte) {
        this.zoom.set(null);
        return;
      }
      const releve = () => this.zoom.set(carte.getZoom());
      releve();
      const clic = (e: maplibregl.MapLayerMouseEvent) => {
        const code = e.features?.[0]?.properties?.['code_iris'] as string | undefined;
        if (!code) return;
        e.preventDefault?.();
        this.selectionner(code);
      };
      const entrer = () => { carte.getCanvas().style.cursor = 'pointer'; };
      const sortir = () => { carte.getCanvas().style.cursor = ''; };
      carte.on('zoomend', releve);
      carte.on('click', COUCHE_IRIS_FOND, clic);
      carte.on('mouseenter', COUCHE_IRIS_FOND, entrer);
      carte.on('mouseleave', COUCHE_IRIS_FOND, sortir);
      nettoyer(() => {
        carte.off('zoomend', releve);
        carte.off('click', COUCHE_IRIS_FOND, clic);
        carte.off('mouseenter', COUCHE_IRIS_FOND, entrer);
        carte.off('mouseleave', COUCHE_IRIS_FOND, sortir);
      });
    });

    effect(() => {
      const carte = this.posee();
      if (carte) montrerCouchesIris(carte, this.visible(), this.relief());
    });
    effect(() => {
      const carte = this.posee();
      if (carte) filtrerCouchesIris(carte, this.filtre());
    });
    // Chaque effet teste la carte AVANT de lire une couleur : le jeton n'est résolu que si la couche existe.
    effect(() => {
      const carte = this.posee();
      if (!carte) return;
      const couleur = this.couleur();
      peindre(carte, COUCHE_IRIS_FOND, 'fill-color', couleur);
      // La couche en relief porte la MÊME couleur : passer en 3D change l'axe de lecture, pas la lecture.
      peindre(carte, COUCHE_IRIS_RELIEF, 'fill-extrusion-color', couleur);
    });
    effect(() => {
      const carte = this.posee();
      const o = this.opacite();
      const trait = this.traitOpacite();
      if (!carte) return;
      peindre(carte, COUCHE_IRIS_FOND, 'fill-opacity', o);
      peindre(carte, COUCHE_IRIS_TRAIT, 'line-opacity', trait);
    });
    effect(() => {
      const carte = this.posee();
      const h = this.hauteurExpr();
      if (carte) peindre(carte, COUCHE_IRIS_RELIEF, 'fill-extrusion-height', h);
    });
    effect(() => {
      const carte = this.posee();
      if (carte) peindre(carte, COUCHE_IRIS_TRAIT, 'line-color', this.couleurs().trait);
    });
  }

  /**
   * Le geste du panneau (« IRIS », « Couche IRIS », « Zoomer », la croix d'« Actifs ») : l'exclusivité d'abord, la
   * visibilité ensuite ; à l'ALLUMAGE seulement, la caméra remonte au plancher si elle est dessous.
   */
  basculer(suivant: boolean): void {
    this.etat.basculerDegrade('iris', suivant);
    if (suivant && this.etatBornes() === 'erreur') this.etatBornes.set('attente');
    this.visible.set(suivant);
    if (!suivant) return;
    const carte = this.couches.carteCourante();
    if (carte && carte.getZoom() < IRIS_ZOOM_PLANCHER) carte.easeTo({ zoom: IRIS_ZOOM_PLANCHER, duration: 800 });
  }

  /** Le curseur d'opacité : l'aplat prend la valeur, le contour `min(v × 0,8 ; 0,6)` (`useMapLayers.ts:743-753`). */
  reglerOpacite(v: number): void {
    this.opaciteReglee.set(true);
    this.opacite.set(v);
  }

  /** « Relief 3D » (`setIris3D`, `useMapLayers.ts:699-710`) : incline la caméra, et rend l'inclinaison d'avant. */
  basculerRelief(suivant: boolean): void {
    this.relief.set(suivant);
    const carte = this.couches.carteCourante();
    if (!carte) return;
    if (suivant) {
      this.pitchAvant = carte.getPitch();
      if (carte.getPitch() < PITCH_RELIEF) carte.easeTo({ pitch: PITCH_RELIEF, duration: 600 });
    } else {
      carte.easeTo({ pitch: this.pitchAvant, duration: 600 });
    }
  }

  /**
   * Un IRIS cliqué : un seul à la fois (jamais de préchargement). Le détail précédent reste affiché s'il s'agit du même
   * IRIS (`useIrisDetail.ts:68`) ; une sélection plus récente annule la lecture en cours.
   */
  selectionner(code: string): void {
    this.lectureDetail?.unsubscribe();
    this.code.set(code);
    this.chargement.set(true);
    this.erreur.set(false);
    this.donnees.update((d) => (d?.code_iris === code ? d : null));
    this.lectureDetail = this.api.detail(code).subscribe({
      next: (d) => {
        this.donnees.set(d);
        this.chargement.set(false);
      },
      error: () => {
        this.chargement.set(false);
        this.erreur.set(true);
      },
    });
  }

  /** La croix du panneau de détail. */
  fermerDetail(): void {
    this.lectureDetail?.unsubscribe();
    this.lectureDetail = null;
    this.code.set(null);
    this.donnees.set(null);
    this.chargement.set(false);
    this.erreur.set(false);
  }

  private lireBornes(): void {
    this.etatBornes.set('chargement');
    this.lectureBornes = this.api.bornes().subscribe({
      next: (catalogue) => {
        this.catalogue.set(catalogue);
        this.etatBornes.set('pret');
      },
      error: () => this.etatBornes.set('erreur'),
    });
  }
}
