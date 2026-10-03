import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import maplibregl from 'maplibre-gl';
import { type Subscription, finalize } from 'rxjs';
import { type Bbox, bboxEnParametre } from '../../carte/bbox';
import { CarteComponent } from '../../carte/carte.component';
import { chargerParCadre } from '../../carte/charger-par-cadre';
import { contenuPopup } from '../../carte/contenu-popup';
import { OPACITE_BANDES } from '../../carte/opacites-bandes';
import { LegendeComponent } from '../../carte/legende/legende.component';
import { LegendeNiveauxComponent, type NiveauLegende } from '../../carte/legende/legende-niveaux.component';
import { ChargementService } from '../../core/chargement/chargement.service';
import { messageErreurApi } from '../../core/http/erreurs';
import { formaterDecimal, formaterNombre, formaterNombreAbrege } from '../../core/format/nombre';
import { CouleursService } from '../../core/theme/couleurs.service';
import { CourbeComponent } from '../../graphiques/courbe.component';
import type { SerieCourbe } from '../../graphiques/option-courbe';
import { BandeauKpiComponent } from '../../ui/bandeau-kpi/bandeau-kpi.component';
import { BarreProgressionComponent } from '../../ui/barre-progression/barre-progression.component';
import { ChampComponent } from '../../ui/champ/champ.component';
import { FilArianeComponent, type SegmentAriane } from '../../ui/fil-ariane/fil-ariane.component';
import { type EtapeAffichee, FilEtapesComponent } from '../../ui/fil-etapes/fil-etapes.component';
import { IconeComponent } from '../../ui/icone/icone.component';
import { KpiComponent } from '../../ui/kpi/kpi.component';
import { PastilleComponent } from '../../ui/pastille/pastille.component';
import { PerimeDirective } from '../../ui/perime/perime.directive';
import { RegletteComponent } from '../../ui/reglette/reglette.component';
import { type ReponseCourbe, ZonesRisqueApi } from '../risques/data/zones-risque.api';

/** Le profil par défaut du module risque : seuil haut 1/2/5 km, seuil bas 500 m/1 km, PPRT inclus. */
export const CODE_PROFIL_DEFAUT = 'h1000.2000.5000_b500.1000_a_L0_P1';

/** Étang de Berre : la vue initiale de CarteRisque.tsx. */
const CADRE_ETANG_DE_BERRE: Bbox = [4.75, 43.35, 5.3, 43.6];

/**
 * Les trois grappes de `CarteRisque.tsx` (`GRAPPES`) : un bouton chacune, qui recadre la carte. La vue d'ouverture est
 * la troisième, comme `VUE_INITIALE = GRAPPES[2].bbox`.
 */
const GRAPPES: ReadonlyArray<{ nom: string; bbox: Bbox }> = [
  { nom: 'Vallée de la chimie', bbox: [4.75, 45.6, 5.05, 45.75] },
  { nom: 'Estuaire de la Seine', bbox: [0.05, 49.4, 0.55, 49.55] },
  { nom: 'Étang de Berre', bbox: CADRE_ETANG_DE_BERRE },
];

/**
 * Le profil de rayons de la page d'essai : anneaux par niveau et cadenas « lier les niveaux » ; le PPRT reste à part.
 * MODÈLE MINIMAL DE PAGE D'ESSAI — le lot 3 porte `lib/risques/profil.ts` (`poserRayonExterieur`, `normaliserProfil`)
 * et `lib/risques/code-profil.ts` ; seul ce que la barre commune exige est reproduit ici, avec les mêmes règles.
 */
export interface ProfilEssai {
  readonly haut: readonly number[];
  readonly bas: readonly number[];
  readonly lie: boolean;
}

/** Le profil par défaut : seuil haut 1/2/5 km, seuil bas 500 m/1 km, niveaux non liés. Son code vaut CODE_PROFIL_DEFAUT. */
export const PROFIL_DEFAUT: ProfilEssai = { haut: [1000, 2000, 5000], bas: [500, 1000], lie: false };

/** Bornes et pas du pré-calcul (`lib/risques/profil.ts` : RAYON_MIN_M, RAYON_MAX_M, PAS_RAYON_M). */
export const RAYON_MIN_M = 100;
export const RAYON_MAX_M = 10_000;
export const PAS_RAYON_M = 100;

type NiveauReglable = 'haut' | 'bas';

const LIBELLE_NIVEAU: Record<NiveauReglable | 'autres', string> = {
  haut: 'Seveso seuil haut',
  bas: 'Seveso seuil bas',
  autres: 'Autres régimes',
};

/** `libelleRayon` de `lib/risques/profil.ts` : « 500 m », « 5 km », « 1,5 km ». */
export function libelleRayon(m: number): string {
  if (m < 1000) return `${m} m`;
  const km = m / 1000;
  return `${Number.isInteger(km) ? km : km.toFixed(1).replace('.', ',')} km`;
}

/** Code de cache des zones (`codeProfil`, `lib/risques/code-profil.ts`) : niveaux, liaison, PPRT à part. */
export function codeDuProfil(p: ProfilEssai): string {
  return `h${p.haut.join('.')}_b${p.bas.join('.')}_a_L${p.lie ? 1 : 0}_P1`;
}

/**
 * Pose le BORD d'un niveau (`poserRayonExterieur`) : ramené dans les bornes, jamais sous le dernier anneau intérieur,
 * écrit sur le seuil haut quand le cadenas est fermé — le seuil bas en hérite alors.
 */
export function poserBord(p: ProfilEssai, niveau: NiveauReglable, rayonM: number): ProfilEssai {
  const cible: NiveauReglable = p.lie ? 'haut' : niveau;
  const interieurs = p[cible].slice(0, -1);
  const dernier = interieurs[interieurs.length - 1];
  const plancher = dernier === undefined ? RAYON_MIN_M : dernier + PAS_RAYON_M;
  const borne = Math.min(RAYON_MAX_M, Math.max(plancher, Math.round(rayonM)));
  const anneaux = [...interieurs, borne];
  return p.lie ? { ...p, haut: anneaux, bas: anneaux } : { ...p, [cible]: anneaux };
}

/** Le cadenas : fermé, le seuil bas prend les anneaux du haut ; rouvert, il les garde (« délier ne les restaure pas »). */
export function basculerLiaison(p: ProfilEssai): ProfilEssai {
  return p.lie ? { ...p, lie: false } : { ...p, lie: true, bas: [...p.haut] };
}

/** Les cinq étapes du module (`lib/risques/etape.ts`). Seule ② existe sur la page d'essai ; les autres arrivent au lot 3. */
const ETAPES: ReadonlyArray<{ cle: string; libelle: string }> = [
  { cle: 'sites', libelle: 'Sites' },
  { cle: 'rayon', libelle: 'Rayon' },
  { cle: 'couverture', libelle: 'Couverture' },
  { cle: 'zones', libelle: 'Zones' },
  { cle: 'campagne', libelle: 'Campagne' },
];

/** Les mailles de « Lister par » (`DIMENSIONS_PROPOSEES`, `LIBELLE_DIMENSION`) ; Région est la maille naturelle de la France entière. */
const MAILLES = ['Région', 'Département', 'Code postal', 'Commune'] as const;
/** Natures de zone (`AIDE_MODE`) et niveaux réglementaires (`NIVEAUX_RISQUE`), dans l'ordre et avec les libellés de React. */
const MODES_ZONE = [
  { libelle: 'Périmètre PPRT', aide: 'Servitude publiée par l’État, opposable' },
  { libelle: 'Rayon calculé', aide: 'Rayon choisi ci-dessus — aucune valeur réglementaire' },
] as const;
const NIVEAUX_REGLEMENTAIRES = [
  'Seveso seuil haut', 'Seveso seuil bas', 'Directive IED', 'Autorisation', 'Enregistrement', 'Régime déclaratif ou non précisé',
] as const;
/** Les deux niveaux retenus par défaut côté React. */
const NIVEAUX_RETENUS: ReadonlySet<string> = new Set(['Seveso seuil haut', 'Seveso seuil bas']);

/** Bornes de la poignée (React : sous 320 px le tableau de ③ devient illisible, au-delà de 900 la carte ne montre plus rien). */
const LARGEUR_PANNEAU_MIN = 320;
const LARGEUR_PANNEAU_MAX = 900;
const LARGEUR_PANNEAU_DEFAUT = 480;

const SOURCE_ZONES = 'zones';
const SOURCE_SITES = 'sites';
const COUCHE_ZONES = 'zones-fond';
const COUCHE_CONTOUR = 'zones-contour';
const COUCHE_SITES = 'sites-points';
/** Nom de la couche dans la tuile : `ST_AsMVT(t, 'zones_risque', …)` (sql/205, zones_risque_tuile). */
const COUCHE_TUILE = 'zones_risque';

/** Opacité d'un PPRT (bande nulle) et d'une zone fondue ; celle des bandes 1 à 4 vient de `carte/opacites-bandes`. */
const OPACITE_PPRT = 0.5;
const OPACITE_FONDUE = 0.32;
const ZOOM_DETAIL = 10;
const ZOOM_LISIBLE = 7;
const NB_NATURES = 8;

type Teintes = { haut: string; bas: string; autres: string };

/**
 * Page d'essai : les vraies zones (tuiles MVT), les vrais sites (GeoJSON sur la bbox visible) et la vraie courbe de
 * couverture, composées sur le SQUELETTE de l'écran risque React à l'étape ② Rayon (`AnalysePopulationOverlay.tsx`,
 * lot Rendu R11) : en-tête avec fils d'Ariane et d'étapes, barre commune, barre de progression, bandeau KPI, panneau
 * d'étape à gauche et carte permanente à droite. Elle prouve les briques, elle ne remplace pas le module risque : ce
 * qui n'est pas branché ici (filtres, autres étapes, exports, atelier des anneaux) est rendu à l'identique mais INERTE,
 * avec l'infobulle « Disponible prochainement » — le patron du bouton « MAGELIAN » de la barre latérale.
 */
@Component({
  selector: 'mg-essai-carte',
  imports: [
    LegendeComponent, LegendeNiveauxComponent, BandeauKpiComponent, PerimeDirective, BarreProgressionComponent,
    CarteComponent, CourbeComponent, KpiComponent, RouterLink, ChampComponent, FilArianeComponent, FilEtapesComponent,
    IconeComponent, PastilleComponent, RegletteComponent,
  ],
  providers: [ChargementService],
  templateUrl: './essai-carte.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EssaiCartePage {
  private readonly api = inject(ZonesRisqueApi);
  private readonly chargement = inject(ChargementService);
  private readonly destruction = inject(DestroyRef);

  protected readonly cadre = CADRE_ETANG_DE_BERRE;
  protected readonly grappes = GRAPPES;
  protected readonly prochainement = 'Disponible prochainement';
  protected readonly mailles = MAILLES;
  protected readonly modesZone = MODES_ZONE;
  protected readonly niveauxReglementaires = NIVEAUX_REGLEMENTAIRES;
  protected readonly niveauxRetenus = NIVEAUX_RETENUS;
  protected readonly rayonMin = RAYON_MIN_M;
  protected readonly rayonMax = RAYON_MAX_M;
  protected readonly pasRayon = PAS_RAYON_M;
  protected readonly libelleRayon = libelleRayon;

  /** Le profil courant. Écrit au RELÂCHEMENT d'une réglette ou au clic du cadenas, jamais pendant un glissement. */
  protected readonly profil = signal<ProfilEssai>(PROFIL_DEFAUT);
  protected readonly codeProfil = computed(() => codeDuProfil(this.profil()));
  /** Cadenas fermé : UNE réglette, celle du seuil haut, dont le seuil bas hérite (`RegletteRayons.tsx`). */
  protected readonly reglettes = computed(() => {
    const p = this.profil();
    const niveaux: NiveauReglable[] = p.lie ? ['haut'] : ['haut', 'bas'];
    return niveaux.map((niveau) => {
      const anneaux = p[niveau];
      const interieurs = anneaux.slice(0, -1);
      const libelle = p.lie ? 'Tous les niveaux' : LIBELLE_NIVEAU[niveau];
      return {
        niveau,
        libelle,
        bord: anneaux[anneaux.length - 1] ?? RAYON_MIN_M,
        interieurs: interieurs.length > 0 ? `${interieurs.map(libelleRayon).join(' · ')} ·` : undefined,
        description: `Bord de la zone — ${libelle}, de ${RAYON_MIN_M} à ${RAYON_MAX_M} mètres`,
      };
    });
  });
  /** La légende suit le profil (React : `anneauxDuNiveau(profil, niveau)`). « Autres régimes » n'a pas d'anneau. */
  protected readonly niveauxLegende = computed<NiveauLegende[]>(() => {
    const p = this.profil();
    return [
      { libelle: LIBELLE_NIVEAU.haut, jeton: 'niveau-haut', anneaux: [...p.haut] },
      { libelle: LIBELLE_NIVEAU.bas, jeton: 'niveau-bas', anneaux: [...p.bas] },
      { libelle: LIBELLE_NIVEAU.autres, jeton: 'niveau-autres', anneaux: [] },
    ];
  });
  /** Le résumé de l'en-tête (`ResumeProfil.tsx`) : une puce par niveau réglé, puis « PPRT à part · N classes ». */
  protected readonly resumeProfil = computed(() => {
    const p = this.profil();
    const niveaux = (['haut', 'bas'] as const).filter((n) => p[n].length > 0);
    return {
      lignes: niveaux.map((n) => ({ libelle: LIBELLE_NIVEAU[n], anneaux: p[n].map(libelleRayon).join(' · ') })),
      // `classesDuProfil` hors « hors zone » : une classe PPRT par niveau réglé, puis une par anneau.
      classes: niveaux.reduce((t, n) => t + p[n].length + 1, 0),
    };
  });
  /** Le bandeau lit la population au BORD du seuil haut (React : `rayonMax` du profil). 5 km par défaut. */
  protected readonly rayonBandeau = computed(() => {
    const haut = this.profil().haut;
    return haut[haut.length - 1] ?? RAYON_MIN_M;
  });

  protected readonly etapes: EtapeAffichee[] = ETAPES.map((e, i) => ({
    cle: e.cle,
    rang: i + 1,
    libelle: e.libelle,
    // `etapeRenseignee` sur l'état par défaut : ① des régimes retenus, ② des anneaux ; ni territoire, ni jeu, ni campagne.
    renseignee: e.cle === 'sites' || e.cle === 'rayon',
  }));
  protected readonly segmentsAriane: SegmentAriane[] = [{ cle: 'france', libelle: 'France entière' }];

  /** Panneau replié (« Carte seule ») et largeur réglée à la poignée. */
  protected readonly carteSeule = signal(false);
  protected readonly largeurPanneau = signal(LARGEUR_PANNEAU_DEFAUT);

  /** Rayon du curseur du panneau ② : lecture IMMÉDIATE dans la courbe déjà chargée, aucun appel réseau (React : 1 km). */
  protected readonly rayonLecture = signal(1000);

  /** Le zoom courant (React : `useState(9)`, tenu par `m.on('zoom')`). */
  protected readonly zoom = signal(9);
  /** Sous le plancher de lecture, MapLibre ne demande AUCUNE tuile et n'émet aucune erreur : la carte paraîtrait vide sans ce bandeau. */
  protected readonly sousLeSeuilLisible = computed(() => this.zoom() < ZOOM_LISIBLE);
  /** Nombre de sites de la dernière vue chargée (React : `nSites`) ; `null` tant qu'aucune n'est arrivée. */
  protected readonly nbSitesAffiches = signal<number | null>(null);
  protected readonly texteNbSites = computed(() => {
    const n = this.nbSitesAffiches();
    return n === null ? '' : ` · ${formaterNombre(n)} sites affichés`;
  });

  protected readonly erreurCarte = signal<string | null>(null);
  protected readonly erreurZones = signal<string | null>(null);
  protected readonly erreurSites = signal<string | null>(null);
  protected readonly erreurCourbe = signal<string | null>(null);
  protected readonly reponseCourbe = signal<ReponseCourbe | null>(null);

  protected readonly zonesEnCours = signal(false);
  private readonly sitesEnCours = signal(false);
  private readonly courbeEnCours = signal(true);

  private readonly couleurs = inject(CouleursService).palette({
    haut: 'niveau-haut', bas: 'niveau-bas', autres: 'niveau-autres', trait: 'text-primary',
  });
  private readonly carte = signal<maplibregl.Map | null>(null);
  private readonly zonesPosees = signal(false);
  /** La préparation en vol : une nouvelle demande (relâchement d'une réglette) annule la précédente. */
  private preparation: Subscription | null = null;

  protected readonly series = computed<SerieCourbe[]>(() => {
    let rang = 0;
    return (this.reponseCourbe()?.courbes ?? []).map((c) => {
      const points = c.points.map((p) => [p.r, p.p] as const);
      if (c.cle === '*') {
        return { cle: c.cle, libelle: 'Toutes natures', jeton: 'brand-teal', points, epaisseur: 2.2, etiquetee: true };
      }
      const jeton = `nature-${(rang % NB_NATURES) + 1}`;
      rang++;
      return { cle: c.cle, libelle: c.cle, jeton, points };
    });
  });
  protected readonly domaineX = computed<readonly [number, number] | undefined>(() => {
    const r = this.reponseCourbe();
    return r ? [100, r.rayon_max_m] : undefined;
  });
  protected readonly rayonMaxCourbe = computed(() => this.reponseCourbe()?.rayon_max_m ?? RAYON_MAX_M);
  protected readonly habitantsBandeau = computed(() => {
    const totale = this.reponseCourbe()?.courbes.find((c) => c.cle === '*');
    const point = totale?.points.find((p) => p.r === this.rayonBandeau());
    return formaterNombre(point?.p);
  });
  protected readonly libelleBandeau = computed(() => `habitants à moins de ${libelleRayon(this.rayonBandeau())}`);
  protected readonly nbSites = computed(() => {
    const r = this.reponseCourbe();
    return r ? formaterNombre(r.n_sites) : '—';
  });
  /**
   * Les quatre chiffres du panneau ②, au rayon du curseur (`OngletRayonInfluence.tsx`) : le dernier palier
   * au-dessous du rayon, la part du total à 10 km, les sites et leurs départements, le gain du palier suivant.
   */
  protected readonly lecture = computed(() => {
    const r = this.reponseCourbe();
    const totale = r?.courbes.find((c) => c.cle === '*');
    if (!r || !totale || totale.points.length === 0) return null;
    let choisi = totale.points[0];
    for (const p of totale.points) if (p.r <= this.rayonLecture()) choisi = p;
    const part = totale.total > 0 ? (choisi.p / totale.total) * 100 : 0;
    const nDep = r.n_departements ?? 0;
    return {
      population: formaterNombre(choisi.p),
      libelle: `à moins de ${formaterDecimal(this.rayonLecture() / 1000)} km`,
      part: `${formaterDecimal(part)} %`,
      total: `${formaterNombre(totale.total)} au maximum`,
      sites: formaterNombre(r.n_sites),
      departements: `${nDep} département${nDep > 1 ? 's' : ''}`,
      increment: formaterNombre(choisi.i ?? 0),
    };
  });
  protected readonly rayonLectureKm = computed(() => `${formaterDecimal(this.rayonLecture() / 1000)} km`);
  /** Le repère suit le curseur du panneau : trait teal tireté, SANS libellé (React). */
  protected readonly repere = computed(() => ({ x: this.rayonLecture() }));
  /** Graduations fixes de 1 à 10 km (Recharts : `ticks`). */
  protected readonly graduationsX = Array.from({ length: 10 }, (_, i) => (i + 1) * 1000);
  protected readonly formaterX = (x: number) => `${x / 1000} km`;
  protected readonly formaterY = formaterNombreAbrege;
  protected readonly formaterValeur = (y: number) => formaterNombre(y);
  protected readonly formaterTitre = (x: number) => `à moins de ${formaterDecimal(x / 1000)} km`;
  /** Étiquettes de population tous les kilomètres, décochées par défaut comme en React. */
  protected readonly etiquettes = signal(false);
  /** Vrai tant que la courbe se charge : les chiffres du bandeau décrivent alors un état périmé (K5). */
  protected readonly chargementCourbe = this.courbeEnCours.asReadonly();
  /**
   * TEXTE DE LA PAGE D'ESSAI, que le lot 3 remplace par celui de l'écran réel : la structure est celle de
   * `BandeauKpi.tsx` (« Ces six chiffres suivent les filtres et le profil. Survolez-en un pour sa définition. »),
   * mais ce bandeau n'a que deux tuiles, aucun filtre branché et aucune définition en infobulle — la phrase ne promet
   * donc que ce qui est vrai (le chiffre de population suit le bord du seuil haut).
   */
  protected readonly consigneBandeau = 'Ces deux chiffres suivent le profil.';

  constructor() {
    this.chargement.suivre('zones', 'Préparation des zones', () => this.zonesEnCours());
    this.chargement.suivre('sites', 'Sites visibles', () => this.sitesEnCours());
    this.chargement.suivre('courbe', 'Courbe de couverture', () => this.courbeEnCours());

    // Désabonnement EXPLICITE et non `takeUntilDestroyed` : `@angular/core/rxjs-interop`
    // n'est pas partagé par un hôte AIDA par défaut, et sa copie lève NG0203
    // (tests/unit/angular/imports-partages.test.ts).
    this.destruction.onDestroy(() => this.preparation?.unsubscribe());
    const courbe = this.api.courbe('seveso_haut')
      .pipe(finalize(() => this.courbeEnCours.set(false)))
      .subscribe({
        next: (r) => this.reponseCourbe.set(r),
        error: (e: unknown) => this.erreurCourbe.set(messageErreurApi(e)),
      });
    this.destruction.onDestroy(() => courbe.unsubscribe());

    // Bascule de thème : on REPOSE les couleurs, on ne recrée ni la carte ni les sources
    // (les tuiles ne sont donc pas redemandées).
    effect(() => {
      const carte = this.carte();
      const c = this.couleurs();
      if (!carte) return;
      carte.setPaintProperty(COUCHE_SITES, 'circle-color', this.couleurSite(c));
      carte.setPaintProperty(COUCHE_SITES, 'circle-stroke-color', c.trait);
      if (this.zonesPosees()) {
        carte.setPaintProperty(COUCHE_ZONES, 'fill-color', this.couleurNiveau(c));
        carte.setPaintProperty(COUCHE_CONTOUR, 'line-color', this.couleurNiveau(c));
      }
    });
  }

  /** Un bouton de grappe recadre la carte avec une animation de 800 ms, marge 40 (`CarteRisque.tsx:980`). */
  protected allerA(bbox: Bbox): void {
    this.carte()?.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, duration: 800 });
  }

  protected surCartePrete(carte: maplibregl.Map): void {
    this.carte.set(carte);
    this.poserSites(carte);
    this.preparerZones(carte, this.codeProfil());
  }

  /** Relâchement d'une réglette de la barre commune : UNE construction de géométrie, puis les tuiles du nouveau profil. */
  protected validerBord(niveau: NiveauReglable, rayonM: number): void {
    this.changerProfil(poserBord(this.profil(), niveau, rayonM));
  }

  protected basculerCadenas(): void {
    this.changerProfil(basculerLiaison(this.profil()));
  }

  /** Curseur du panneau ② : lecture en mémoire, à chaque position (React `onChange`) — aucun appel n'en dépend. */
  protected lireRayon(ev: Event): void {
    this.rayonLecture.set(Number((ev.target as HTMLInputElement).value));
  }

  /** Poignée du panneau (React : `onPointerDown` + capture) ; la carte suit par le `ResizeObserver` de `mg-carte`. */
  protected saisirPoignee(ev: PointerEvent): void {
    const poignee = ev.currentTarget as HTMLElement;
    poignee.setPointerCapture?.(ev.pointerId);
    const depart = ev.clientX;
    const initiale = this.largeurPanneau();
    const deplacer = (e: PointerEvent) => {
      this.largeurPanneau.set(Math.max(LARGEUR_PANNEAU_MIN, Math.min(LARGEUR_PANNEAU_MAX, initiale + e.clientX - depart)));
    };
    const relacher = () => {
      poignee.removeEventListener('pointermove', deplacer);
      poignee.removeEventListener('pointerup', relacher);
      poignee.removeEventListener('pointercancel', relacher);
    };
    poignee.addEventListener('pointermove', deplacer);
    poignee.addEventListener('pointerup', relacher);
    poignee.addEventListener('pointercancel', relacher);
  }

  private changerProfil(suivant: ProfilEssai): void {
    if (codeDuProfil(suivant) === this.codeProfil()) {
      // Même code (bord ramené à sa valeur) : la réglette retombe sur `bord`, rien à reconstruire.
      this.profil.set(suivant);
      return;
    }
    this.profil.set(suivant);
    const carte = this.carte();
    if (carte) this.preparerZones(carte, this.codeProfil());
  }

  private preparerZones(carte: maplibregl.Map, code: string): void {
    this.preparation?.unsubscribe();
    this.erreurZones.set(null);
    this.zonesEnCours.set(true);
    this.preparation = this.api.preparer(code)
      .pipe(finalize(() => this.zonesEnCours.set(false)))
      .subscribe({
        // Les tuiles ne sont demandées QU'APRÈS la construction de la géométrie.
        next: () => this.poserZones(carte, code),
        error: (e: unknown) => this.erreurZones.set(messageErreurApi(e)),
      });
  }

  private poserZones(carte: maplibregl.Map, code: string): void {
    const url = this.api.urlTuilesZones(code);
    if (this.zonesPosees()) {
      // Profil changé : seule l'adresse des tuiles change ; la source et ses deux couches restent.
      (carte.getSource(SOURCE_ZONES) as maplibregl.VectorTileSource | undefined)?.setTiles([url]);
      return;
    }
    const c = this.couleurs();
    carte.addSource(SOURCE_ZONES, {
      type: 'vector',
      tiles: [url],
      minzoom: 4,
      maxzoom: 14,
    });
    // Sous les sites, pour qu'un point reste cliquable.
    carte.addLayer({
      id: COUCHE_ZONES, type: 'fill', source: SOURCE_ZONES, 'source-layer': COUCHE_TUILE,
      minzoom: ZOOM_LISIBLE,
      paint: {
        'fill-color': this.couleurNiveau(c) as never,
        'fill-opacity': ['step', ['zoom'], OPACITE_FONDUE, ZOOM_DETAIL, [
          'case',
          ['==', ['get', 'bande'], null], OPACITE_PPRT,
          ['==', ['get', 'bande'], 1], OPACITE_BANDES[0],
          ['==', ['get', 'bande'], 2], OPACITE_BANDES[1],
          ['==', ['get', 'bande'], 3], OPACITE_BANDES[2],
          OPACITE_BANDES[3],
        ]] as never,
      },
    }, COUCHE_SITES);
    carte.addLayer({
      id: COUCHE_CONTOUR, type: 'line', source: SOURCE_ZONES, 'source-layer': COUCHE_TUILE,
      minzoom: ZOOM_DETAIL,
      paint: { 'line-color': this.couleurNiveau(c) as never, 'line-width': 1, 'line-opacity': 0.9 },
    }, COUCHE_SITES);
    this.zonesPosees.set(true);
  }

  private poserSites(carte: maplibregl.Map): void {
    const c = this.couleurs();
    carte.addSource(SOURCE_SITES, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    carte.addLayer({
      id: COUCHE_SITES, type: 'circle', source: SOURCE_SITES,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 13, 5.5],
        'circle-color': this.couleurSite(c) as never,
        'circle-stroke-color': c.trait,
        'circle-stroke-width': 1,
      },
    });
    carte.on('click', COUCHE_SITES, (e: maplibregl.MapLayerMouseEvent) => this.ouvrirPopup(carte, e));

    // UNE requête après l'arrêt du mouvement, sur la bbox visible — jamais sans bbox.
    const arreter = chargerParCadre(
      carte,
      (b) => {
        this.sitesEnCours.set(true);
        return this.api.sites(bboxEnParametre(b)).pipe(finalize(() => this.sitesEnCours.set(false)));
      },
      (fc) => {
        this.erreurSites.set(null);
        this.nbSitesAffiches.set(Array.isArray(fc?.features) ? fc.features.length : null);
        (carte.getSource(SOURCE_SITES) as maplibregl.GeoJSONSource | undefined)?.setData(fc);
      },
      { surEchec: (e) => this.erreurSites.set(messageErreurApi(e)) },
    );
    this.destruction.onDestroy(arreter);
  }

  /** Propriétés lues dans la réponse réelle de /api/map/risques-industriels : nom, ville, statut_seveso, libelle_nature. */
  private ouvrirPopup(carte: maplibregl.Map, e: maplibregl.MapLayerMouseEvent): void {
    const p = (e.features?.[0]?.properties ?? {}) as Record<string, unknown>;
    // Statut · ville · nature, dans l'ordre de React (`CarteRisque.tsx:667`).
    const details = [p['statut_seveso'], p['ville'], p['libelle_nature']].map((v) => (v ? String(v) : null));
    new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
      .setLngLat(e.lngLat)
      .setDOMContent(contenuPopup(String(p['nom'] ?? 'Site sans nom'), details))
      .addTo(carte);
  }

  private couleurNiveau(c: Teintes): unknown[] {
    return ['match', ['get', 'niveau'], 'haut', c.haut, 'bas', c.bas, c.autres];
  }

  private couleurSite(c: Teintes): unknown[] {
    return ['match', ['get', 'gravite'], 'seveso_haut', c.haut, 'seveso_bas', c.bas, c.autres];
  }
}
