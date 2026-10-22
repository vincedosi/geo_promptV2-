import { DestroyRef, Injectable, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import type { Subscription } from 'rxjs';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { IrisApi } from '../data/iris.api';
import { ZonesCustomApi } from '../data/zones-custom.api';
import { ContoursZonesService } from '../etat/contours-zones.service';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { ZoneAnalyseeService } from '../etat/zone-analysee.service';
import { bboxDeZone } from '../logique/zones/zones-affichees';
import {
  JETONS_COUVERTURE, type RenduCouverture, ZOOM_IRIS_COUVERTURE, entitesCouvertureCp, poserCoucheCouverture,
  retirerCoucheCouverture, surlignerCouverture,
} from './couche-couverture';

/** Marge du recadrage sur la zone (plan, T8 : padding 60). La marge de la carte (panneau d'étape) s'y ajoute. */
const RECADRAGE = { padding: 60, duration: 900 } as const;

/**
 * ④ Analyse — la couverture d'une zone peinte sur LA carte (lot 4, T8, A-7). Lit le chiffrage de
 * `ZoneAnalyseeService` et pose `couche-couverture.ts` : contour de la zone, puis la part de chaque CP ou IRIS.
 *
 * ── RIEN N'EST LU AVANT UN CHIFFRAGE ─────────────────────────────────────
 * Le contour de la zone (`GET /api/custom-geo/[id]/geometry`) est lu au PREMIER résultat de cette zone, une fois ;
 * les contours CP (~3,8 Mo, `ContoursZonesService`, partagés avec le score, la météo et la santé) au premier résultat
 * « par code postal ». Les IRIS viennent des tuiles `iris-source`. Ouvrir ④ ne lit rien.
 *
 * ── UNE ZONE QUITTÉE NE SE PEINT JAMAIS (P-c) ────────────────────────────
 * Changer de zone, de cible ou de découpage efface le résultat (`ZoneAnalyseeService`) : le rendu devient `null` et les
 * couches sont retirées. La lecture du contour d'une zone quittée est désabonnée, et sa réponse comparée à la zone
 * COURANTE avant d'être gardée.
 *
 * ── CYCLE DE VIE ─────────────────────────────────────────────────────────
 * Fourni par la PAGE (P-e) : la couche survit à ④ → ① → ④. Un `effect` sur `carteCourante` la re-pose sur une carte
 * recréée par un changement de fond (B11) ; le thème la repeint (palette calculée, relue par l'effet). « Tout effacer »
 * la MASQUE jusqu'au prochain chiffrage, sans toucher au résultat affiché dans le panneau. À la destruction : lectures
 * désabonnées, couches retirées, écouteur de zoom retiré (nettoyage de l'effet).
 *
 * ── UN SEUL DÉGRADÉ À LA FOIS (relecture T8, Q1) ─────────────────────────
 * `'couverture'` est au registre (`logique/degrades.ts` et sa source React `lib/carte/degrades.ts`, écart P5 ratifié) :
 * la couche peinte RÉCLAME le dégradé (l'IRIS, les carreaux, le score… sont évincés et l'éviction annoncée) ; évincée à
 * son tour, elle se MASQUE — le chiffre reste au panneau, qui dit « Couche retirée de la carte » (Q2).
 *
 * ── LE CONTOUR SUIT LA VERSION DE LA ZONE (relecture T8, I1) ─────────────
 * Un recalcul en ③ garde l'id et change la forme : la réponse porte `zone_maj` (sql/271), et le contour est relu (et la
 * carte recadrée) dès que (zone, zone_maj) change. Tant que le neuf n'est pas lu, l'ancien n'est PAS tracé.
 */
@Injectable()
export class CouvertureService {
  private readonly zone = inject(ZoneAnalyseeService);
  private readonly couches = inject(CouchesCarteService);
  private readonly etat = inject(EtatCarteService);
  private readonly zonesApi = inject(ZonesCustomApi);
  private readonly irisApi = inject(IrisApi);
  private readonly contoursZones = inject(ContoursZonesService);
  private readonly palette = inject(CouleursService).palette(JETONS_COUVERTURE);

  /** « Tout effacer » ou l'éviction par un autre dégradé masquent la couche ; un chiffrage ou `afficher()` la rendent. */
  private readonly _masquee = linkedSignal({ source: this.zone.resultat, computation: () => false });
  /** La couche est-elle masquée alors qu'un chiffrage existe ? Le panneau le dit (« Couche retirée de la carte »). */
  readonly masquee = computed(() => this.zone.resultat() !== null && this._masquee());
  /** La couverture est-elle peinte ? Lu par la pastille « renseignée » de ④. */
  readonly affichee = computed(() => this.zone.resultat() !== null && !this._masquee());
  /** Le territoire survolé dans le tableau ; remis à `null` à chaque résultat. */
  readonly survole = linkedSignal<unknown, string | null>({ source: this.zone.resultat, computation: () => null });

  /** Le contour lu, et la version (`cle` = zone + `zone_maj`) dont il est la forme. */
  private readonly geometrie = signal<{ cle: string; entite: GeoJSON.Feature } | null>(null);
  private readonly contoursCp = signal<GeoJSON.FeatureCollection | null>(null);
  /** Contours CP en lecture / en échec : le panneau le dit (le tableau reste lisible). */
  readonly chargementContours = signal(false);
  readonly contoursIndisponibles = signal(false);

  private readonly zoom = signal<number | null>(null);
  /** Découpage IRIS sous z9 : rien n'est peint (les tuiles portent des communes) — « Zoomez pour voir les IRIS ». */
  readonly irisSousLeZoom = computed(() => {
    const z = this.zoom();
    return this.affichee() && this.zone.resultat()?.decoupage === 'iris' && z !== null && z < ZOOM_IRIS_COUVERTURE;
  });

  private readonly rendu = computed<RenduCouverture | null>(() => {
    const r = this.zone.resultat();
    if (!r || this._masquee()) return null;
    const g = this.geometrie();
    const cp = this.contoursCp();
    return {
      zone: g && g.cle === cleContour(r) ? g.entite : null,
      decoupage: r.decoupage,
      cp: r.decoupage === 'cp' && cp ? entitesCouvertureCp(cp, r.lignes) : null,
      iris: r.decoupage === 'iris' ? r.lignes : null,
    };
  });

  /** L'instance qui porte les couches — la surbrillance n'écrit que là. */
  private readonly posee = signal<maplibregl.Map | null>(null);
  private lectureZone: Subscription | null = null;
  /** La version (zone + `zone_maj`) dont le contour est lu ou en lecture ; `null` : aucune. */
  private cleLue: string | null = null;
  /** Le dégradé `couverture` est-il réclamé ? (transition seulement, comme `ScoreService`). */
  private reclame = false;
  private lectureContours: Subscription | null = null;

  constructor() {
    this.couches.inscrireEffacement('couverture', () => this._masquee.set(true));
    // Évincée par un autre dégradé : masquée, sans rendre un dégradé qu'on vient de prendre.
    this.etat.surEviction('couverture', () => {
      this.reclame = false;
      this._masquee.set(true);
    });

    // Peinte → réclame le dégradé ; retirée → le rend. Transition seulement.
    effect(() => {
      const a = this.affichee();
      untracked(() => {
        if (a === this.reclame) return;
        this.reclame = a;
        this.etat.basculerDegrade('couverture', a);
      });
    });

    // Les lectures suivent le RÉSULTAT (jamais l'ouverture de ④) : le contour de sa zone, les contours CP s'il le faut.
    effect(() => {
      const r = this.zone.resultat();
      const id = this.zone.zoneId();
      untracked(() => {
        // Zone quittée, ou forme recalculée : le contour (lu ou en vol) n'est plus le nôtre.
        const cle = r ? cleContour(r) : null;
        if (this.cleLue !== null && !this.cleLue.startsWith(`${id}@`)) this.oublierContour();
        if (!r || !cle) return;
        if (this.cleLue !== null && this.cleLue !== cle) this.oublierContour();
        if (this.cleLue === null) this.lireZone(r.zone_id, cle);
        if (r.decoupage === 'cp' && !this.contoursCp() && !this.lectureContours) this.lireContours();
      });
    });

    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      const rendu = this.rendu();
      if (!carte) {
        this.posee.set(null);
        return;
      }
      if (!rendu) {
        untracked(() => {
          retirerCoucheCouverture(carte);
          this.posee.set(null);
        });
        return;
      }
      // La palette en DERNIER, seulement avec un rendu (patron de `radio.service.ts`) : sans feuille de style — les
      // specs de la page — `palette` lève, et ouvrir la carte ne doit rien lire.
      const p = this.palette();
      nettoyer(quandStyleCharge(carte, () => untracked(() => {
        poserCoucheCouverture(carte, rendu, p, this.irisApi.urlTuiles());
        surlignerCouverture(carte, this.survole());
        this.posee.set(carte);
      })));
    });

    effect(() => {
      const carte = this.posee();
      const code = this.survole();
      if (carte) surlignerCouverture(carte, code);
    });

    // Le zoom de la carte en service, pour dire « Zoomez pour voir les IRIS ».
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (!carte) {
        this.zoom.set(null);
        return;
      }
      const relever = () => this.zoom.set(carte.getZoom());
      untracked(relever);
      carte.on('zoomend', relever);
      nettoyer(() => carte.off('zoomend', relever));
    });

    inject(DestroyRef).onDestroy(() => {
      this.lectureZone?.unsubscribe();
      this.lectureContours?.unsubscribe();
      const carte = this.couches.carteCourante();
      if (carte) retirerCoucheCouverture(carte);
    });
  }

  /** « Afficher sur la carte » : rend la couche masquée, SANS re-chiffrer (relecture T8, Q2). */
  afficher(): void {
    this._masquee.set(false);
  }

  /** Survol d'une ligne du tableau (`null` en sortie). */
  survoler(code: string | null): void {
    this.survole.set(code);
  }

  private oublierContour(): void {
    this.lectureZone?.unsubscribe();
    this.lectureZone = null;
    this.cleLue = null;
    this.geometrie.set(null);
  }

  private lireZone(id: string, cle: string): void {
    this.cleLue = cle;
    this.lectureZone = this.zonesApi.geometrie(id).subscribe({
      next: (f) => {
        this.lectureZone = null;
        if (this.cleLue !== cle || !f?.geometry) return;
        this.geometrie.set({ cle, entite: f as GeoJSON.Feature });
        const b = bboxDeZone(null, f.geometry);
        if (b) this.couches.carteCourante()?.fitBounds([[b[0], b[1]], [b[2], b[3]]], RECADRAGE);
      },
      // Sans contour, la part reste peinte : on ne bloque pas le reste pour un trait.
      error: () => {
        this.lectureZone = null;
        if (this.cleLue === cle) this.cleLue = null;
      },
    });
  }

  private lireContours(): void {
    this.chargementContours.set(true);
    this.contoursIndisponibles.set(false);
    this.lectureContours = this.contoursZones.zones('cp').subscribe({
      next: (z) => this.contoursCp.set(z),
      error: () => {
        this.lectureContours = null;
        this.chargementContours.set(false);
        this.contoursIndisponibles.set(true);
      },
      complete: () => {
        this.lectureContours = null;
        this.chargementContours.set(false);
      },
    });
  }
}

/** La version d'une zone chiffrée : son id et la date de sa forme (`zone_maj`, sql/271). */
function cleContour(r: { zone_id: string; zone_maj?: string | null }): string {
  return `${r.zone_id}@${r.zone_maj ?? ''}`;
}
