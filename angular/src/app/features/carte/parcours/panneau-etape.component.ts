import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { IconeComponent } from '../../../ui/icone/icone.component';
import { CONSIGNE_ETAPE, type EtapeCarte, LARGEUR_PANNEAU_ETAPE, LIBELLE_ETAPE_CARTE, rangEtapeCarte } from '../logique/parcours';

/**
 * Le panneau de l'étape courante (spec § 3) — patron du module risque (`RisquePage` : aside dans le flux, poignée
 * 320-900 px, repli « carte seule »). Il porte la consigne d'une ligne de l'étape et PROJETTE les panneaux montés par la
 * page : replié ou masqué (mode immersif), il passe à `visibility: hidden` et largeur nulle, jamais `display: none` ni
 * `@if` — rien de ce qu'il porte ne se démonte. La largeur et le repli restent LOCAUX : un lien partagé n'impose pas sa
 * mise en page (comme le risque).
 */
@Component({
  selector: 'mg-panneau-etape',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <aside [attr.aria-label]="titre()" class="relative flex min-w-0 shrink-0 flex-col overflow-hidden bg-surface"
           [style.width.px]="cache() ? 0 : largeur()" [style.visibility]="cache() ? 'hidden' : 'visible'">
      <div class="flex shrink-0 items-start gap-2 border-b-fin border-subtle px-4 py-2.5">
        <p data-consigne class="m-0 flex-1 text-[12px] leading-[1.5] text-secondary">{{ consigne() }}</p>
        <button type="button" data-replier (click)="replie.set(true)" aria-label="Replier le panneau (carte seule)" title="Carte seule"
                class="flex shrink-0 cursor-pointer border-0 bg-transparent p-1 text-tertiary hover:text-primary">
          <mg-icone nom="chevron-gauche" [taille]="14" [trait]="1.5" />
        </button>
      </div>
      <div class="relative min-h-0 flex-1"><ng-content /></div>
    </aside>
    @if (!cache()) {
      <div role="separator" aria-orientation="vertical" aria-label="Largeur du panneau"
           [attr.aria-valuenow]="largeur()" [attr.aria-valuemin]="bornes.min" [attr.aria-valuemax]="bornes.max"
           class="w-[5px] shrink-0 cursor-col-resize touch-none bg-[var(--border-subtle)]"
           (pointerdown)="saisirPoignee($event)"></div>
    }
  `,
})
export class PanneauEtapeComponent {
  readonly etape = input.required<EtapeCarte>();
  /** Mode immersif : caché sans toucher au repli choisi. */
  readonly masque = input(false);
  readonly replie = model(false);

  protected readonly bornes = LARGEUR_PANNEAU_ETAPE;
  readonly largeur = signal<number>(LARGEUR_PANNEAU_ETAPE.defaut);
  protected readonly cache = computed(() => this.masque() || this.replie());
  protected readonly titre = computed(() => `Étape ${rangEtapeCarte(this.etape())} — ${LIBELLE_ETAPE_CARTE[this.etape()]}`);
  protected readonly consigne = computed(() => CONSIGNE_ETAPE[this.etape()]);

  /** Capture du pointeur sur la POIGNÉE elle-même, jamais `window` (celui du shell) — recopie de `RisquePage.saisirPoignee`. */
  protected saisirPoignee(ev: PointerEvent): void {
    const poignee = ev.currentTarget as HTMLElement;
    poignee.setPointerCapture?.(ev.pointerId);
    const depart = ev.clientX;
    const initiale = this.largeur();
    const deplacer = (e: PointerEvent) => {
      this.largeur.set(Math.max(this.bornes.min, Math.min(this.bornes.max, initiale + e.clientX - depart)));
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
}
