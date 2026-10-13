import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { IconeComponent } from '../../../ui/icone/icone.component';
import { CONSIGNE_ETAPE, type EtapeCarte, LARGEUR_PANNEAU_ETAPE, LIBELLE_ETAPE_CARTE, rangEtapeCarte } from '../logique/parcours';
import { ECART_TIROIR } from '../outils/boite-outils.component';

/** La marge de la carte flottante au conteneur carte, en haut, à gauche et en bas (l'ancien panneau du rail). */
export const MARGE_PANNEAU_ETAPE = 12;
/** La place du badge de zoom, qui suit le bord droit du panneau (`z5  20km` : 68 px, plus son écart de 10). */
const PLACE_BADGE_ZOOM = 80;
/**
 * Ce que le panneau laisse libre à sa droite, EN PLUS de `reserveDroite` (l'écart de la boîte à outils) : la colonne
 * d'outils (`ECART_TIROIR` de `boite-outils.component.ts`, 48 px) et la place du badge de zoom — 128 px.
 */
export const JOUR_DROIT_PANNEAU = ECART_TIROIR + PLACE_BADGE_ZOOM;

/**
 * Le panneau de l'étape courante (spec § 3) : une carte FLOTTANTE au-dessus de la carte, posée dans le conteneur carte
 * (`data-zone-carte`) — décision de Vincent le 13/10 (« le tiroir de gauche ça doit être un overlay comme on avait
 * avant », T4b). La carte garde toute sa largeur, panneau ouvert, replié ou élargi : il ne lui prend plus rien.
 *
 * - Le cadre est celui de l'ancien panneau du rail (`rail/panneau.component.ts`, retiré à T4) : `absolute`, `z-index`
 *   40, à 12 px du haut et de la gauche, coins de 12 px, bord fin `--border-default`. Fond OPAQUE (`--surface`) et non
 *   le `--card-overlay` translucide : sans le flou de React (« flat total », ni ombre ni `backdrop-filter`), la légende
 *   ou les étiquettes de la carte se liraient AU TRAVERS du panneau, texte sur texte (parcours T21 du lot 4).
 * - Hauteur AJUSTÉE au contenu de l'étape courante, bornée à `calc(100% - 24px)` (au-delà, le panneau défile) — comme
 *   l'ancien panneau : une étape courte (③, ⑤-⑧) ne pose plus un grand pan vide sur la carte. La page ne laisse que
 *   l'étape courante dans le flux ; les étapes quittées restent montées, `absolute` et invisibles (arbitrage A1).
 * - La poignée (320-900 px) est le bord DROIT de la carte flottante. La largeur est bornée par la place libre : le
 *   conteneur moins `reserveDroite` (l'écart de la boîte à outils, qui suit le plan média, le détail IRIS et Street
 *   View — ruling AT-3) et `JOUR_DROIT_PANNEAU`. Un panneau élargi rétrécit donc quand le plan média s'ouvre, au lieu
 *   de passer sous lui et sous les outils.
 * - Replié ou masqué (mode immersif), le cadre passe à `visibility: hidden`, jamais `display: none` ni `@if` — rien de
 *   ce qu'il porte ne se démonte. La largeur et le repli restent LOCAUX : un lien partagé n'impose pas sa mise en page.
 * - `emprise` : le bord droit occupé par le panneau dans le conteneur carte (`0px` caché), borne comprise — une
 *   expression CSS `min(…)`, dont le `100%` se résout contre le conteneur à l'endroit où elle sert. La page le pose en
 *   `--emprise-panneau` sur le conteneur ; le badge de zoom, la zone active et la légende s'y alignent
 *   (leur `left` vaut `calc(var(--emprise-panneau, 0px) + 10 ou 12 px)`) pour ne jamais rester dessous.
 */
@Component({
  selector: 'mg-panneau-etape',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <aside [attr.aria-label]="titre()"
           class="absolute left-3 top-3 z-40 flex max-h-[calc(100%-24px)] flex-col overflow-hidden rounded-[12px] border-fin border-default bg-surface"
           [style.width.px]="largeur()" [style.max-width]="largeurMax()" [style.visibility]="cache() ? 'hidden' : 'visible'">
      <div class="flex shrink-0 items-start gap-2 border-b-fin border-subtle px-4 py-2.5">
        <p data-consigne class="m-0 flex-1 text-[12px] leading-[1.5] text-secondary">{{ consigne() }}</p>
        <button type="button" data-replier (click)="replie.set(true)" aria-label="Replier le panneau (carte seule)" title="Carte seule"
                class="flex shrink-0 cursor-pointer border-0 bg-transparent p-1 text-tertiary hover:text-primary">
          <mg-icone nom="chevron-gauche" [taille]="14" [trait]="1.5" />
        </button>
      </div>
      <div class="relative flex min-h-0 flex-1 flex-col"><ng-content /></div>
      @if (!cache()) {
        <div role="separator" aria-orientation="vertical" aria-label="Largeur du panneau"
             [attr.aria-valuenow]="largeur()" [attr.aria-valuemin]="bornes.min" [attr.aria-valuemax]="bornes.max"
             class="absolute inset-y-0 right-0 z-10 w-[5px] cursor-col-resize touch-none bg-transparent transition-colors duration-150 hover:bg-[var(--border-hover)]"
             (pointerdown)="saisirPoignee($event)"></div>
      }
    </aside>
  `,
})
export class PanneauEtapeComponent {
  readonly etape = input.required<EtapeCarte>();
  /** Mode immersif : caché sans toucher au repli choisi. */
  readonly masque = input(false);
  readonly replie = model(false);
  /** L'écart, en px, de ce qui occupe le bord droit du conteneur carte (`decalageOutils` de la page). */
  readonly reserveDroite = input(0);

  protected readonly bornes = LARGEUR_PANNEAU_ETAPE;
  readonly largeur = signal<number>(LARGEUR_PANNEAU_ETAPE.defaut);
  /** La largeur au dernier RELÂCHER de la poignée : la marge de la carte ne suit pas chaque pixel du glissement. */
  private readonly largeurPosee = signal<number>(LARGEUR_PANNEAU_ETAPE.defaut);
  protected readonly cache = computed(() => this.masque() || this.replie());
  /**
   * Ce que le panneau ouvert couvre au bord gauche de la carte, en px (marge + largeur posée) ; 0 caché. La page le passe
   * à MapLibre en `padding.left` (`couches/marge-carte.ts`) : centrage et recadrages se font dans la partie visible.
   */
  readonly decalageCarte = computed(() => this.cache() ? 0 : MARGE_PANNEAU_ETAPE + this.largeurPosee());
  /** Le bord droit libre le plus lointain du panneau : tout le conteneur, moins la réserve droite et le jour. */
  private readonly bordMax = computed(() => `100% - ${this.reserveDroite() + JOUR_DROIT_PANNEAU + MARGE_PANNEAU_ETAPE}px`);
  protected readonly largeurMax = computed(() => `calc(${this.bordMax()} - ${MARGE_PANNEAU_ETAPE}px)`);
  /** Le bord droit du panneau dans le conteneur carte, borné comme lui ; `0px` caché — `--emprise-panneau` de la page. */
  readonly emprise = computed(() => this.cache() ? '0px' : `min(${MARGE_PANNEAU_ETAPE + this.largeur()}px, ${this.bordMax()})`);
  protected readonly titre = computed(() => `Étape ${rangEtapeCarte(this.etape())} — ${LIBELLE_ETAPE_CARTE[this.etape()]}`);
  protected readonly consigne = computed(() => CONSIGNE_ETAPE[this.etape()]);

  /**
   * Capture du pointeur sur la POIGNÉE elle-même, jamais `window` (celui du shell) — recopie de `RisquePage.saisirPoignee`.
   * La largeur est ramenée à la largeur RENDUE (bornée par `max-width`) à la saisie et au relâcher : sans quoi elle
   * dépassait ce qui s'affiche — `aria-valuenow` mentait, et revenir en arrière ne faisait rien tant qu'on n'était pas
   * repassé sous la borne (relecture T4b, m1).
   */
  protected saisirPoignee(ev: PointerEvent): void {
    const poignee = ev.currentTarget as HTMLElement;
    poignee.setPointerCapture?.(ev.pointerId);
    this.ramenerALaLargeurRendue(poignee);
    const depart = ev.clientX;
    const initiale = this.largeur();
    const deplacer = (e: PointerEvent) => {
      this.largeur.set(Math.max(this.bornes.min, Math.min(this.bornes.max, initiale + e.clientX - depart)));
    };
    const relacher = () => {
      poignee.removeEventListener('pointermove', deplacer);
      poignee.removeEventListener('pointerup', relacher);
      poignee.removeEventListener('pointercancel', relacher);
      this.ramenerALaLargeurRendue(poignee);
      this.largeurPosee.set(this.largeur());
    };
    poignee.addEventListener('pointermove', deplacer);
    poignee.addEventListener('pointerup', relacher);
    poignee.addEventListener('pointercancel', relacher);
  }

  /** La poignée est l'enfant de l'`aside` ; une largeur rendue nulle (pas de mise en page, jsdom) ne change rien. */
  private ramenerALaLargeurRendue(poignee: HTMLElement): void {
    const rendue = Math.round(poignee.parentElement?.getBoundingClientRect().width ?? 0);
    if (rendue > 0 && rendue < this.largeur()) this.largeur.set(Math.max(this.bornes.min, rendue));
  }
}
