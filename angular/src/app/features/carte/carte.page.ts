import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, viewChild,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import type maplibregl from 'maplibre-gl';
import { CarteComponent } from '../../carte/carte.component';
import { IconeComponent } from '../../ui/icone/icone.component';
import { AnnonceComponent } from './commun/annonce.component';
import { AnnonceService } from './etat/annonce.service';
import { CouchesCarteService } from './etat/couches-carte.service';
import { EtatCarteService } from './etat/etat-carte.service';
import { PileEchapService } from './etat/pile-echap.service';
import { MAP_STYLE } from './logique/fonds';
import { ignorerRaccourciClavier } from './logique/garde-saisie';
import { franciserLibelles } from './logique/libelles-fr';
import { ENTREES_NAVIGATION, LARGEUR_RAIL, type EntreeId, entreeParRaccourci } from './logique/navigation';
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
 * ── LA PILE ÉCHAP EST UN SERVICE DE LA PAGE ──────────────────────────────
 * Panneau et mode immersif s'y empilent : dernier ouvert = premier fermé (`PileEchapService`).
 */
@Component({
  selector: 'mg-carte-principale',
  imports: [AnnonceComponent, BarreHautComponent, CarteComponent, IconeComponent, PanneauComponent, RailComponent, RouterOutlet],
  providers: [EtatCarteService, CouchesCarteService, PileEchapService, AnnonceService],
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

  protected readonly largeurRail = LARGEUR_RAIL;
  protected readonly hauteurBarre = HAUTEUR_BARRE_HAUT;
  protected readonly fond = MAP_STYLE;
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

    // Le focus sur l'hôte à l'ouverture : sans lui, aucun raccourci ne l'atteint avant le premier clic.
    afterNextRender(() => {
      const el = this.hote.nativeElement;
      const actif = (el.getRootNode() as Document | ShadowRoot).activeElement;
      if (!el.contains(actif)) el.focus({ preventScroll: true });
    });
  }

  protected choisir(id: EntreeId): void {
    this.etat.choisirEntree(id);
  }

  protected basculerImmersif(): void {
    this.etat.railMasque.update((m) => !m);
  }

  protected cartePrete(carte: maplibregl.Map): void {
    // Libellés du fond en français, au `load` comme React (`useMapInit.ts:209-215`).
    franciserLibelles(carte as unknown as Parameters<typeof franciserLibelles>[0]);
    this.couches.publier(carte);
  }

  protected zoomChange(z: number): void {
    this.zoom.set(z);
  }

  /**
   * Recopie de `page.tsx:302-318`. Échap n'est JAMAIS filtré par la garde de saisie ; un Échap déjà
   * consommé par un gestionnaire intérieur (`preventDefault()`, un menu du badge de session) ne ferme
   * rien de plus. L'Assistant (`Ctrl+K`) n'est pas porté : la frappe n'est pas captée.
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
