import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface SegmentAriane {
  cle: string;
  libelle: string;
  /** Précision au survol — par exemple le niveau et le code INSEE, qui se recouvrent entre régions et départements. */
  titre?: string;
}

/** OÙ JE REGARDE (racine › … › courant). À ne pas confondre avec le fil d'étapes, qui dit OÙ J'EN SUIS. */
@Component({
  selector: 'mg-fil-ariane',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav aria-label="Fil d’Ariane" class="flex items-center gap-[7px] text-xs">
      @for (s of segments(); track s.cle; let i = $index, dernier = $last) {
        @if (i > 0) { <span aria-hidden="true" class="text-tertiary">&rsaquo;</span> }
        <button type="button" [disabled]="dernier" (click)="remonter.emit(i)"
                [attr.title]="s.titre ?? null"
                [attr.aria-current]="dernier ? 'location' : null"
                class="p-0 underline-offset-[3px]"
                [class.text-primary]="dernier" [class.cursor-default]="dernier"
                [class.text-teal]="!dernier" [class.underline]="!dernier" [class.cursor-pointer]="!dernier">
          {{ s.libelle }}
        </button>
      }
      @if (precision(); as p) {
        <!-- Affichée verbatim : DESIGN_SYSTEM.md garde les acronymes (IRIS,
             INSEE…) en majuscules, et lowercaser écraserait aussi ceux-là.
             L'appelant fournit déjà la casse voulue (sentence case ou sigle). -->
        <span class="ml-0.5 font-mono text-[10px] text-tertiary">· {{ p }}</span>
      }
    </nav>
  `,
})
export class FilArianeComponent {
  readonly segments = input.required<SegmentAriane[]>();
  readonly precision = input<string>();
  readonly remonter = output<number>();
}
