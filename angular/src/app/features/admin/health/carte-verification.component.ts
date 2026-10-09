import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Check } from '../logique/types/admin';
import { STYLES_STATUT } from './statut';

/**
 * Une vérification du Health check — portage de `CheckCard` et `StatusIcon`
 * (`app/admin/health/page.tsx:37-126`). Icônes SVG recopiées telles quelles (tracés Feather /
 * lucide dessinés en ligne par React, pas des composants lucide).
 *
 * ⚠ Rendu MESURÉ de React, défaut compris (C16) : React écrit `border: 1px solid ${couleur}44`
 * avec `couleur = 'var(--success)'` pour OK, soit `var(--success)44` — invalide une fois la
 * variable substituée, donc la bordure de la carte et le fond/bordure du badge DISPARAISSENT pour
 * OK (mesuré : `0px none`, fond transparent), alors que WARN et ERROR, écrits en hex, les ont.
 * Reproduit ici par `data-etat` (styles de `statut.ts`).
 */
@Component({
  selector: 'mg-carte-verification',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [STYLES_STATUT, `
    :host { display: block; }
    .carte {
      padding: 12px 16px; background: var(--fond-statut); border: 1px solid var(--bord-statut);
      border-radius: 2px; display: flex; align-items: flex-start; gap: 12px;
    }
    .carte[data-etat='OK'] { border: none; }
    .icone { margin-top: 2px; flex-shrink: 0; display: flex; }
    .corps { flex: 1; min-width: 0; }
    .tete { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
    .nom { font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: var(--text-primary); }
    .badge {
      font-size: 10px; font-family: var(--font-mono); color: var(--c-statut);
      background: var(--badge-statut); padding: 1px 6px; border-radius: 2px; border: 1px solid var(--bord-statut);
    }
    .carte[data-etat='OK'] .badge { background: transparent; border: none; }
    .valeur { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); margin-bottom: 3px; }
    .message { font-size: 12px; color: var(--text-tertiary); line-height: 1.5; font-family: var(--font-sans); }
  `],
  template: `
    <div data-carte class="carte statut" [attr.data-etat]="check().status">
      <div class="icone">
        @switch (check().status) {
          @case ('OK') {
            <svg data-icone="OK" width="16" height="16" viewBox="0 0 24 24" fill="none" style="stroke: var(--success)" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          }
          @case ('WARN') {
            <svg data-icone="WARN" width="16" height="16" viewBox="0 0 24 24" fill="none" style="stroke: var(--warning)" stroke-width="2.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          }
          @default {
            <svg data-icone="ERROR" width="16" height="16" viewBox="0 0 24 24" fill="none" style="stroke: var(--danger)" stroke-width="2.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          }
        }
      </div>
      <div class="corps">
        <div class="tete">
          <span data-nom class="nom">{{ check().name }}</span>
          <span data-statut class="badge">{{ check().status }}</span>
        </div>
        @if (check().value) {
          <div data-valeur class="valeur">{{ check().value }}</div>
        }
        <div data-message class="message">{{ check().message }}</div>
      </div>
    </div>
  `,
})
export class CarteVerificationComponent {
  readonly check = input.required<Check>();
}
