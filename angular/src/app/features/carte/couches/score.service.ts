import { DOCUMENT, DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import type { Subscription } from 'rxjs';
import { FABRIQUE_POPUP, type PopupCarte } from '../../../carte/fabrique-carte';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { ContoursZonesService } from '../etat/contours-zones.service';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import {
  COUCHE_SCORE_FOND, type ScoreAffiche, comptePartiels, contenuPopupScore, entitesScore, poserCoucheScore, repeindreCoucheScore,
  retirerCoucheScore,
} from './couche-score';

/**
 * La choroplèthe 0-100 du score composite par code postal — portage de `app/map/_components/ScoreMapLayer.tsx` et du
 * câblage de `page.tsx:526-590` (lot 4, T18).
 *
 * ── UN APPEL DE SERVICE, PLUS UN ÉVÉNEMENT ───────────────────────────────
 * React allumait le calque par `window.dispatchEvent(SCORE_MAP_EVENT)`, que DEUX écouteurs recevaient : le calque, et
 * `page.tsx` pour l'exclusivité des dégradés. Ici, l'outil (ou « Mes analyses ») appelle `afficher` ; l'éteindre,
 * `eteindre`. Même règle « transition seulement » que `page.tsx:584-587` : le dégradé `score` n'est réclamé qu'au
 * passage éteint → allumé, et rendu qu'au passage inverse — un second score ne réclame rien.
 *
 * Le défaut de pile synchrone de `page.tsx:533-549` (un `dispatchEvent` relancé DANS `onDegrade`, qui relisait le
 * `degradeActif` du dernier rendu et finissait à `null` avec l'IRIS affiché) n'a pas d'équivalent : l'éviction
 * (`surEviction`) VIDE la couche sans rappeler `basculerDegrade`, et l'état est un signal, jamais une valeur périmée.
 * Aucune ref à recopier.
 *
 * ── CONTOURS ─────────────────────────────────────────────────────────────
 * Les polygones des codes postaux (`/api/meteo-geo/zones?scale=cp`, ~3,8 Mo) viennent de `ContoursZonesService` —
 * lus à la PREMIÈRE activation, jamais au montage, et partagés avec la météo et la santé. Éteint pendant la lecture :
 * l'abonnement est coupé, rien n'est peint ensuite (le jeton d'annulation de React).
 *
 * ── LA COUCHE (B11) ──────────────────────────────────────────────────────
 * Posée quand il y a un score ET des contours, re-posée sur une carte recréée par un changement de fond, retirée à
 * l'extinction (React : `nettoyer`). Au sommet de la pile (`ORDRE_COUCHES`), comme React qui l'ajoutait après le load.
 *
 * Écart, défaut corrigé : « Tout effacer » vide aussi le score — React remettait le dégradé à `null` et laissait la
 * choroplèthe peinte, sans légende ni exclusivité.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class ScoreService {
  private readonly etat = inject(EtatCarteService);
  private readonly couches = inject(CouchesCarteService);
  private readonly contours = inject(ContoursZonesService);
  private readonly fabriquePopup = inject(FABRIQUE_POPUP);
  private readonly document = inject(DOCUMENT);
  private readonly couleurs = inject(CouleursService).palette({ teal: 'brand-teal' });

  private readonly score = signal<ScoreAffiche | null>(null);
  /** Le score peint, `null` éteint — lu par la carte flottante. */
  readonly affiche = this.score.asReadonly();
  /** Lecture des contours en cours (« Chargement des contours… »). */
  readonly chargement = signal(false);
  /** Contours indisponibles : le score est calculé mais ne peut pas être peint — l'écran le dit. */
  readonly echec = signal(false);
  readonly partiels = computed(() => comptePartiels(this.score()));

  private readonly zones = signal<GeoJSON.FeatureCollection | null>(null);
  private readonly donnees = computed(() => {
    const a = this.score();
    const z = this.zones();
    return a && z ? entitesScore(z, a) : null;
  });
  /** L'instance qui porte la couche — la repeinture et le clic n'écrivent que là. */
  private readonly posee = signal<maplibregl.Map | null>(null);
  private lecture: Subscription | null = null;
  private popup: PopupCarte | null = null;

  constructor() {
    // Évincé par un autre dégradé, ou « Tout effacer » : la couche se vide, sans rendre un dégradé qu'on vient de prendre.
    this.etat.surEviction('score', () => this.vider());
    this.couches.inscrireEffacement('score', () => this.vider());
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());

    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      const donnees = this.donnees();
      if (!carte) {
        this.posee.set(null);
        return;
      }
      if (!donnees) {
        untracked(() => {
          retirerCoucheScore(carte);
          this.posee.set(null);
        });
        return;
      }
      nettoyer(quandStyleCharge(carte, () => untracked(() => {
        poserCoucheScore(carte, donnees, this.couleurs().teal);
        this.posee.set(carte);
      })));
    });

    effect(() => {
      const carte = this.posee();
      if (carte) repeindreCoucheScore(carte, this.couleurs().teal);
    });

    effect((nettoyer) => {
      const carte = this.posee();
      if (!carte) return;
      const clic = (e: maplibregl.MapLayerMouseEvent) => this.cliquer(carte, e);
      const entrer = () => { carte.getCanvas().style.cursor = 'pointer'; };
      const sortir = () => { carte.getCanvas().style.cursor = ''; };
      carte.on('click', COUCHE_SCORE_FOND, clic);
      carte.on('mouseenter', COUCHE_SCORE_FOND, entrer);
      carte.on('mouseleave', COUCHE_SCORE_FOND, sortir);
      nettoyer(() => {
        carte.off('click', COUCHE_SCORE_FOND, clic);
        carte.off('mouseenter', COUCHE_SCORE_FOND, entrer);
        carte.off('mouseleave', COUCHE_SCORE_FOND, sortir);
      });
    });
  }

  /** Peint un score ; un score VIDE éteint (le `scores: []` de l'événement de React). */
  afficher(a: ScoreAffiche): void {
    if (a.scores.length === 0) {
      this.eteindre();
      return;
    }
    // Transition seulement : le dégradé AVANT le score, l'éviction de l'ancien et son annonce partent dans ce geste.
    if (!this.score()) this.etat.basculerDegrade('score', true);
    this.score.set(a);
    if (!this.zones()) this.lireContours();
  }

  /** La croix de la carte flottante, un réglage de l'outil modifié (`perimerResultat`). */
  eteindre(): void {
    if (!this.score()) return;
    this.etat.basculerDegrade('score', false);
    this.vider();
  }

  private lireContours(): void {
    if (this.lecture && !this.lecture.closed) return;
    this.chargement.set(true);
    this.echec.set(false);
    this.lecture = this.contours.zones('cp').subscribe({
      next: (z) => this.zones.set(z),
      error: () => {
        this.chargement.set(false);
        this.echec.set(true);
      },
      complete: () => this.chargement.set(false),
    });
  }

  private vider(): void {
    this.lecture?.unsubscribe();
    this.lecture = null;
    this.score.set(null);
    this.chargement.set(false);
    this.echec.set(false);
    this.popup?.remove();
    this.popup = null;
  }

  private cliquer(carte: maplibregl.Map, e: maplibregl.MapLayerMouseEvent): void {
    const f = e.features?.[0];
    if (!f) return;
    const doc = carte.getContainer().ownerDocument ?? this.document;
    this.popup?.remove();
    this.popup = this.fabriquePopup({ closeButton: true })
      .setLngLat(e.lngLat)
      .setDOMContent(contenuPopupScore(f.properties ?? {}, doc))
      .addTo(carte);
  }
}
