import { Injectable, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CarreauxApi } from '../data/carreaux.api';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { bornesDe, type BornesEchelle } from '../logique/carreaux/bornes';
import {
  COUCHE_CARREAUX_FOND, COUCHE_CARREAUX_RELIEF, COUCHE_CARREAUX_TRAIT, JETONS_CARREAUX, expressionCouleur,
  expressionHauteur, expressionsOpacite, montrerCouchesCarreaux, peindre, poserCouchesCarreaux,
} from './couche-carreaux';

/** Inclinaison donnée au relief (`PITCH_RELIEF`, `useMapLayers.ts:487`) : en deçà de ~40°, il se devine à peine. */
export const PITCH_RELIEF = 55;

/**
 * La couche des carreaux Filosofi — l'état que `useMapLayers.ts:147-183` tenait pour la carte, et sa synchronisation
 * avec l'instance MapLibre.
 *
 * ── CONTRAT DU REGISTRE (`CouchesCarteService`, B11) ─────────────────────
 * La source et ses couches sont posées à la PREMIÈRE visibilité (React les posait au `load`, masquées : aucune tuile
 * n'était demandée non plus), sur l'instance COURANTE ; changer de fond publie une nouvelle instance et la couche s'y
 * re-pose d'elle-même, avec son indicateur, sa palette, son opacité et son relief. Chaque réglage n'est ensuite qu'un
 * `setPaintProperty` / `setLayoutProperty` : changer d'indicateur ou de palette ne recrée PAS la source, donc aucune
 * tuile n'est redemandée — la tuile porte toutes les colonnes (une colonne à la fois, CLAUDE.md § Disk I/O).
 *
 * ── UN SEUL DÉGRADÉ ──────────────────────────────────────────────────────
 * `basculer(true)` réclame l'exclusivité (`EtatCarteService.basculerDegrade`) PUIS montre la couche
 * (`PanneauCalques.tsx:292-296`) ; un autre dégradé allumé ensuite l'éteint par `surEviction`. « Tout effacer » ne
 * fait que masquer (`page.tsx:723`) : le relief, l'indicateur et la palette restent.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class CarreauxService {
  private readonly etat = inject(EtatCarteService);
  private readonly couches = inject(CouchesCarteService);
  private readonly api = inject(CarreauxApi);
  private readonly couleurs = inject(CouleursService).palette(JETONS_CARREAUX);

  readonly visible = signal(false);
  readonly indicateur = signal('population_totale');
  readonly palette = signal('rouge');
  readonly opacite = signal(0.72);
  readonly relief = signal(false);
  /** Exagération du relief, en multiples de la largeur de maille (jamais en mètres). */
  readonly hauteur = signal(1.5);
  /** Le palier de la légende cliqué ; changer d'indicateur le remet à `null` (`useMapLayers.ts:294`). */
  readonly seauSelectionne = linkedSignal<string, number | null>({ source: this.indicateur, computation: () => null });
  /** Bornes NATIONALES de l'indicateur (log10) ; `null` sur une étendue nulle, qui rendrait l'échelle muette. */
  readonly bornes = computed<BornesEchelle | null>(() => {
    const b = bornesDe(this.indicateur());
    return b.max > b.min ? b : null;
  });

  /** L'instance où la couche est POSÉE (null avant la première visibilité, et dès que la carte disparaît). */
  private readonly posee = signal<maplibregl.Map | null>(null);
  private readonly couleur = computed(() => {
    const b = this.bornes();
    return b ? expressionCouleur(this.indicateur(), this.palette(), b, this.couleurs().absente) : null;
  });
  private readonly opacites = computed(() =>
    expressionsOpacite(this.indicateur(), this.bornes(), this.seauSelectionne(), this.opacite()));
  private readonly hauteurExpr = computed(() => {
    const b = this.bornes();
    return b ? expressionHauteur(this.indicateur(), b, this.hauteur()) : null;
  });
  private pitchAvant = 0;

  constructor() {
    this.etat.surEviction('carreaux', () => this.visible.set(false));
    this.couches.inscrireEffacement('carreaux', () => this.visible.set(false));

    // Pose : sur la carte courante, dès que la couche est visible ; rejouée sur chaque nouvelle instance.
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (!carte) {
        this.posee.set(null);
        return;
      }
      if (!this.visible() || untracked(this.posee) === carte) return;
      nettoyer(quandStyleCharge(carte, () => {
        untracked(() => poserCouchesCarreaux(carte, this.api.urlTuiles(), {
          couleur: this.couleur(), opacite: this.opacites(), hauteur: this.hauteurExpr(), trait: this.couleurs().trait,
          visible: this.visible(), relief: this.relief(),
        }));
        this.posee.set(carte);
      }));
    });

    effect(() => {
      const carte = this.posee();
      if (carte) montrerCouchesCarreaux(carte, this.visible(), this.relief());
    });
    // Chaque effet teste la carte AVANT de lire une couleur : la palette n'est lue (donc le jeton résolu) que si la
    // couche existe.
    effect(() => {
      const carte = this.posee();
      if (!carte) return;
      const couleur = this.couleur();
      if (!couleur) return;
      peindre(carte, COUCHE_CARREAUX_FOND, 'fill-color', couleur);
      // La couche extrudée porte la MÊME couleur : passer en 3D change l'axe de lecture, pas la lecture.
      peindre(carte, COUCHE_CARREAUX_RELIEF, 'fill-extrusion-color', couleur);
    });
    effect(() => {
      const carte = this.posee();
      const o = this.opacites();
      if (!carte) return;
      peindre(carte, COUCHE_CARREAUX_FOND, 'fill-opacity', o.fond);
      peindre(carte, COUCHE_CARREAUX_TRAIT, 'line-opacity', o.trait);
    });
    effect(() => {
      const carte = this.posee();
      const h = this.hauteurExpr();
      if (carte && h) peindre(carte, COUCHE_CARREAUX_RELIEF, 'fill-extrusion-height', h);
    });
    effect(() => {
      const carte = this.posee();
      if (carte) peindre(carte, COUCHE_CARREAUX_TRAIT, 'line-color', this.couleurs().trait);
    });
  }

  /** Le geste du panneau (« Carreaux », « Actifs ») : l'exclusivité d'abord, la visibilité ensuite. */
  basculer(suivant: boolean): void {
    this.etat.basculerDegrade('carreaux', suivant);
    this.visible.set(suivant);
  }

  /**
   * « Relief 3D » (`setCarreaux3D`, `useMapLayers.ts:508-518`) : montrer une extrusion sur une carte à plat ne change
   * RIEN à l'écran — la bascule incline donc la caméra, et rend l'inclinaison d'avant au retour en 2D.
   */
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
}
