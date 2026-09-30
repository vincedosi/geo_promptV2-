import {
  ChangeDetectionStrategy, Component, DestroyRef, type ElementRef, afterNextRender,
  computed, effect, inject, input, signal, viewChild, type Signal,
} from '@angular/core';
import { CouleursService } from '../core/theme/couleurs.service';
import { FABRIQUE_GRAPHIQUE, type GraphiqueMinimal } from './fabrique-graphique';
import { type RepereCourbe, type SerieCourbe, optionCourbe } from './option-courbe';

/**
 * Une ou plusieurs courbes, avec un repère vertical optionnel et une légende
 * cliquable (portée d'OngletRayonInfluence.tsx). Les couleurs viennent des
 * jetons par CouleursService : elles suivent le thème sans recharger.
 * Un jeton inconnu LÈVE dans le `computed` des options : le graphique reste
 * alors non peint et l'erreur remonte par l'ErrorHandler.
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

  /**
   * Une palette par ENSEMBLE de jetons présents dans les séries, mémoïsée : le
   * composant reste générique, et aucun signal n'est renvoyé par un signal.
   * Un jeton inconnu fait lever CouleursService à la lecture : jamais de repli.
   */
  private readonly palettesParJetons = new Map<string, Signal<Record<string, string>>>();
  private readonly teintesJetons = computed(() => {
    const jetons = [...new Set(this.series().map((s) => s.jeton))].sort();
    const cle = jetons.join('|');
    let palette = this.palettesParJetons.get(cle);
    if (!palette) {
      palette = this.couleursService.palette(Object.fromEntries(jetons.map((j) => [j, j])));
      this.palettesParJetons.set(cle, palette);
    }
    return palette();
  });
  private readonly teintesCadre = this.couleursService.palette({
    texte: 'text-tertiary', grille: 'border-subtle', fondInfobulle: 'bg-level-1',
    bordInfobulle: 'border-default', repere: 'text-secondary',
  });

  private readonly option = computed(() => {
    const cadre = this.teintesCadre();
    const jetons = this.teintesJetons();
    const series = Object.fromEntries(
      this.series().map((s) => [s.cle, jetons[s.jeton]]),
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
