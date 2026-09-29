import {
  ChangeDetectionStrategy, Component, DestroyRef, type ElementRef, ViewEncapsulation,
  afterNextRender, inject, input, output, viewChild,
} from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { type Bbox, bboxDeCarte } from './bbox';
import { FABRIQUE_CARTE, FOND_POSITRON } from './fabrique-carte';

/**
 * Une carte MapLibre, et SEULEMENT son cycle de vie : le parent reçoit la
 * carte (`prete`) et y pose ses sources et ses couches.
 *
 * - Créée APRÈS le premier rendu : MapLibre mesure son conteneur à la création.
 * - `ResizeObserver` OBLIGATOIRE : MapLibre ne se redimensionne que sur un
 *   changement de taille de FENÊTRE ; une poignée ou un panneau replié laisse
 *   sinon une moitié grise et des clics décalés (constaté côté React).
 * - `deplacee` au `moveend`, JAMAIS au `move` : un chargement par image de
 *   panoramique serait la famille de l'incident du 28/03 (CLAUDE.md).
 * - Le composant ne choisit pas de cadre « France entière » par défaut :
 *   `cadre` est requis.
 * - `styleUrl` (et non `angular.json` → `styles`) : MapLibre ne doit JAMAIS
 *   peser sur le paquet initial (contrainte du lot). En feuille de style
 *   GLOBALE elle est incluse même si aucune route ne monte `mg-carte` ; en
 *   `styleUrl` de ce composant elle part dans le MÊME chunk paresseux que le
 *   composant, chargée seulement quand `mg-carte` est réellement utilisé.
 * - `ViewEncapsulation.None` : les contrôles et popups MapLibre sont ajoutés
 *   au DOM par la librairie EN DEHORS du template de ce composant (attachés
 *   directement au conteneur, hors de tout `<div #conteneur>` scopé). Un
 *   encapsulement par défaut (`ViewEncapsulation.Emulated`) attribuerait un
 *   attribut `_ngcontent-*` que ces éléments ne portent pas, et les styles de
 *   MapLibre ne s'appliqueraient plus dessus.
 * - `maplibre-gl.css` pèse ~69,5 kB : le budget `anyComponentStyle` de
 *   `angular.json` (par défaut 4 kB / 8 kB, pensé pour nos propres feuilles
 *   de style de composant) a dû être relevé (8 kB / 80 kB) pour ne pas faire
 *   ÉCHOUER le build sur cette seule feuille tierce, connue et volontaire —
 *   toute autre feuille de style de composant qui grossirait au-delà de
 *   80 kB déclenchera encore une erreur.
 */
@Component({
  selector: 'mg-carte',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: '<div #conteneur class="absolute inset-0"></div>',
  styleUrl: '../../../node_modules/maplibre-gl/dist/maplibre-gl.css',
  host: { class: 'block relative' },
})
export class CarteComponent {
  readonly fond = input(FOND_POSITRON);
  readonly cadre = input.required<Bbox>();
  readonly prete = output<maplibregl.Map>();
  readonly deplacee = output<Bbox>();
  /** Émise si le FOND lui-même échoue avant le premier `load` — pas les
   *  erreurs de tuile ordinaires qui suivent un chargement réussi. */
  readonly erreur = output<string>();

  private readonly conteneur = viewChild.required<ElementRef<HTMLDivElement>>('conteneur');
  private readonly fabrique = inject(FABRIQUE_CARTE);
  private readonly destruction = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const element = this.conteneur().nativeElement;
      const carte = this.fabrique({
        container: element,
        style: this.fond(),
        bounds: [...this.cadre()] as [number, number, number, number],
        fitBoundsOptions: { padding: 40 },
        attributionControl: { compact: true },
      });
      let chargee = false;
      carte.on('load', () => {
        chargee = true;
        this.prete.emit(carte);
      });
      carte.on('moveend', () => this.deplacee.emit(bboxDeCarte(carte)));
      carte.on('error', () => {
        if (!chargee) this.erreur.emit("Le fond de carte n'a pas pu être chargé.");
      });
      const observateur = new ResizeObserver(() => carte.resize());
      observateur.observe(element);
      this.destruction.onDestroy(() => {
        observateur.disconnect();
        carte.remove();
      });
    });
  }
}
