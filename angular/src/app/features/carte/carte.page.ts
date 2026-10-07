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
import { CarreauxService } from './couches/carreaux.service';
import { DetailIrisComponent } from './couches/detail-iris.component';
import { IrisService } from './couches/iris.service';
import { JETONS_STYLE_MAGELIAN, appliquerStyleMagelian, couchesDuFond } from './couches/style-magelian';
import { AnnonceService } from './etat/annonce.service';
import { CouchesCarteService } from './etat/couches-carte.service';
import { EtatCarteService } from './etat/etat-carte.service';
import { lireFondMemorise, memoriserFond, urlDuFond } from './etat/fond-carte';
import { PileEchapService } from './etat/pile-echap.service';
import { ReferentielGeoService } from './etat/referentiel-geo.service';
import { PuceFiltreComponent } from './filtre/puce-filtre.component';
import { LegendeCarteComponent } from './legende/legende-carte.component';
import { ignorerRaccourciClavier } from './logique/garde-saisie';
import { franciserLibelles } from './logique/libelles-fr';
import { ENTREES_NAVIGATION, LARGEUR_RAIL, type EntreeId, entreeParRaccourci } from './logique/navigation';
import { AideComponent } from './panneaux/aide.component';
import { PanneauCalquesComponent } from './panneaux/calques/panneau-calques.component';
import { PanneauFiltreComponent } from './panneaux/filtre/panneau-filtre.component';
import { ReglagesComponent } from './panneaux/reglages.component';
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
    AideComponent, AnnonceComponent, BarreHautComponent, BoutonsFlottantsComponent, CarteComponent, DetailIrisComponent,
    FondCompactComponent, LegendeCarteComponent, PanneauCalquesComponent, PanneauComponent, PanneauFiltreComponent, PuceFiltreComponent,
    RailComponent, ReglagesComponent, RouterOutlet,
  ],
  providers: [EtatCarteService, CouchesCarteService, PileEchapService, AnnonceService, ReferentielGeoService, CarreauxService,
    IrisService,
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
  private readonly document = inject(DOCUMENT);

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
  protected readonly texteZoom = computed(() => `z${Math.floor(this.zoom())}  ${palierCarreaux(this.zoom())}`);

  constructor() {
    // Mode immersif dans la pile Échap (`page.tsx:288-293`) : Échap ré-affiche la barre.
    effect((nettoyer) => {
      if (!this.etat.railMasque()) return;
      this.pile.empiler('rail-masque', () => this.etat.railMasque.set(false));
      nettoyer(() => this.pile.depiler('rail-masque'));
    });

    inject(DestroyRef).onDestroy(() => this.couches.publier(null));

    // Le fond MAGELIAN : surcharges posées sur la carte prête, ré-appliquées à chaque bascule de thème
    // (`useMapInit.ts:217-221,1091-1102`). `carteCourante` n'est publiée qu'au `load` : le style est chargé.
    effect(() => {
      const carte = this.couches.carteCourante();
      if (!carte || this.fond() !== 'magelian') return;
      const fond = this.couchesFond.get(carte);
      if (fond) appliquerStyleMagelian(carte, this.paletteMagelian(), fond);
    });

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
   * reste posé, comme React ; et il n'y a pas d'URL à nettoyer — aucun paramètre de la carte n'y vit encore (B9).
   */
  protected toutEffacer(): void {
    this.couches.toutEffacer();
    this.etat.reinitialiserDegrade();
    this.etat.perimetreScope.set(null);
    this.etat.poiSelectionnes.set([]);
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
    if (!panneau) return;
    const chemin = e.composedPath();
    const cadre = this.cadrePanneau()?.nativeElement;
    const rail = this.rail()?.nativeElement;
    if ((cadre && chemin.includes(cadre)) || (rail && chemin.includes(rail))) return;
    panneau.demanderFermeture();
  }
}
