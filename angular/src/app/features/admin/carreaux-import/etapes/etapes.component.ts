import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { WizardStep } from '../logique/lots';

const ETAPES: readonly { n: WizardStep; libelle: string }[] = [
  { n: 1, libelle: 'Fichiers' },
  { n: 2, libelle: 'Mapping' },
  { n: 3, libelle: 'Import' },
];

/**
 * Fil d'étapes de l'import Shapefile — portage de `app/admin/carreaux-import/_components/Stepper.tsx` (lot 6,
 * T14). Une étape franchie est cliquable pour revenir en arrière ; l'étape courante ne fait rien ; une étape
 * non atteinte est désactivée. Pendant un envoi (`verrouille`), les étapes franchies le sont aussi (vague
 * finale, B4) : défaut de React, dont le fil laissait redéposer un bundle — et remplacer `features` — en plein envoi.
 *
 * Écarts à React, voulus : couleurs en jetons (C9) — `rgba(61,255,160,0.12|0.3)` → `--success` à 12 / 30 %,
 * `#505050` → `--text-tertiary`, `#000` du rond franchi → `--brand-teal-fg` (texte posé sur un aplat, invariant) ;
 * vert en TEXTE lisible en clair par `--success-texte` du cadre admin (F-3) ; `aria-current="step"` sur l'étape
 * courante ; focus clavier visible (React : `outline: none`). Gardés : bords 1 px, rayon 2, filet de 48 px.
 */
@Component({
  selector: 'mg-shapefile-etapes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="fil" aria-label="Étapes de l’import">
      @for (e of etapes(); track e.n) {
        <div class="groupe">
          @if (e.n > 1) {
            <div class="filet" [class.atteint]="e.atteinte"></div>
          }
          <button
            type="button"
            class="etape"
            [class.courante]="e.courante"
            [class.franchie]="e.franchie"
            [attr.data-etape]="e.n"
            [attr.aria-current]="e.courante ? 'step' : null"
            [disabled]="e.future || e.bloquee"
            (click)="e.franchie && choisir.emit(e.n)"
          >
            <span class="rond">{{ e.franchie ? '✓' : e.n }}</span>
            {{ e.libelle }}
          </button>
        </div>
      }
    </nav>
  `,
  styles: `
    :host {
      display: block;
    }
    .fil { display: flex; align-items: center; gap: 8px; margin-bottom: 32px; }
    .groupe { display: flex; align-items: center; gap: 8px; }
    .filet { width: 48px; height: 1px; background: var(--border-subtle); }
    .filet.atteint { background: var(--success); }
    .etape {
      display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 2px;
      font-family: var(--font-sans); font-size: 12px; font-weight: 400; cursor: default;
      background: var(--bg-surface); border: 1px solid var(--border-subtle); color: var(--text-tertiary);
      transition: all 0.15s;
    }
    .etape:disabled { cursor: not-allowed; }
    .etape.franchie { color: var(--text-secondary); cursor: pointer; }
    .etape.courante {
      font-weight: 600; color: var(--success-texte);
      background: color-mix(in srgb, var(--success) 12%, transparent);
      border-color: color-mix(in srgb, var(--success) 30%, transparent);
    }
    .etape:focus-visible { outline: 1px solid var(--brand-teal-50); outline-offset: 1px; }
    .rond {
      width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-family: var(--font-mono); font-size: 11px; font-weight: 700;
      background: var(--bg-level-2); color: var(--text-tertiary);
    }
    .franchie .rond { background: var(--success); color: var(--brand-teal-fg); }
    .courante .rond { background: color-mix(in srgb, var(--success) 12%, transparent); color: var(--success-texte); }
  `,
})
export class EtapesComponent {
  readonly etape = input.required<WizardStep>();
  /** Envoi en cours : aucune étape franchie n'est cliquable (B4). */
  readonly verrouille = input(false);
  readonly choisir = output<WizardStep>();

  protected readonly etapes = computed(() => {
    const courante = this.etape();
    const verrouille = this.verrouille();
    return ETAPES.map((e) => ({
      ...e,
      courante: e.n === courante,
      franchie: e.n < courante && !verrouille,
      future: e.n > courante,
      bloquee: e.n < courante && verrouille,
      atteinte: courante >= e.n,
    }));
  });
}
