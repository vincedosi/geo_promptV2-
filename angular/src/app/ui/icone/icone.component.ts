import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ICONES, type ElementIcone, type NomIcone } from './icones';

/**
 * Icône en SVG en ligne, tracés de lucide (voir `icones.ts`), sans dépendance.
 * Rendu identique à `lucide-react` : viewBox 24, `fill none`, `stroke currentColor`,
 * bouts et jointures arrondis. La couleur vient du texte de l'hôte (`currentColor`).
 * `trait` vaut 1,5 par défaut : c'est le `strokeWidth` que React passe dans la barre
 * latérale, l'accueil et le changement de thème (lucide seul aurait 2).
 * Décorative par défaut (`aria-hidden`) ; avec `libelle`, elle devient une image nommée.
 */
@Component({
  selector: 'mg-icone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0' },
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      [attr.width]="taille()"
      [attr.height]="taille()"
      [attr.stroke-width]="trait()"
      [attr.aria-hidden]="libelle() ? null : 'true'"
      [attr.role]="libelle() ? 'img' : null"
      [attr.aria-label]="libelle() || null"
    >
      @for (el of elements(); track $index) {
        @switch (el.t) {
          @case ('path') { <path [attr.d]="el.d" /> }
          @case ('circle') { <circle [attr.cx]="el.cx" [attr.cy]="el.cy" [attr.r]="el.r" /> }
          @case ('ellipse') { <ellipse [attr.cx]="el.cx" [attr.cy]="el.cy" [attr.rx]="el.rx" [attr.ry]="el.ry" /> }
          @case ('rect') {
            <rect [attr.x]="el.x" [attr.y]="el.y" [attr.width]="el.width" [attr.height]="el.height" [attr.rx]="el.rx" />
          }
          @case ('line') { <line [attr.x1]="el.x1" [attr.y1]="el.y1" [attr.x2]="el.x2" [attr.y2]="el.y2" /> }
          @case ('polyline') { <polyline [attr.points]="el.points" /> }
          @case ('polygon') { <polygon [attr.points]="el.points" /> }
        }
      }
    </svg>
  `,
})
export class IconeComponent {
  readonly nom = input.required<NomIcone>();
  /** Côté en pixels. */
  readonly taille = input(16);
  /** Épaisseur du trait, dans le repère 24 × 24 (comme `strokeWidth` de lucide). */
  readonly trait = input(1.5);
  readonly libelle = input<string>();

  protected readonly elements = computed<readonly ElementIcone[]>(() => ICONES[this.nom()]);
}
