import { HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT, DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { Subscription, map } from 'rxjs';
import { FABRIQUE_POPUP, type PopupCarte } from '../../../carte/fabrique-carte';
import { MeteoApi } from '../data/meteo.api';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { ZonesMeteoService } from '../etat/zones-meteo.service';
import { bboxPourRequete } from '../logique/bbox-requete';
import { avantDe } from '../logique/ordre-couches';
import { buildColorExpression } from '../logique/meteo/palettes';
import {
  METEO_LABEL, type MeteoParams, type MeteoScale, type MeteoZoneChunk, type MeteoZoneMeta, type MeteoZoneValue,
} from '../logique/meteo/types';
import { OPACITE_METEO, TRAIT_METEO } from '../logique/palettes-donnees-carte';

export const SOURCE_METEO = 'meteo-source';
export const COUCHE_METEO_FOND = 'meteo-fill';
export const COUCHE_METEO_TRAIT = 'meteo-outline';

/** La progression du flux (`MeteoProgress`, `use-meteo-data.ts:209-213`). */
export interface ProgressionMeteo {
  current: number;
  total: number;
  etaMs?: number;
}

/** Ce qu'une lecture réussie affiche : les valeurs, leurs métadonnées et les polygones de LEUR échelle, ensemble. */
interface Affichage {
  donnees: Record<string, MeteoZoneValue>;
  meta: MeteoZoneMeta;
  zones: GeoJSON.FeatureCollection;
}

type CarteMeteo = Pick<maplibregl.Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer' | 'setLayoutProperty' | 'setPaintProperty'>;

/**
 * La couche « Météo » de la carte principale — l'état et les effets de `app/map/_hooks/useMeteoLayer.ts` et de
 * `lib/meteo/use-meteo-data.ts`, la modale de `page.tsx:1456-1488` (ouverte / fermée ici, rendue par
 * `mg-dialogue-meteo`) et la couche `meteo-source` / `meteo-fill` / `meteo-outline` de `useMapInit.ts:362-383`.
 *
 * ── APPLIQUER (`handleMeteoApply`, `useMeteoLayer.ts:220-253`) ───────────
 * Les polygones de l'échelle (`ZonesMeteoService`, une lecture par échelle et par écran, partagée avec la santé
 * environnementale) et le flux NDJSON d'Open-Meteo partent ENSEMBLE ; la conclusion attend les deux. Réussite : la
 * couche s'affiche, la météo réclame l'exclusivité des dégradés (`onDegrade('meteo', true)`, qui évince le précédent
 * avec son annonce) et le dialogue se ferme. Échec : le dialogue reste ouvert et dit pourquoi ; les valeurs déjà
 * affichées sont vidées (`use-meteo-data.ts:282-287`). Ré-appliquer annule la lecture en cours (l'`abort` de React).
 * Fermer le dialogue pendant le chargement n'annule rien : la lecture conclut quand même, comme React.
 *
 * ── BBOX ─────────────────────────────────────────────────────────────────
 * Au code postal SEULEMENT : celle du filtre géographique s'il y en a un (`bboxPourRequete`), sinon la carte VISIBLE
 * — la règle EXACTE de React (`useMeteoLayer.ts:231-241`, round 1 du 2026-09-12 : jamais `BBOX_METRO`, qui masquait
 * l'outre-mer), et la promesse du dialogue (« Les CP de la vue carte sont interrogés »). Trois décimales, comme React ;
 * la route l'arrondit au demi-degré vers l'extérieur. Au département et à la région, aucune bbox.
 *
 * ── QUOTA ────────────────────────────────────────────────────────────────
 * Rien ne relit au déplacement de la carte : un appel par « Appliquer », jamais plus (`geo:rl:meteo-geo`, 20/min).
 *
 * ── LA COUCHE (B11) ──────────────────────────────────────────────────────
 * Posée à la PREMIÈRE donnée, à sa place dans l'ordre de React (`avantDe` : sous le flux routier), re-posée avec ses
 * valeurs sur une carte recréée par un changement de fond, sans relire. Teintes : `METEO_PALETTES` (B12, données, les
 * mêmes dans les deux thèmes) — aucune repeinture au thème n'est donc nécessaire.
 *
 * Écarts à React, défauts corrigés : une erreur HTTP dit le message de la route (« HTTP 429 Trop de requêtes… ») au
 * lieu de son JSON brut ; valeurs, métadonnées et polygones sont publiés ENSEMBLE à la conclusion (React pouvait
 * peindre un instant les valeurs d'une échelle sur les polygones de l'autre).
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class MeteoService {
  private readonly etat = inject(EtatCarteService);
  private readonly couches = inject(CouchesCarteService);
  private readonly api = inject(MeteoApi);
  private readonly zonesMeteo = inject(ZonesMeteoService);
  private readonly fabriquePopup = inject(FABRIQUE_POPUP);
  private readonly document = inject(DOCUMENT);

  /** La couche est affichée (`meteoVisible`). */
  readonly visible = signal(false);
  /** Le dialogue de configuration (`meteoPanelOpen`). */
  readonly dialogueOuvert = signal(false);
  readonly chargement = signal(false);
  readonly progression = signal<ProgressionMeteo | null>(null);
  readonly erreur = signal<string | null>(null);
  private readonly affichage = signal<Affichage | null>(null);
  /** Les métadonnées de la couche affichée (`meteo.meta`) : la variable, les statistiques de la période. */
  readonly meta = computed(() => this.affichage()?.meta ?? null);
  /** « Température », « Précipitations »… (`METEO_LABEL[meteo.meta.variable]`), `null` sans couche. */
  readonly libelle = computed(() => {
    const m = this.meta();
    return m ? METEO_LABEL[m.variable] : null;
  });

  /** L'instance où la couche est POSÉE. */
  private readonly posee = signal<maplibregl.Map | null>(null);
  private lecture: Subscription | null = null;
  private popup: PopupCarte | null = null;

  constructor() {
    // `onDegrade` : `if (eteint === 'meteo') handleMeteoClear()` (`page.tsx:531`) ; « Tout effacer » (`page.tsx:736`).
    this.etat.surEviction('meteo', () => this.effacer());
    this.couches.inscrireEffacement('meteo', () => this.effacer());
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());

    // Pose : dès qu'il y a quelque chose à montrer, sur l'instance courante — et de nouveau sur une carte recréée.
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (!carte) {
        this.posee.set(null);
        return;
      }
      const a = this.affichage();
      if (!a || untracked(this.posee) === carte) return;
      nettoyer(quandStyleCharge(carte, () => {
        poserCoucheMeteo(carte, expressionMeteo(a.meta));
        this.posee.set(carte);
      }));
    });

    // Synchronisation de la source (`useMeteoLayer.ts:129-169`) : valeurs, teintes de la variable, visibilité.
    effect(() => {
      const carte = this.posee();
      if (!carte) return;
      const a = this.affichage();
      const visible = this.visible();
      untracked(() => synchroniser(carte, a, visible));
    });

    // Popup au clic, curseur au survol (`useMeteoLayer.ts:171-205`).
    effect((nettoyer) => {
      const carte = this.posee();
      if (!carte) return;
      const clic = (e: maplibregl.MapLayerMouseEvent) => this.cliquer(carte, e);
      const entrer = () => { carte.getCanvas().style.cursor = 'pointer'; };
      const sortir = () => { carte.getCanvas().style.cursor = ''; };
      carte.on('click', COUCHE_METEO_FOND, clic);
      carte.on('mouseenter', COUCHE_METEO_FOND, entrer);
      carte.on('mouseleave', COUCHE_METEO_FOND, sortir);
      nettoyer(() => {
        carte.off('click', COUCHE_METEO_FOND, clic);
        carte.off('mouseenter', COUCHE_METEO_FOND, entrer);
        carte.off('mouseleave', COUCHE_METEO_FOND, sortir);
      });
    });
  }

  /** « Configurer la météo » / « Modifier la météo ». */
  ouvrirDialogue(): void {
    this.dialogueOuvert.set(true);
  }

  /** La croix, le voile, Échap. */
  fermerDialogue(): void {
    this.dialogueOuvert.set(false);
  }

  /** « Appliquer » du dialogue (`handleMeteoApply` puis `onDegrade('meteo', true)`, `page.tsx:1468-1478`). */
  appliquer(params: MeteoParams): void {
    // Granularité choisie ; à défaut, l'heuristique de React par durée (`useMeteoLayer.ts:223-224`).
    const jours = (new Date(params.endDate).getTime() - new Date(params.startDate).getTime()) / 86400000;
    const echelle: MeteoScale = params.scale ?? (jours > 30 ? 'region' : 'departement');
    const bbox = echelle === 'cp' ? this.bboxCp() : undefined;

    this.lecture?.unsubscribe();
    this.chargement.set(true);
    this.progression.set(null);
    this.erreur.set(null);

    let zones: GeoJSON.FeatureCollection | null = null;
    let zonesLues = false;
    let resultat: { donnees: Record<string, MeteoZoneValue>; meta: MeteoZoneMeta } | null = null;
    let fluxReussi: boolean | null = null;
    const conclure = () => {
      if (!zonesLues || fluxReussi === null || !fluxReussi) return;
      // Un flux terminé sans ligne `done` garde l'affichage précédent, comme React (`setData` jamais appelé).
      if (resultat && zones) this.affichage.set({ ...resultat, zones });
      this.visible.set(true);
      this.etat.basculerDegrade('meteo', true);
      this.dialogueOuvert.set(false);
    };

    const lecture = new Subscription();
    this.lecture = lecture;
    lecture.add(this.zonesMeteo.zones(echelle).subscribe({
      next: (z) => { zones = z; },
      // Polygones introuvables : React n'affichait rien (`if (!res.ok) return`), sans le dire non plus.
      error: () => { zonesLues = true; conclure(); },
      complete: () => { zonesLues = true; conclure(); },
    }));
    lecture.add(this.api.donnees(echelle, { ...params, bbox }).pipe(
      map((ligne: MeteoZoneChunk) => {
        if (ligne.status === 'error') throw new Error(ligne.error);
        return ligne;
      }),
    ).subscribe({
      next: (ligne) => {
        if (ligne.status === 'fetching') {
          this.progression.set({ current: ligne.progress, total: ligne.total, etaMs: ligne.etaMs });
        } else if (ligne.status === 'done') {
          resultat = { donnees: ligne.data, meta: ligne.meta };
          this.progression.set(null);
        }
      },
      error: (e: unknown) => {
        this.chargement.set(false);
        this.progression.set(null);
        this.erreur.set(messageErreur(e));
        this.affichage.set(null);
        fluxReussi = false;
      },
      complete: () => {
        this.chargement.set(false);
        this.progression.set(null);
        fluxReussi = true;
        conclure();
      },
    }));
  }

  /** « Masquer » de la section et la croix d'« Actifs » (`onDegrade('meteo', false); handleMeteoClear()`). */
  masquer(): void {
    this.etat.basculerDegrade('meteo', false);
    this.effacer();
  }

  /** `handleMeteoClear` (`useMeteoLayer.ts:255-258`) : annule, vide, masque. */
  private effacer(): void {
    this.lecture?.unsubscribe();
    this.lecture = null;
    this.affichage.set(null);
    this.chargement.set(false);
    this.progression.set(null);
    this.erreur.set(null);
    this.visible.set(false);
    this.popup?.remove();
    this.popup = null;
  }

  /** La bbox du filtre s'il y en a un, sinon la carte visible — trois décimales (`useMeteoLayer.ts:231-241`). */
  private bboxCp(): string | undefined {
    const filtre = bboxPourRequete(this.etat.filtre());
    if (filtre) return filtre.map((v) => v.toFixed(3)).join(',');
    const b = this.couches.carteCourante()?.getBounds();
    return b ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(3)).join(',') : undefined;
  }

  private cliquer(carte: maplibregl.Map, e: maplibregl.MapLayerMouseEvent): void {
    const f = e.features?.[0];
    if (!f) return;
    const doc = carte.getContainer().ownerDocument ?? this.document;
    this.popup?.remove();
    this.popup = this.fabriquePopup({ closeButton: false, maxWidth: '240px' })
      .setLngLat(e.lngLat)
      .setDOMContent(contenuPopupMeteo(f.properties ?? {}, doc))
      .addTo(carte);
  }
}

/** `HTTP <statut> <message de la route>` ; le message d'une ligne `error` ; sinon « Erreur inconnue ». */
function messageErreur(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    const texte = typeof e.error === 'string' ? e.error : '';
    let message = texte;
    try {
      const corps = JSON.parse(texte) as { error?: unknown };
      if (typeof corps.error === 'string') message = corps.error;
    } catch { /* corps non JSON : gardé tel quel, comme React */ }
    return `HTTP ${e.status} ${message}`.trim();
  }
  return e instanceof Error ? e.message : 'Erreur inconnue';
}

/** La rampe de la variable sur `weather_value` (`buildColorExpression`, B12). */
function expressionMeteo(meta: MeteoZoneMeta): unknown[] {
  return buildColorExpression(meta.variable, meta.stats, 'weather_value');
}

/**
 * La source vide et ses deux couches masquées (`useMapInit.ts:364-383`), IDEMPOTENT, à leur place (`avantDe`). L'aplat
 * naît avec la rampe de la variable affichée : le `#4ecdc4` de React n'était qu'une valeur de départ, aussitôt remplacée.
 */
export function poserCoucheMeteo(carte: CarteMeteo, teinte: unknown[]): void {
  if (!carte.getSource(SOURCE_METEO)) {
    carte.addSource(SOURCE_METEO, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  if (!carte.getLayer(COUCHE_METEO_FOND)) {
    carte.addLayer({
      id: COUCHE_METEO_FOND, type: 'fill', source: SOURCE_METEO,
      paint: { 'fill-color': teinte, 'fill-opacity': OPACITE_METEO },
      layout: { visibility: 'none' },
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_METEO_FOND));
  }
  if (!carte.getLayer(COUCHE_METEO_TRAIT)) {
    carte.addLayer({
      id: COUCHE_METEO_TRAIT, type: 'line', source: SOURCE_METEO,
      paint: { 'line-color': TRAIT_METEO.couleur, 'line-width': TRAIT_METEO.largeur },
      layout: { visibility: 'none' },
    } as maplibregl.LayerSpecification, avantDe(carte, COUCHE_METEO_TRAIT));
  }
}

/** `useMeteoLayer.ts:129-169` : seules les zones qui ont une valeur, la rampe de la variable, la visibilité. */
function synchroniser(carte: CarteMeteo, a: Affichage | null, visible: boolean): void {
  const source = carte.getSource(SOURCE_METEO) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  const montrer = (v: boolean) => {
    for (const c of [COUCHE_METEO_FOND, COUCHE_METEO_TRAIT]) {
      if (carte.getLayer(c)) carte.setLayoutProperty(c, 'visibility', v ? 'visible' : 'none');
    }
  };
  if (!a) {
    source.setData({ type: 'FeatureCollection', features: [] });
    montrer(false);
    return;
  }
  const features: GeoJSON.Feature[] = [];
  for (const f of a.zones.features) {
    const v = a.donnees[String(f.properties?.['code'] ?? '')];
    if (!v) continue;
    features.push({ ...f, properties: { ...f.properties, weather_value: v.value, label: v.label, unit: v.unit } });
  }
  source.setData({ type: 'FeatureCollection', features });
  if (carte.getLayer(COUCHE_METEO_FOND)) {
    carte.setPaintProperty(COUCHE_METEO_FOND, 'fill-color', expressionMeteo(a.meta));
  }
  montrer(visible);
}

/** Nom, valeur (`fr-FR`, une décimale au plus) et unité, libellé qualitatif (`useMeteoLayer.ts:181-191`), en DOM. */
export function contenuPopupMeteo(p: Record<string, unknown>, doc: Document): HTMLElement {
  const racine = doc.createElement('div');
  racine.setAttribute('data-popup-meteo', '');
  Object.assign(racine.style, { fontFamily: 'Inter, sans-serif', fontSize: '12px', color: 'var(--text-primary)' });
  const nom = doc.createElement('div');
  nom.textContent = p['nom'] != null ? String(p['nom']) : '';
  Object.assign(nom.style, { fontWeight: '500', marginBottom: '2px' });
  racine.append(nom);
  const valeur = p['weather_value'] != null ? Number(p['weather_value']) : null;
  if (valeur != null) {
    const ligne = doc.createElement('div');
    ligne.textContent = `${valeur.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ${p['unit'] != null ? String(p['unit']) : ''}`;
    Object.assign(ligne.style, { fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-secondary)' });
    racine.append(ligne);
  }
  if (p['label']) {
    const libelle = doc.createElement('div');
    libelle.textContent = String(p['label']);
    Object.assign(libelle.style, { fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' });
    racine.append(libelle);
  }
  return racine;
}
