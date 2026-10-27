import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Les outils présentés dans l'encart d'accueil (`AVAILABLE_TOOLS`, `SpatialAnalysisIntro.tsx:17-20`). */
// « Isochrones routiers — Temps de trajet réel ORS » jusqu'au retrait de la V1 (27/10) : l'outil annoncé est la V2.
const OUTILS_DISPONIBLES = [{ icone: '◎', libelle: 'Bataille V2 (multi-paliers)', description: 'Temps de trajet ORS, lus dans le cache' }] as const;

/**
 * Les encarts d'accueil de l'analyse spatiale — portage de `filter-panel/SpatialAnalysisIntro.tsx` (lot 4, T17) :
 * aucun POI sélectionné → ce qui est disponible et la condition d'accès ; plusieurs → combien de types retirer ; un
 * seul → rien (les outils s'affichent).
 *
 * Écart voulu (décision du propriétaire) : la ligne « Voronoï géométrique » n'y figure plus — le Voronoï n'existait
 * que par l'Assistant, jamais porté, et il est ABSENT du panneau ; l'annoncer aurait promis un outil introuvable.
 * Couleurs : les `rgba(255,255,255,…)` de React deviennent `--text-primary` au même pourcentage, le rouge pâle
 * `#fca5a5` du texte d'alerte `--danger` à 70 %.
 */
@Component({
  selector: 'mg-intro-analyse',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (nombrePoi() === 0) {
      <div data-intro-vide class="rounded-[4px] border-fin border-subtle bg-[color-mix(in_srgb,var(--text-primary)_2%,transparent)] p-[14px]">
        <div class="mb-2 text-[11px] font-medium text-tertiary">Analyses spatiales disponibles</div>
        <div class="flex flex-col gap-2">
          @for (o of outils; track o.libelle) {
            <div class="flex items-center gap-[10px] rounded-[4px] border-fin border-subtle bg-[color-mix(in_srgb,var(--text-primary)_2%,transparent)] px-[10px] py-2">
              <span class="shrink-0 font-mono text-[14px] text-tertiary">{{ o.icone }}</span>
              <div>
                <div class="text-[12px] font-medium text-secondary">{{ o.libelle }}</div>
                <div class="mt-px text-[11px] text-tertiary">{{ o.description }}</div>
              </div>
            </div>
          }
        </div>
        <div class="mt-3 rounded-[4px] border-fin border-default bg-[color-mix(in_srgb,var(--text-primary)_3%,transparent)] px-[11px] py-[9px]">
          <div class="mb-1 text-[11px] font-medium text-secondary">Sélectionnez 1 seul type de POI</div>
          <div class="text-[12px] leading-[1.5] text-tertiary">Isolez un réseau (ex: CIRFA) pour débloquer le calcul de zone de chalandise.</div>
        </div>
      </div>
    } @else if (nombrePoi() > 1) {
      <div data-intro-trop class="mt-1 rounded-[4px] border-fin border-[color-mix(in_srgb,var(--danger)_25%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-[10px]">
        <div class="mb-1 text-[11px] font-medium text-danger">! Trop de types sélectionnés</div>
        <div class="text-[12px] leading-[1.5] text-[color-mix(in_srgb,var(--danger)_70%,var(--text-primary))]">{{ retrait() }}</div>
      </div>
    }
  `,
})
export class IntroAnalyseComponent {
  /** Le nombre de types de POI choisis (`selectedPOI.length`). */
  readonly nombrePoi = input.required<number>();
  protected readonly outils = OUTILS_DISPONIBLES;
  protected readonly retrait = computed(() => {
    const n = this.nombrePoi() - 1;
    return `Les analyses spatiales nécessitent exactement 1 type de POI. Retirez ${n} type${n > 1 ? 's' : ''}.`;
  });
}
