import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { NotificationsService } from '../../../ui/notifications/notifications.service';

/**
 * Un lien secret d'usage unique (initialisation ou réinitialisation du mot de passe) : un champ en
 * lecture seule, un bouton « Copier » et une mention. Partagé par l'onglet Membres (lien de mot de
 * passe) et le dialogue « Ajouter un membre » (écran « Compte créé »).
 *
 * Le lien n'est JAMAIS passé à `console.*`, ni dans un message de notification : seul le
 * presse-papiers le reçoit, sur geste de l'utilisateur. Le composant ne garde rien : c'est le parent
 * qui porte le lien et l'efface (signal remis à `null`, ou composant démonté) à la fermeture.
 *
 * « Copie impossible » s'affiche SOUS le champ (`role="alert"`), pas en notification : le composant
 * vit toujours dans un `<dialog>` modal, où la pile de notifications est inerte (vague finale, I-1).
 * Le succès (« Lien copié ») reste une notification, que la pile en popover rend visible.
 */
@Component({
  selector: 'mg-lien-secret',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ligne">
      <input
        data-lien-secret
        type="text"
        readonly
        aria-label="Lien"
        [value]="lien()"
        (focus)="selectionner($event)"
      />
      <button type="button" data-copier class="copier" (click)="copier()">Copier</button>
    </div>
    @if (copieImpossible()) {
      <p role="alert" data-copie-impossible class="impossible">Copie impossible. Sélectionnez le lien et copiez-le.</p>
    }
    <p class="mention">{{ mention() }}</p>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 8px; }
    .ligne { display: flex; gap: 8px; }
    input {
      flex: 1; min-width: 0;
      background: var(--bg-level-2); border: 0.5px solid var(--border-subtle); border-radius: 6px;
      padding: 8px 12px; font-family: var(--font-mono); font-size: 12px; color: var(--text-primary); outline: none;
    }
    input:focus { border-color: var(--brand-teal-50); }
    .copier {
      flex-shrink: 0; background: transparent; border: 0.5px solid var(--brand-teal); color: var(--brand-teal);
      border-radius: 6px; padding: 8px 16px; font-family: var(--font-sans); font-size: 12px; font-weight: 500; cursor: pointer;
      transition: background-color 150ms var(--ease-hover);
    }
    .copier:hover { background: var(--brand-teal-10); }
    .copier:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .mention { margin: 0; font-size: 12px; color: var(--warning); }
    .impossible { margin: 0; font-size: 12px; color: var(--danger); }
  `,
})
export class LienSecretComponent {
  private readonly notifications = inject(NotificationsService);

  readonly lien = input.required<string>();
  readonly mention = input.required<string>();
  protected readonly copieImpossible = signal(false);

  protected selectionner(e: Event): void {
    (e.target as HTMLInputElement).select();
  }

  protected copier(): void {
    this.copieImpossible.set(false);
    const presse = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!presse) {
      this.copieImpossible.set(true);
      return;
    }
    presse.writeText(this.lien()).then(
      () => this.notifications.success('Lien copié'),
      () => this.copieImpossible.set(true),
    );
  }
}
