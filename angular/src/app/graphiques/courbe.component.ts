import {
  ChangeDetectionStrategy, Component, DestroyRef, type ElementRef, afterNextRender,
  computed, effect, inject, input, signal, viewChild,
} from '@angular/core';
import { CouleursService } from '../core/theme/couleurs.service';
import { FABRIQUE_GRAPHIQUE, type GraphiqueMinimal } from './fabrique-graphique';
import { type RepereCourbe, type SerieCourbe, optionCourbe } from './option-courbe';

/** Les jetons qu'une série peut porter : lus UNE fois, sans signal de signal. */
const JETONS_SERIES = ['brand-teal', ...Array.from({ length: 8 }, (_, i) => `nature-${i + 1}`)];

/**
 * Une ou plusieurs courbes, avec un repère vertical optionnel et une légende
 * cliquable (portée d'OngletRayonInfluence.tsx). Les couleurs viennent des
 * jetons par CouleursService : elles suivent le thème sans recharger.
 */
@Component({
  selector: 'mg-courbe',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="img" [attr.aria-label]="libelle()" class="relative w-full" [style.height.px]="hauteur()">
      <div #conteneur class="absolute inset-0"></div>
    </div>
    <div class="flex flex-wrap gap-x-3 gap-y-1 mt-2">
      @for (s of series(); track s.cle) {
        <button type="button" (click)="basculer(s.cle)" [attr.aria-pressed]="!masquees().has(s.cle)"
                class="inline-flex items-center gap-1.5 text-[11px] cursor-pointer"
                [class.text-secondary]="!masquees().has(s.cle)" [class.text-tertiary]="masquees().has(s.cle)"
                [class.line-through]="masquees().has(s.cle)">
          <span aria-hidden="true" class="inline-block w-3 h-0.5" [style.background]="'var(--' + s.jeton + ')'"></span>
          {{ s.libelle }}
        </button>
      }
    </div>
  `,
})
export class CourbeComponent {
  readonly series = input.required<SerieCourbe[]>();
  readonly libelle = input.required<string>();
  readonly formaterX = input<(x: number) => string>((x) => String(x));
  readonly formaterY = input<(y: number) => string>((y) => String(y));
  readonly repere = input<RepereCourbe>();
  readonly domaineX = input<readonly [number, number]>();
  readonly hauteur = input(280);

  protected readonly masquees = signal<ReadonlySet<string>>(new Set());

  private readonly conteneur = viewChild.required<ElementRef<HTMLDivElement>>('conteneur');
  private readonly fabrique = inject(FABRIQUE_GRAPHIQUE);
  private readonly couleursService = inject(CouleursService);
  private readonly destruction = inject(DestroyRef);
  private readonly graphique = signal<GraphiqueMinimal | null>(null);

  private readonly teintesJetons = this.couleursService.palette(
    Object.fromEntries(JETONS_SERIES.map((j) => [j, j])),
  );
  private readonly teintesCadre = this.couleursService.palette({
    texte: 'text-tertiary', grille: 'border-subtle', fondInfobulle: 'bg-level-1',
    bordInfobulle: 'border-default', repere: 'text-secondary',
  });

  private readonly option = computed(() => {
    const cadre = this.teintesCadre();
    const jetons = this.teintesJetons();
    const series = Object.fromEntries(
      this.series().map((s) => [s.cle, jetons[s.jeton] ?? cadre.texte]),
    );
    return optionCourbe({
      series: this.series(),
      masquees: this.masquees(),
      couleurs: { ...cadre, series },
      formaterX: this.formaterX(),
      formaterY: this.formaterY(),
      repere: this.repere(),
      domaineX: this.domaineX(),
    });
  });

  constructor() {
    afterNextRender(() => {
      const element = this.conteneur().nativeElement;
      const g = this.fabrique(element);
      this.graphique.set(g);
      const observateur = new ResizeObserver(() => g.resize());
      observateur.observe(element);
      this.destruction.onDestroy(() => {
        observateur.disconnect();
        g.dispose();
      });
    });
    effect(() => {
      const g = this.graphique();
      if (g) g.setOption(this.option(), { notMerge: true });
    });
  }

  protected basculer(cle: string): void {
    this.masquees.update((m) => {
      const suivant = new Set(m);
      if (suivant.has(cle)) suivant.delete(cle);
      else suivant.add(cle);
      return suivant;
    });
  }
}
