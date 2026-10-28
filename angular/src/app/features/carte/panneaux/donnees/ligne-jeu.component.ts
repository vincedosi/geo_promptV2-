import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { LIBELLE_NATURE } from '../../logique/jeux-carte';
import type { JeuAffichable } from '../../logique/rangement-jeux';
import { FicheJeuComponent } from './fiche-jeu.component';

/**
 * La ligne uniforme d'un jeu de ② (arbitrage A12) : nom, nature · maille, pastille « affiché », puis une CASE (type de
 * POI : le choisir) ou un CHEVRON qui déplie les réglages existants de sa section (projetée, rendue seulement dépliée).
 *
 * Le bouton « i » (lot « Catalogue et groupes », A-8) déplie la FICHE du jeu sous la ligne (`mg-fiche-jeu`, lue à sa
 * première ouverture seulement) : propriétaire, niveau, effectif, date d'import. État d'affichage local, hors URL.
 */
@Component({
  selector: 'mg-ligne-jeu',
  imports: [FicheJeuComponent, IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block border-t-fin border-subtle', '[attr.data-jeu]': 'jeu().cle' },
  template: `
    <div class="flex items-center gap-2 px-[14px] py-2">
      @if (mode() === 'case') {
        <input type="checkbox" class="case shrink-0" [checked]="coche()" [attr.aria-label]="'Choisir ' + jeu().nom" (change)="surCocher($event)" />
      }
      <div class="min-w-0 flex-1">
        <div class="truncate text-[12px] text-primary">{{ jeu().nom }}</div>
        <div class="text-[11px] text-tertiary">{{ meta() }}</div>
        @if (indice(); as i) {
          <div data-indice class="text-[11px] text-teal">{{ i }}</div>
        }
      </div>
      @if (affiche()) {
        <span data-affiche title="Affiché sur la carte" class="size-1.5 shrink-0 rounded-full bg-teal"></span>
        <span class="sr-only">(affiché)</span>
      }
      <button type="button" data-bouton-fiche [attr.aria-expanded]="ficheOuverte()" [attr.aria-controls]="idFiche()"
              [attr.aria-label]="libelleFiche()" [title]="libelleFiche()" (click)="ficheOuverte.set(!ficheOuverte())"
              class="flex min-h-6 min-w-6 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-1 text-tertiary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-teal-50)]">
        <mg-icone nom="info" [taille]="13" [trait]="1.5" />
      </button>
      @if (mode() === 'reglages') {
        <button type="button" [attr.aria-expanded]="deplie()" [attr.aria-label]="(deplie() ? 'Replier ' : 'Régler ') + jeu().nom"
                (click)="basculer.emit()" class="flex min-h-6 min-w-6 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-1 text-tertiary hover:text-primary">
          <mg-icone [nom]="deplie() ? 'chevron-bas' : 'chevron-droite'" [taille]="14" [trait]="1.5" />
        </button>
      }
    </div>
    <mg-fiche-jeu [attr.id]="idFiche()" [cle]="jeu().cle" [ouvert]="ficheOuverte()" />
    @if (mode() === 'reglages' && deplie()) {
      <div data-reglages class="px-[14px] pb-3"><ng-content /></div>
    }
  `,
  styles: `.case { accent-color: var(--brand-teal); cursor: pointer; } .case:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }`,
})
export class LigneJeuComponent {
  readonly jeu = input.required<JeuAffichable>();
  readonly affiche = input(false);
  readonly mode = input<'case' | 'reglages'>('reglages');
  readonly coche = input(false);
  readonly deplie = input(false);
  /** Une invite d'une ligne sous « nature · maille » (la fiche santé d'une commune à lire, par exemple) ; rien si `null`. */
  readonly indice = input<string | null>(null);
  readonly cocher = output<void>();
  readonly basculer = output<void>();
  protected readonly meta = computed(() => `${LIBELLE_NATURE[this.jeu().nature]} · ${this.jeu().maille}`);
  /** La fiche du jeu est dépliée sous la ligne (bouton « i »). */
  protected readonly ficheOuverte = signal(false);
  protected readonly libelleFiche = computed(() => `Fiche du jeu ${this.jeu().nom}`);
  /** L'identifiant de la fiche, cible d'`aria-controls` : la clé, réduite aux caractères sûrs d'un identifiant. */
  protected readonly idFiche = computed(() => `fiche-jeu-${this.jeu().cle.replace(/[^a-z0-9_-]/gi, '-')}`);

  /**
   * La case reflète TOUJOURS `coche` (relecture T12, m1) : le navigateur l'a déjà basculée, on la remet à l'état reçu
   * avant d'émettre. Si le parent accepte, `coche` change et la liaison la rebascule ; s'il refuse, elle reste juste.
   */
  protected surCocher(e: Event): void {
    (e.target as HTMLInputElement).checked = this.coche();
    this.cocher.emit();
  }
}
