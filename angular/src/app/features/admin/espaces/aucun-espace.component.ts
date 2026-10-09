import { ChangeDetectionStrategy, Component } from '@angular/core';

/** `admin/espaces` sans fiche choisie : l'invite à droite de la colonne. Aucun appel. */
@Component({
  selector: 'mg-aucun-espace',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="invite">
      <p class="titre">Aucun espace sélectionné</p>
      <p class="texte">
        Choisissez le socle ou un espace dans la colonne pour voir ses jeux de données et ses membres,
        ou créez un nouvel espace.
      </p>
    </div>
  `,
  styles: `
    :host { display: block; }
    .invite {
      padding: 24px; border: 0.5px dashed var(--border-default); border-radius: 8px;
      background: var(--bg-surface); font-family: var(--font-sans);
    }
    .titre { margin: 0 0 6px; font-size: 13px; font-weight: 500; color: var(--text-primary); }
    .texte { margin: 0; font-size: 13px; line-height: 1.6; color: var(--text-secondary); max-width: 520px; }
  `,
})
export class AucunEspaceComponent {}
