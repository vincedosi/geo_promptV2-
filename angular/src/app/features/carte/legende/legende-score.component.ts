import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formaterNombre } from '../../../core/format/nombre';
import { ScoreService } from '../couches/score.service';
import { libelleCodesPostaux } from '../logique/analyses/score';

/** Les cinq paliers plats de l'échelle SÉQUENTIELLE (`PALIERS_SEQUENTIELS_CSS`, `components/ui/echelle-sequentielle.ts`). */
const PALIERS = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)'] as const;

/**
 * La carte flottante du score composite — le rendu de `ScoreMapLayer.tsx:237-303` (lot 4, T18), monté par la légende
 * de la carte (`mg-legende-carte`) mais posé À PART, en bas à DROITE : React l'en avait sortie parce que la légende,
 * au même endroit, la recouvrait (constat 17). Score et diffusion portent leur propre carte (`degradeALegende`).
 *
 * Trois états, ceux de React : « Chargement des contours… », l'échec des contours (le score est calculé mais ne peut
 * pas être peint — sinon l'utilisateur restait sans calque ET sans explication), puis le score : titre, croix qui
 * l'éteint, ce qu'il agrège, cinq paliers plats (jamais un dégradé : « flat total »), 0 / 100, nombre de codes postaux
 * et de partiels.
 *
 * Écarts, défauts corrigés : « codes postaux » (React écrivait « codes postalux ») ; les deux comptes passent par
 * `formaterNombre` (« 6 187 ») — React écrivait « 6187 » ici et « 6 187 » dans l'outil, pour le même nombre.
 */
@Component({
  selector: 'mg-legende-score',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (visible()) {
      <div data-legende-score
        class="absolute bottom-[28px] right-4 z-[35] min-w-[200px] max-w-[260px] rounded-[6px] border-fin border-default bg-card-overlay px-3 py-[10px] text-[11px] text-secondary">
        @if (score.chargement()) {
          Chargement des contours…
        } @else if (score.echec()) {
          <span class="text-danger">Contours des codes postaux indisponibles — le score est calculé, mais ne peut pas être affiché.</span>
        } @else if (score.affiche(); as a) {
          <div class="mb-1.5 flex items-center gap-2">
            <span class="flex-1 text-[12px] font-medium text-primary">Score composite</span>
            <!-- Sans cette croix, la seule façon d'éteindre le score était d'activer un autre dégradé. -->
            <button type="button" aria-label="Masquer le score composite" (click)="score.eteindre()"
              class="cursor-pointer border-0 bg-transparent p-0 text-[14px] leading-none text-tertiary">×</button>
          </div>
          <div class="mb-2 leading-[1.4]">{{ a.libelle }}</div>
          <div aria-hidden="true" class="mb-1 flex h-1.5 gap-0.5">
            @for (p of paliers; track p) {
              <span data-palier class="flex-1 rounded-[1px]" [style.background]="p"></span>
            }
          </div>
          <div class="flex justify-between font-mono text-[10px] text-tertiary"><span>0</span><span>100</span></div>
          <div class="mt-2 font-mono text-[10px] text-tertiary">{{ compte() }}</div>
          @if (score.partiels() > 0) {
            <div class="mt-1 font-mono text-[10px] text-warning">{{ partiels() }}</div>
          }
        }
      </div>
    }
  `,
})
export class LegendeScoreComponent {
  protected readonly score = inject(ScoreService);
  protected readonly paliers = PALIERS;
  protected readonly visible = computed(() => this.score.affiche() !== null || this.score.chargement() || this.score.echec());

  protected readonly compte = computed(() => libelleCodesPostaux(this.score.affiche()?.scores.length ?? 0));
  protected readonly partiels = computed(() => {
    const n = this.score.partiels();
    return `${formaterNombre(n)} partiel${n > 1 ? 's' : ''}, peint${n > 1 ? 's' : ''} en transparence`;
  });
}
