import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BatailleService } from './bataille.service';
import { PoisService } from './pois.service';

/**
 * La colonne haut-gauche de la carte — portage de `MapPanel.tsx:150-246` : le badge « ZONE_ACTIVE » de la zone de
 * points affichée (son libellé — `ville` de la réponse : « Tous les panneaux OOH », « Zone visible », « France »… —, le
 * rayon s'il y en a un et le nombre de points), puis la bascule « Bataille » dès qu'une bataille a été peinte (T17).
 * Absente quand il n'y a ni l'un ni l'autre, comme React. Les badges Isochrone et Voronoï de React ne venaient que de
 * l'Assistant, jamais porté : ils n'ont pas de place ici.
 *
 * Posée dans le conteneur de la carte, au-dessus du badge de zoom (même place, `z-index` 10, plus tard dans le DOM),
 * comme React — et, comme lui, à 12 px à droite du panneau d'étape flottant (`--emprise-panneau`, T4b). Écarts voulus : sans le flou `backdrop-filter` ni l'agrandissement au survol (« flat total ») ; le
 * rouge `#ef4444` codé en dur de la bascule devient `--danger`, à 9 % (`18` hexadécimal) et 50 % (`80`) comme React.
 */
@Component({
  selector: 'mg-zone-active',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (pois.zone() || bataille.categorie()) {
      <div class="absolute left-[calc(var(--emprise-panneau,0px)+12px)] top-3 z-10 flex w-[220px] flex-col gap-1.5">
        @if (pois.zone(); as z) {
          <div data-zone-active
            class="rounded-[4px] border-fin border-subtle bg-surface px-[10px] py-1.5 font-mono text-[10px] tracking-[0.04em] text-primary">
            <div class="mb-[3px] text-[9px] tracking-[0.08em] text-secondary">ZONE_ACTIVE</div>
            <div class="font-semibold">{{ z.ville }}</div>
            <div class="mt-0.5 text-tertiary">{{ detail() }}</div>
          </div>
        }
        @if (bataille.categorie()) {
          <div class="flex gap-1">
            <button type="button" data-bascule-bataille [attr.aria-pressed]="bataille.visible()" (click)="bataille.visible.set(!bataille.visible())"
              class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[4px] border-fin px-1.5 py-[5px] text-[10px] uppercase tracking-[0.04em] transition-all duration-200"
              [class]="bataille.visible()
                ? 'border-[color-mix(in_srgb,var(--danger)_50%,transparent)] bg-[color-mix(in_srgb,var(--danger)_9%,transparent)] text-danger'
                : 'border-subtle bg-surface text-tertiary'">
              <span class="size-[7px] shrink-0 rounded-[1px] border-[1.5px] border-solid border-danger" [class.bg-danger]="bataille.visible()"></span>
              Bataille
            </button>
          </div>
        }
      </div>
    }
  `,
})
export class ZoneActiveComponent {
  protected readonly pois = inject(PoisService);
  protected readonly bataille = inject(BatailleService);
  protected readonly detail = computed(() => {
    const z = this.pois.zone();
    if (!z) return '';
    return `${z.rayon_metres ? `r=${(z.rayon_metres / 1000).toFixed(1)}km · ` : ''}${z.nb_pois} POI`;
  });
}
