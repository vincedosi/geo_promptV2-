import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input, output, viewChild,
} from '@angular/core';
import { LienSecretComponent } from './lien-secret.component';

let compteur = 0;

/**
 * « Lien de réinitialisation » : `<dialog>` natif (patron de `mg-dialogue-nouvel-espace`), monté par
 * un `@if` du parent tant que le lien existe, et démonté à la fermeture — le parent remet alors son
 * signal à `null` : le lien quitte le DOM ET l'état.
 *
 * Fermeture : Échap (`cancel` empêché puis `fermer` émis), clic sur le fond, « Fermer », ou une
 * fermeture native non empêchée. Avant le retrait du nœud, `close()` rend le focus au bouton qui
 * avait ouvert le dialogue.
 */
@Component({
  selector: 'mg-dialogue-lien',
  imports: [LienSecretComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialogue
      [attr.aria-labelledby]="idTitre"
      (cancel)="$event.preventDefault(); fermer.emit()"
      (close)="surFermeture()"
      (click)="surClic($event)"
      (keydown.escape)="$event.stopPropagation()"
    >
      <div class="boite">
        <h2 [id]="idTitre" class="titre">Lien de réinitialisation</h2>
        <p class="pour">{{ email() }}</p>
        <mg-lien-secret [lien]="lien()" mention="Ce lien ne sera plus affiché après fermeture." />
        <div class="actions">
          <button type="button" data-fermer-lien class="fermer" autofocus (click)="fermer.emit()">Fermer</button>
        </div>
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      margin: auto; padding: 0; max-width: 520px; width: calc(100% - 32px);
      background: var(--bg-surface); color: inherit; border: 0.5px solid var(--border-default); border-radius: 12px;
    }
    dialog::backdrop { background: color-mix(in srgb, black 85%, transparent); backdrop-filter: blur(4px); }
    .boite { padding: 24px; display: flex; flex-direction: column; gap: 14px; font-family: var(--font-sans); }
    .titre { margin: 0; font-size: 16px; font-weight: 500; color: var(--text-primary); }
    .pour { margin: -8px 0 0; font-size: 12px; color: var(--text-tertiary); }
    .actions { display: flex; justify-content: flex-end; }
    .fermer {
      background: transparent; border: 0.5px solid var(--border-default); color: var(--text-secondary);
      border-radius: 6px; padding: 9px 18px; font-family: var(--font-sans); font-size: 13px; font-weight: 500; cursor: pointer;
    }
    .fermer:hover { border-color: var(--border-hover); background: var(--bg-level-2); color: var(--text-primary); }
    .fermer:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
  `,
})
export class DialogueLienComponent {
  private readonly hote = inject<ElementRef<HTMLElement>>(ElementRef);
  private detruit = false;

  protected readonly idTitre = `mg-dialogue-lien-titre-${++compteur}`;
  readonly lien = input.required<string>();
  readonly email = input.required<string>();
  readonly fermer = output<void>();

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

  protected surFermeture(): void {
    if (!this.detruit) this.fermer.emit();
  }

  protected surClic(e: MouseEvent): void {
    if (e.target === this.dialogue().nativeElement) this.fermer.emit();
  }
}
