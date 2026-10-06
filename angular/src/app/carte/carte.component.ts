import {
  ChangeDetectionStrategy, Component, DestroyRef, DOCUMENT, type ElementRef,
  afterNextRender, effect, inject, input, output, signal, viewChild,
} from '@angular/core';
import maplibregl from 'maplibre-gl';
import { type Bbox, bboxDeCarte } from './bbox';
import { BASE_RESSOURCES } from '../core/ressources/ressource-distante';
import { chargerFeuilleMaplibre } from './feuille-maplibre';
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
 *   `cadre` est requis, sauf si `centre` ET `zoomInitial` le remplacent (lot 4, B11).
 * - **La feuille de style MapLibre voyage avec la carte, sans passer par un
 *   `styleUrl` de composant.** `angular.json` déclare
 *   `node_modules/maplibre-gl/dist/maplibre-gl.css` avec `inject: false` :
 *   Angular l'émet en `maplibre.css` dans le dossier de build mais ne
 *   l'ajoute PAS à `index.html`, donc elle ne pèse JAMAIS sur le paquet
 *   initial — même première charge de page, même sans aucune carte montée.
 *   `chargerFeuilleMaplibre()` (`feuille-maplibre.ts`) la pose ici, à la
 *   demande, la première fois qu'une carte existe — DANS la racine d'ombre qui
 *   porte la carte (Isolation CSS : une feuille du document ne l'atteindrait
 *   pas), dans le `<head>` seulement hors racine — résolue contre
 *   l'application DISTANTE, pas contre le document du shell.
 *   Si elle ne charge pas, `erreur` le dit : une carte sans sa feuille a ses
 *   contrôles et ses popups en vrac, ce n'est pas un état silencieux. Un
 *   `styleUrl` pointant vers cette feuille de 69,5 kB avait été tenté
 *   (fix round 1) mais forçait à ÉLARGIR le budget `anyComponentStyle` — la
 *   protection de TOUS les futurs composants du lot, pas seulement de
 *   celui-ci. Le style global paresseux évite ce compromis : le budget
 *   `anyComponentStyle` reste à ses valeurs d'origine (4 kB / 8 kB).
 */
@Component({
  selector: 'mg-carte',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `h-full w-full` en plus de `inset-0` : `.maplibregl-map` impose `position: relative` (feuille
  // chargée après Tailwind), ce qui annule `inset-0` — la carte gardait 300 px de haut.
  // `<ng-content>` : le mobilier posé PAR LE PARENT (légende, raccourcis, avertissement) se range par-dessus la carte ;
  // il se positionne lui-même (`absolute`), la carte ne connaît ni son contenu ni ses emplacements.
  template: '<div #conteneur class="absolute inset-0 h-full w-full"></div><ng-content />',
  host: { class: 'block relative' },
})
export class CarteComponent {
  readonly fond = input(FOND_POSITRON);
  /**
   * Le cadre initial (et tout recadrage ultérieur). Requis SAUF si `centre` ET `zoomInitial` sont
   * fournis : la carte ne choisit jamais d'elle-même un cadre « France entière ».
   */
  readonly cadre = input<Bbox | null>(null);
  /**
   * Centre et zoom initiaux (lot 4, arbitrage B11) : la carte principale s'ouvre comme React
   * (`useMapInit.ts:131-145`, `[2.3, 46.6]` à z5,5), pas sur une emprise. Fournis ENSEMBLE, ils
   * prennent le pas sur `cadre` à la création ; absents, rien ne change.
   */
  readonly centre = input<[number, number] | null>(null);
  readonly zoomInitial = input<number | null>(null);
  /**
   * Le contrôle de zoom : haut droite sans boussole par défaut (dotation de `CarteRisque.tsx`) ;
   * la carte principale le pose en bas à droite AVEC boussole (`useMapInit.ts:189`, contrôle par défaut).
   */
  readonly navigation = input<{ position: 'top-right' | 'bottom-right'; boussole: boolean }>(
    { position: 'top-right', boussole: false },
  );
  readonly prete = output<maplibregl.Map>();
  readonly deplacee = output<Bbox>();
  /** Le zoom courant, à chaque image de zoom (React : `m.on('zoom', …)`) et une fois à la première pose. */
  readonly zoom = output<number>();
  /** Émise si le FOND lui-même échoue avant le premier `load` — pas les
   *  erreurs de tuile ordinaires qui suivent un chargement réussi —, ou si la
   *  feuille de style MapLibre ne charge pas. */
  readonly erreur = output<string>();

  private readonly conteneur = viewChild.required<ElementRef<HTMLDivElement>>('conteneur');
  private readonly fabrique = inject(FABRIQUE_CARTE);
  private readonly destruction = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly base = inject(BASE_RESSOURCES);
  private readonly instance = signal<maplibregl.Map | null>(null);
  private cadreApplique: Bbox | null = null;

  constructor() {
    // Un `cadre` qui change APRÈS la création recadre la carte, sans animation.
    // La valeur initiale est déjà posée par `bounds` à la création : on la saute.
    effect(() => {
      const cadre = this.cadre();
      const carte = this.instance();
      if (!carte || !cadre || cadre === this.cadreApplique) return;
      this.cadreApplique = cadre;
      carte.fitBounds([...cadre] as [number, number, number, number], { padding: 40, animate: false });
    });
    afterNextRender(() => {
      // Sans `await` : MapLibre peut créer la carte pendant que sa feuille
      // arrive. Une sortie ne s'émet plus après destruction (NG0953).
      // Dans la racine d'ombre qui porte la carte (Isolation CSS) ; dans le document hors racine (specs).
      const racine = this.conteneur().nativeElement.getRootNode();
      // nodeType et non `instanceof` (même règle que `estDocument`, feuilles.ts) :
      // `instanceof` échoue d'un domaine de JavaScript à l'autre. 11 = DOCUMENT_FRAGMENT_NODE.
      const cible = racine.nodeType === 11 ? (racine as ShadowRoot) : this.document;
      chargerFeuilleMaplibre(cible, this.base).catch(() => {
        if (!this.destruction.destroyed) this.erreur.emit("La feuille de style de la carte n'a pas pu être chargée.");
      });
      const element = this.conteneur().nativeElement;
      const centre = this.centre();
      const zoomInitial = this.zoomInitial();
      const cadre = this.cadre();
      let position: Pick<maplibregl.MapOptions, 'center' | 'zoom' | 'bounds' | 'fitBoundsOptions'>;
      if (centre && zoomInitial !== null) position = { center: centre, zoom: zoomInitial };
      else if (cadre) position = { bounds: [...cadre] as [number, number, number, number], fitBoundsOptions: { padding: 40 } };
      else throw new Error('mg-carte : fournir `cadre`, ou `centre` ET `zoomInitial`.');
      const carte = this.fabrique({
        container: element,
        style: this.fond(),
        ...position,
        attributionControl: { compact: true },
      });
      // Par défaut, zoom +/− sans boussole en haut à droite, attribution compacte en bas à droite (`attributionControl`
      // ci-dessus) : la dotation de CarteRisque.tsx. Les contrôles vivent DANS le conteneur, donc dans la racine d'ombre.
      const navigation = this.navigation();
      carte.addControl(new maplibregl.NavigationControl({ showCompass: navigation.boussole }), navigation.position);
      carte.on('zoom', () => this.zoom.emit(carte.getZoom()));
      this.cadreApplique = cadre;
      this.instance.set(carte);
      let chargee = false;
      carte.on('load', () => {
        chargee = true;
        this.zoom.emit(carte.getZoom());
        this.prete.emit(carte);
      });
      carte.on('moveend', () => this.deplacee.emit(bboxDeCarte(carte)));
      // Seul l'échec du STYLE est fatal : un glyphe, un sprite ou une tuile en 404
      // (OpenFreeMap en sert de façon récurrente) laisse une carte qui fonctionne.
      // Ceux-là portent une source/tuile, ou surviennent une fois le style chargé
      // (`getStyle()` ne rend rien tant que le style n'est pas chargé).
      carte.on('error', (e: { sourceId?: string; tile?: unknown }) => {
        if (chargee || e?.sourceId || e?.tile || carte.getStyle()) return;
        this.erreur.emit("Le fond de carte n'a pas pu être chargé.");
      });
      const observateur = new ResizeObserver(() => carte.resize());
      observateur.observe(element);
      this.destruction.onDestroy(() => {
        observateur.disconnect();
        this.instance.set(null);
        carte.remove();
      });
    });
  }
}
