import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, viewChild } from '@angular/core';
import { IconeComponent } from '../icone/icone.component';

/** Identifiants uniques des titres (aria-labelledby), plusieurs boîtes pouvant coexister. */
let compteur = 0;

/**
 * Boîte de confirmation, port de `ConfirmModal` (`components/ui/confirm-modal.tsx`, arbitrage C6).
 *
 * `<dialog>` NATIF et non un voile `position: fixed` : `showModal()` place la boîte dans la couche
 * supérieure du navigateur SANS la sortir de l'arbre, donc DANS la racine d'ombre (stylée, isolée
 * du shell) ; le reste de la page devient inerte et le focus est piégé par le navigateur. Remplace
 * aussi les `window.confirm()` de React, qui bloquaient le fil du SHELL.
 *
 * Fermeture — mêmes gestes que React, sauf pendant `enCours` :
 * - Échap : l'événement `cancel` FERMERAIT le dialogue de lui-même ; il est empêché, puis
 *   `annuler` est émis — c'est le parent qui repasse `ouvert` à faux. Sans ce `preventDefault`, le
 *   DOM et l'état `ouvert` divergeraient. La touche ne remonte pas jusqu'à un écouteur de page.
 * - clic sur le fond : le dialogue n'a pas de marge intérieure, sa boîte est un enfant ; un clic
 *   dont la cible est le dialogue lui-même vient donc du fond (`::backdrop`).
 * - une fermeture native qu'on n'a pas pu empêcher (Chrome laisse passer un second Échap sans
 *   activation de l'utilisateur) émet aussi `annuler`, pour resynchroniser l'état.
 */
@Component({
  selector: 'mg-confirmation',
  imports: [IconeComponent],
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
      <div data-boite class="p-6">
        <div class="mb-5 flex items-start gap-3">
          @if (variante() === 'danger') {
            <div class="pastille-danger flex size-9 shrink-0 items-center justify-center rounded-lg">
              <mg-icone nom="triangle-alerte" data-nom="triangle-alerte" [taille]="18" [trait]="1.5" class="text-danger" />
            </div>
          }
          <div>
            <div [id]="idTitre" class="mb-1.5 text-[16px] font-medium text-primary">{{ titre() }}</div>
            <div class="text-[13px] leading-[1.6] text-secondary">
              @if (message()) { {{ message() }} }
              <ng-content />
            </div>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <button type="button" autofocus class="bouton annuler" [disabled]="enCours()" (click)="annuler.emit()">{{ libelleAnnuler() }}</button>
          <button
            type="button"
            class="bouton confirmer"
            [class.danger]="variante() === 'danger'"
            [disabled]="enCours()"
            (click)="confirmer.emit()"
          >{{ enCours() ? 'En cours...' : libelleConfirmer() }}</button>
        </div>
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      margin: auto;
      padding: 0;
      max-width: 420px;
      width: calc(100% - 32px);
      background: var(--bg-surface);
      color: inherit;
      border: 0.5px solid var(--border-default);
      border-radius: 12px;
    }
    dialog[open] { animation: entree 240ms cubic-bezier(0.23, 1, 0.32, 1); }
    /* Voile de ConfirmModal : #050505 à 85 % et un flou de 4 px, dans les DEUX thèmes. Noir et non
       un jeton : aucun jeton ne reste sombre en thème clair (même choix que le voile de la coquille). */
    dialog::backdrop {
      background: color-mix(in srgb, black 85%, transparent);
      backdrop-filter: blur(4px);
      animation: voile 220ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    @keyframes entree { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
    @keyframes voile { from { opacity: 0; } to { opacity: 1; } }
    .pastille-danger { background: color-mix(in srgb, var(--danger) 10%, transparent); }
    .bouton {
      border-radius: 6px;
      padding: 9px 18px;
      font-size: 13px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover),
        color 150ms var(--ease-hover), opacity 150ms var(--ease-hover), transform 160ms var(--ease-out);
    }
    .bouton:not(:disabled):active { transform: scale(0.97); }
    .annuler {
      background: transparent;
      border: 0.5px solid var(--border-default);
      color: var(--text-secondary);
    }
    .annuler:not(:disabled):hover {
      border-color: var(--border-hover);
      background: var(--bg-level-2);
      color: var(--text-primary);
    }
    .confirmer { border: none; background: var(--text-primary); color: var(--bg-primary); }
    .confirmer.danger { background: var(--danger); color: var(--text-primary); }
    .confirmer:disabled { cursor: not-allowed; opacity: 0.5; }
    .confirmer:not(:disabled):hover { opacity: 0.85; }
    @media (prefers-reduced-motion: reduce) {
      dialog[open], dialog::backdrop { animation: none; }
    }
  `,
})
export class ConfirmationComponent {
  protected readonly idTitre = `mg-confirmation-titre-${++compteur}`;
  readonly ouvert = input.required<boolean>();
  readonly titre = input.required<string>();
  readonly message = input<string>();
  readonly libelleConfirmer = input('Confirmer');
  readonly libelleAnnuler = input('Annuler');
  readonly variante = input<'danger' | 'defaut'>('defaut');
  readonly enCours = input(false);
  readonly confirmer = output<void>();
  readonly annuler = output<void>();

  private readonly dialogue = viewChild.required<ElementRef<HTMLDialogElement>>('dialogue');

  constructor() {
    effect(() => {
      const d = this.dialogue().nativeElement;
      if (this.ouvert()) {
        if (!d.open) d.showModal();
      } else if (d.open) {
        d.close();
      }
    });
  }

  protected surAnnulationNative(e: Event): void {
    e.preventDefault();
    if (!this.enCours()) this.annuler.emit();
  }

  protected surFermeture(): void {
    if (this.ouvert()) this.annuler.emit();
  }

  protected surClic(e: MouseEvent): void {
    if (e.target === this.dialogue().nativeElement && !this.enCours()) this.annuler.emit();
  }
}
