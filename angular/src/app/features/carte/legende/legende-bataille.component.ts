import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BatailleService } from '../couches/bataille.service';
import { BATTLE_PALIER_OPACITY } from '../logique/palettes-donnees-carte';

/** Les paliers de la rampe d'opacité (`LegendeCarte.tsx:430`). */
const PALIERS_RAMPE = [10, 20, 30, 40, 50, 60, 90] as const;
/** Au-delà, « +N autres » (`LegendeCarte.tsx:449-457`). */
const POI_MAX = 8;

/**
 * Le bloc « BATAILLE » de la légende — portage de `LegendeCarte.tsx:408-460` (lot 4, T17) : la catégorie, la réglette
 * du palier maximum (10 à 90 min, pas de 10 — elle filtre les anneaux de la carte, ce n'est pas qu'une clé de lecture),
 * la rampe d'opacité des paliers, puis un POI par teinte (huit au plus).
 *
 * Présent tant que la bataille est VISIBLE et a une catégorie, comme React. Rendu dans le bloc « Analyse spatiale » de
 * `mg-legende-carte`, à la place qu'il occupait. Le rouge de React (`rgba(255,87,87,…)`) est `--danger` au même
 * pourcentage ; les teintes des POI sont des couleurs de DONNÉES (`VORONOI_PALETTE`, B12), `40` hexadécimal = 25 %.
 */
@Component({
  selector: 'mg-legende-bataille',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (presente()) {
      <div data-bloc="bataille" class="mt-[3px] flex flex-col gap-1 border-t border-subtle pt-[5px]">
        <div class="flex items-center gap-1.5">
          <span class="size-[9px] shrink-0 rounded-[1px] border-[1.5px] border-solid border-danger bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]"></span>
          <span class="text-[9px] tracking-[0.08em] text-primary">BATAILLE · {{ bataille.categorie() }}</span>
        </div>
        <div class="mt-0.5 flex flex-col gap-[3px]">
          <div class="flex items-center justify-between">
            <span class="text-[8px] tracking-[0.08em] text-tertiary">PALIER_MAX</span>
            <span data-palier-max class="font-mono text-[9px] font-semibold text-danger">{{ bataille.palierMax() }} min</span>
          </div>
          <input type="range" min="10" max="90" step="10" aria-label="Palier maximum"
            [value]="bataille.palierMax()" (input)="regler($event)"
            class="h-[14px] w-full cursor-pointer accent-[var(--danger)]" />
          <div class="mt-px flex items-end gap-0.5">
            @for (c of rampe(); track c.palier) {
              <div data-rampe [attr.data-actif]="c.actif" class="flex flex-1 flex-col items-center gap-px">
                <span class="inline-block h-1.5 w-full rounded-[1px] transition-[background] duration-200"
                  [class]="c.actif ? '' : 'border border-subtle bg-elevated'" [style.background]="c.fond"></span>
                <span class="text-[7px] text-tertiary">{{ c.palier }}</span>
              </div>
            }
          </div>
        </div>
        @for (p of poisAffiches(); track p.id) {
          <div data-poi-bataille class="flex items-center gap-1.5">
            <span class="size-2 shrink-0 rounded-[1px] border-[1.5px] border-solid" [style.background]="p.color + '40'" [style.border-color]="p.color"></span>
            <span class="font-mono text-[10px] text-tertiary">{{ p.nom }}</span>
          </div>
        }
        @if (autres() > 0) {
          <span class="font-mono text-[10px] text-tertiary">+{{ autres() }} autres</span>
        }
      </div>
    }
  `,
})
export class LegendeBatailleComponent {
  protected readonly bataille = inject(BatailleService);

  protected readonly presente = computed(() => this.bataille.visible() && !!this.bataille.categorie());
  protected readonly rampe = computed(() => {
    const max = this.bataille.palierMax();
    return PALIERS_RAMPE.map((palier) => {
      const actif = palier <= max;
      const pct = Math.round((BATTLE_PALIER_OPACITY[palier] ?? 0.15) * 100);
      return { palier, actif, fond: actif ? `color-mix(in srgb, var(--danger) ${pct}%, transparent)` : null };
    });
  });
  protected readonly poisAffiches = computed(() => this.bataille.legende().slice(0, POI_MAX));
  protected readonly autres = computed(() => Math.max(0, this.bataille.legende().length - POI_MAX));

  /** La réglette pose le palier maximum ; la couche filtre ses anneaux par le même seuil (`filtreAnneaux`). */
  protected regler(e: Event): void {
    this.bataille.palierMax.set(Number((e.target as HTMLInputElement).value));
  }
}
