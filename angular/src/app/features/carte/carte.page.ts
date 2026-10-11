import {
  ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, viewChild,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import type maplibregl from 'maplibre-gl';
import { CarteComponent } from '../../carte/carte.component';
import { CouleursService } from '../../core/theme/couleurs.service';
import { AnnonceComponent } from './commun/annonce.component';
import { BoutonsFlottantsComponent } from './commun/boutons-flottants.component';
import { FondCompactComponent } from './commun/fond-compact.component';
import { DessinService } from './couches/dessin.service';
import { BatailleService } from './couches/bataille.service';
import { CarreauxService } from './couches/carreaux.service';
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
import { PileEchapService } from './etat/pile-echap.service';
import { PlanMediaService } from './etat/plan-media.service';
import { PONT_CARTE } from './etat/pont-carte';
import { ReferentielGeoService } from './etat/referentiel-geo.service';
import { ContoursZonesService } from './etat/contours-zones.service';
import { RisqueCarteService } from './etat/risque-carte.service';
import { PuceFiltreComponent } from './filtre/puce-filtre.component';
import { LegendeCarteComponent } from './legende/legende-carte.component';
import { ignorerRaccourciClavier } from './logique/garde-saisie';
import { franciserLibelles } from './logique/libelles-fr';
import { ENTREES_NAVIGATION, LARGEUR_RAIL, type EntreeId, entreeParRaccourci } from './logique/navigation';
import { AideComponent } from './panneaux/aide.component';
import { DialogueMeteoComponent } from './panneaux/calques/dialogue-meteo.component';
import { PanneauCalquesComponent } from './panneaux/calques/panneau-calques.component';
import { PanneauFiltreComponent } from './panneaux/filtre/panneau-filtre.component';
import { ReglagesComponent } from './panneaux/reglages.component';
import { PanneauZonesComponent } from './panneaux/zones/panneau-zones.component';
import { PanneauAnalyseComponent } from './panneaux/analyse/panneau-analyse.component';
import { BatailleV1Service } from './etat/bataille-v1.service';
import { BatailleV2Service } from './etat/bataille-v2.service';
import { ContexteBatailleService } from './etat/contexte-bataille.service';
import { LARGEUR_PLAN_MEDIA, PlanMediaComponent } from './panneaux/zones/plan-media.component';
import { BarreHautComponent, HAUTEUR_BARRE_HAUT } from './rail/barre-haut.component';
import { PanneauComponent } from './rail/panneau.component';
import { RailComponent } from './rail/rail.component';

/** Couleur du point de l'en-tête du panneau, par entrée — `DOT_PAR_ENTREE` de `app/map/page.tsx:111-118`. */
const POINT_PAR_ENTREE: Partial<Record<EntreeId, string>> = {
  filtre: 'var(--cat-context)',
  calques: 'var(--cat-terrain)',
  analyse: 'var(--cat-analysis)',
  zones: 'var(--brand-teal)',
  reglages: 'var(--text-tertiary)',
  aide: 'var(--text-tertiary)',
};

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
 * La carte principale — portage de `app/map/page.tsx` (lot 4). Cette tâche (T3) en pose le
 * SQUELETTE : route, rail, barre du haut, panneau gauche, état transverse, clavier, mode immersif,
 * badge de zoom ; chaque panneau et chaque couche arrivent dans les tâches suivantes (T4-T20).
 *
 * ── UNE ROUTE PLEIN ÉCRAN (arbitrage B1) ─────────────────────────────────
 * React posait tout en `position: fixed` (enveloppe, rail, barre, boutons flottants). Dans la racine
 * d'ombre, `fixed` se poserait sur la fenêtre du SHELL : tout est `absolute` dans l'hôte `relative`,
 * avec les mêmes `z-index` relatifs (rail 30 < panneau 40 < barre 45 < boutons 50).
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
 * Panneau et mode immersif s'y empilent : dernier ouvert = premier fermé (`PileEchapService`).
 */
@Component({
  selector: 'mg-carte-principale',
  imports: [
    AideComponent, AnnonceComponent, BarreHautComponent, BoutonsFlottantsComponent, CarteComponent, DetailIrisComponent, DialogueMeteoComponent,
    FondCompactComponent, LegendeCarteComponent, PanneauAnalyseComponent, PanneauCalquesComponent, PanneauComponent, PanneauFiltreComponent, PanneauZonesComponent, PlanMediaComponent, PuceFiltreComponent,
    RailComponent, ReglagesComponent, RouterOutlet, TiroirPanneauComponent, ZoneActiveComponent,
  ],
  providers: [EtatCarteService, CouchesCarteService, PileEchapService, AnnonceService, ReferentielGeoService, CarreauxService,
    IrisService, PoisService, OohService, TransportService, CataloguePoiService, TmjaService, RadioService,
    IndicateursCiviquesService, SanteService, ContoursZonesService, MeteoService, RisqueCarteService, RisquesIndustrielsService,
    PprtService, ZonesRisqueService, BatailleService, ZonesCustomService, LienZoneService, ExportZoneService, PlanMediaService,
    CaptureService, DessinService,
    // Le score composite peint (T18) : à la PAGE — fermer le panneau Analyse ne l'éteint pas, comme React.
    ScoreService,
    // Les batailles d'isochrones (T17) : à la PAGE, pas au panneau — fermer le panneau ne coupe pas un calcul en cours.
    ContexteBatailleService, BatailleV1Service, BatailleV2Service,
    // Le clustering (T19) : à la PAGE — fermer le panneau Analyse laisse les clusters sur la carte, comme React (`page.tsx:245`).
    ClustersService,
    // Le pont du module risque (B3) : le module, rendu par l'outlet de cette page, le voit par son injecteur d'élément.
    { provide: PONT_CARTE, useExisting: ZonesRisqueService },
  ],
  templateUrl: './carte.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative flex h-full overflow-hidden bg-[var(--bg-primary)] outline-none transition-[padding] duration-200 ease-[var(--ease-out)]',
    tabindex: '-1',
    '[style.padding-left.px]': 'etat.railMasque() ? 0 : largeurRail',
    '[style.padding-top.px]': 'etat.railMasque() ? 0 : hauteurBarre',
    '(keydown)': 'clavier($event)',
    '(mousedown)': 'pointerHors($event)',
  },
})
export class CartePage {
  protected readonly etat = inject(EtatCarteService);
  private readonly couches = inject(CouchesCarteService);
  private readonly pile = inject(PileEchapService);
  private readonly hote = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injecteur = inject(Injector);
  private readonly iris = inject(IrisService);
  private readonly pois = inject(PoisService);
  /** La météo (T11) : la page monte son dialogue, comme la modale de `page.tsx:1456-1488`. */
  protected readonly meteo = inject(MeteoService);
  private readonly document = inject(DOCUMENT);
  private readonly annonce = inject(AnnonceService);
  private readonly zonesCustom = inject(ZonesCustomService);
  private readonly exports = inject(ExportZoneService);
  /** Le lien `?customZone=` (T14) : lu dès l'ouverture de la carte, même panneau Zones fermé. */
  protected readonly lienZone = inject(LienZoneService);
  /** Le plan média des zones affichées (T15) : panneau droit, et l'écart des boutons flottants quand il est ouvert. */
  protected readonly planMedia = inject(PlanMediaService);
  protected readonly decalageBoutons = computed(() => 10 + (this.planMedia.visible() ? LARGEUR_PLAN_MEDIA + 10 : 0));
  /** « Plan média (n) » : des zones affichées, panneau fermé (`page.tsx:1222`). */
  protected readonly zonesPlanFerme = computed(() => {
    const n = this.planMedia.zones().length;
    return n > 0 && !this.planMedia.ouvert() ? n : null;
  });

  protected readonly largeurRail = LARGEUR_RAIL;
  protected readonly hauteurBarre = HAUTEUR_BARRE_HAUT;
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

  /** L'entrée active, si elle s'ouvre dans le panneau gauche (`page.tsx:1173`). */
  protected readonly panneau = computed(() => {
    const id = this.etat.entreeActive();
    const entree = id ? ENTREES_NAVIGATION.find((e) => e.id === id) : undefined;
    if (!entree || entree.type !== 'panneau-gauche') return null;
    return { id: entree.id, titre: entree.label, point: POINT_PAR_ENTREE[entree.id] ?? 'var(--text-tertiary)' };
  });
  /** Le panneau reste monté d'un outil à l'autre : seule sa catégorie change (`OverlayPanel.tsx:73`). */
  protected readonly panneauOuvert = computed(() => this.panneau() !== null);
  private readonly cadrePanneau = viewChild(PanneauComponent, { read: ElementRef });
  private readonly composantPanneau = viewChild(PanneauComponent);
  private readonly rail = viewChild(RailComponent, { read: ElementRef });

  /** Zoom courant ; le badge s'affiche dès l'ouverture, avant le `load` du fond, comme React. */
  private readonly zoom = signal(ZOOM_INITIAL);
  /**
   * Le module risque est-il rendu par l'outlet (route enfant `risques`, B2) ? Tenu par `activate`/`deactivate` de
   * l'outlet : le calque qui le porte n'occupe la page que pendant ce temps — sinon il intercepterait les clics sur la carte.
   */
  protected readonly moduleOuvert = signal(false);
  protected readonly texteZoom = computed(() => `z${Math.floor(this.zoom())}  ${palierCarreaux(this.zoom())}`);

  constructor() {
    // Mode immersif dans la pile Échap (`page.tsx:288-293`) : Échap ré-affiche la barre.
    effect((nettoyer) => {
      if (!this.etat.railMasque()) return;
      this.pile.empiler('rail-masque', () => this.etat.railMasque.set(false));
      nettoyer(() => this.pile.depiler('rail-masque'));
    });

    inject(DestroyRef).onDestroy(() => this.couches.publier(null));
    // Les choroplèthes « Environnement » (T10, et la météo T11, injectée plus haut) existent dès l'ouverture : elles
    // s'inscrivent à l'éviction de leur dégradé et à « Tout effacer » avant tout geste, même panneau Calques fermé.
    inject(IndicateursCiviquesService);
    inject(SanteService);
    // Les couches de risque (T12) : instanciées ici, elles vivent avec la page et non avec le panneau Calques — sites et
    // périmètres restent sur la carte panneau fermé, comme les couches React montées par `page.tsx:1187-1214`.
    inject(RisquesIndustrielsService);
    inject(PprtService);
    // Les zones d'un profil (T13) : inscrites à l'éviction de leur dégradé dès l'ouverture, avant tout « Voir sur la carte ».
    inject(ZonesRisqueService);

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
    // laisserait sur <body> du document — hors de l'unique écouteur clavier (B10) : Alt+1..4 et Échap ne répondraient
    // plus. Même règle que `panneauFerme` (T3).
    this.rendreFocusALaFermeture(() => this.iris.codeSelectionne() !== null);
    this.rendreFocusALaFermeture(() => this.pois.panneauSelectionne() !== null);
    this.rendreFocusALaFermeture(this.meteo.dialogueOuvert);
    // Le module risque (T13) : il portait le focus, il disparaît avec l'outlet.
    this.rendreFocusALaFermeture(this.moduleOuvert);

    // Le focus sur l'hôte à l'ouverture : sans lui, aucun raccourci ne l'atteint avant le premier clic.
    afterNextRender(() => this.rendreFocus());
  }

  protected choisir(id: EntreeId): void {
    this.etat.choisirEntree(id);
  }

  protected basculerImmersif(): void {
    this.etat.railMasque.update((m) => !m);
  }

  /** Réglages › Fond de carte, et le sélecteur compact. Le même id ne recrée rien. */
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
   * reste posé, comme React. Le seul paramètre d'URL de la carte, `customZone` (B9), est retiré par l'effacement que
   * `LienZoneService` inscrit — comme `page.tsx:760-763`, pour qu'un rechargement ne rouvre pas la zone.
   */
  protected toutEffacer(): void {
    this.couches.toutEffacer();
    this.etat.reinitialiserDegrade();
    this.etat.perimetreScope.set(null);
    this.etat.poiSelectionnes.set([]);
  }

  /**
   * Changement d'organisation dans la barre du haut. React recharge toute la page (`window.location.reload()`) ;
   * recréer la carte ici perdrait tous les calques, alors que seul ce qui APPARTIENT à l'organisation précédente devient
   * faux : ses zones affichées, la zone ouverte par le lien et un filtre posé sur l'une d'elles. Le panneau ouvert est
   * FERMÉ ici, quel que soit le geste : au clavier, aucun clic hors du panneau ne l'a fermé, et « Mes zones » (comme la
   * liste de zones du Filtre) a lu l'organisation à son ouverture — resté ouvert, il listerait l'ancienne et une
   * opération y écrirait sa zone. Rouvert, il relit la nouvelle (revue 1).
   */
  protected organisationChangee(): void {
    if (this.panneauOuvert()) this.panneauFerme();
    this.zonesCustom.effacer();
    this.lienZone.oublier();
    if (this.etat.filtre()?.type === 'zone') this.etat.filtre.set(null);
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

  /**
   * Le panneau a fini sa sortie. S'il portait le focus (sa croix vient d'être cliquée, un champ de son
   * contenu), le retirer du DOM le ferait tomber sur `<body>` du document — hors de l'hôte, donc hors
   * de l'unique écouteur clavier (B10) : `Alt+1..4` et Échap ne répondraient plus avant un nouveau clic.
   * React écoute `window` et n'a pas ce problème ; ici, le focus revient à l'hôte de la page.
   */
  protected panneauFerme(): void {
    const cadre = this.cadrePanneau()?.nativeElement;
    const avaitFocus = !!cadre && cadre.contains(this.elementActif());
    this.etat.fermerEntree();
    if (avaitFocus) afterNextRender(() => this.rendreFocus(), { injector: this.injecteur });
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

  /** Rend le focus à l'hôte s'il n'est plus nulle part dans la page (élément retiré pendant qu'il le portait). */
  private rendreFocus(): void {
    const el = this.hote.nativeElement;
    const actif = this.elementActif();
    if (!actif || !el.contains(actif)) el.focus({ preventScroll: true });
  }

  /**
   * Recopie de `page.tsx:302-318`. Échap n'est JAMAIS filtré par la garde de saisie. Un Échap déjà
   * consommé par un gestionnaire INTÉRIEUR (`preventDefault()`) ne ferme rien de plus : c'est le cas
   * d'un menu ouvert du badge de session, qui consomme Échap sur son propre hôte AVANT que la frappe
   * ne remonte ici (`BadgeSessionComponent.echap`) — sinon un seul Échap fermerait le menu ET le
   * panneau. L'Assistant (`Ctrl+K`) n'est pas porté : la frappe n'est pas captée.
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
    const entree = entreeParRaccourci(e);
    if (!entree || entree === 'assistant') return;
    e.preventDefault();
    this.etat.choisirEntree(entree);
  }

  /**
   * Clic hors du panneau ET hors du rail : le panneau se ferme (`OverlayPanel.tsx:116-131`). Écouté
   * sur l'hôte de la page, jamais sur `window` : un clic dans le shell n'a pas à fermer un panneau.
   */
  protected pointerHors(e: MouseEvent): void {
    const panneau = this.composantPanneau();
    // Un outil de « Créer une zone » tient la carte (tracé, pose d'un centre) : ses clics lui appartiennent (T16) ; un
    // clic sur un point des clusters appartient au panneau de clusters (fiche, POI B — T19).
    if (!panneau || this.etat.carteOccupee() || this.etat.clicReserve(e)) return;
    const chemin = e.composedPath();
    const cadre = this.cadrePanneau()?.nativeElement;
    const rail = this.rail()?.nativeElement;
    if ((cadre && chemin.includes(cadre)) || (rail && chemin.includes(rail))) return;
    panneau.demanderFermeture();
  }
}
