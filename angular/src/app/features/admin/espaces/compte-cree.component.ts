import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LienSecretComponent } from './lien-secret.component';

/** Lien absent du 201 : le compte existe quand même. */
export const MESSAGE_SANS_LIEN = 'Le compte est créé, mais le lien n\'a pas pu être généré. Générez-en un avec « Lien de mot de passe ».';

/**
 * L'écran « Compte créé » : titre, une phrase, le lien d'initialisation (`mg-lien-secret`) ou un
 * avertissement s'il manque, et « Terminer ». Partagé par « Ajouter un membre » (onglet Membres) et
 * « Créer un compte » (vue « Tous les comptes ») — extrait le 2026-10-10 pour ne pas le dupliquer.
 *
 * Il ne PORTE pas le secret : le dialogue parent le garde dans un signal, l'efface à « Terminer » et
 * à sa destruction, ignore Échap et rouvre une fermeture native forcée tant que cet écran est
 * affiché. Le lien n'est jamais passé à `console.*` ni à une notification.
 *
 * `idTitre` : l'identifiant du titre, que le `<dialog>` parent cite dans `aria-labelledby`.
 */
@Component({
  selector: 'mg-compte-cree',
  imports: [LienSecretComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 [id]="idTitre()" class="titre">Compte créé</h2>
    <p class="texte">{{ texte() }}</p>
    @if (lien(); as l) {
      <mg-lien-secret [lien]="l" mention="Transmettez ce lien à la personne : il ne sera plus affiché." />
    } @else {
      <p class="avertissement">{{ messageSansLien() }}</p>
    }
    <div class="actions">
      <button type="button" data-terminer class="bouton principal" (click)="terminer.emit()">Terminer</button>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; }
    .titre { margin: 0; font-size: 16px; font-weight: 500; color: var(--text-primary); }
    .texte { margin: 0; font-size: 13px; color: var(--text-secondary); }
    .avertissement { margin: 0; font-size: 12px; color: var(--warning); }
    .actions { display: flex; justify-content: flex-end; gap: 8px; }
    .bouton {
      border-radius: 6px; padding: 9px 18px; font-size: 13px; font-weight: 500; font-family: var(--font-sans); cursor: pointer;
      transition: opacity 150ms var(--ease-hover);
    }
    .bouton:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .principal { border: none; background: var(--text-primary); color: var(--bg-primary); }
    .principal:hover { background: var(--cta-hover); }
  `,
})
export class CompteCreeComponent {
  readonly idTitre = input.required<string>();
  readonly texte = input.required<string>();
  /** Le lien d'initialisation, ou `null` si le serveur n'a pas pu le générer. */
  readonly lien = input.required<string | null>();
  readonly messageSansLien = input(MESSAGE_SANS_LIEN);
  readonly terminer = output<void>();
}
