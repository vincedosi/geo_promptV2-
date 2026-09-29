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
    <nav aria-label="Étapes du parcours" class="flex items-center gap-0.5 ml-1">
      @for (e of etapes(); track e.cle; let i = $index) {
        @if (i > 0) { <span aria-hidden="true" class="text-[11px] text-tertiary">›</span> }
        <button #bouton type="button"
                (click)="choisir.emit(e.cle)" (keydown)="auClavier($event, i)"
                [attr.aria-current]="e.cle === courante() ? 'step' : null"
                class="inline-flex items-center gap-[5px] px-2.5 pt-1 pb-1.5 text-xs cursor-pointer border-b-2"
                [class.font-medium]="e.cle === courante()"
                [class.text-primary]="e.cle === courante()"
                [class.border-teal]="e.cle === courante()"
                [class.text-tertiary]="e.cle !== courante()"
                [class.border-transparent]="e.cle !== courante()">
          <span aria-hidden="true" class="text-[10px]"
                [class.text-teal]="e.cle === courante()">{{ e.rang }}</span>
          {{ e.libelle }}
          @if (e.renseignee && e.cle !== courante()) {
            <span aria-hidden="true" title="Vous avez posé un choix à cette étape."
                  class="size-[5px] rounded-full bg-teal"></span>
            <span class="sr-only">(renseignée)</span>
          }
        </button>
      }
    </nav>
  `,
})
export class FilEtapesComponent {
  readonly etapes = input.required<EtapeAffichee[]>();
  readonly courante = input.required<string>();
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
