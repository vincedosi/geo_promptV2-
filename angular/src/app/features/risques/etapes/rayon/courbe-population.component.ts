import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { formaterDecimal, formaterNombre, formaterNombreAbrege } from '../../../../core/format/nombre';
import { CourbeComponent } from '../../../../graphiques/courbe.component';
import type { SerieCourbe } from '../../../../graphiques/option-courbe';
import { KpiComponent } from '../../../../ui/kpi/kpi.component';
import type { ReponseCourbe } from '../../data/zones-risque.api';
import { TEINTES_NATURE } from '../../logique/palette-natures';

/** La courbe « toutes valeurs confondues », distinguée par cette clé côté base (`OngletRayonInfluence.tsx:40`). */
export const CLE_TOUTES = '*';
/** Rayon du curseur à l'ouverture (React : `useState(1000)`). */
export const RAYON_LECTURE_DEFAUT = 1000;
/** Graduations aux kilomètres ronds (Recharts : `ticks`), coupées au rayon maximal. */
const GRADUATIONS_X: readonly number[] = Array.from({ length: 10 }, (_, i) => (i + 1) * 1000);

/** « 1 km », « 2,5 km » : les distances de la courbe et de ses appelants. */
export const formaterKm = (m: number): string => `${formaterNombre(m / 1000)} km`;

/** Une courbe cumulée : la forme commune de `lire_couverture_rayon` et de `couverture_rayon_poi` (sql/272). */
export type CourbeCumulee = ReponseCourbe['courbes'][number];

/**
 * Le JETON d'une valeur d'après son rang, pour ECharts : `var(--nature-3)` → `nature-3`. ECharts ne résout pas
 * `var()` : la couleur est lue par `CouleursService` (dans `mg-courbe`), donc repeinte au changement de thème.
 * Rang modulo la palette, comme React (`TEINTES[i++ % TEINTES.length]`, l.160).
 */
export function jetonNature(rang: number): string {
  return TEINTES_NATURE[rang % TEINTES_NATURE.length].slice('var(--'.length, -1);
}

/**
 * La courbe de population couverte selon le rayon, en pure présentation (lot 4, T12) — extraite de `mg-courbe-rayon`
 * pour servir aussi la couverture autour de tout type de POI (④). Ce qui est propre à l'appelant arrive par projection :
 * un `mg-kpi` (les sites ou POI), `[mgActions]` (l'export du risque) et `[mgNote]` (sa note sous la légende).
 *
 * AUCUN APPEL RÉSEAU AU DÉPLACEMENT DU CURSEUR : la série complète arrive en entrée ; `rayon` est un `model()` que le
 * parent lit (export du risque, cercles de ④), bouger le curseur relit un tableau, rien de plus.
 *
 * Hôte `contents` : les blocs restent enfants directs de la colonne flexible du parent, comme avant l'extraction.
 */
@Component({
  selector: 'mg-courbe-population',
  imports: [CourbeComponent, KpiComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <div class="flex items-end gap-[34px] px-5 pt-4 pb-3" data-role="kpis">
      <mg-kpi [taille]="22" accent [valeur]="lecture().population" [libelle]="lecture().libelle" [note]="lecture().noteCible" />
      <mg-kpi [taille]="22" [valeur]="lecture().part" [libelle]="libellePart()" [note]="lecture().total" />
      <ng-content select="mg-kpi" />
      @if (lecture().increment !== null) {
        <mg-kpi [taille]="22" [valeur]="lecture().increment!" libelle="au palier suivant" note="habitants gagnés par 100 m de plus" />
      }
    </div>

    <!-- Le curseur : lecture IMMÉDIATE dans la série déjà chargée. \`flex-wrap\` : à 480 px, la case passe dessous. -->
    <div class="flex flex-wrap items-center gap-3 px-5 pt-0 pb-[14px]">
      <input type="range" class="flex-1 accent-teal" [min]="100" [max]="rayonMax()" [step]="100"
             [value]="rayon()" (input)="lireRayon($event)" aria-label="Rayon retenu, en mètres" />
      <span data-role="rayon" class="min-w-[66px] font-mono text-[12px] text-primary">{{ rayonKm() }}</span>
      <span class="text-[10px] text-tertiary">lecture immédiate, sans recalcul</span>
      <label class="flex cursor-pointer items-center gap-[6px] text-[11px] whitespace-nowrap text-secondary">
        <input type="checkbox" class="accent-teal" [checked]="etiquettes()" (change)="basculerEtiquettes($event)" />
        Afficher les étiquettes (tous les 1 km)
      </label>
      <ng-content select="[mgActions]" />
    </div>

    <mg-courbe [libelle]="titre()" [series]="series()" [formaterX]="formaterX" [formaterY]="formaterY"
               [repere]="repere()" [domaineX]="domaineX()" [graduationsX]="graduationsX()"
               [formaterValeur]="formaterValeur" [formaterTitre]="formaterTitre" [etiquettes]="etiquettes()">
      <ng-container ngProjectAs="[mgNote]"><ng-content select="[mgNote]" /></ng-container>
    </mg-courbe>
  `,
})
export class CourbePopulationComponent {
  /** Les courbes à tracer, au moins une ; la totale porte la clé `'*'`. */
  readonly courbes = input.required<readonly CourbeCumulee[]>();
  readonly libelleCible = input.required<string>();
  readonly nomPerimetre = input.required<string>();
  /** Le libellé accessible du graphique. */
  readonly titre = input.required<string>();
  /** Le nom de la courbe totale dans la légende (« Toutes natures », « Tous les POI »). */
  readonly nomTotale = input.required<string>();
  readonly rayonMax = input.required<number>();
  /** Rayon retenu par le curseur — local, aucun appel réseau, rien dans l'URL. */
  readonly rayon = model(RAYON_LECTURE_DEFAUT);

  /** Étiquettes au kilomètre, sur la courbe totale seulement ; décochées par défaut comme en React. */
  protected readonly etiquettes = signal(false);

  protected readonly formaterX = formaterKm;
  protected readonly formaterY = formaterNombreAbrege;
  protected readonly formaterValeur = (y: number) => formaterNombre(y);
  protected readonly formaterTitre = (x: number) => `à moins de ${formaterDecimal(x / 1000)} km`;

  protected readonly series = computed<SerieCourbe[]>(() => {
    let rang = 0;
    return this.courbes().map((c) => {
      const points = c.points.map((p) => [p.r, p.p] as const);
      if (c.cle === CLE_TOUTES) {
        return { cle: c.cle, libelle: this.nomTotale(), jeton: 'brand-teal', points, epaisseur: 2.2, etiquetee: true };
      }
      return { cle: c.cle, libelle: c.cle, jeton: jetonNature(rang++), points };
    });
  });

  protected readonly domaineX = computed<readonly [number, number]>(() => [100, this.rayonMax()]);
  /** Sous 1 km de rayon maximal, aucune graduation ronde : ECharts choisit les siennes. */
  protected readonly graduationsX = computed(() => {
    const g = GRADUATIONS_X.filter((x) => x <= this.rayonMax());
    return g.length > 0 ? g : undefined;
  });
  /** Le repère suit le curseur : trait teal tireté, SANS libellé (React : `ReferenceLine`). */
  protected readonly repere = computed(() => ({ x: this.rayon() }));
  protected readonly rayonKm = computed(() => `${formaterDecimal(this.rayon() / 1000)} km`);
  protected readonly libellePart = computed(() => `du total à ${formaterKm(this.rayonMax())}`);

  /**
   * Les chiffres au rayon du curseur (l.146-167) : le point le plus proche SANS dépasser (la courbe est cumulée), la
   * part du total au rayon maximal, l'incrément de la courbe TOTALE.
   */
  protected readonly lecture = computed(() => {
    const totale = this.courbes().find((c) => c.cle === CLE_TOUTES);
    const points = totale?.points ?? [];
    let choisi = points[0];
    for (const p of points) if (p.r <= this.rayon()) choisi = p;
    const total = totale?.total ?? 0;
    const pop = choisi?.p ?? 0;
    const part = total > 0 ? (pop / total) * 100 : 0;
    return {
      population: formaterNombre(pop),
      libelle: `à moins de ${formaterDecimal(this.rayon() / 1000)} km`,
      noteCible: `${this.libelleCible().toLowerCase()} · ${this.nomPerimetre()}`,
      part: `${formaterDecimal(part)} %`,
      total: `${formaterNombre(total)} au maximum`,
      // React n'affiche ce KPI que s'il existe un point (`auRayon &&`) ; l'incrément manquant vaut 0.
      increment: choisi ? formaterNombre(choisi.i ?? 0) : null,
    };
  });

  protected lireRayon(ev: Event): void {
    this.rayon.set(Number((ev.target as HTMLInputElement).value));
  }

  protected basculerEtiquettes(ev: Event): void {
    this.etiquettes.set((ev.target as HTMLInputElement).checked);
  }
}
