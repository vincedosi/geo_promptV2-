import type { HttpResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { Observable } from 'rxjs';
import { formaterDecimal, formaterNombre, formaterNombreAbrege } from '../../../../core/format/nombre';
import { CourbeComponent } from '../../../../graphiques/courbe.component';
import type { SerieCourbe } from '../../../../graphiques/option-courbe';
import { KpiComponent } from '../../../../ui/kpi/kpi.component';
import { ProfilRisqueApi } from '../../data/profil-risque.api';
import type { ResultatCourbe } from '../../logique/donnees-risque';
import { BoutonExportComponent } from '../../exports/bouton-export.component';
import { TEINTES_NATURE } from '../../logique/palette-natures';

/** La courbe « toutes natures confondues », distinguée par cette clé côté base (`OngletRayonInfluence.tsx:40`). */
export const CLE_TOUTES = '*';
/** La commande qui termine le pré-calcul — MOT POUR MOT de `OngletRayonInfluence.tsx:177,211`. */
export const COMMANDE_COUVERTURE = 'node scripts/construire_couverture_rayon.mjs';
/** Rayon du curseur à l'ouverture (React : `useState(1000)`). */
export const RAYON_LECTURE_DEFAUT = 1000;
/** Graduations fixes de 1 à 10 km (Recharts : `ticks`). */
const GRADUATIONS_X: readonly number[] = Array.from({ length: 10 }, (_, i) => (i + 1) * 1000);

/**
 * Le JETON d'une nature d'après son rang, pour ECharts : `var(--nature-3)` → `nature-3`. ECharts ne résout pas
 * `var()` : la couleur est lue par `CouleursService` (dans `mg-courbe`), donc repeinte au changement de thème.
 * Rang modulo la palette, comme React (`TEINTES[i++ % TEINTES.length]`, l.160) — les quatorze natures recyclent.
 */
export function jetonNature(rang: number): string {
  return TEINTES_NATURE[rang % TEINTES_NATURE.length].slice('var(--'.length, -1);
}

/** Le territoire courant, sous la forme que la route d'export attend (un code unique). */
export interface PerimetreCourbe { niveau: 'region' | 'departement'; code: string }

/**
 * ② Rayon — la courbe de couverture, portage d'`OngletRayonInfluence.tsx` sur `mg-courbe` (ECharts).
 *
 * ── AUCUN APPEL RÉSEAU AU DÉPLACEMENT DU CURSEUR ──────────────────────────
 *
 * La série complète (100 points par courbe) est chargée UNE fois par `DonneesRisqueService` et arrive ici en entrée.
 * Le curseur est un signal LOCAL : le bouger relit un tableau, rien de plus — ni appel, ni écriture d'URL.
 *
 * ── LA COURBE TOTALE N'EST PAS LA SOMME DES AUTRES ───────────────────────
 *
 * Un carreau proche de deux natures compte dans les DEUX courbes par nature ; la courbe `'*'` vient d'un calcul
 * séparé, au minimum par carreau. L'écran le dit sous la légende, et dit aussi quand le filtre de natures ne la
 * touche pas (`total_est_global`).
 *
 * Couleurs : jetons (`brand-teal` pour la totale, `nature-n` pour les autres), jamais `var()` ni hexadécimal dans les
 * options ECharts — `mg-courbe` les lit par `CouleursService` et repeint au changement de thème.
 */
@Component({
  selector: 'mg-courbe-rayon',
  imports: [BoutonExportComponent, CourbeComponent, KpiComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (courbe().chargement && !courbe().data) {
      <!-- Squelette : la forme de l'écran, pas un tourniquet (\`Squelette\`, l.449). -->
      <div data-role="squelette" class="flex flex-col gap-[14px] p-5" aria-hidden="true">
        <div class="flex gap-[34px]">
          @for (i of [0, 1, 2]; track i) {
            <div class="flex flex-col gap-[5px]">
              <div class="h-[22px] w-[90px] rounded-md bg-elevated"></div>
              <div class="h-[10px] w-[120px] rounded-[3px] bg-elevated"></div>
            </div>
          }
        </div>
        <div class="h-2 rounded-md bg-elevated"></div>
        <div class="h-[240px] rounded-lg bg-elevated"></div>
      </div>
    } @else if (courbe().erreur) {
      <!-- 409 \`a_construire\` : la construction manque, jamais une courbe plate (qui se lirait « personne »). -->
      <div data-role="erreur" class="p-7 text-[13px] leading-[1.6] text-secondary">
        <p class="m-0" [class.text-warning]="courbe().aConstruire" [class.text-danger]="!courbe().aConstruire">{{ courbe().erreur }}</p>
        @if (courbe().aConstruire) {
          <p class="mb-0 mt-[10px] text-[11px] text-tertiary">Construction : <code class="font-mono">{{ commande }}</code></p>
        }
      </div>
    } @else if (!donnees()) {
      <p data-role="vide" class="m-0 p-7 text-[13px] text-tertiary">Aucun site à risque pour ces filtres.</p>
    } @else {
      <div class="flex h-full min-h-0 flex-col">
        @if (partiel(); as p) {
          <!-- AVANT les chiffres : une courbe bâtie sur une France incomplète sous-estime sans changer de forme. -->
          <p data-role="partiel" class="m-0 border-b-fin border-warning bg-elevated px-5 py-[10px] text-[11px] leading-[1.5] text-warning">
            <strong class="font-medium">Pré-calcul partiel : {{ p.pct }} % de la métropole</strong>
            ({{ p.bandes }} bandes construites{{ p.lointaines }}). Les chiffres ci-dessous SOUS-ESTIMENT la population
            couverte — ils ne portent que sur la part déjà traitée. Terminer avec
            <code class="font-mono">{{ commande }}</code>.
          </p>
        }

        <div class="flex items-end gap-[34px] px-5 pt-4 pb-3" data-role="kpis">
          <mg-kpi [taille]="22" accent [valeur]="lecture().population" [libelle]="lecture().libelle" [note]="lecture().noteCible" />
          <mg-kpi [taille]="22" [valeur]="lecture().part" libelle="du total à 10 km" [note]="lecture().total" />
          <mg-kpi [taille]="22" [valeur]="lecture().sites" libelle="sites concernés" [note]="lecture().departements" />
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
          <mg-bouton-export libelle="Export Excel" libelleEnCours="Préparation…" nomRepli="rayon-influence-seveso.xlsx"
                            titre="Classeur Excel interactif : seuil Seveso, territoire, rayon et natures se règlent dans Excel"
                            [charger]="chargerExport" />
        </div>

        <mg-courbe [libelle]="libelleGraphique()" [series]="series()" [formaterX]="formaterX" [formaterY]="formaterY"
                   [repere]="repere()" [domaineX]="domaineX()" [graduationsX]="graduationsX"
                   [formaterValeur]="formaterValeur" [formaterTitre]="formaterTitre" [etiquettes]="etiquettes()">
          <p mgNote data-role="note" class="m-0 px-5 pt-0 pb-[14px] text-[10px] leading-[1.5] text-tertiary">
            Distance au <strong class="font-medium">site</strong> le plus proche, jamais au périmètre PPRT : un rayon
            d’influence se mesure autour de l’installation.
            <strong class="font-medium">« Toutes natures » n’est pas la somme des autres courbes</strong> — un habitant
            proche de deux natures compte dans les deux, ce qui est juste pour chacune et faux pour leur addition.
            @if (donnees()!.total_est_global) {
              <span data-role="total-global">Vous avez filtré les natures : la courbe totale, elle, porte toujours sur l’ensemble.</span>
            }
          </p>
        </mg-courbe>
      </div>
    }
  `,
})
export class CourbeRayonComponent {
  /** La courbe, chargée par `DonneesRisqueService` — jamais ici (elle repartait sinon à chaque retour sur l'étape). */
  readonly courbe = input.required<ResultatCourbe>();
  readonly libelleCible = input.required<string>();
  /** Le territoire du fil d'Ariane, « France entière » par défaut. */
  readonly nomPerimetre = input.required<string>();
  /** Gravités et natures retenues : valeurs INITIALES du classeur exporté, comme React. */
  readonly gravites = input.required<readonly string[]>();
  readonly natures = input.required<readonly string[]>();
  readonly perim = input.required<PerimetreCourbe | null>();

  private readonly profilApi = inject(ProfilRisqueApi);

  /** Rayon retenu par le curseur. Purement local — aucun appel réseau, rien dans l'URL. */
  protected readonly rayon = signal(RAYON_LECTURE_DEFAUT);
  /** Étiquettes au kilomètre, sur la courbe totale seulement ; décochées par défaut comme en React. */
  protected readonly etiquettes = signal(false);

  protected readonly commande = COMMANDE_COUVERTURE;
  protected readonly graduationsX = GRADUATIONS_X;
  protected readonly formaterX = (x: number) => `${x / 1000} km`;
  protected readonly formaterY = formaterNombreAbrege;
  protected readonly formaterValeur = (y: number) => formaterNombre(y);
  protected readonly formaterTitre = (x: number) => `à moins de ${formaterDecimal(x / 1000)} km`;

  /** La réponse, si elle porte au moins une courbe (sinon : « Aucun site à risque pour ces filtres. »). */
  protected readonly donnees = computed(() => {
    const d = this.courbe().data;
    return d && d.courbes.length > 0 ? d : null;
  });

  protected readonly series = computed<SerieCourbe[]>(() => {
    let rang = 0;
    return (this.donnees()?.courbes ?? []).map((c) => {
      const points = c.points.map((p) => [p.r, p.p] as const);
      if (c.cle === CLE_TOUTES) {
        return { cle: c.cle, libelle: 'Toutes natures', jeton: 'brand-teal', points, epaisseur: 2.2, etiquetee: true };
      }
      return { cle: c.cle, libelle: c.cle, jeton: jetonNature(rang++), points };
    });
  });

  protected readonly rayonMax = computed(() => this.donnees()?.rayon_max_m ?? 10000);
  protected readonly domaineX = computed<readonly [number, number]>(() => [100, this.rayonMax()]);
  /** Le repère suit le curseur : trait teal tireté, SANS libellé (React : `ReferenceLine`). */
  protected readonly repere = computed(() => ({ x: this.rayon() }));
  protected readonly rayonKm = computed(() => `${formaterDecimal(this.rayon() / 1000)} km`);
  protected readonly libelleGraphique = computed(
    () => `Population couverte selon le rayon autour des sites à risque — ${this.libelleCible().toLowerCase()}, ${this.nomPerimetre()}`,
  );

  /**
   * Les quatre chiffres au rayon du curseur (l.146-167) : le point le plus proche SANS dépasser (la courbe est
   * cumulée), la part du total à 10 km, les sites et leurs départements, l'incrément de la courbe TOTALE.
   */
  protected readonly lecture = computed(() => {
    const d = this.donnees();
    const totale = d?.courbes.find((c) => c.cle === CLE_TOUTES);
    const points = totale?.points ?? [];
    let choisi = points[0];
    for (const p of points) if (p.r <= this.rayon()) choisi = p;
    const total = totale?.total ?? 0;
    const pop = choisi?.p ?? 0;
    const part = total > 0 ? (pop / total) * 100 : 0;
    const nDep = d?.n_departements ?? 0;
    return {
      population: formaterNombre(pop),
      libelle: `à moins de ${formaterDecimal(this.rayon() / 1000)} km`,
      noteCible: `${this.libelleCible().toLowerCase()} · ${this.nomPerimetre()}`,
      part: `${formaterDecimal(part)} %`,
      total: `${formaterNombre(total)} au maximum`,
      sites: formaterNombre(d?.n_sites ?? 0),
      departements: `${nDep} département${nDep > 1 ? 's' : ''}`,
      // React n'affiche ce KPI que s'il existe un point (`auRayon &&`) ; l'incrément manquant vaut 0.
      increment: choisi ? formaterNombre(choisi.i ?? 0) : null,
    };
  });

  /** Le bandeau « Pré-calcul partiel », sous 99 % de la métropole (l.199). */
  protected readonly partiel = computed(() => {
    const d = this.donnees();
    const pct = d?.couverture_pct;
    if (!d || pct === undefined || pct >= 99) return null;
    const n = d.n_zones_lointaines ?? 0;
    return {
      pct,
      bandes: d.n_bandes_construites ?? 0,
      lointaines: n > 0 ? `, plus ${n} zone${n > 1 ? 's' : ''} d’outre-mer` : '',
    };
  });

  /**
   * Le classeur interactif du rayon. Paramètres de `BoutonExportRayon.tsx:38-45` : `rayon_m` toujours, puis
   * `gravites`, `natures`, `perim_niveau` + `perim_code` s'ils sont renseignés. Lu AU CLIC : le rayon exporté est celui
   * du curseur au moment du geste.
   */
  protected readonly chargerExport = (): Observable<HttpResponse<Blob>> => {
    const p = new URLSearchParams({ rayon_m: String(this.rayon()) });
    if (this.gravites().length > 0) p.set('gravites', this.gravites().join(','));
    if (this.natures().length > 0) p.set('natures', this.natures().join(','));
    const perim = this.perim();
    if (perim) {
      p.set('perim_niveau', perim.niveau);
      p.set('perim_code', perim.code);
    }
    return this.profilApi.exportRayon(p);
  };

  protected lireRayon(ev: Event): void {
    this.rayon.set(Number((ev.target as HTMLInputElement).value));
  }

  protected basculerEtiquettes(ev: Event): void {
    this.etiquettes.set((ev.target as HTMLInputElement).checked);
  }
}
