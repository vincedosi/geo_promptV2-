import { DOCUMENT, DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import type { Subscription } from 'rxjs';
import { bboxDeCarte } from '../../../carte/bbox';
import { FABRIQUE_POPUP, type PopupCarte } from '../../../carte/fabrique-carte';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { type OptionsFiltreRadio, RadioApi } from '../data/radio.api';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { COULEUR_COUVERTURE_DEFAUT } from '../logique/palettes-donnees-carte';
import {
  CADRE_FRANCE, COUCHE_CHALEUR, COUCHE_COMPTE, COUCHE_COUVERTURE_FOND, COUCHE_COUVERTURE_TRAIT, COUCHE_GRAPPES, COUCHE_POINTS,
  JETONS_RADIO, SOURCE_COUVERTURE, SOURCE_EMETTEURS, cerclesCouverture, contenuPopupRadio, couleurChaleur, couleurPoints,
  empriseEmetteurs, montrerRadio, opacitePoints, peindreRadio, peinturesCouverture, poserCouchesRadio,
} from './couche-radio';
import { messagePoints } from './pois.service';

/** L'attente après un déplacement avant de relire les émetteurs de la carte visible (`useRadioLayer.ts:208`). */
export const DELAI_DEPLACEMENT_MS = 600;

/**
 * La couche Radio FM/DAB+ — l'état que `useRadioLayer.ts` tenait (seize `useState`, une annulation, quatre effets) et
 * son rendu (`useMapInit.ts:420-598`).
 *
 * ── TROIS STRATÉGIES DE CHARGEMENT (à ne pas uniformiser, `useRadioLayer.ts:13-20`) ──
 * - une radio choisie : tous ses émetteurs, sans bbox, puis cadrage sur eux ;
 * - couverture : lecture GLOBALE plafonnée à 15 000, sans bbox (un cercle de 54 km déborde de l'écran) ;
 * - grappes / chaleur : la carte VISIBLE, relue 600 ms après un déplacement si la bbox arrondie a changé.
 * Changer de filtre (système, radios, catégories exclues) relit ; la densité, la couleur et les réglettes ne font que
 * repeindre — aucune requête. Les options du filtre sont lues à la PREMIÈRE visibilité, UNE fois par écran.
 *
 * ── CONTRAT DU REGISTRE (B11) ────────────────────────────────────────────
 * Sources et couches posées à la première visibilité, sur l'instance COURANTE, chacune à sa place dans l'ordre de React,
 * et re-posées (avec les émetteurs relus) sur la carte recréée par un changement de fond.
 *
 * Écarts à React, tous des défauts corrigés (rapport T9) :
 * - la radio choisie est peinte en teal : React passait `'var(--brand-teal)'` à `setPaintProperty`, que MapLibre REFUSE —
 *   la sélection ne changeait que l'opacité ;
 * - le clic sur une grappe zoome : React appelait `getClusterExpansionZoom` avec un rappel, que MapLibre 5 ignore (c'est
 *   une promesse) — le clic ne faisait rien ;
 * - un échec de lecture est dit dans la section (React : `if (!res.ok) return`, silence) ;
 * - « Tout effacer » vide aussi les émetteurs gardés : React vidait la source mais gardait son état, et l'en-tête
 *   continuait d'annoncer « N » émetteurs ; il ferme aussi la popup ouverte ;
 * - la bbox lue est retenue : React relisait au PREMIER déplacement même quand la carte n'avait pas bougé.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class RadioService {
  private readonly couches = inject(CouchesCarteService);
  private readonly api = inject(RadioApi);
  private readonly fabriquePopup = inject(FABRIQUE_POPUP);
  private readonly document = inject(DOCUMENT);
  private readonly couleurs = inject(CouleursService).palette(JETONS_RADIO);

  readonly visible = signal(false);
  /** « Densité (heatmap) ». */
  readonly densite = signal(false);
  /** « Zones de couverture ». */
  readonly couverture = signal(false);
  readonly systeme = signal('');
  readonly radioIds = signal<readonly string[]>([]);
  readonly categoriesExclues = signal<readonly string[]>([]);
  /** La radio choisie par la recherche (`radioSelectedId` / `radioSelectedNom`). */
  readonly selection = signal<{ id: string; nom: string } | null>(null);
  /** La couleur de couverture : une DONNÉE de l'utilisateur (B12), passée telle quelle à MapLibre. */
  readonly couleurCouverture = signal(COULEUR_COUVERTURE_DEFAUT);
  /** En pour cent, comme la réglette. */
  readonly opaciteCouverture = signal(15);
  readonly contour = signal(0.5);
  readonly taillePoints = signal(5);
  /** Les options du filtre, `null` tant qu'elles n'ont pas été lues. */
  readonly options = signal<OptionsFiltreRadio | null>(null);
  readonly chargement = signal(false);
  readonly erreur = signal<string | null>(null);

  private readonly emetteurs = signal<GeoJSON.FeatureCollection | null>(null);
  /** « N émetteurs » de l'en-tête (`radioGeoJSON?.features.length ?? 0`). */
  readonly compte = computed(() => this.emetteurs()?.features.length ?? 0);

  private readonly selectionId = computed(() => this.selection()?.id ?? null);
  private readonly posee = signal<maplibregl.Map | null>(null);
  private lecture: Subscription | null = null;
  private lectureOptions: Subscription | null = null;
  private popup: PopupCarte | null = null;
  /** La bbox arrondie de la dernière lecture « carte visible » (garde du déplacement). */
  private derniereBbox = '';

  constructor() {
    this.couches.inscrireEffacement('radio', () => this.effacer());
    inject(DestroyRef).onDestroy(() => {
      this.lecture?.unsubscribe();
      this.lectureOptions?.unsubscribe();
    });

    // Options du filtre : à la première visibilité, une fois (cache avant appel).
    effect(() => {
      if (!this.visible() || this.options() || this.lectureOptions) return;
      untracked(() => {
        this.lectureOptions = this.api.optionsFiltre().subscribe({
          next: (d) => {
            if (!d) return;
            this.options.set({
              categories: Array.isArray(d.categories) ? d.categories : [],
              radios: Array.isArray(d.radios_with_emetteurs) ? d.radios_with_emetteurs : [],
            });
          },
          // Un échec laisse la porte ouverte : la prochaine visibilité relira (comme React).
          error: () => { this.lectureOptions = null; },
        });
      });
    });

    // Pose : sur la carte courante, dès que le calque est visible ; rejouée sur chaque nouvelle instance.
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (!carte) {
        this.posee.set(null);
        return;
      }
      if (!this.visible() || untracked(this.posee) === carte) return;
      nettoyer(quandStyleCharge(carte, () => {
        untracked(() => poserCouchesRadio(carte, this.couleurs(), this.reglages()));
        this.posee.set(carte);
      }));
    });

    // Chargement (`useRadioLayer.ts:186-213`) : à chaque changement de stratégie ou de filtre, puis au déplacement.
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (!carte || !this.visible()) return;
      const selection = this.selectionId();
      const couverture = this.couverture();
      const systeme = this.systeme();
      const radioIds = this.radioIds();
      const categoriesExclues = this.categoriesExclues();
      const lire = () => untracked(() => this.charger(carte, { selection, couverture, systeme, radioIds, categoriesExclues }));
      lire();
      if (selection || couverture) return;
      let minuterie: ReturnType<typeof setTimeout> | undefined;
      const deplacement = () => {
        clearTimeout(minuterie);
        minuterie = setTimeout(() => {
          if (bboxArrondie(carte) === this.derniereBbox) return;
          lire();
        }, DELAI_DEPLACEMENT_MS);
      };
      carte.on('moveend', deplacement);
      nettoyer(() => {
        carte.off('moveend', deplacement);
        clearTimeout(minuterie);
      });
    });

    // Données → source.
    effect(() => {
      const carte = this.posee();
      if (!carte) return;
      const fc = this.emetteurs();
      (carte.getSource(SOURCE_EMETTEURS) as maplibregl.GeoJSONSource | undefined)
        ?.setData(fc ?? { type: 'FeatureCollection', features: [] });
    });

    // Cercles de couverture, calculés côté client.
    effect(() => {
      const carte = this.posee();
      const fc = this.emetteurs();
      if (!carte || !fc || !this.couverture()) return;
      (carte.getSource(SOURCE_COUVERTURE) as maplibregl.GeoJSONSource | undefined)?.setData(cerclesCouverture(fc));
    });

    // Visibilités : grappes OU chaleur, couverture.
    effect(() => {
      const carte = this.posee();
      if (carte) montrerRadio(carte, { visible: this.visible(), densite: this.densite(), couverture: this.couverture() });
    });

    // Couverture : couleur, opacité, contour — des peintures, jamais une requête.
    effect(() => {
      const carte = this.posee();
      if (!carte) return;
      const p = peinturesCouverture({
        couleurCouverture: this.couleurCouverture(), opaciteCouverture: this.opaciteCouverture(), contour: this.contour(),
      });
      for (const [prop, v] of Object.entries(p.fond)) peindreRadio(carte, COUCHE_COUVERTURE_FOND, prop, v);
      for (const [prop, v] of Object.entries(p.trait)) peindreRadio(carte, COUCHE_COUVERTURE_TRAIT, prop, v);
    });

    // Points : radio choisie, taille. La carte AVANT la palette : un jeton n'est lu que si la couche existe.
    effect(() => {
      const carte = this.posee();
      if (!carte) return;
      const sel = this.selectionId();
      const c = this.couleurs();
      peindreRadio(carte, COUCHE_POINTS, 'circle-color', couleurPoints(sel, c.choisie));
      peindreRadio(carte, COUCHE_POINTS, 'circle-opacity', opacitePoints(sel));
      peindreRadio(carte, COUCHE_POINTS, 'circle-radius', this.taillePoints());
    });

    // Couleurs d'interface : repeintes au changement de thème.
    effect(() => {
      const carte = this.posee();
      if (!carte) return;
      const c = this.couleurs();
      peindreRadio(carte, COUCHE_GRAPPES, 'circle-color', c.grappes);
      peindreRadio(carte, COUCHE_GRAPPES, 'circle-stroke-color', c.cernes);
      peindreRadio(carte, COUCHE_COMPTE, 'text-color', c.texteGrappes);
      peindreRadio(carte, COUCHE_POINTS, 'circle-stroke-color', c.cernes);
      const rampe = couleurChaleur(c.grappes);
      if (rampe) peindreRadio(carte, COUCHE_CHALEUR, 'heatmap-color', rampe);
    });

    // Écoutes : popup d'un émetteur, zoom sur une grappe, curseur.
    effect((nettoyer) => {
      const carte = this.posee();
      if (carte) nettoyer(this.ecouter(carte));
    });
  }

  /** « Afficher les émetteurs » / « Émetteurs visibles » (`onToggleRadio`). */
  basculer(): void {
    this.visible.update((v) => !v);
  }

  /** Une radio de l'autocomplétion : choisie, et le calque s'allume (`page.tsx:1000`). */
  choisirRadio(id: string, nom: string): void {
    this.selection.set({ id, nom });
    this.visible.set(true);
  }

  /** La croix du bandeau de la radio choisie. */
  oublierSelection(): void {
    this.selection.set(null);
  }

  /** « Recentrer France » (`page.tsx:1017`). */
  recentrerFrance(): void {
    this.couches.carteCourante()?.fitBounds(CADRE_FRANCE, { padding: 20, duration: 1000 });
  }

  private reglages() {
    return {
      visible: this.visible(), densite: this.densite(), couverture: this.couverture(),
      couleurCouverture: this.couleurCouverture(), opaciteCouverture: this.opaciteCouverture(), contour: this.contour(),
      taillePoints: this.taillePoints(), selectionId: this.selectionId(),
    };
  }

  private charger(
    carte: maplibregl.Map,
    f: { selection: string | null; couverture: boolean; systeme: string; radioIds: readonly string[]; categoriesExclues: readonly string[] },
  ): void {
    this.lecture?.unsubscribe();
    this.erreur.set(null);
    this.chargement.set(true);
    const bbox = bboxDeCarte(carte);
    if (!f.selection && !f.couverture) this.derniereBbox = bboxArrondie(carte);
    this.lecture = this.api.emetteurs({
      radioId: f.selection, couverture: f.couverture, bbox, systeme: f.systeme, radioIds: f.radioIds,
      categoriesExclues: f.categoriesExclues,
    }).subscribe({
      next: (fc) => {
        this.chargement.set(false);
        this.emetteurs.set(fc);
        if (f.selection && fc.features.length > 0) {
          const cadre = empriseEmetteurs(fc);
          if (cadre) carte.fitBounds(cadre, { padding: 40, duration: 1000 });
        }
      },
      error: (e: unknown) => {
        this.chargement.set(false);
        this.erreur.set(messagePoints(e, 'Délai dépassé — réessayez dans quelques instants'));
      },
    });
  }

  /** « Tout effacer » (`page.tsx:693,744-748`). Les filtres et réglages restent, comme React. */
  private effacer(): void {
    this.lecture?.unsubscribe();
    this.chargement.set(false);
    this.erreur.set(null);
    this.visible.set(false);
    this.densite.set(false);
    this.couverture.set(false);
    this.selection.set(null);
    this.emetteurs.set(null);
    const carte = this.posee();
    (carte?.getSource(SOURCE_COUVERTURE) as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
    this.popup?.remove();
    this.popup = null;
  }

  private ecouter(carte: maplibregl.Map): () => void {
    type Evt = maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] };
    const clicPoint = (e: Evt) => {
      const props = e.features?.[0]?.properties as Record<string, unknown> | undefined;
      if (!props) return;
      const doc = carte.getContainer().ownerDocument ?? this.document;
      this.popup = this.fabriquePopup({ closeButton: true, maxWidth: '280px' })
        .setLngLat(e.lngLat).setDOMContent(contenuPopupRadio(props, doc)).addTo(carte);
    };
    // MapLibre 5 : `getClusterExpansionZoom` rend une PROMESSE — le rappel de React n'était jamais appelé.
    const clicGrappe = (e: Evt) => {
      const id = e.features?.[0]?.properties?.['cluster_id'];
      const source = carte.getSource(SOURCE_EMETTEURS) as maplibregl.GeoJSONSource | undefined;
      if (!source || id === undefined) return;
      source.getClusterExpansionZoom(id).then((zoom) => carte.easeTo({ center: e.lngLat, zoom: zoom + 1 })).catch(() => undefined);
    };
    const entree = () => { carte.getCanvas().style.cursor = 'pointer'; };
    const sortie = () => { carte.getCanvas().style.cursor = ''; };
    carte.on('click', COUCHE_POINTS, clicPoint);
    carte.on('click', COUCHE_GRAPPES, clicGrappe);
    for (const c of [COUCHE_POINTS, COUCHE_GRAPPES]) {
      carte.on('mouseenter', c, entree);
      carte.on('mouseleave', c, sortie);
    }
    return () => {
      carte.off('click', COUCHE_POINTS, clicPoint);
      carte.off('click', COUCHE_GRAPPES, clicGrappe);
      for (const c of [COUCHE_POINTS, COUCHE_GRAPPES]) {
        carte.off('mouseenter', c, entree);
        carte.off('mouseleave', c, sortie);
      }
    };
  }
}

/** La bbox à 2 décimales, garde du rechargement au déplacement (`useRadioLayer.ts:203-205`). */
function bboxArrondie(carte: Pick<maplibregl.Map, 'getBounds'>): string {
  return bboxDeCarte(carte).map((v) => v.toFixed(2)).join(',');
}
