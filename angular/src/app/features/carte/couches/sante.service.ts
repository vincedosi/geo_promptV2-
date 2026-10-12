import { HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT, DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { type Observable, type Subscription, switchMap, tap } from 'rxjs';
import { FABRIQUE_POPUP, type PopupCarte } from '../../../carte/fabrique-carte';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { CiviqueApi, type LigneDepartement, type ReponseSanteCp } from '../data/civique.api';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { ContoursZonesService } from '../etat/contours-zones.service';
import { bboxPourRequete } from '../logique/bbox-requete';
import { avantDe } from '../logique/ordre-couches';
import { JETONS_NIVEAUX_SANTE, OPACITE_SANTE, TRAIT_SANTE } from '../logique/palettes-donnees-carte';
import { type EchelleSante, type JeuSante, METRIQUES_SANTE } from '../logique/sante';
import { peindre } from './couche-carreaux';
import { messagePoints } from './pois.service';
import {
  COUCHE_SANTE_FOND, COUCHE_SANTE_TRAIT, type EntreeZone, SOURCE_SANTE, type TeintesNiveaux, contenuPopupSante,
  expressionSante, zonesPeintes,
} from './couche-civique';

/** L'état de l'ingestion nationale (`CivicIngestState`, `use-civic-ingest.ts:334-338`). */
export interface EtatIngestion {
  running: boolean;
  message: string | null;
  error: string | null;
}

/** Le flux départemental repeint la carte tous les N départements (`CivicHealthMapLayer.tsx:392`). */
const REPEINDRE_TOUS_LES = 10;

/**
 * La couche « Santé environnementale » — indice pollen ou indice ATMO par zone : l'état que `app/map/page.tsx` tenait
 * (`civicHealthLayer`, `civicScale`, `civicMetric`, `civicMinLevel`, `civicProgress`, `civicLoading`, `civicCpStatus`,
 * `civicCpDate`, `civicRefreshKey`), son rendu (`CivicHealthMapLayer.tsx`) et l'ingestion (`use-civic-ingest.ts`).
 *
 * ── DEUX ÉCHELLES ────────────────────────────────────────────────────────
 * - département : une commune représentative par département, en flux NDJSON — la progression `{done,total}` avance
 *   LIGNE À LIGNE et la carte est repeinte tous les dix départements ;
 * - code postal : la table quotidienne (`pollen_map_daily` / `atmo_map_daily`), avec `bbox` SEULEMENT si un filtre
 *   géographique est actif (`bboxPourRequete`) ; au département, le filtre ne relit RIEN (échantillon national fixe).
 * Le seuil et la métrique ne font que repeindre (propriété `indice` recalculée) — aucune requête. Les polygones des
 * zones sont lus UNE fois par échelle et par écran (cache avant appel).
 *
 * ── DONNÉE PÉRIMÉE ───────────────────────────────────────────────────────
 * `statutCp` et `dateCp` disent à la section si la table est vide (`no_data`) ou de quand elle date : c'est elle qui
 * affiche le message daté de React (`pollen_map_daily` s'arrête au 2026-09-17), jamais une carte vide muette.
 *
 * ── UN SEUL DÉGRADÉ, CONTRAT DU REGISTRE (B11) ───────────────────────────
 * `choisirJeu` réclame l'exclusivité ; changer de jeu remet la métrique à « global » et la progression à `null`
 * (`page.tsx:1023-1027`). Une carte recréée retrouve couches et valeurs SANS relire si la lecture était complète.
 *
 * Écarts à React, défauts corrigés : les teintes de niveau SUIVENT le thème (React les lisait une fois, au chargement,
 * par `getComputedStyle` — basculer le thème laissait la carte dans l'ancien) ; une carte recréée re-pose la couche.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class SanteService {
  private readonly etat = inject(EtatCarteService);
  private readonly couches = inject(CouchesCarteService);
  private readonly api = inject(CiviqueApi);
  private readonly contours = inject(ContoursZonesService);
  private readonly fabriquePopup = inject(FABRIQUE_POPUP);
  private readonly document = inject(DOCUMENT);
  private readonly palettes = {
    pollen: inject(CouleursService).palette(JETONS_NIVEAUX_SANTE.pollen),
    atmo: inject(CouleursService).palette(JETONS_NIVEAUX_SANTE.atmo),
  };

  private readonly jeuActif = signal<JeuSante | null>(null);
  /** Le jeu affiché (`civicHealthLayer`), `null` : couche masquée. */
  readonly jeu = this.jeuActif.asReadonly();
  private readonly echelleActive = signal<EchelleSante>('departement');
  readonly echelle = this.echelleActive.asReadonly();
  /** `global`, une espèce ou un polluant. */
  readonly metrique = signal('global');
  /** Niveau minimum affiché (0 = tous). */
  readonly seuil = signal(0);
  readonly progression = signal<{ done: number; total: number } | null>(null);
  readonly chargement = signal(false);
  /** Un échec des contours, du flux ou de la lecture CP : la section le dit (React : `console.error`, carte vide muette). */
  readonly erreur = signal<string | null>(null);
  readonly statutCp = signal<'ok' | 'no_data' | null>(null);
  readonly dateCp = signal<string | null>(null);
  readonly ingestion = signal<EtatIngestion>({ running: false, message: null, error: null });
  /** Incrémenté après une ingestion réussie : la couche est relue (`civicRefreshKey`). */
  private readonly rafraichissement = signal(0);

  /** La bbox du filtre, au code postal SEULEMENT — au département, une chaîne stable qui ne relit rien. */
  private readonly bboxParam = computed(() => {
    if (this.echelleActive() !== 'cp') return null;
    return bboxPourRequete(this.etat.filtre())?.join(',') ?? null;
  });
  private readonly teintes = computed<TeintesNiveaux | null>(() => {
    const j = this.jeuActif();
    return j ? (this.palettes[j]() as unknown as TeintesNiveaux) : null;
  });

  /** L'instance où la couche est POSÉE. */
  private readonly posee = signal<maplibregl.Map | null>(null);
  private zones: GeoJSON.FeatureCollection | null = null;
  private entrees = new Map<string, EntreeZone>();
  /** La clé de la dernière lecture COMPLÈTE : la même clé sur une carte recréée se re-pose sans relire. */
  private cleComplete: string | null = null;
  private lecture: Subscription | null = null;
  private lectureIngestion: Subscription | null = null;
  private popup: PopupCarte | null = null;

  constructor() {
    this.etat.surEviction('civic-sante', () => this.jeuActif.set(null));
    this.couches.inscrireEffacement('civic-sante', () => {
      this.jeuActif.set(null);
      this.progression.set(null);
    });
    inject(DestroyRef).onDestroy(() => {
      this.lecture?.unsubscribe();
      this.lectureIngestion?.unsubscribe();
    });

    // Données : (re)lues quand le jeu, l'échelle, le rafraîchissement ou la bbox du filtre (au CP) changent.
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      const jeu = this.jeuActif();
      const echelle = this.echelleActive();
      const rafraichi = this.rafraichissement();
      const bbox = this.bboxParam();
      if (!carte) {
        this.posee.set(null);
        return;
      }
      if (!jeu) {
        untracked(() => this.eteindre(carte));
        return;
      }
      const cle = `${jeu}|${echelle}|${rafraichi}|${bbox ?? ''}`;
      nettoyer(quandStyleCharge(carte, () => untracked(() => this.charger(carte, jeu, echelle, bbox, cle))));
      nettoyer(() => {
        this.lecture?.unsubscribe();
        this.lecture = null;
        this.chargement.set(false);
      });
    });

    // Seuil et métrique : repeinture seule (`CivicHealthMapLayer.tsx:424-429`).
    effect(() => {
      const carte = this.posee();
      this.seuil();
      this.metrique();
      if (carte) untracked(() => this.repeindre(carte));
    });

    // Teintes : posées au chargement, REPEINTES au changement de thème.
    effect(() => {
      const carte = this.posee();
      const t = this.teintes();
      if (!carte || !t) return;
      peindre(carte, COUCHE_SANTE_FOND, 'fill-color', expressionSante(t));
      peindre(carte, COUCHE_SANTE_TRAIT, 'line-color', t[0]);
    });

    // Popup au clic sur une zone.
    effect((nettoyer) => {
      const carte = this.posee();
      if (!carte) return;
      const clic = (e: maplibregl.MapLayerMouseEvent) => this.cliquer(carte, e);
      carte.on('click', COUCHE_SANTE_FOND, clic);
      nettoyer(() => carte.off('click', COUCHE_SANTE_FOND, clic));
    });
  }

  /** « Allergènes » / « Qualité de l'air » (re-cliquer masque) et la croix d'« Actifs ». */
  choisirJeu(jeu: JeuSante | null): void {
    this.etat.basculerDegrade('civic-sante', jeu !== null);
    this.progression.set(null);
    this.metrique.set('global');
    this.jeuActif.set(jeu);
  }

  /** « Département » / « Code postal » (`page.tsx:1031`). */
  choisirEchelle(echelle: EchelleSante): void {
    this.progression.set(null);
    this.echelleActive.set(echelle);
  }

  /** Relit la couche (après une ingestion). */
  rafraichir(): void {
    this.rafraichissement.update((n) => n + 1);
  }

  /**
   * L'ingestion nationale (`runCivicIngestStream`, `use-civic-ingest.ts:356-409`) — ÉCRIT en base. La route exige un
   * administrateur : un 403 devient « Réservé aux administrateurs. », jamais une erreur brute.
   */
  ingerer(): void {
    this.lectureIngestion?.unsubscribe();
    this.ingestion.set({ running: true, message: 'Démarrage…', error: null });
    const echouer = (message: string) => {
      this.lectureIngestion?.unsubscribe();
      this.ingestion.set({ running: false, message: null, error: message });
    };
    this.lectureIngestion = this.api.ingerer().subscribe({
      next: (ligne) => {
        if (ligne.type === 'progress' && ligne.message) {
          this.ingestion.set({ running: true, message: ligne.message, error: null });
        } else if (ligne.type === 'done') {
          const parts: string[] = [];
          if (ligne.summary?.pollen?.cps_written != null) parts.push(`pollen ${ligne.summary.pollen.cps_written} CP`);
          if (ligne.summary?.atmo?.cps_written != null) parts.push(`air ${ligne.summary.atmo.cps_written} CP`);
          this.ingestion.set({ running: false, message: `Terminé : ${parts.join(' · ') || 'aucune donnée'}`, error: null });
          this.rafraichir();
        } else if (ligne.type === 'error') {
          echouer(ligne.message ?? 'Erreur inconnue');
        }
      },
      error: (e: unknown) => {
        if (e instanceof HttpErrorResponse) echouer(e.status === 403 ? 'Réservé aux administrateurs.' : `HTTP ${e.status}`);
        else echouer(e instanceof Error ? e.message : 'Erreur inconnue');
      },
    });
  }

  private charger(carte: maplibregl.Map, jeu: JeuSante, echelle: EchelleSante, bbox: string | null, cle: string): void {
    this.poser(carte);
    if (cle === this.cleComplete && this.zones) {
      this.repeindre(carte);
      return;
    }
    this.lecture?.unsubscribe();
    this.chargement.set(true);
    this.erreur.set(null);
    this.entrees = new Map();
    this.cleComplete = null;
    // Contours en cache pour l'écran, PARTAGÉS avec la météo (T11, `ContoursZonesService`) : une lecture par échelle.
    const zones$ = this.contours.zones(echelle);
    // UNE chaîne, UN abonnement (revue 1) : les contours en cache répondent de façon SYNCHRONE ; deux abonnements
    // imbriqués rangés dans le même champ perdaient l'abonnement au flux, que plus rien n'annulait.
    this.lecture = zones$.pipe(
      switchMap((zones) => {
        this.zones = zones;
        this.repeindre(carte);
        return echelle === 'cp' ? this.lireCp(carte, jeu, cle, bbox) : this.lireDepartements(carte, jeu, cle);
      }),
    ).subscribe({
      error: (e: unknown) => {
        this.chargement.set(false);
        this.erreur.set(messagePoints(e, 'Délai dépassé — réessayez dans quelques instants'));
      },
    });
  }

  private lireCp(carte: maplibregl.Map, jeu: JeuSante, cle: string, bbox: string | null): Observable<unknown> {
    return this.api.santeCp(jeu, bbox).pipe(tap((payload: ReponseSanteCp) => {
      this.chargement.set(false);
      if (!payload.date) {
        this.statutCp.set('no_data');
        this.dateCp.set(null);
        this.cleComplete = cle;
        this.repeindre(carte);
        return;
      }
      this.statutCp.set('ok');
      this.dateCp.set(payload.date);
      for (const r of payload.rows) {
        const metrics: Record<string, number> = {};
        const concentrations: Record<string, number> = {};
        for (const [k] of METRIQUES_SANTE[jeu]) {
          metrics[k] = Number(r[k] ?? 0);
          if (jeu === 'pollen') concentrations[k] = Number(r[`conc_${k}`] ?? 0);
        }
        this.entrees.set(r.code_postal, {
          nom: r.code_postal, indice_global: r.indice_global, metrics,
          ...(jeu === 'pollen' ? { concentrations, alerte: r.alerte === true } : {}),
          stale: false, nbCommunes: r.nb_communes,
        });
      }
      this.cleComplete = cle;
      this.repeindre(carte);
    }));
  }

  private lireDepartements(carte: maplibregl.Map, jeu: JeuSante, cle: string): Observable<unknown> {
    let total = 0;
    let faits = 0;
    let depuisPeinture = 0;
    return this.api.santeDepartement(jeu).pipe(tap({
      next: (ligne: LigneDepartement) => {
        if (ligne.type === 'meta') {
          total = ligne.total ?? 0;
          return;
        }
        if (ligne.type !== 'dept' || !ligne.code_dept) return;
        faits++;
        if (jeu === 'pollen' && ligne.pollen) {
          this.entrees.set(ligne.code_dept, {
            nom: ligne.nom_dept ?? ligne.code_dept, indice_global: ligne.pollen.indice_global, metrics: { ...ligne.pollen.especes },
            concentrations: ligne.pollen.concentrations, alerte: ligne.pollen.alerte, stale: ligne.stale ?? false,
          });
        } else if (jeu === 'atmo' && ligne.air) {
          const s = ligne.air.sous_indices;
          this.entrees.set(ligne.code_dept, {
            nom: ligne.nom_dept ?? ligne.code_dept, indice_global: ligne.air.indice,
            metrics: { no2: s.no2 ?? 0, o3: s.o3 ?? 0, pm10: s.pm10 ?? 0, pm25: s.pm25 ?? 0, so2: s.so2 ?? 0 },
            stale: ligne.stale ?? false,
          });
        }
        if (++depuisPeinture >= REPEINDRE_TOUS_LES) {
          this.repeindre(carte);
          depuisPeinture = 0;
        }
        this.progression.set({ done: faits, total });
      },
      // `complete` du tap : jamais appelé quand la chaîne est désabonnée (changement de jeu, extinction).
      complete: () => {
        this.repeindre(carte);
        this.progression.set({ done: faits, total: total || faits });
        this.chargement.set(false);
        this.cleComplete = cle;
      },
    }));
  }

  /** Source vide et deux couches, une fois par instance (`CivicHealthMapLayer.tsx:233-250`), à leur rang de React (`avantDe`, revue finale I-1). */
  private poser(carte: maplibregl.Map): void {
    const t = this.teintes();
    if (!t) return;
    if (!carte.getSource(SOURCE_SANTE)) {
      carte.addSource(SOURCE_SANTE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!carte.getLayer(COUCHE_SANTE_FOND)) {
      carte.addLayer({
        id: COUCHE_SANTE_FOND, type: 'fill', source: SOURCE_SANTE,
        paint: { 'fill-color': expressionSante(t) as maplibregl.ExpressionSpecification, 'fill-opacity': OPACITE_SANTE },
      }, avantDe(carte, COUCHE_SANTE_FOND));
    }
    if (!carte.getLayer(COUCHE_SANTE_TRAIT)) {
      carte.addLayer({
        id: COUCHE_SANTE_TRAIT, type: 'line', source: SOURCE_SANTE,
        paint: { 'line-color': t[0], 'line-width': TRAIT_SANTE.largeur, 'line-opacity': TRAIT_SANTE.opacite },
      }, avantDe(carte, COUCHE_SANTE_TRAIT));
    }
    this.posee.set(carte);
  }

  private repeindre(carte: maplibregl.Map): void {
    const source = carte.getSource(SOURCE_SANTE) as maplibregl.GeoJSONSource | undefined;
    if (!source || !this.zones) return;
    source.setData(zonesPeintes(this.zones, this.entrees, this.seuil(), this.metrique()));
  }

  /** Désactivation (`cleanup`, `CivicHealthMapLayer.tsx:161-170`). */
  private eteindre(carte: maplibregl.Map): void {
    this.lecture?.unsubscribe();
    this.lecture = null;
    this.chargement.set(false);
    this.erreur.set(null);
    this.popup?.remove();
    this.popup = null;
    for (const c of [COUCHE_SANTE_TRAIT, COUCHE_SANTE_FOND]) if (carte.getLayer(c)) carte.removeLayer(c);
    if (carte.getSource(SOURCE_SANTE)) carte.removeSource(SOURCE_SANTE);
    this.posee.set(null);
    this.entrees = new Map();
    this.zones = null;
    this.cleComplete = null;
  }

  private cliquer(carte: maplibregl.Map, e: maplibregl.MapLayerMouseEvent): void {
    const f = e.features?.[0];
    const jeu = this.jeuActif();
    const teintes = this.teintes();
    if (!f || !jeu || !teintes) return;
    const code = String(f.properties?.['code'] ?? '');
    const nom = f.properties?.['nom'] != null ? String(f.properties['nom']) : null;
    this.popup?.remove();
    const doc = carte.getContainer().ownerDocument ?? this.document;
    this.popup = this.fabriquePopup({ closeButton: true, closeOnClick: false, offset: 10, maxWidth: '300px' })
      .setLngLat(e.lngLat)
      .setDOMContent(contenuPopupSante({
        jeu, echelle: this.echelleActive(), code, nom, entree: this.entrees.get(code), teintes,
      }, doc))
      .addTo(carte);
  }
}
