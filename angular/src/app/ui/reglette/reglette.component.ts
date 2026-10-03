import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

/**
 * Une réglette qui PRÉVISUALISE pendant le glissement et ne VALIDE qu'au
 * relâchement (portée de components/risques/RegletteRayons.tsx).
 *
 * Le calcul que déclenche une validation coûte plusieurs secondes : une
 * requête par pixel glissé serait la famille de l'incident du 28/03
 * (CLAUDE.md). Mesuré côté React : zéro requête sur vingt positions, une seule
 * au relâchement.
 *
 * Après validation, l'affichage retombe sur `valeur` — celle du PARENT, qui a
 * pu corriger la demande. Sinon le curseur montrerait la position demandée
 * pendant que les chiffres décrivent autre chose.
 */
@Component({
  selector: 'mg-reglette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-1 min-w-[210px]">
      <div class="flex items-baseline gap-1.5">
        <span class="text-[11px] text-tertiary">{{ libelle() }}</span>
        @if (complement(); as c) {
          <span class="font-mono text-[11px] text-tertiary">{{ c }}</span>
        }
        <span class="font-mono text-[12px] text-teal">{{ formater()(affiche()) }}</span>
      </div>
      <input type="range" class="w-full accent-[var(--brand-teal)]"
             [min]="min()" [max]="max()" [step]="pas()" [value]="affiche()"
             [attr.aria-label]="descriptionAccessible() ?? libelle() + ', de ' + formater()(min()) + ' à ' + formater()(max())"
             (input)="glisser($event)"
             (pointerup)="poser()" (change)="poser()" (keyup)="poser()" (blur)="poser()" />
    </div>
  `,
})
export class RegletteComponent {
  readonly libelle = input.required<string>();
  readonly valeur = input.required<number>();
  readonly min = input.required<number>();
  readonly max = input.required<number>();
  readonly pas = input.required<number>();
  readonly formater = input<(n: number) => string>((n) => String(n));
  /** Texte discret à côté du libellé (par exemple des valeurs réglées ailleurs). */
  readonly complement = input<string>();
  readonly descriptionAccessible = input<string>();

  readonly apercu = output<number | null>();
  readonly valider = output<number>();

  /** `null` = rien en cours de glissement : on affiche la valeur du parent. */
  private readonly glisse = signal<number | null>(null);
  protected readonly affiche = computed(() => this.glisse() ?? this.valeur());

  protected glisser(ev: Event): void {
    const v = Number((ev.target as HTMLInputElement).value);
    this.glisse.set(v);
    this.apercu.emit(v);
  }

  protected poser(): void {
    const v = this.glisse();
    if (v === null) return;
    this.glisse.set(null);
    // L'aperçu s'éteint AVANT le résultat : pendant le calcul, garder
    // l'ancien et l'aperçu côte à côte montrerait deux valeurs pour un réglage.
    this.apercu.emit(null);
    this.valider.emit(v);
  }
}
