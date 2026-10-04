import {
  ChangeDetectionStrategy, Component, DestroyRef, type ElementRef, afterNextRender,
  computed, effect, inject, input, signal, viewChild, type Signal,
} from '@angular/core';
import { CouleursService } from '../core/theme/couleurs.service';
import { FABRIQUE_GRAPHIQUE, type GraphiqueMinimal } from './fabrique-graphique';
import { type MargesCourbe, type RepereCourbe, type SerieCourbe, optionCourbe } from './option-courbe';

/**
 * Une ou plusieurs courbes (lissées, rendu de Recharts), avec un repère vertical optionnel et une légende
 * cliquable (portée d'OngletRayonInfluence.tsx). Les couleurs viennent des
 * jetons par CouleursService : elles suivent le thème sans recharger.
 * Un jeton inconnu LÈVE dans le `computed` des options : le graphique reste
 * alors non peint et l'erreur remonte par l'ErrorHandler.
 */
@Component({
  selector: 'mg-courbe',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="img" [attr.aria-label]="libelle()" class="w-full" [style.height.px]="hauteur()">
      <!-- \`h-full\` et une marge, jamais \`absolute inset-0\` : ECharts pose \`position: relative\` EN LIGNE sur un
           conteneur dont il lit la position \`static\` — c'est le cas d'un élément encore DÉTACHÉ à l'init (contenu
           projeté sous un \`@if\`, T10). La classe \`absolute\` perdait alors, et le graphique restait haut de 0 px. -->
      <div #conteneur class="h-full" [class.mr-2]="!marges()"></div>
    </div>
    @if (legende()) {
    <div class="flex flex-wrap gap-x-[14px] gap-y-[6px] border-t-fin border-subtle px-5 pt-[10px] pb-[6px]">
      @for (s of series(); track s.cle) {
        <button type="button" (click)="basculer(s.cle)" [attr.aria-pressed]="!masquees().has(s.cle)"
                [attr.title]="masquees().has(s.cle) ? 'Afficher cette courbe' : 'Masquer cette courbe'"
                class="inline-flex cursor-pointer items-center gap-[6px] border-0 bg-transparent p-0 text-[11px]"
                [class.text-secondary]="!masquees().has(s.cle)" [class.text-tertiary]="masquees().has(s.cle)"
                [class.opacity-50]="masquees().has(s.cle)">
          <span aria-hidden="true" class="inline-block h-[2.5px] w-[14px] rounded-[2px]" [style.background]="'var(--' + s.jeton + ')'"></span>
          {{ s.libelle }}
          <span data-role="valeur-legende" class="font-mono text-[10px] text-tertiary">{{ valeurLegende(s) }}</span>
        </button>
      }
    </div>
    }
    <ng-content select="[mgNote]" />
  `,
})
export class CourbeComponent {
  readonly series = input.required<SerieCourbe[]>();
  readonly libelle = input.required<string>();
  readonly formaterX = input<(x: number) => string>((x) => String(x));
  readonly formaterY = input<(y: number) => string>((y) => String(y));
  readonly repere = input<RepereCourbe>();
  readonly domaineX = input<readonly [number, number]>();
  /** Valeur complète (infobulle, légende) ; défaut `formaterY`. */
  readonly formaterValeur = input<(y: number) => string>();
  /** Titre de l'infobulle pour une abscisse ; défaut `formaterX`. */
  readonly formaterTitre = input<(x: number) => string>();
  /** Graduations X imposées. */
  readonly graduationsX = input<readonly number[]>();
  /** Étiquettes aux kilomètres ronds sur les séries `etiquetee`. */
  readonly etiquettes = input(false);
  readonly hauteur = input(280);
  /** La légende cliquable sous le graphique ; `false` pour une courbe sans légende (alignement de ⑤). */
  readonly legende = input(true);
  /** Domaine et graduations Y imposés (voir `optionCourbe`). */
  readonly domaineY = input<readonly [number, number]>();
  readonly graduationsY = input<readonly number[]>();
  /**
   * Marges de la zone de tracé, celles de Recharts (`margin` + largeur des axes). Données, elles REMPLACENT aussi les
   * 8 px que le conteneur réserve à droite pour la courbe de ②, et la zone de tracé ne rétrécit plus pour contenir
   * ses étiquettes (Recharts les laisse déborder) : la marge droite s'écrit donc telle que React la pose.
   */
  readonly marges = input<MargesCourbe>();
  /** Grille horizontale pleine plutôt que pointillée. */
  readonly grillePleine = input(false);
  /** Jeton du fond de l'infobulle, sans `--` ; défaut `card-overlay`. */
  readonly jetonFondInfobulle = input<string>();

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
    const repere = this.repere();
    const jetons = [...new Set([
      ...this.series().map((s) => s.jeton),
      ...[repere?.jeton, repere?.jetonLibelle, this.jetonFondInfobulle()].filter((j): j is string => !!j),
    ])].sort();
    const cle = jetons.join('|');
    let palette = this.palettesParJetons.get(cle);
    if (!palette) {
      palette = this.couleursService.palette(Object.fromEntries(jetons.map((j) => [j, j])));
      this.palettesParJetons.set(cle, palette);
    }
    return palette();
  });
  private readonly teintesCadre = this.couleursService.palette({
    texte: 'text-tertiary', textePrincipal: 'text-primary', grille: 'border-subtle', axe: 'border-default',
    fondInfobulle: 'card-overlay', bordInfobulle: 'border-default', repere: 'brand-teal', halo: 'bg-level-1', pointActif: 'point-actif-contour',
  });

  private readonly option = computed(() => {
    const cadre = this.teintesCadre();
    const jetons = this.teintesJetons();
    const series = Object.fromEntries(
      this.series().map((s) => [s.cle, jetons[s.jeton]]),
    );
    const repere = this.repere();
    const fond = this.jetonFondInfobulle();
    return optionCourbe({
      series: this.series(),
      masquees: this.masquees(),
      couleurs: {
        ...cadre,
        series,
        ...(repere?.jeton ? { repere: jetons[repere.jeton] } : {}),
        ...(repere?.jetonLibelle ? { libelleRepere: jetons[repere.jetonLibelle] } : {}),
        ...(fond ? { fondInfobulle: jetons[fond] } : {}),
      },
      formaterX: this.formaterX(),
      formaterY: this.formaterY(),
      repere: this.repere(),
      domaineX: this.domaineX(),
      formaterValeur: this.formaterValeur(),
      formaterTitre: this.formaterTitre(),
      graduationsX: this.graduationsX(),
      etiquettes: this.etiquettes(),
      domaineY: this.domaineY(),
      graduationsY: this.graduationsY(),
      marges: this.marges(),
      grillePleine: this.grillePleine(),
    });
  });

  /**
   * La valeur de la courbe au repère (React : « valeur au rayon » dans la légende) : le dernier point
   * SANS dépasser le repère — la courbe est cumulée, prendre le suivant annoncerait une population non
   * atteinte. Repli sur le premier point quand le repère le précède, comme React : la valeur annoncée est
   * alors celle d'un rayon pas encore atteint. Sans repère, aucune valeur n'est lisible : tiret.
   */
  protected valeurLegende(s: SerieCourbe): string {
    const repere = this.repere();
    // Les trous (`null`) ne se lisent pas : ni la valeur au repère, ni son repli.
    const points = s.points.filter((p): p is readonly [number, number] => p[1] !== null);
    if (!repere || points.length === 0) return '—';
    let choisi = points[0];
    for (const p of points) if (p[0] <= repere.x) choisi = p;
    return (this.formaterValeur() ?? this.formaterY())(choisi[1]);
  }

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
