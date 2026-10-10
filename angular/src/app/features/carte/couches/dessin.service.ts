import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { PileEchapService } from '../etat/pile-echap.service';
import {
  type ModeDessin, type Position, apercuTrace, cliquer, doubleCliquer, messageAideDessin, nombreSommets, retirerDernier,
  traceVide,
} from '../logique/zones/dessin';

export const SOURCE_DESSIN = 'dessin-trace';
export const COUCHES_DESSIN = ['dessin-trace-fill', 'dessin-trace-line', 'dessin-trace-point'] as const;
const [REMPLISSAGE, LIGNE, POINTS] = COUCHES_DESSIN;
/** L'identifiant sous lequel le dessin PREND la carte (`EtatCarteService.prendreCarte`). */
const OUTIL = 'dessin';
/** L'entrée de la pile Échap tant qu'un tracé est en cours : Échap l'annule, le suivant ferme le panneau. */
const ECHAP_TRACE = 'dessin-trace';

type CarteDessin = Pick<maplibregl.Map,
  'getSource' | 'addSource' | 'getLayer' | 'addLayer' | 'removeLayer' | 'removeSource' | 'setPaintProperty'>;

/**
 * Le tracé libre d'une zone, ÉCRIT À LA MAIN sur MapLibre (lot 4, T16) — ce que `DessinLibre.tsx` confiait à
 * `terra-draw` (arbitrage B8 du propriétaire : aucune nouvelle dépendance). Les gestes sont dans
 * `logique/zones/dessin.ts` ; ce service ne fait que brancher les événements de la carte et peindre.
 *
 * ── CE QUE LE DESSIN PREND À LA CARTE, ET REND ───────────────────────────
 * - le zoom au double-clic, tant que l'outil est actif : le double-clic FERME le polygone ;
 * - le déplacement à la souris, pendant un tracé EN COURS seulement (un glisser ne fait pas de clic, mais un tracé
 *   qui glisse sous le pointeur entre deux sommets se pose mal) ; rendu dès que le tracé est fermé ou effacé ;
 * - le curseur (viseur), et les clics : `EtatCarteService.prendreCarte` empêche qu'un clic de sommet ferme le
 *   panneau Zones — React le fermait, et l'outil disparaissait au premier sommet.
 * `Backspace` est écouté sur le CONTENEUR de la carte (le canevas y fait remonter ses frappes), jamais sur `window` ni
 * `document` du shell (B10) ; elle n'est consommée que s'il y a un sommet à retirer.
 *
 * Re-posé sur une carte recréée par un changement de fond (B11), teal repeint au changement de thème (`CouleursService`,
 * jamais `var()` dans `paint`). « Tout effacer » efface le tracé et laisse l'outil ouvert.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class DessinService {
  private readonly couches = inject(CouchesCarteService);
  private readonly etat = inject(EtatCarteService);
  private readonly pile = inject(PileEchapService);
  private readonly couleurs = inject(CouleursService).palette({ teal: 'brand-teal' });

  private readonly actif = signal(false);
  private readonly trace = signal(traceVide('polygone'));
  private readonly curseur = signal<Position | null>(null);

  readonly mode = computed(() => this.trace().mode);
  readonly nombreSommets = computed(() => nombreSommets(this.trace()));
  /** Le tracé FERMÉ, tel qu'il partira à `/source/dessin` ; `null` tant qu'il ne l'est pas. */
  readonly traceFerme = computed(() => this.trace().ferme);
  readonly aide = computed(() => messageAideDessin(this.mode(), this.nombreSommets()));
  private readonly enCours = computed(() => !this.trace().ferme && this.trace().sommets.length > 0);
  private readonly apercu = computed(() => apercuTrace(this.trace(), this.curseur()));

  /** L'instance où la source est posée. */
  private readonly posee = signal<maplibregl.Map | null>(null);

  constructor() {
    this.couches.inscrireEffacement('dessin', () => this.effacer());

    // Pose et retrait : la couche n'existe que pendant que l'outil est ouvert.
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (!carte || !this.actif()) {
        this.posee.set(null);
        return;
      }
      const ecoute = this.brancher(carte);
      const attente = quandStyleCharge(carte, () => {
        untracked(() => poserDessin(carte, this.couleurs().teal));
        this.posee.set(carte);
      });
      nettoyer(() => {
        attente();
        ecoute();
        retirerDessin(carte);
      });
    });

    effect(() => {
      const carte = this.posee();
      const apercu = this.apercu();
      (carte?.getSource(SOURCE_DESSIN) as maplibregl.GeoJSONSource | undefined)?.setData(apercu);
    });
    effect(() => {
      const carte = this.posee();
      if (!carte) return;
      const teal = this.couleurs().teal;
      carte.setPaintProperty(REMPLISSAGE, 'fill-color', teal);
      carte.setPaintProperty(LIGNE, 'line-color', teal);
      carte.setPaintProperty(POINTS, 'circle-color', teal);
    });
    // Échap annule le tracé EN COURS (revue 1) : l'entrée n'est dans la pile que pendant un tracé, au-dessus du panneau.
    effect(() => {
      if (this.enCours()) this.pile.empiler(ECHAP_TRACE, () => this.effacer());
      else this.pile.depiler(ECHAP_TRACE);
    });
    // dragPan coupé pendant un tracé en cours, rendu à la fin.
    effect(() => {
      const carte = this.posee();
      if (!carte) return;
      if (this.enCours()) carte.dragPan.disable();
      else carte.dragPan.enable();
    });
  }

  /** Ouvre l'outil (« Dessiner une zone »), en mode polygone. */
  demarrer(): void {
    this.trace.set(traceVide(this.mode()));
    this.actif.set(true);
    this.etat.prendreCarte(OUTIL);
  }

  /** Ferme l'outil : tracé perdu, couches retirées, carte rendue (« Quitter le dessin », panneau fermé). */
  arreter(): void {
    this.actif.set(false);
    this.trace.set(traceVide('polygone'));
    this.curseur.set(null);
    this.etat.rendreCarte(OUTIL);
    this.pile.depiler(ECHAP_TRACE);
  }

  /** Changer de mode repart d'un tracé vide. */
  choisirMode(mode: ModeDessin): void {
    this.trace.set(traceVide(mode));
  }

  effacer(): void {
    this.trace.set(traceVide(this.mode()));
  }

  /** Les écoutes du tracé sur une instance ; rend de quoi tout défaire. */
  private brancher(carte: maplibregl.Map): () => void {
    const projeter = (p: Position) => carte.project(p);
    const position = (e: maplibregl.MapMouseEvent): Position => [e.lngLat.lng, e.lngLat.lat];
    // Un seul outil reçoit les clics : si la pose d'un rayon a repris la carte, le dessin les laisse passer.
    const aLaMain = () => this.etat.outilCarte() === OUTIL;
    const clic = (e: maplibregl.MapMouseEvent) => {
      if (aLaMain()) this.trace.update((t) => cliquer(t, position(e), e.point, projeter));
    };
    const double = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      if (aLaMain()) this.trace.update(doubleCliquer);
    };
    const survol = (e: maplibregl.MapMouseEvent) => {
      if (untracked(this.enCours)) this.curseur.set(position(e));
    };
    const touche = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' || !untracked(this.enCours)) return;
      e.preventDefault();
      this.trace.update(retirerDernier);
    };
    const conteneur = carte.getContainer();
    carte.on('click', clic);
    carte.on('dblclick', double);
    carte.on('mousemove', survol);
    conteneur.addEventListener('keydown', touche);
    carte.doubleClickZoom.disable();
    const canevas = carte.getCanvas();
    canevas.style.cursor = 'crosshair';
    return () => {
      carte.off('click', clic);
      carte.off('dblclick', double);
      carte.off('mousemove', survol);
      conteneur.removeEventListener('keydown', touche);
      carte.doubleClickZoom.enable();
      carte.dragPan.enable();
      // Le viseur reste si un autre outil tient encore la carte.
      if (!this.etat.carteOccupee()) canevas.style.cursor = '';
    };
  }
}

/** Source et couches du tracé, idempotentes ; la donnée arrive ensuite par `setData`. */
function poserDessin(carte: CarteDessin, teal: string): void {
  if (!carte.getSource(SOURCE_DESSIN)) {
    carte.addSource(SOURCE_DESSIN, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  if (!carte.getLayer(REMPLISSAGE)) {
    carte.addLayer({
      id: REMPLISSAGE, type: 'fill', source: SOURCE_DESSIN, filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': teal, 'fill-opacity': 0.12 },
    });
  }
  if (!carte.getLayer(LIGNE)) {
    carte.addLayer({
      id: LIGNE, type: 'line', source: SOURCE_DESSIN, filter: ['!=', ['geometry-type'], 'Point'],
      paint: { 'line-color': teal, 'line-width': 2 },
    });
  }
  if (!carte.getLayer(POINTS)) {
    carte.addLayer({
      id: POINTS, type: 'circle', source: SOURCE_DESSIN, filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-color': teal, 'circle-radius': 4 },
    });
  }
}

/** Retire couches puis source (une source encore utilisée ne se retire pas) ; une carte déjà détruite est ignorée. */
function retirerDessin(carte: CarteDessin): void {
  try {
    for (const id of [...COUCHES_DESSIN].reverse()) if (carte.getLayer(id)) carte.removeLayer(id);
    if (carte.getSource(SOURCE_DESSIN)) carte.removeSource(SOURCE_DESSIN);
  } catch {
    // La carte a été recréée (changement de fond) : ses couches sont parties avec elle.
  }
}
