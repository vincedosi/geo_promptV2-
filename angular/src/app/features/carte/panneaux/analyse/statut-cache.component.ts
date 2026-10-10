import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { StatutCache } from '../../data/isochrones.api';

/**
 * La couverture du cache d'isochrones pour la sélection — le bandeau que `IsochronesTool.tsx:191-220` et
 * `BattleV2Tool.tsx:122-152` écrivaient deux fois, à trois libellés près : « N POIs à calculer » / « ✕ N POIs
 * manquants », la note de bas, et la teinte de la barre quand il manque des isochrones (danger en V1, le cyan de la V2
 * devenu `--brand-teal`). Complet : vert ; incomplet : ambre. Les `rgba` de React deviennent leurs jetons au même
 * pourcentage, et le gris `#94a3b8` du compte `--text-tertiary`.
 */
@Component({
  selector: 'mg-statut-cache',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let s = statut();
    <div data-statut-cache class="flex flex-col gap-1 rounded-[2px] border-fin px-[10px] py-[7px]"
      [class]="complet() ? 'border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[color-mix(in_srgb,var(--success)_6%,transparent)]'
        : 'border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--warning)_6%,transparent)]'">
      <div class="flex items-center justify-between">
        <span class="font-mono text-[9px] text-tertiary">{{ s.total_pois }} POIs · {{ s.total_combos }} isochrones</span>
        <span class="font-mono text-[9px] font-bold" [class]="complet() ? 'text-success' : 'text-warning'">{{ etat() }}</span>
      </div>
      <div class="h-[3px] overflow-hidden rounded-[2px] bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)]">
        <div class="h-full rounded-[2px] transition-[width] duration-[400ms] ease-linear" [class]="barre()" [style.width.%]="pct()"></div>
      </div>
      <div class="font-mono text-[8px] text-tertiary">{{ s.cached_combos }}/{{ s.total_combos }} en cache{{ note() }}</div>
    </div>
  `,
})
export class StatutCacheComponent {
  readonly statut = input.required<StatutCache>();
  readonly variante = input.required<'v1' | 'v2'>();

  protected readonly complet = computed(() => this.statut().missing_combos === 0);
  protected readonly pct = computed(() => Math.round((this.statut().cached_combos / Math.max(this.statut().total_combos, 1)) * 100));
  protected readonly etat = computed(() => {
    if (this.complet()) return '✓ 100% en cache';
    const n = this.statut().missing_pois;
    return this.variante() === 'v1' ? `${n} POI${n > 1 ? 's' : ''} à calculer` : `✕ ${n} POI${n > 1 ? 's' : ''} manquants`;
  });
  protected readonly barre = computed(() => (this.complet() ? 'bg-success' : this.variante() === 'v1' ? 'bg-danger' : 'bg-teal'));
  protected readonly note = computed(() => {
    const m = this.statut().missing_combos;
    if (m <= 0) return '';
    return this.variante() === 'v1' ? ` · ORS calculera les ${m} manquants automatiquement` : ` · ${m} à calculer`;
  });
}
