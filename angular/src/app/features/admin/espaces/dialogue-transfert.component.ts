import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input, output, viewChild,
} from '@angular/core';

let compteur = 0;

export interface Choix { id: string; nom: string; inactif: boolean }

/**
 * « Transférer… » : `<dialog>` natif qui liste les AUTRES espaces (patron de
 * `mg-dialogue-nouvel-espace`). Aucune requête n'y part : choisir un espace mène à la confirmation
 * du parent, qui nomme les deux espaces. Le parent le monte par un `@if` ; la fermeture explicite
 * dans `onDestroy` rend le focus au bouton d'origine.
 */
@Component({
  selector: 'mg-dialogue-transfert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialogue
      [attr.aria-labelledby]="idTitre"
      (cancel)="surAnnulationNative($event)"
      (close)="surFermeture()"
      (click)="surClic($event)"
      (keydown.escape)="$event.stopPropagation()"
    >
      <div class="boite">
        <h2 [id]="idTitre" class="titre">Transférer « {{ nomJeu() }} »</h2>
        <p class="aide">Choisissez l'espace qui en devient propriétaire.</p>
        @if (espaces().length === 0) {
          <p class="aide">Aucun autre espace.</p>
        } @else {
          <ul class="liste">
            @for (e of espaces(); track e.id) {
              <li>
                <button type="button" class="choix" [attr.data-cible]="e.id" (click)="choisir.emit(e.id)">
                  <span>{{ e.nom }}</span>
                  @if (e.inactif) {
                    <span data-inactif class="badge">Inactif</span>
                  }
                </button>
              </li>
            }
          </ul>
        }
        <div class="actions">
          <button type="button" data-annuler class="annuler" (click)="annuler.emit()">Annuler</button>
        </div>
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      margin: auto; padding: 0; max-width: 440px; width: calc(100% - 32px);
      background: var(--bg-surface); color: inherit; border: 0.5px solid var(--border-default); border-radius: 12px;
    }
    dialog[open] { animation: entree 240ms var(--ease-out); }
    dialog::backdrop {
      background: color-mix(in srgb, black 85%, transparent);
      backdrop-filter: blur(4px);
      animation: voile 220ms var(--ease-out);
    }
    @keyframes entree { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
    @keyframes voile { from { opacity: 0; } to { opacity: 1; } }
    .boite { padding: 24px; display: flex; flex-direction: column; gap: 12px; font-family: var(--font-sans); }
    .titre { margin: 0; font-size: 16px; font-weight: 500; color: var(--text-primary); }
    .aide { margin: 0; font-size: 12px; color: var(--text-tertiary); }
    .liste { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow-y: auto; }
    .choix {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      width: 100%; text-align: left; background: var(--bg-level-2); border: 0.5px solid var(--border-subtle); border-radius: 6px;
      padding: 8px 12px; font-family: var(--font-sans); font-size: 13px; color: var(--text-primary); cursor: pointer;
      transition: border-color 150ms var(--ease-hover), background-color 150ms var(--ease-hover);
    }
    .badge {
      flex-shrink: 0;
      background: var(--bg-level-3); border: 0.5px solid var(--border-default); color: var(--text-tertiary);
      font-size: 10px; border-radius: 4px; padding: 1px 6px;
    }
    .choix:hover { border-color: var(--brand-teal-30); background: var(--bg-level-3); }
    .choix:focus-visible, .annuler:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .actions { display: flex; justify-content: flex-end; margin-top: 4px; }
    .annuler {
      background: transparent; border: 0.5px solid var(--border-default); color: var(--text-secondary); border-radius: 6px;
      padding: 9px 18px; font-size: 13px; font-weight: 500; font-family: inherit; cursor: pointer;
      transition: background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover);
    }
    .annuler:hover { border-color: var(--border-hover); background: var(--bg-level-2); color: var(--text-primary); }
    @media (prefers-reduced-motion: reduce) { dialog[open], dialog::backdrop { animation: none; } }
  `,
})
export class DialogueTransfertComponent {
  private readonly hote = inject<ElementRef<HTMLElement>>(ElementRef);
  private detruit = false;

  protected readonly idTitre = `mg-transfert-titre-${++compteur}`;
  readonly nomJeu = input.required<string>();
  readonly espaces = input.required<readonly Choix[]>();
  readonly choisir = output<string>();
  readonly annuler = output<void>();

  private readonly dialogue = viewChild.required<ElementRef<HTMLDialogElement>>('dialogue');

  constructor() {
    afterNextRender(() => {
      const d = this.dialogue().nativeElement;
      if (!d.open) d.showModal();
    });
    const noeud = this.hote.nativeElement;
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      const d = noeud.querySelector('dialog');
      if (d?.open) d.close();
    });
  }

  protected surAnnulationNative(e: Event): void {
    e.preventDefault();
    this.annuler.emit();
  }

  protected surFermeture(): void {
    if (!this.detruit) this.annuler.emit();
  }

  protected surClic(e: MouseEvent): void {
    if (e.target === this.dialogue().nativeElement) this.annuler.emit();
  }
}
