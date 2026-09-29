import {
  ChangeDetectionStrategy, Component, DestroyRef, type ElementRef, afterNextRender,
  inject, input, output, viewChild,
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
 */
@Component({
  selector: 'mg-carte',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div #conteneur class="absolute inset-0"></div>',
  host: { class: 'block relative' },
})
export class CarteComponent {
  readonly fond = input(FOND_POSITRON);
  readonly cadre = input.required<Bbox>();
  readonly prete = output<maplibregl.Map>();
  readonly deplacee = output<Bbox>();

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
      carte.on('load', () => this.prete.emit(carte));
      carte.on('moveend', () => this.deplacee.emit(bboxDeCarte(carte)));
      const observateur = new ResizeObserver(() => carte.resize());
      observateur.observe(element);
      this.destruction.onDestroy(() => {
        observateur.disconnect();
        carte.remove();
      });
    });
  }
}
