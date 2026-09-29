import {
  ChangeDetectionStrategy, Component, DestroyRef, DOCUMENT, type ElementRef,
  afterNextRender, inject, input, output, viewChild,
} from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { type Bbox, bboxDeCarte } from './bbox';
import { assurerFeuilleMaplibre } from './feuille-maplibre';
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
 * - **La feuille de style MapLibre voyage avec la carte, sans passer par un
 *   `styleUrl` de composant.** `angular.json` déclare
 *   `node_modules/maplibre-gl/dist/maplibre-gl.css` avec `inject: false` :
 *   Angular l'émet en `maplibre.css` dans le dossier de build mais ne
 *   l'ajoute PAS à `index.html`, donc elle ne pèse JAMAIS sur le paquet
 *   initial — même première charge de page, même sans aucune carte montée.
 *   `assurerFeuilleMaplibre()` (`feuille-maplibre.ts`) l'injecte dans
 *   `<head>` ici, à la demande, la première fois qu'une carte existe. Un
 *   `styleUrl` pointant vers cette feuille de 69,5 kB avait été tenté
 *   (fix round 1) mais forçait à ÉLARGIR le budget `anyComponentStyle` — la
 *   protection de TOUS les futurs composants du lot, pas seulement de
 *   celui-ci. Le style global paresseux évite ce compromis : le budget
 *   `anyComponentStyle` reste à ses valeurs d'origine (4 kB / 8 kB).
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
  /** Émise si le FOND lui-même échoue avant le premier `load` — pas les
   *  erreurs de tuile ordinaires qui suivent un chargement réussi. */
  readonly erreur = output<string>();

  private readonly conteneur = viewChild.required<ElementRef<HTMLDivElement>>('conteneur');
  private readonly fabrique = inject(FABRIQUE_CARTE);
  private readonly destruction = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

  constructor() {
    afterNextRender(() => {
      assurerFeuilleMaplibre(this.document);
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
