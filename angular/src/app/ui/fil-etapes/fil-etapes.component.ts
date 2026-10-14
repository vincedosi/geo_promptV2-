import { ChangeDetectionStrategy, Component, type ElementRef, input, output, viewChildren } from '@angular/core';

export interface EtapeAffichee {
  cle: string;
  rang: number;
  libelle: string;
  /** On a posé un choix à cette étape. Jamais « validée » : le parcours n'est pas un tunnel. */
  renseignee: boolean;
}

/**
 * Le fil des étapes d'un parcours (porté de components/risques/FilArianeEtapes.tsx).
 * Chaque étape reste cliquable dans les deux sens ; flèches, Début et Fin
 * déplacent l'étape ET le focus.
 */
@Component({
  selector: 'mg-fil-etapes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav aria-label="Étapes du parcours" class="flex items-center ml-1" [class]="compact() ? 'gap-0' : 'gap-0.5'">
      @for (e of etapes(); track e.cle; let i = $index) {
        @if (i > 0) { <span aria-hidden="true" class="text-[11px] text-tertiary">›</span> }
        <button #bouton type="button"
                (click)="choisir.emit(e.cle)" (keydown)="auClavier($event, i)"
                [attr.aria-current]="e.cle === courante() ? 'step' : null"
                [attr.title]="compact() && e.cle !== courante() ? e.libelle : null"
                class="inline-flex items-center gap-[5px] pt-1 pb-1.5 text-[12px] cursor-pointer border-b-2"
                [class]="compact() ? boutonCompact : boutonNormal"
                [class.font-medium]="e.cle === courante()"
                [class.text-primary]="e.cle === courante()"
                [class.border-teal]="e.cle === courante()"
                [class.text-tertiary]="e.cle !== courante()"
                [class.border-transparent]="e.cle !== courante()">
          <span aria-hidden="true" class="text-[10px]"
                [class.text-teal]="e.cle === courante()">{{ e.rang }}</span>&ngsp;
          <span data-libelle-etape [class]="compact() && e.cle !== courante() ? repli : ''">{{ e.libelle }}</span>
          @if (e.renseignee && e.cle !== courante()) {
            <span aria-hidden="true" title="Vous avez posé un choix à cette étape."
                  class="size-[5px] rounded-full bg-teal"></span>
            <span class="sr-only">&ngsp;(renseignée)</span>
          }
        </button>
      }
    </nav>
  `,
})
export class FilEtapesComponent {
  readonly etapes = input.required<EtapeAffichee[]>();
  readonly courante = input.required<string>();
  /**
   * Fil COMPACT (barre du parcours de la carte, 8 étapes — T4c) : une ligne par étape, padding réduit, et sous
   * le seuil `repli` (largeur de CONTENEUR : le parent porte `@container`), les étapes non courantes ne montrent plus que
   * leur numéro — libellé gardé pour le lecteur d'écran (`sr-only`) et redit en infobulle. Défaut : inchangé.
   */
  readonly compact = input(false);
  protected readonly boutonNormal = 'px-2.5';
  protected readonly boutonCompact = 'h-[30px] min-w-6 justify-center px-1 whitespace-nowrap shrink-0';
  /**
   * Littéral : Tailwind lit les classes dans le source. Seuil = le fil complet en compact au PIRE du lot 1 : ≈ 606 px
   * sans pastille (`px-1`, mesuré au round 1), plus ① et ② « renseignées » (≈ 10 px chacune) et le `font-medium` de
   * l'étape courante, plus le bouton « Autres » que la barre pose dans le MÊME conteneur depuis T11b. En compact, le `nav`
   * n'a AUCUN écart (`gap-0`, −28 px ; les `px-1` des boutons séparent déjà les chevrons). Mesuré le 14/10 au navigateur
   * (round 1 de T11b), au pire — ① et ② renseignées, « 5 Jeu de zones » courante en gras : fil 571 px, filet 1, « Autres »
   * 45, deux écarts de 4 px = 625 px. Sous 630 px il se replie au lieu de défiler. Seule la barre du parcours pose
   * `compact`. À 1 440 px, fil d'Ariane « France entière » : 646 px offerts avec le badge super_admin long (367 px,
   * « dentsu.explore (interne) »), tout lisible ; à 1 280 px (≈ 486 px) : replié. Une précision au fil d'Ariane
   * (« métropole ») ou un filtre posé réduit la place comme avant T11b.
   */
  protected readonly repli = '@max-[630px]:sr-only';
  readonly choisir = output<string>();

  private readonly boutons = viewChildren<ElementRef<HTMLButtonElement>>('bouton');

  protected auClavier(ev: KeyboardEvent, i: number): void {
    const n = this.etapes().length;
    const cible =
      ev.key === 'ArrowLeft' ? i - 1
        : ev.key === 'ArrowRight' ? i + 1
          : ev.key === 'Home' ? 0
            : ev.key === 'End' ? n - 1
              : null;
    if (cible === null) return;
    ev.preventDefault();
    const borne = Math.max(0, Math.min(n - 1, cible));
    this.choisir.emit(this.etapes()[borne].cle);
    this.boutons()[borne]?.nativeElement.focus();
  }
}
