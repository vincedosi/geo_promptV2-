import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PoisService } from './pois.service';

/**
 * Le badge « ZONE_ACTIVE » de la zone de points affichée — portage de `MapPanel.tsx:150-161` (colonne haut-gauche de
 * la carte) : son libellé (`ville` de la réponse : « Tous les panneaux OOH », « Zone visible », « France »…), le rayon
 * s'il y en a un et le nombre de points. Absent sans zone, comme React.
 *
 * Posé dans le conteneur de la carte, au-dessus du badge de zoom (même place, `z-index` 10, plus tard dans le DOM),
 * comme React. Écart voulu : sans le flou `backdrop-filter` (« flat total », précédent T3).
 */
@Component({
  selector: 'mg-zone-active',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (pois.zone(); as z) {
      <div data-zone-active
        class="absolute left-3 top-3 z-10 w-[220px] rounded-[4px] border-fin border-subtle bg-surface px-[10px] py-1.5 font-mono text-[10px] tracking-[0.04em] text-primary">
        <div class="mb-[3px] text-[9px] tracking-[0.08em] text-secondary">ZONE_ACTIVE</div>
        <div class="font-semibold">{{ z.ville }}</div>
        <div class="mt-0.5 text-tertiary">{{ detail() }}</div>
      </div>
    }
  `,
})
export class ZoneActiveComponent {
  protected readonly pois = inject(PoisService);
  protected readonly detail = computed(() => {
    const z = this.pois.zone();
    if (!z) return '';
    return `${z.rayon_metres ? `r=${(z.rayon_metres / 1000).toFixed(1)}km · ` : ''}${z.nb_pois} POI`;
  });
}
