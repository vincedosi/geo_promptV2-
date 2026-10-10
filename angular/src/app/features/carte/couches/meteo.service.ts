import { DOCUMENT, DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { Subscription, map } from 'rxjs';
import { FABRIQUE_POPUP, type PopupCarte } from '../../../carte/fabrique-carte';
import { MeteoApi } from '../data/meteo.api';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { ContoursZonesService } from '../etat/contours-zones.service';
import { bboxPourRequete } from '../logique/bbox-requete';
import {
  METEO_LABEL, type MeteoParams, type MeteoScale, type MeteoZoneChunk, type MeteoZoneMeta, type MeteoZoneValue,
} from '../logique/meteo/types';
import {
  type AffichageMeteo, COUCHE_METEO_FOND, MESSAGE_CONTOURS_INDISPONIBLES, contenuPopupMeteo, expressionMeteo,
  messageErreurMeteo, poserCoucheMeteo, synchroniserCoucheMeteo,
} from './couche-meteo';

/** La progression du flux (`MeteoProgress`, `use-meteo-data.ts:209-213`). */
export interface ProgressionMeteo {
  current: number;
  total: number;
  etaMs?: number;
}

/**
 * La couche « Météo » de la carte principale — l'état et les effets de `app/map/_hooks/useMeteoLayer.ts` et de
 * `lib/meteo/use-meteo-data.ts`, la modale de `page.tsx:1456-1488` (ouverte / fermée ici, rendue par
 * `mg-dialogue-meteo`) et la couche `meteo-source` / `meteo-fill` / `meteo-outline` de `useMapInit.ts:362-383`.
 *
 * ── APPLIQUER (`handleMeteoApply`, `useMeteoLayer.ts:137-170`) ───────────
 * Les polygones de l'échelle (`ContoursZonesService`, une lecture par échelle et par écran, partagée avec la santé
 * environnementale) et le flux NDJSON d'Open-Meteo partent ENSEMBLE ; la conclusion attend les deux. Réussite : la
 * couche s'affiche, la météo réclame l'exclusivité des dégradés (`onDegrade('meteo', true)`, qui évince le précédent
 * avec son annonce) et le dialogue se ferme. Échec : le dialogue reste ouvert et dit pourquoi ; les valeurs déjà
 * affichées sont vidées (`use-meteo-data.ts:88-93`). Ré-appliquer annule la lecture en cours (l'`abort` de React).
 * Fermer le dialogue pendant le chargement n'annule rien : la lecture conclut quand même, comme React.
 *
 * ── BBOX ─────────────────────────────────────────────────────────────────
 * Au code postal SEULEMENT : celle du filtre géographique s'il y en a un (`bboxPourRequete`), sinon la carte VISIBLE
 * — la règle EXACTE de React (`useMeteoLayer.ts:148-158`, round 1 du 2026-09-12 : jamais `BBOX_METRO`, qui masquait
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
 * lieu de son JSON brut (statut 0 : le message commun de l'application) ; un échec des CONTOURS est dit
 * aussi (React concluait en réussite, dégradé réclamé et dialogue fermé, sans rien peindre) ; valeurs, métadonnées et polygones sont publiés ENSEMBLE à la conclusion (React pouvait
 * peindre un instant les valeurs d'une échelle sur les polygones de l'autre).
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class MeteoService {
  private readonly etat = inject(EtatCarteService);
  private readonly couches = inject(CouchesCarteService);
  private readonly api = inject(MeteoApi);
  private readonly contours = inject(ContoursZonesService);
  private readonly fabriquePopup = inject(FABRIQUE_POPUP);
  private readonly document = inject(DOCUMENT);

  /** La couche est affichée (`meteoVisible`). */
  readonly visible = signal(false);
  /** Le dialogue de configuration (`meteoPanelOpen`). */
  readonly dialogueOuvert = signal(false);
  readonly chargement = signal(false);
  readonly progression = signal<ProgressionMeteo | null>(null);
  readonly erreur = signal<string | null>(null);
  private readonly affichage = signal<AffichageMeteo | null>(null);
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

    // Synchronisation de la source (`useMeteoLayer.ts:46-86`) : valeurs, teintes de la variable, visibilité.
    effect(() => {
      const carte = this.posee();
      if (!carte) return;
      const a = this.affichage();
      const visible = this.visible();
      untracked(() => synchroniserCoucheMeteo(carte, a, visible));
    });

    // Popup au clic, curseur au survol (`useMeteoLayer.ts:88-122`).
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
    // Granularité choisie ; à défaut, l'heuristique de React par durée (`useMeteoLayer.ts:140-141`).
    const jours = (new Date(params.endDate).getTime() - new Date(params.startDate).getTime()) / 86400000;
    const echelle: MeteoScale = params.scale ?? (jours > 30 ? 'region' : 'departement');
    const bbox = echelle === 'cp' ? this.bboxCp() : undefined;

    this.lecture?.unsubscribe();
    this.chargement.set(true);
    this.progression.set(null);
    this.erreur.set(null);

    let zones: GeoJSON.FeatureCollection | null = null;
    let zonesLues = false;
    let echec = false;
    let resultat: { donnees: Record<string, MeteoZoneValue>; meta: MeteoZoneMeta } | null = null;
    let fluxReussi: boolean | null = null;
    const conclure = () => {
      if (echec || !zonesLues || fluxReussi !== true) return;
      // Un flux terminé sans ligne `done` garde l'affichage précédent, comme React (`setData` jamais appelé).
      if (resultat && zones) this.affichage.set({ ...resultat, zones });
      this.visible.set(true);
      this.etat.basculerDegrade('meteo', true);
      this.dialogueOuvert.set(false);
    };

    const lecture = new Subscription();
    this.lecture = lecture;
    // Un échec, des contours OU du flux : la lecture entière s'arrête, le message reste dans le dialogue ouvert, aucun
    // dégradé n'est réclamé et l'affichage précédent est vidé — jamais présenté comme le résultat de cette demande.
    const echouer = (message: string) => {
      echec = true;
      lecture.unsubscribe();
      this.chargement.set(false);
      this.progression.set(null);
      this.erreur.set(message);
      this.affichage.set(null);
    };
    lecture.add(this.contours.zones(echelle).subscribe({
      next: (z) => { zones = z; },
      // Défaut React corrigé (revue 1) : `if (!res.ok) return` concluait en réussite sans rien peindre, sans le dire.
      error: () => echouer(MESSAGE_CONTOURS_INDISPONIBLES),
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
      error: (e: unknown) => echouer(messageErreurMeteo(e)),
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

  /** `handleMeteoClear` (`useMeteoLayer.ts:172-175`) : annule, vide, masque. */
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

  /** La bbox du filtre s'il y en a un, sinon la carte visible — trois décimales (`useMeteoLayer.ts:148-158`). */
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
