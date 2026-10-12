import {
  ChangeDetectionStrategy, Component, DestroyRef, type ElementRef, effect, inject, input, output, signal, untracked, viewChild,
} from '@angular/core';
import { IconeComponent } from '../../../ui/icone/icone.component';
import { PileEchapService } from '../etat/pile-echap.service';
import { ECART_RAIL_PANNEAU, LARGEUR_PANNEAU, LARGEUR_RAIL, type EntreeId } from '../logique/navigation';

/** Durée de la sortie — `EXIT_DURATION_MS` de `OverlayPanel.tsx` (= `--duration-exit`). */
export const DUREE_SORTIE_MS = 200;
/** Identifiant fixe dans la pile Échap : un seul panneau est monté à la fois (`OverlayPanel.tsx:12`). */
export const PILE_PANNEAU = 'panneau';

/**
 * Le cadre des panneaux gauches du rail — portage de `components/map/OverlayPanel.tsx`.
 *
 * - `absolute` dans l'hôte de la page (arbitrage B1), à `LARGEUR_RAIL + ECART_RAIL_PANNEAU` du bord,
 *   `z-index` 40 comme React.
 * - Le panneau reste MONTÉ quand on passe d'une entrée à l'autre : seule sa `categorie` change, et
 *   l'en-tête et le corps rejouent la petite animation de « morph » de React (état des enfants gardé).
 * - Fermer (croix, Échap via la pile, clic hors du panneau relayé par la page) joue la sortie de
 *   200 ms PUIS émet `fermer`. Il s'empile dans la pile Échap UNE fois, au montage (`'panneau'`).
 * - Écarts voulus (« flat total », DESIGN_SYSTEM § 2) : ni `box-shadow` ni `backdrop-filter`. Le fond
 *   est OPAQUE (`--surface`) et non le `--card-overlay` translucide de React : React floute ce qui
 *   passe dessous (`blur(4px)`) ; sans ce flou, la légende de la carte, ouverte SOUS le panneau, se
 *   lisait au travers de son corps, texte sur texte (parcours T21). Teinte voisine : en sombre la même
 *   (#0a0a0a contre rgba(10,10,10,0.92)), en clair #f5f5f5 contre rgba(248,248,248,0.90).
 *   Le bouton « Agrandir » (`expandable`) n'est passé par aucun appelant de React : non porté.
 */
@Component({
  selector: 'mg-panneau-carte',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @keyframes entree { from { opacity: 0; transform: translateX(-12px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes sortie { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(-12px); } }
    :host { animation: entree var(--duration-enter) var(--ease-spring) both; }
    :host([data-state='closing']) { animation: sortie var(--duration-exit) var(--ease-exit) both; }
  `,
  host: {
    class: 'panneau-carte absolute z-40 flex flex-col overflow-hidden rounded-[12px] border-fin border-default bg-surface',
    role: 'dialog',
    '[attr.aria-label]': 'titre()',
    '[attr.data-categorie]': 'categorie()',
    '[attr.data-state]': "fermeture() ? 'closing' : 'open'",
    '[style.top.px]': '12 + decalageHaut()',
    '[style.left.px]': 'gauche',
    '[style.width.px]': 'largeur',
    '[style.max-height]': "'calc(100% - 24px - ' + decalageHaut() + 'px)'",
  },
  template: `
    <div #entete class="flex shrink-0 items-center gap-2.5 border-b-fin border-subtle px-4 pb-3 pt-3.5">
      <span
        data-pastille
        class="size-2 shrink-0 rounded-full transition-[background-color] duration-200 ease-[var(--ease-spring)]"
        [style.background]="pastille()"
      ></span>
      <span class="flex-1 text-[14px] font-semibold text-primary">{{ titre() }}</span>
      <button
        type="button"
        aria-label="Fermer"
        (click)="demanderFermeture()"
        class="flex cursor-pointer items-center border-0 bg-transparent p-1 text-tertiary transition-colors duration-150 ease-[var(--ease-hover)] hover:text-primary"
      >
        <mg-icone nom="croix" [taille]="16" [trait]="1.5" />
      </button>
    </div>
    <div #corps class="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto py-2">
      <ng-content />
    </div>
  `,
})
export class PanneauComponent {
  readonly categorie = input.required<EntreeId>();
  readonly titre = input.required<string>();
  /** Couleur du point de l'en-tête : un jeton CSS (`var(--cat-…)`), posé dans le DOM. */
  readonly pastille = input.required<string>();
  /** Hauteur de la barre du haut à laisser libre (0 en mode immersif). */
  readonly decalageHaut = input(0);
  readonly fermer = output<void>();

  protected readonly gauche = LARGEUR_RAIL + ECART_RAIL_PANNEAU;
  protected readonly largeur = LARGEUR_PANNEAU;
  protected readonly fermeture = signal(false);

  private readonly entete = viewChild.required<ElementRef<HTMLElement>>('entete');
  private readonly corps = viewChild.required<ElementRef<HTMLElement>>('corps');
  private minuterie: ReturnType<typeof setTimeout> | undefined;
  private categoriePrecedente: EntreeId | null = null;

  constructor() {
    const pile = inject(PileEchapService);
    pile.empiler(PILE_PANNEAU, () => this.demanderFermeture());
    inject(DestroyRef).onDestroy(() => {
      pile.depiler(PILE_PANNEAU);
      clearTimeout(this.minuterie);
    });

    // Morph inter-catégories (`OverlayPanel.tsx:73-84`) : changer d'outil sans fermer rejoue un court
    // « settle » sur l'en-tête et le corps, SANS démonter le contenu.
    effect(() => {
      const categorie = this.categorie();
      untracked(() => {
        const precedente = this.categoriePrecedente;
        this.categoriePrecedente = categorie;
        if (precedente === null || precedente === categorie) return;
        const entete = this.entete().nativeElement;
        const corps = this.corps().nativeElement;
        if (typeof entete.animate !== 'function') return;
        entete.animate(
          [{ opacity: 0, transform: 'translateY(-3px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 200, easing: this.jeton(entete, '--ease-out'), fill: 'both' },
        );
        corps.animate(
          [
            { opacity: 0.35, transform: 'scale(0.985)', offset: 0 },
            { opacity: 1, transform: 'scale(1.005)', offset: 0.6 },
            { opacity: 1, transform: 'scale(1)', offset: 1 },
          ],
          { duration: 280, easing: this.jeton(corps, '--ease-spring'), fill: 'both' },
        );
      });
    });
  }

  /**
   * Une courbe d'accélération lue dans les jetons (`--ease-out`, `--ease-spring`), comme le `var()` des
   * animations de React : l'API Web Animations ne résout pas `var()`, on passe la valeur calculée.
   */
  private jeton(el: HTMLElement, nom: string): string {
    return getComputedStyle(el).getPropertyValue(nom).trim() || 'ease';
  }

  /** Joue la sortie puis émet `fermer`. Une seule fois : un second appel pendant la sortie est ignoré. */
  demanderFermeture(): void {
    if (this.fermeture()) return;
    this.fermeture.set(true);
    this.minuterie = setTimeout(() => this.fermer.emit(), DUREE_SORTIE_MS);
  }
}
