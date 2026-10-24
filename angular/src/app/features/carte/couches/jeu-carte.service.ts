import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { map } from 'rxjs';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { IrisApi } from '../data/iris.api';
import { JeuxApi, MAX_CODES_CONTOURS } from '../data/jeux.api';
import { ZonesCustomApi } from '../data/zones-custom.api';
import { ContoursZonesService } from '../etat/contours-zones.service';
import { CouchesCarteService, quandStyleCharge } from '../etat/couches-carte.service';
import { EtatCarteService } from '../etat/etat-carte.service';
import { JeuZonesService } from '../etat/jeu-zones.service';
import { LectureAnnulable } from '../etat/lecture-annulable';
import { estExacte } from '../logique/jeu/bilan';
import { estRetenue } from '../logique/jeu/conversion';
import type { LigneCouverture } from '../logique/analyses/couverture';
import type { Plateforme } from '../logique/jeu/plateformes';
import { bboxDeZone } from '../logique/zones/zones-affichees';
import { JETONS_JEU, type RenduJeu, entitesCercles, entitesTerritoires, poserCoucheJeu, retirerCoucheJeu } from './couche-jeu';
import { ZOOM_IRIS_UNITES } from './couche-unites';

/** Marge du recadrage sur la zone, celle de ④ (la marge du panneau d'étape s'y ajoute). */
const RECADRAGE = { padding: 60, duration: 900 } as const;

/** Ce qu'il faut peindre pour la plateforme regardée, avant toute géométrie. */
type Vue =
  | { type: 'zone' }
  | { type: 'territoires'; echelle: 'cp' | 'departement'; lignes: readonly LigneCouverture[]; seuil: number }
  | { type: 'communes'; lignes: readonly LigneCouverture[]; seuil: number; codes: string[]; toutes: boolean }
  | { type: 'iris'; lignes: readonly LigneCouverture[]; seuil: number }
  | { type: 'cercles'; rendu: GeoJSON.FeatureCollection };

/**
 * ⑤ Jeu de zones — la carte de la plateforme REGARDÉE (lot 5, T11, A-14), sur LA carte principale : le contour de la
 * zone exacte (`ZonesCustomApi.geometrie`, une lecture par zone), puis ses unités — CP et départements par
 * `ContoursZonesService` (partagé, une lecture par échelle et par écran), communes TOUCHÉES par
 * `JeuxApi.contoursCommunes` (une lecture par jeu de codes, gardée ; le seuil tranche en mémoire, ruling de la
 * relecture T10-12 ; au-delà de `MAX_CODES_CONTOURS`, les seules retenues), IRIS sur les tuiles `iris-source` (z ≥ 9),
 * cercles par `cercleGeoJSON` du module risque ; une maille exacte (A-6) : le contour seul. Couleurs CALCULÉES.
 *
 * ── UNE PLATEFORME À LA FOIS, UNE CHOROPLÈTHE À LA FOIS ──────────────────
 * `regarder(p)` (« Voir sur la carte » d'une colonne) remplace la précédente : ses couches sont retirées avant que la
 * nouvelle soit posée. Peinte, la carte RÉCLAME le dégradé `'jeu'` (registre du lot 4) : la couverture de ④ est
 * évincée et se masque (son panneau propose « Afficher sur la carte ») ; évincée à son tour par ④ ou un calque, la
 * carte de ⑤ se masque, et « Voir sur la carte » la rend.
 *
 * ── RIEN SANS GESTE ; RIEN D'UNE ZONE QUITTÉE (P-c) ─────────────────────
 * Aucune lecture avant `regarder` ; le geste porte sa zone : changer de zone l'annule (sans effet qui le remette à
 * zéro — un geste fait dans le même tick resterait perdu), oublie le contour et désabonne les lectures en vol. Les
 * contours de communes restent gardés par jeu de codes : ce sont les mêmes communes, quelle que soit la zone. Fourni par la PAGE (P-e) : la carte survit à ⑤ → ① → ⑤ ; un `effect` sur
 * `carteCourante` la re-pose sur une carte recréée par un changement de fond (B11) et le thème la repeint ; « Tout
 * effacer » la masque ; à la destruction du SERVICE, ses couches sont retirées.
 */
@Injectable()
export class JeuCarteService {
  private readonly jeu = inject(JeuZonesService);
  private readonly couches = inject(CouchesCarteService);
  private readonly etat = inject(EtatCarteService);
  private readonly zonesApi = inject(ZonesCustomApi);
  private readonly jeuxApi = inject(JeuxApi);
  private readonly irisApi = inject(IrisApi);
  private readonly contoursZones = inject(ContoursZonesService);
  private readonly palette = inject(CouleursService).palette(JETONS_JEU);

  /** Le geste « Voir sur la carte » : la plateforme ET la zone sur laquelle il a été fait. */
  private readonly _regardee = signal<{ p: Plateforme; zone: string } | null>(null);
  private readonly _masquee = signal(false);
  /** La plateforme dont la carte montre les unités ; `null` sans geste, ou si la zone a changé depuis (P-c). */
  readonly regardee = computed(() => {
    const r = this._regardee();
    return r && r.zone === this.jeu.zoneId() ? r.p : null;
  });
  /** La carte de ⑤ est-elle peinte ? */
  readonly affichee = computed(() => this.regardee() !== null && !this._masquee());

  private readonly contour = new LectureAnnulable<{ zone: string; entite: GeoJSON.Feature } | null>(() => '');
  private readonly contoursCp = new LectureAnnulable<GeoJSON.FeatureCollection>(() => '');
  private readonly contoursDepartements = new LectureAnnulable<GeoJSON.FeatureCollection>(() => '');
  private readonly lectureCommunes = new LectureAnnulable<{ cle: string; fc: GeoJSON.FeatureCollection }>(() => '');
  /** Les contours de communes déjà lus, par jeu de codes : revenir à un seuil ne relit rien. */
  private readonly communesLues = signal<ReadonlyMap<string, GeoJSON.FeatureCollection>>(new Map());
  /** Contours en lecture : la colonne le dit. */
  readonly chargement = computed(() => this.contour.enCours() || this.contoursCp.enCours() || this.contoursDepartements.enCours() || this.lectureCommunes.enCours());

  private readonly zoom = signal<number | null>(null);
  /** Plus de communes touchées que la route n'en lit d'un coup : seules les retenues sont dessinées (la colonne le dit). */
  readonly communesTronquees = computed(() => {
    const v = this.affichee() ? this.vue() : null;
    return v?.type === 'communes' && !v.toutes;
  });
  /** Une plateforme regardée à l'IRIS sous z9 : rien n'est peint (les tuiles portent des communes). */
  readonly irisSousLeZoom = computed(() => {
    const z = this.zoom();
    return this.affichee() && this.vue()?.type === 'iris' && z !== null && z < ZOOM_IRIS_UNITES;
  });

  /** Ce que la plateforme regardée demande, d'après son choix et la conversion EN MÉMOIRE (aucune requête ici). */
  private readonly vue = computed<Vue | null>(() => {
    const p = this.regardee();
    const c = p ? this.jeu.choix()[p] : undefined;
    const ligne = c && this.jeu.plateformes().find((l) => l.plateforme === p && l.maille === c.maille);
    if (!p || !c || !ligne) return null;
    if (estExacte(c, ligne, this.jeu.recette()) || c.maille === 'polygone') return { type: 'zone' };
    if (c.maille === 'cercle') {
      const k = this.jeu.cercles()[p];
      return k && k.rayon_m === c.rayon_m && k.seuil === c.seuil ? { type: 'cercles', rendu: entitesCercles(k) } : null;
    }
    const lignes = this.jeu.couvertures()[c.maille]?.lignes;
    if (!lignes) return null;
    if (c.maille === 'commune') {
      // Les contours de TOUTES les communes touchées, lus une fois : le seuil tranche ensuite en mémoire (P-h). Au-delà
      // du plafond de la route, les seules retenues — un seuil relâché les relit, et la colonne le dit.
      const toutes = lignes.length <= MAX_CODES_CONTOURS;
      const codes = (toutes ? lignes : lignes.filter((l) => estRetenue(l, c.seuil))).map((l) => l.code).sort();
      return { type: 'communes', lignes, seuil: c.seuil, codes, toutes };
    }
    if (c.maille === 'iris') return { type: 'iris', lignes, seuil: c.seuil };
    return { type: 'territoires', echelle: c.maille, lignes, seuil: c.seuil };
  });

  private readonly rendu = computed<RenduJeu | null>(() => {
    if (!this.affichee()) return null;
    const g = this.contour.resultat();
    const zone = g && g.zone === this.jeu.zoneId() ? g.entite : null;
    const v = this.vue();
    const r: RenduJeu = { zone, unites: null, iris: null };
    if (v?.type === 'cercles') r.unites = v.rendu;
    if (v?.type === 'territoires') {
      const fc = (v.echelle === 'cp' ? this.contoursCp : this.contoursDepartements).resultat();
      if (fc) r.unites = entitesTerritoires(fc, v.lignes, v.seuil);
    }
    if (v?.type === 'communes') {
      const fc = this.communesLues().get(v.codes.join(','));
      if (fc) r.unites = entitesTerritoires(fc, v.lignes, v.seuil);
    }
    if (v?.type === 'iris') r.iris = { retenus: v.lignes.filter((l) => estRetenue(l, v.seuil)), touches: v.lignes.map((l) => l.code) };
    return r;
  });

  /** Le dégradé `'jeu'` est-il réclamé ? (transition seulement, comme ④). */
  private reclame = false;
  /** Le jeu de codes de communes en lecture. */
  private cleCommunes: string | null = null;
  /** La zone dont le contour est lu ou en lecture ; `null` : aucune. */
  private zoneContour: string | null = null;

  constructor() {
    this.couches.inscrireEffacement('jeu', () => this._masquee.set(true));
    this.etat.surEviction('jeu', () => {
      this.reclame = false;
      this._masquee.set(true);
    });
    effect(() => {
      const a = this.affichee();
      untracked(() => {
        if (a === this.reclame) return;
        this.reclame = a;
        this.etat.basculerDegrade('jeu', a);
      });
    });

    // Les lectures suivent le GESTE (une plateforme regardée), jamais l'ouverture de ⑤. Une zone quittée : son contour
    // (lu ou en vol) est oublié, ses communes en vol jetées.
    effect(() => {
      const zone = this.jeu.zoneId();
      const affichee = this.affichee();
      const v = affichee ? this.vue() : null;
      untracked(() => {
        if (this.zoneContour !== null && this.zoneContour !== zone) {
          this.contour.perimer();
          this.lectureCommunes.perimer();
          this.zoneContour = null;
        }
        if (!zone || !affichee) return;
        if (this.zoneContour === null) this.lireZone(zone);
        if (v?.type === 'territoires') {
          const l = v.echelle === 'cp' ? this.contoursCp : this.contoursDepartements;
          l.chargerUneFois(() => this.contoursZones.zones(v.echelle));
        }
        if (v?.type === 'communes' && v.codes.length > 0) this.lireCommunes(v.codes);
      });
    });

    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      const rendu = this.rendu();
      if (!carte) return;
      if (!rendu) {
        untracked(() => retirerCoucheJeu(carte));
        return;
      }
      // La palette en DERNIER, seulement avec un rendu (patron de ④) : ouvrir la carte ne lit aucune feuille de style.
      const p = this.palette();
      nettoyer(quandStyleCharge(carte, () => untracked(() => poserCoucheJeu(carte, rendu, p, this.irisApi.urlTuiles()))));
    });

    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      if (!carte) {
        this.zoom.set(null);
        return;
      }
      const relever = () => this.zoom.set(carte.getZoom());
      untracked(relever);
      carte.on('zoomend', relever);
      nettoyer(() => carte.off('zoomend', relever));
    });

    inject(DestroyRef).onDestroy(() => {
      const carte = this.couches.carteCourante();
      if (carte) retirerCoucheJeu(carte);
    });
  }

  /** « Voir sur la carte » : cette plateforme remplace la précédente ; une carte masquée revient. Recadrée sur la zone. */
  regarder(p: Plateforme): void {
    const zone = this.jeu.zoneId();
    this._regardee.set(zone ? { p, zone } : null);
    this._masquee.set(false);
    this.recadrer(this.contour.resultat()?.entite ?? null);
  }

  private lireZone(zone: string): void {
    this.zoneContour = zone;
    this.contour.lancer(
      this.zonesApi.geometrie(zone).pipe(map((f) => (f?.geometry ? { zone, entite: f as GeoJSON.Feature } : null))),
      (g) => this.recadrer(g?.entite ?? null),
      // Échec : relu au prochain geste.
      () => { this.zoneContour = null; },
    );
  }

  /** Une lecture par jeu de codes : déjà lu, rien ; un autre jeu en vol est remplacé (jeton). */
  private lireCommunes(codes: string[]): void {
    const cle = codes.join(',');
    if (this.communesLues().has(cle) || (this.lectureCommunes.enCours() && this.cleCommunes === cle)) return;
    this.cleCommunes = cle;
    this.lectureCommunes.lancer(
      this.jeuxApi.contoursCommunes(codes).pipe(map((r) => ({
        cle, fc: { type: 'FeatureCollection' as const, features: r.communes.map((c) => ({ type: 'Feature' as const, geometry: c.geometry, properties: { code: c.code } })) },
      }))),
      (r) => this.communesLues.update((m) => new Map(m).set(r.cle, r.fc)),
    );
  }

  private recadrer(entite: GeoJSON.Feature | null): void {
    const b = entite && bboxDeZone(null, entite.geometry);
    const carte: maplibregl.Map | null = this.couches.carteCourante();
    if (b && carte) carte.fitBounds([[b[0], b[1]], [b[2], b[3]]], RECADRAGE);
  }
}
