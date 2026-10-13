import {
  ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, output, signal,
  untracked, viewChild,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import type maplibregl from 'maplibre-gl';
import { CarteComponent } from '../../carte/carte.component';
import { CouleursService } from '../../core/theme/couleurs.service';
import type { SegmentAriane } from '../../ui/fil-ariane/fil-ariane.component';
import { IconeComponent } from '../../ui/icone/icone.component';
import { AnnonceComponent } from './commun/annonce.component';
import { DessinService } from './couches/dessin.service';
import { BatailleService } from './couches/bataille.service';
import { CarreauxService } from './couches/carreaux.service';
import { ApercuClusteringService } from './couches/apercu-clustering.service';
import { ClustersService } from './couches/clusters.service';
import { DetailIrisComponent } from './couches/detail-iris.component';
import { IndicateursCiviquesService } from './couches/indicateurs-civiques.service';
import { IrisService } from './couches/iris.service';
import { MeteoService } from './couches/meteo.service';
import { OohService } from './couches/ooh.service';
import { PoisService } from './couches/pois.service';
import { PprtService } from './couches/pprt.service';
import { RadioService } from './couches/radio.service';
import { RisquesIndustrielsService } from './couches/risques-industriels.service';
import { SanteService } from './couches/sante.service';
import { ScoreService } from './couches/score.service';
import { TiroirPanneauComponent } from './couches/tiroir-panneau.component';
import { TmjaService } from './couches/tmja.service';
import { TransportService } from './couches/transport.service';
import { ZonesRisqueService } from './couches/zones-risque.service';
import { ZoneActiveComponent } from './couches/zone-active.component';
import { ZonesCustomService } from './couches/zones-custom.service';
import { JETONS_STYLE_MAGELIAN, appliquerStyleMagelian, couchesDuFond } from './couches/style-magelian';
import { AnnonceService } from './etat/annonce.service';
import { CataloguePoiService } from './etat/catalogue-poi.service';
import { CaptureService } from './etat/capture.service';
import { CouchesCarteService } from './etat/couches-carte.service';
import { EtatCarteService } from './etat/etat-carte.service';
import { ExportZoneService } from './etat/export-zone.service';
import { lireFondMemorise, memoriserFond, urlDuFond } from './etat/fond-carte';
import { LienZoneService } from './etat/lien-zone.service';
import { ParcoursService } from './etat/parcours.service';
import { PileEchapService } from './etat/pile-echap.service';
import { PlanMediaService } from './etat/plan-media.service';
import { PONT_CARTE } from './etat/pont-carte';
import { ReferentielGeoService } from './etat/referentiel-geo.service';
import { ContoursZonesService } from './etat/contours-zones.service';
import { RisqueCarteService } from './etat/risque-carte.service';
import { LegendeCarteComponent } from './legende/legende-carte.component';
import { ignorerRaccourciClavier } from './logique/garde-saisie';
import { franciserLibelles } from './logique/libelles-fr';
import { ETAPES_CARTE, etapeParRaccourci, etapesDuFil, lireEtape, precisionDuPerimetre, segmentsDuFiltre } from './logique/parcours';
import { DialogueMeteoComponent } from './panneaux/calques/dialogue-meteo.component';
import { PanneauCalquesComponent } from './panneaux/calques/panneau-calques.component';
import { PanneauFiltreComponent } from './panneaux/filtre/panneau-filtre.component';
import { PanneauZonesComponent } from './panneaux/zones/panneau-zones.component';
import { PanneauAnalyseComponent } from './panneaux/analyse/panneau-analyse.component';
import { BatailleV1Service } from './etat/bataille-v1.service';
import { BatailleV2Service } from './etat/bataille-v2.service';
import { ContexteBatailleService } from './etat/contexte-bataille.service';
import { PlanMediaComponent } from './panneaux/zones/plan-media.component';
import { BarreParcoursComponent } from './parcours/barre-parcours.component';
import { BoiteOutilsComponent, ecartOutils } from './outils/boite-outils.component';
import { OutilsCarteService } from './outils/outils-carte.service';
import { EtapeBientotComponent } from './parcours/etape-bientot.component';
import { PanneauEtapeComponent } from './parcours/panneau-etape.component';
import { suivreMargeCarte } from './couches/marge-carte';

/** Centre et zoom d'ouverture de React (`useMapInit.ts:131-132`). */
const CENTRE_INITIAL: [number, number] = [2.3, 46.6];
const ZOOM_INITIAL = 5.5;

/**
 * Palier de carreaux servi à ce zoom — miroir de la cascade de `get_tile` (sql/129) et du badge de
 * React (`useMapInit.ts:170-176`) : le tiret ne reste que sous z4, où aucune tuile n'est servie.
 */
export function palierCarreaux(zoom: number): string {
  const z = Math.floor(zoom);
  return z >= 12 ? '200m' : z >= 9 ? '1km' : z >= 8 ? '2km' : z >= 7 ? '5km' : z >= 4 ? '20km' : '—';
}

/**
 * La carte principale, en PARCOURS (spec 2026-10-13, lot 1) — ① Périmètre › ② Données › ③ Analyse › ④ Zones ›
 * ⑤ Plan › ⑥ Activation › ⑦ Live. Portage d'origine : `app/map/page.tsx` (lot 4 Angular).
 *
 * ── BARRE DU PARCOURS, PUIS LA CARTE ; LE PANNEAU D'ÉTAPE FLOTTE DESSUS ───
 * Une colonne : la barre (`mg-barre-parcours`), puis le conteneur de la carte, seul dans sa rangée. Le panneau de l'étape
 * courante (`mg-panneau-etape`, poignée, repli « carte seule ») FLOTTE dans ce conteneur (T4b, Vincent 13/10) : la carte
 * garde toute sa largeur ; son bord droit (`--emprise-panneau`) écarte badge de zoom, zone active et légende. Rien en
 * `fixed` (racine d'ombre : il se poserait sur la fenêtre du SHELL). L'étape vit dans `?etape=` (`ParcoursService`) ; un
 * panneau visité reste MONTÉ (invisible et inerte quitté, arbitrage A1) — un calcul lui survit, revenir ne relit rien.
 *
 * ── UN SEUL ÉCOUTEUR CLAVIER, SUR L'HÔTE (arbitrage B10) ─────────────────
 * Jamais `window`/`document` (ceux du shell). L'hôte est focalisable (`tabindex="-1"`) et focalisé
 * au montage ; les frappes venues de l'intérieur de la page y remontent (`composed`). La garde de
 * saisie lit la cible COMPOSÉE (`composedPath()[0]`) : dans une racine d'ombre, `document.activeElement`
 * est l'HÔTE de la racine, jamais le champ où l'on tape.
 *
 * ── CHANGER DE FOND RECRÉE LA CARTE (arbitrage B11, T4) ──────────────────
 * Comme React (`useMapInit.ts:1083-1089`, dépendance `[mapStyleUrl]`) : `mg-carte` est rendu sous
 * `@for (f of [fond()]; track f)`, donc un nouvel id détruit l'instance et en crée une autre. `carteCourante`
 * passe par `null` AVANT la recréation ; chaque couche se re-pose par son `effect` (`CouchesCarteService`).
 * Le suivi porte sur l'ID du fond et non sur l'URL : « Clair » et « MAGELIAN » partagent Positron, et passer
 * de l'un à l'autre doit poser — ou retirer — les surcharges MAGELIAN. Défaut React corrigé : là-bas, l'URL
 * ne contient jamais « magelian », les surcharges ne s'appliquaient donc JAMAIS et les deux boutons
 * s'allumaient ensemble.
 *
 * ── LA PILE ÉCHAP EST UN SERVICE DE LA PAGE ──────────────────────────────
 * Le mode immersif, le tiroir de la boîte à outils (`OutilsCarteService`, T5) et ce que les panneaux y empilent : dernier
 * ouvert = premier fermé (`PileEchapService`). Le panneau d'étape n'y est pas : il ne se ferme pas, il se replie.
 */
@Component({
  selector: 'mg-carte-principale',
  imports: [
    AnnonceComponent, BarreParcoursComponent, BoiteOutilsComponent, CarteComponent, DetailIrisComponent, DialogueMeteoComponent,
    EtapeBientotComponent, IconeComponent, LegendeCarteComponent, PanneauAnalyseComponent, PanneauCalquesComponent, PanneauEtapeComponent,
    PanneauFiltreComponent, PanneauZonesComponent, PlanMediaComponent, RouterOutlet, TiroirPanneauComponent, ZoneActiveComponent,
  ],
  providers: [ParcoursService, OutilsCarteService, EtatCarteService, CouchesCarteService, PileEchapService, AnnonceService, ReferentielGeoService, CarreauxService,
    IrisService, PoisService, OohService, TransportService, CataloguePoiService, TmjaService, RadioService,
    IndicateursCiviquesService, SanteService, ContoursZonesService, MeteoService, RisqueCarteService, RisquesIndustrielsService,
    PprtService, ZonesRisqueService, BatailleService, ZonesCustomService, LienZoneService, ExportZoneService, PlanMediaService,
    CaptureService, DessinService,
    // Le score composite peint (T18) : à la PAGE — quitter l'étape Analyse ne l'éteint pas, comme React.
    ScoreService,
    // Les batailles d'isochrones (T17) : à la PAGE, pas au panneau — changer d'étape ne coupe pas un calcul en cours.
    ContexteBatailleService, BatailleV1Service, BatailleV2Service,
    // Le clustering (T19) : à la PAGE — quitter l'étape Analyse laisse les clusters sur la carte, comme React (`page.tsx:245`).
    ClustersService,
    // L'aperçu des POI de l'assistant de clustering (T20) : une couche de la carte, pilotée par l'assistant.
    ApercuClusteringService,
    // Le pont du module risque (B3) : le module, rendu par l'outlet de cette page, le voit par son injecteur d'élément.
    { provide: PONT_CARTE, useExisting: ZonesRisqueService },
  ],
  templateUrl: './carte.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative flex h-full flex-col overflow-hidden bg-[var(--bg-primary)] outline-none',
    tabindex: '-1',
    '(keydown)': 'clavier($event)',
  },
})
export class CartePage {
  /** Émis après un changement d'espace réussi : l'hôte de la route recrée la page (droits sur la carte, T3). */
  readonly espaceChange = output<void>();
  protected readonly etat = inject(EtatCarteService);
  /** L'étape courante et les étapes visitées, reflétées dans `?etape=` (T2). */
  protected readonly parcours = inject(ParcoursService);
  private readonly couches = inject(CouchesCarteService);
  private readonly pile = inject(PileEchapService);
  private readonly hote = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injecteur = inject(Injector);
  private readonly iris = inject(IrisService);
  private readonly pois = inject(PoisService);
  private readonly tmja = inject(TmjaService);
  private readonly radio = inject(RadioService);
  private readonly risqueCarte = inject(RisqueCarteService);
  /** La météo (T11) : la page monte son dialogue, comme la modale de `page.tsx:1456-1488`. */
  protected readonly meteo = inject(MeteoService);
  private readonly document = inject(DOCUMENT);
  private readonly annonce = inject(AnnonceService);
  private readonly exports = inject(ExportZoneService);
  /** Le lien `?customZone=` (T14) : lu dès l'ouverture de la carte, quelle que soit l'étape. */
  protected readonly lienZone = inject(LienZoneService);
  /** Le plan média des zones affichées (T15) : panneau droit du conteneur carte, et l'écart des outils quand il est ouvert. */
  protected readonly planMedia = inject(PlanMediaService);
  /** La boîte à outils (T5) : l'outil ouvert, la légende affichée. */
  protected readonly outils = inject(OutilsCarteService);
  /** Écartée du plan média, du détail IRIS et du tiroir Street View ouverts (ruling AT-3) ; les annonces sous elle. */
  protected readonly decalageOutils = computed(() => ecartOutils({
    planMedia: this.planMedia.visible(), detailIris: this.iris.codeSelectionne() !== null, streetView: this.pois.panneauSelectionne() !== null,
  }));
  /** « Plan média (n) » : des zones affichées, panneau fermé (`page.tsx:1222`). */
  protected readonly zonesPlanFerme = computed(() => {
    const n = this.planMedia.zones().length;
    return n > 0 && !this.planMedia.ouvert() ? n : null;
  });

  /** « Carte seule » : local, jamais dans l'URL (comme le risque). */
  protected readonly panneauReplie = signal(false);
  private readonly panneauEtape = viewChild(PanneauEtapeComponent);
  /** Les panneaux montés, dans l'ordre du parcours. */
  protected readonly etapesMontees = computed(() => ETAPES_CARTE.filter((e) => this.parcours.visitees().has(e)));
  /**
   * Les pastilles « renseignée » (arbitrage A2). Celle de ② est PARTIELLE jusqu'à la tâche 13 (ruling AT-4) : l'OOH et
   * le transport tiennent leur état dans un service fourni par le panneau Calques, invisible de la page.
   */
  protected readonly etapes = computed(() => etapesDuFil({
    filtrePose: this.etat.filtre() !== null || this.etat.perimetreScope() !== null,
    calquesActifs: this.etat.degradeActif() !== null || this.etat.poiSelectionnes().length > 0 || this.tmja.visible()
      || this.radio.visible() || this.risqueCarte.actif() || this.risqueCarte.pprtActif(),
  }));
  protected readonly segmentsAriane = computed<SegmentAriane[]>(() => segmentsDuFiltre(this.etat.filtre()));
  protected readonly precisionAriane = computed(() => precisionDuPerimetre(this.etat.perimetreScope()));

  /**
   * L'id du fond (`MAP_STYLES[].id`), lu dans `localStorage['genesis_map_style']` à l'ouverture et écrit au choix
   * (B9). Un stockage qui lève rend le fond par défaut.
   */
  readonly fond = signal(lireFondMemorise(() => this.document.defaultView?.localStorage));
  protected readonly urlFond = computed(() => urlDuFond(this.fond()));
  /** Les couleurs du fond MAGELIAN : un `Signal` qui suit le thème (lu seulement quand ce fond est choisi). */
  private readonly paletteMagelian = inject(CouleursService).palette(JETONS_STYLE_MAGELIAN);
  /** Les ids du style de FOND de chaque instance, relevés au `load` avant toute couche de l'application. */
  private readonly couchesFond = new WeakMap<maplibregl.Map, ReadonlySet<string>>();
  protected readonly centre = CENTRE_INITIAL;
  protected readonly zoomInitial = ZOOM_INITIAL;
  protected readonly navigation = { position: 'bottom-right', boussole: true } as const;

  /** Zoom courant ; le badge s'affiche dès l'ouverture, avant le `load` du fond, comme React. */
  private readonly zoom = signal(ZOOM_INITIAL);
  /**
   * Le module risque est-il rendu par l'outlet (route enfant `risques`, B2) ? Tenu par `activate`/`deactivate` de
   * l'outlet : le calque qui le porte n'occupe la page que pendant ce temps — sinon il intercepterait les clics sur la carte.
   */
  protected readonly moduleOuvert = signal(false);
  protected readonly texteZoom = computed(() => `z${Math.floor(this.zoom())}  ${palierCarreaux(this.zoom())}`);

  constructor() {
    // Mode immersif dans la pile Échap (`page.tsx:288-293`) : Échap ré-affiche la barre et le panneau.
    effect((nettoyer) => {
      if (!this.etat.immersif()) return;
      this.pile.empiler('immersif', () => this.etat.immersif.set(false));
      nettoyer(() => this.pile.depiler('immersif'));
    });

    inject(DestroyRef).onDestroy(() => this.couches.publier(null));
    // Les choroplèthes « Environnement » (T10, et la météo T11, injectée plus haut) existent dès l'ouverture : elles
    // s'inscrivent à l'éviction de leur dégradé et à « Tout effacer » avant tout geste, même étape ② jamais visitée.
    inject(IndicateursCiviquesService);
    inject(SanteService);
    // Les couches de risque (T12) : instanciées ici, elles vivent avec la page et non avec le panneau Calques — sites et
    // périmètres restent sur la carte à toute étape, comme les couches React montées par `page.tsx:1187-1214`.
    inject(RisquesIndustrielsService);
    inject(PprtService);
    // Les zones d'un profil (T13) : inscrites à l'éviction de leur dégradé dès l'ouverture, avant tout « Voir sur la carte ».
    inject(ZonesRisqueService);
    // Les zones custom (T14-T15) : instanciées dès l'ouverture, comme avant la tâche 3 des droits sur la carte, qui a retiré
    // le seul appel direct de la page (`effacer()` au changement d'espace).
    inject(ZonesCustomService);
    suivreMargeCarte(this.couches.carteCourante, () => this.panneauEtape()?.decalageCarte() ?? 0, this.decalageOutils); // I-1 de T4b

    // Le fond MAGELIAN : surcharges posées sur la carte prête, ré-appliquées à chaque bascule de thème
    // (`useMapInit.ts:217-221,1091-1102`). `carteCourante` est publiée au `load` : le style
    // de FOND est chargé (même si `isStyleLoaded()` peut rester faux le temps des tuiles, voir `quandStyleCharge`).
    effect(() => {
      const carte = this.couches.carteCourante();
      if (!carte || this.fond() !== 'magelian') return;
      const fond = this.couchesFond.get(carte);
      if (fond) appliquerStyleMagelian(carte, this.paletteMagelian(), fond);
    });

    // Un élément qui portait le focus et se retire (détail IRIS, tiroir Street View d'un panneau, dialogue météo) le
    // laisserait sur <body> du document — hors de l'unique écouteur clavier (B10) : Alt+1..7 et Échap ne répondraient plus.
    this.rendreFocusALaFermeture(() => this.iris.codeSelectionne() !== null);
    this.rendreFocusALaFermeture(() => this.pois.panneauSelectionne() !== null);
    this.rendreFocusALaFermeture(this.meteo.dialogueOuvert);
    // Le module risque (T13) : il portait le focus, il disparaît avec l'outlet. Le tiroir de la boîte à outils (T5) : inerte.
    this.rendreFocusALaFermeture(this.moduleOuvert);
    this.rendreFocusALaFermeture(() => this.outils.outil() !== null);

    // Le focus sur l'hôte à l'ouverture (sans lui, aucun raccourci ne l'atteint avant le premier clic), puis après
    // chaque geste qui CACHE ce qui le portait : l'étape quittée devient inerte, le panneau replié et la barre de
    // l'immersif disparaissent — le bouton cliqué, ou le champ du panneau quitté, ne peut plus le garder. Seulement si
    // le focus était DANS la page au moment du geste (relevé avant le rendu) : un `?etape=` écrit de l'extérieur
    // pendant que le focus est dans le shell AIDA ne le lui vole pas (relecture T4, m3).
    let ouverture = true;
    effect(() => {
      this.parcours.etape();
      this.panneauReplie();
      this.etat.immersif();
      const actif = untracked(() => this.elementActif());
      const dansLaPage = ouverture || (!!actif && this.hote.nativeElement.contains(actif));
      ouverture = false;
      if (dansLaPage) afterNextRender(() => this.rendreFocus(), { injector: this.injecteur });
    });
  }

  protected choisirEtape(cle: string): void {
    const e = lireEtape(cle);
    if (e) this.parcours.choisir(e);
  }

  /** « France entière » du fil d'Ariane : retire le filtre — la croix de l'ancienne puce. */
  protected remonterAriane(index: number): void {
    if (index === 0) this.etat.filtre.set(null);
  }

  protected basculerImmersif(): void {
    this.etat.immersif.update((m) => !m);
  }

  /** L'outil « Fond de carte » de la boîte à outils (T5). Le même id ne recrée rien. */
  protected choisirFond(id: string): void {
    if (id === this.fond()) return;
    // Avant la recréation : aucun effet de couche n'écrit dans l'instance qui va être détruite.
    this.couches.publier(null);
    this.fond.set(id);
    memoriserFond(() => this.document.defaultView?.localStorage, id);
  }

  /**
   * « Tout effacer » (`page.tsx:681-765`) : chaque couche inscrite s'efface, le dégradé actif est remis à zéro
   * SANS annonce (`page.tsx:740-743`), et le périmètre et les POI sélectionnés repartent à vide. Le filtre unique
   * reste posé, comme React. Le paramètre `customZone` (B9) est retiré par l'effacement que `LienZoneService`
   * inscrit — comme `page.tsx:760-763`, pour qu'un rechargement ne rouvre pas la zone ; `etape` reste.
   */
  protected toutEffacer(): void {
    this.couches.toutEffacer();
    this.etat.reinitialiserDegrade();
    this.etat.perimetreScope.set(null);
    this.etat.poiSelectionnes.set([]);
  }

  /**
   * Changement d'espace (organisation active) dans la barre du parcours : la page le signale à son hôte
   * (`CarteHoteComponent`), qui la RECRÉE — l'équivalent du `window.location.reload()` de React (droits sur la carte,
   * T3). Tous les services d'état de la carte sont fournis ici (`providers`) : la recréation remet à zéro TOUT ce qui
   * dépend du périmètre (catalogue POI, points, panneaux, batailles, zones, analyses, plan média), sans liste
   * d'invalidations à tenir à jour.
   */
  protected organisationChangee(): void {
    this.espaceChange.emit();
  }

  /** « Script bidding DV360 » de la zone du lien (`page.tsx:1377-1399`) : un FICHIER, aucun envoi vers DV360. */
  protected genererScriptDv360(): void {
    const zone = this.lienZone.zoneDuLien();
    if (!zone) return;
    void this.exports.exporter(zone.id, 'bidding_script').then((echec) => {
      if (echec) this.annonce.annoncer(echec);
    });
  }

  protected cartePrete(carte: maplibregl.Map): void {
    // Libellés du fond en français, au `load` comme React (`useMapInit.ts:209-215`).
    franciserLibelles(carte as unknown as Parameters<typeof franciserLibelles>[0]);
    // AVANT la publication : aucune couche de l'application n'existe encore, le style ne porte que le fond.
    this.couchesFond.set(carte, couchesDuFond(carte));
    this.couches.publier(carte);
  }

  protected zoomChange(z: number): void {
    this.zoom.set(z);
  }

  /** À chaque passage de `ouvert` de vrai à faux, le focus revient à l'hôte s'il n'est plus dans la page. */
  private rendreFocusALaFermeture(ouvert: () => boolean): void {
    let etaitOuvert = false;
    effect(() => {
      const o = ouvert();
      if (etaitOuvert && !o) afterNextRender(() => this.rendreFocus(), { injector: this.injecteur });
      etaitOuvert = o;
    });
  }

  /** L'élément focalisé, lu dans la racine qui porte la page (`document.activeElement` y serait l'hôte d'ombre). */
  private elementActif(): Element | null {
    return (this.hote.nativeElement.getRootNode() as Document | ShadowRoot).activeElement;
  }

  /**
   * Rend le focus à l'hôte s'il n'est plus nulle part dans la page (élément retiré pendant qu'il le portait), ou s'il
   * est resté sur un élément devenu inatteignable : dans l'étape quittée (`inert`) ou dans le panneau caché.
   */
  private rendreFocus(): void {
    const el = this.hote.nativeElement;
    const actif = this.elementActif();
    const cache = !!actif && actif !== el && (actif.closest('[inert]') !== null || getComputedStyle(actif).visibility === 'hidden');
    if (!actif || !el.contains(actif) || cache) el.focus({ preventScroll: true });
  }

  /**
   * Échap n'est JAMAIS filtré par la garde de saisie. Un Échap déjà consommé par un gestionnaire INTÉRIEUR
   * (`preventDefault()`) ne ferme rien de plus : c'est le cas d'un menu ouvert du badge de session, qui consomme Échap
   * sur son propre hôte AVANT que la frappe ne remonte ici (`BadgeSessionComponent.echap`). Alt+1…Alt+7 choisissent
   * l'étape (`etapeParRaccourci`, lu sur la touche physique : Alt+1 marche en AZERTY). Alt+C (l'ancienne Campagne) et
   * Ctrl+K (l'Assistant, retiré le 2026-10-12) ne mènent plus à rien : la frappe n'est pas captée.
   */
  protected clavier(e: KeyboardEvent): void {
    // `nodeType` et non `instanceof Element` : la cible peut venir d'un autre domaine de JavaScript.
    const premier = e.composedPath()[0] as Node | undefined;
    const cible = premier && premier.nodeType === 1 ? (premier as Element) : null;
    if (ignorerRaccourciClavier(e.key, cible)) return;
    if (e.key === 'Escape') {
      if (e.defaultPrevented) return;
      e.preventDefault();
      this.pile.fermerLePlusHaut();
      return;
    }
    // Sous le module risque, le parcours ne bouge pas : un raccourci n'écrit pas l'URL de la carte dessous (Review Focus 2).
    if (this.moduleOuvert()) return;
    const etape = etapeParRaccourci(e);
    if (!etape) return;
    e.preventDefault();
    this.parcours.choisir(etape);
  }
}
