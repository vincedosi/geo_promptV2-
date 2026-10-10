import { DOCUMENT, DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { type Observable, type Subscription, catchError, of } from 'rxjs';
import { type Bbox, bboxDeCarte, bboxEnParametre } from '../../../carte/bbox';
import { FABRIQUE_POPUP, type PopupCarte } from '../../../carte/fabrique-carte';
import { CiviqueApi, type DetailCp } from '../data/civique.api';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import {
  type CodeVariableCivique, OPACITE_CIVIQUE, TRAIT_CIVIQUE, VARIABLES_CIVIQUES,
} from '../logique/palettes-donnees-carte';
import {
  COUCHE_CIVIQUE_FOND, COUCHE_CIVIQUE_TRAIT, SOURCE_CIVIQUE, bboxContenue, contenuPopupCivique, expressionCivique,
} from './couche-civique';
import { messagePoints } from './pois.service';
import { DELAI_DEPLACEMENT_MS } from './radio.service';

/**
 * La choroplèthe « Indicateurs civiques » par code postal — l'état que `app/map/page.tsx` tenait (`civicVariableCode`)
 * et son rendu (`app/map/_components/CivicIndicatorsLayer.tsx`). Une seule variable : l'abstention à la présidentielle
 * 2022.
 *
 * ── UN SEUL DÉGRADÉ ──────────────────────────────────────────────────────
 * `choisir` réclame l'exclusivité AVANT de poser la variable (`PanneauCalques.tsx:302-305`) : IRIS, carreaux ou santé
 * allumés s'éteignent et l'annonce les nomme ; évincée à son tour, la variable retombe à `null`.
 *
 * ── LA CARTE VISIBLE, PAS LE MONDE (CLAUDE.md § Disk I/O) ────────────────
 * React lisait TOUTE la France et les DROM au premier choix (`-180,-90,180,90` : 6 186 polygones, 21,6 Mo de jsonb,
 * 3,9 s de RPC mesurés le 2026-10-10). Ici, la bbox VISIBLE ; un déplacement relit 600 ms après (même attente que la
 * radio), et SEULEMENT si la carte visible sort de la bbox déjà lue — zoomer dans une zone chargée ne coûte rien.
 *
 * ── CONTRAT DU REGISTRE (B11) ────────────────────────────────────────────
 * La donnée lue est gardée : une carte recréée (changement de fond) retrouve source et couches SANS nouvelle requête.
 * Couches au SOMMET (`addLayer` sans `beforeId`), comme React qui les y forçait par `moveLayer`.
 *
 * Écarts à React, défauts corrigés : un échec de lecture est DIT dans la section (React : `console.error`, carte vide
 * muette) ; la commune d'un code postal est lue une fois par écran (cache) ; la popup est construite en DOM et ses
 * couleurs sont des jetons (React : `#f0f0f0`, `#a0a0a0`, `#666`, `#4ecdc4` en dur).
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class IndicateursCiviquesService {
  private readonly etat = inject(EtatCarteService);
  private readonly couches = inject(CouchesCarteService);
  private readonly api = inject(CiviqueApi);
  private readonly fabriquePopup = inject(FABRIQUE_POPUP);
  private readonly document = inject(DOCUMENT);

  private readonly code = signal<CodeVariableCivique | null>(null);
  /** La variable affichée (`civicVariableCode`), `null` : calque éteint. */
  readonly variable = this.code.asReadonly();
  readonly chargement = signal(false);
  readonly erreur = signal<string | null>(null);

  /** La dernière lecture : sa variable, sa bbox, ses polygones — re-posés tels quels sur une carte recréée. */
  private donnees: { code: CodeVariableCivique; bbox: Bbox; fc: GeoJSON.FeatureCollection } | null = null;
  private lecture: Subscription | null = null;
  private lectureDetail: Subscription | null = null;
  private readonly communes = new Map<string, DetailCp | null>();
  private popup: PopupCarte | null = null;

  constructor() {
    this.etat.surEviction('civic-indicateurs', () => this.code.set(null));
    this.couches.inscrireEffacement('civic-indicateurs', () => this.code.set(null));
    inject(DestroyRef).onDestroy(() => {
      this.lecture?.unsubscribe();
      this.lectureDetail?.unsubscribe();
    });

    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      const code = this.code();
      if (!carte) return;
      if (!code) {
        untracked(() => this.eteindre(carte));
        return;
      }
      nettoyer(quandStyleCharge(carte, () => untracked(() => {
        const visible = bboxDeCarte(carte);
        const d = this.donnees;
        if (d && d.code === code && bboxContenue(visible, d.bbox)) this.afficher(carte, d.fc);
        else this.lire(carte, code);
      })));
      let minuterie: ReturnType<typeof setTimeout> | undefined;
      const deplacement = () => {
        clearTimeout(minuterie);
        minuterie = setTimeout(() => {
          const d = this.donnees;
          if (d && d.code === code && bboxContenue(bboxDeCarte(carte), d.bbox)) return;
          this.lire(carte, code);
        }, DELAI_DEPLACEMENT_MS);
      };
      const clic = (e: maplibregl.MapLayerMouseEvent) => this.cliquer(carte, code, e);
      const entree = () => { carte.getCanvas().style.cursor = 'pointer'; };
      const sortie = () => { carte.getCanvas().style.cursor = ''; };
      carte.on('moveend', deplacement);
      carte.on('click', COUCHE_CIVIQUE_FOND, clic);
      carte.on('mousemove', COUCHE_CIVIQUE_FOND, entree);
      carte.on('mouseleave', COUCHE_CIVIQUE_FOND, sortie);
      nettoyer(() => {
        clearTimeout(minuterie);
        carte.off('moveend', deplacement);
        carte.off('click', COUCHE_CIVIQUE_FOND, clic);
        carte.off('mousemove', COUCHE_CIVIQUE_FOND, entree);
        carte.off('mouseleave', COUCHE_CIVIQUE_FOND, sortie);
      });
    });
  }

  /** Le sélecteur « Variable à afficher » et la croix d'« Actifs » : l'exclusivité d'abord, la variable ensuite. */
  choisir(code: CodeVariableCivique | null): void {
    this.etat.basculerDegrade('civic-indicateurs', code !== null);
    this.code.set(code);
  }

  private lire(carte: maplibregl.Map, code: CodeVariableCivique): void {
    this.lecture?.unsubscribe();
    this.erreur.set(null);
    this.chargement.set(true);
    const bbox = bboxDeCarte(carte);
    this.lecture = this.api.geojsonVariable(code, bboxEnParametre(bbox)).subscribe({
      next: (fc) => {
        this.chargement.set(false);
        this.donnees = { code, bbox, fc };
        this.afficher(carte, fc);
      },
      error: (e: unknown) => {
        this.chargement.set(false);
        this.erreur.set(messagePoints(e, 'Délai dépassé — réessayez dans quelques instants'));
      },
    });
  }

  /** Source et couches posées une fois sur l'instance, puis seulement `setData` (`CivicIndicatorsLayer.tsx:220-255`). */
  private afficher(carte: maplibregl.Map, fc: GeoJSON.FeatureCollection): void {
    const code = this.code();
    if (!code) return;
    const source = carte.getSource(SOURCE_CIVIQUE) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(fc);
      return;
    }
    carte.addSource(SOURCE_CIVIQUE, { type: 'geojson', data: fc });
    carte.addLayer({
      id: COUCHE_CIVIQUE_FOND, type: 'fill', source: SOURCE_CIVIQUE,
      paint: {
        'fill-color': expressionCivique(VARIABLES_CIVIQUES[code]) as maplibregl.ExpressionSpecification,
        'fill-opacity': OPACITE_CIVIQUE,
      },
    });
    carte.addLayer({
      id: COUCHE_CIVIQUE_TRAIT, type: 'line', source: SOURCE_CIVIQUE,
      paint: { 'line-color': TRAIT_CIVIQUE.couleur, 'line-width': TRAIT_CIVIQUE.largeur, 'line-opacity': TRAIT_CIVIQUE.opacite },
    });
  }

  /** Désactivation (`cleanup`, `CivicIndicatorsLayer.tsx:180-192`) : popup, couches, source ; la lecture en cours est annulée. */
  private eteindre(carte: maplibregl.Map): void {
    this.lecture?.unsubscribe();
    this.lecture = null;
    this.lectureDetail?.unsubscribe();
    this.chargement.set(false);
    this.erreur.set(null);
    this.popup?.remove();
    this.popup = null;
    for (const c of [COUCHE_CIVIQUE_TRAIT, COUCHE_CIVIQUE_FOND]) if (carte.getLayer(c)) carte.removeLayer(c);
    if (carte.getSource(SOURCE_CIVIQUE)) carte.removeSource(SOURCE_CIVIQUE);
  }

  /** Clic : la commune principale (lue une fois par code postal), puis la popup persistante. */
  private cliquer(carte: maplibregl.Map, code: CodeVariableCivique, e: maplibregl.MapLayerMouseEvent): void {
    const props = e.features?.[0]?.properties as Record<string, unknown> | undefined;
    if (!props) return;
    const cp = String(props['code_postal'] ?? '');
    const valeur = Number(props['value'] ?? NaN);
    if (!Number.isFinite(valeur)) return;
    const inscrits = Number(props['inscrits'] ?? 0);
    const dept = String(props['code_dept'] ?? '');
    const lngLat = e.lngLat;
    const enCache = this.communes.has(cp);
    const detail$: Observable<DetailCp | null> = enCache
      ? of(this.communes.get(cp) ?? null)
      : this.api.detailCp(cp).pipe(catchError(() => of(null)));
    this.lectureDetail?.unsubscribe();
    this.lectureDetail = detail$.subscribe((detail) => {
      if (!enCache) this.communes.set(cp, detail);
      if (this.code() !== code) return;
      this.popup?.remove();
      const doc = carte.getContainer().ownerDocument ?? this.document;
      this.popup = this.fabriquePopup({ closeButton: true, closeOnClick: false, offset: 12, maxWidth: '300px' })
        .setLngLat(lngLat)
        .setDOMContent(contenuPopupCivique({
          cp, dept, valeur, inscrits, commune: detail?.commune_principale ?? '', nbCommunes: detail?.nb_communes ?? 0,
        }, VARIABLES_CIVIQUES[code], doc))
        .addTo(carte);
    });
  }
}
