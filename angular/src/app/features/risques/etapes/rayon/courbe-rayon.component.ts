import type { HttpResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { Observable } from 'rxjs';
import { formaterNombre } from '../../../../core/format/nombre';
import { KpiComponent } from '../../../../ui/kpi/kpi.component';
import { ProfilRisqueApi } from '../../data/profil-risque.api';
import type { ResultatCourbe } from '../../logique/donnees-risque';
import { BoutonExportComponent } from '../../exports/bouton-export.component';
import { CourbePopulationComponent, RAYON_LECTURE_DEFAUT } from './courbe-population.component';

export { CLE_TOUTES, jetonNature } from './courbe-population.component';
/** La commande qui termine le pré-calcul — MOT POUR MOT de `OngletRayonInfluence.tsx:177,211`. */
export const COMMANDE_COUVERTURE = 'node scripts/construire_couverture_rayon.mjs';

/** Le territoire courant, sous la forme que la route d'export attend (un code unique). */
export interface PerimetreCourbe { niveau: 'region' | 'departement'; code: string }

/**
 * ② Rayon — la courbe de couverture, portage d'`OngletRayonInfluence.tsx`. La courbe, ses chiffres et le curseur sont
 * `mg-courbe-population` (lot 4, T12, partagée avec ④) ; restent ici les états de chargement, le bandeau du pré-calcul
 * partiel, les sites concernés, l'export et la note propres au risque.
 *
 * La série complète (100 points par courbe) est chargée UNE fois par `DonneesRisqueService` et arrive ici en entrée.
 *
 * ── LA COURBE TOTALE N'EST PAS LA SOMME DES AUTRES ───────────────────────
 *
 * Un carreau proche de deux natures compte dans les DEUX courbes par nature ; la courbe `'*'` vient d'un calcul
 * séparé, au minimum par carreau. L'écran le dit sous la légende, et dit aussi quand le filtre de natures ne la
 * touche pas (`total_est_global`).
 */
@Component({
  selector: 'mg-courbe-rayon',
  imports: [BoutonExportComponent, CourbePopulationComponent, KpiComponent],
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

        <mg-courbe-population [courbes]="donnees()!.courbes" [libelleCible]="libelleCible()" [nomPerimetre]="nomPerimetre()"
                              [titre]="libelleGraphique()" nomTotale="Toutes natures" [rayonMax]="rayonMax()" [(rayon)]="rayon">
          <mg-kpi [taille]="22" [valeur]="sites()" libelle="sites concernés" [note]="departements()" />
          <mg-bouton-export mgActions libelle="Export Excel" libelleEnCours="Préparation…" nomRepli="rayon-influence-seveso.xlsx"
                            titre="Classeur Excel interactif : seuil Seveso, territoire, rayon et natures se règlent dans Excel"
                            [charger]="chargerExport" />
          <p mgNote data-role="note" class="m-0 px-5 pt-0 pb-[14px] text-[10px] leading-[1.5] text-tertiary">
            Distance au <strong class="font-medium">site</strong> le plus proche, jamais au périmètre PPRT : un rayon
            d’influence se mesure autour de l’installation.
            <strong class="font-medium">« Toutes natures » n’est pas la somme des autres courbes</strong> — un habitant
            proche de deux natures compte dans les deux, ce qui est juste pour chacune et faux pour leur addition.
            @if (donnees()!.total_est_global) {
              <span data-role="total-global">Vous avez filtré les natures : la courbe totale, elle, porte toujours sur l’ensemble.</span>
            }
          </p>
        </mg-courbe-population>
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

  /** Rayon retenu par le curseur de la courbe : lu par l'export. Purement local — aucun appel réseau, rien dans l'URL. */
  protected readonly rayon = signal(RAYON_LECTURE_DEFAUT);

  protected readonly commande = COMMANDE_COUVERTURE;

  /** La réponse, si elle porte au moins une courbe (sinon : « Aucun site à risque pour ces filtres. »). */
  protected readonly donnees = computed(() => {
    const d = this.courbe().data;
    return d && d.courbes.length > 0 ? d : null;
  });

  protected readonly rayonMax = computed(() => this.donnees()?.rayon_max_m ?? 10000);
  protected readonly libelleGraphique = computed(
    () => `Population couverte selon le rayon autour des sites à risque — ${this.libelleCible().toLowerCase()}, ${this.nomPerimetre()}`,
  );
  protected readonly sites = computed(() => formaterNombre(this.donnees()?.n_sites ?? 0));
  protected readonly departements = computed(() => {
    const n = this.donnees()?.n_departements ?? 0;
    return `${n} département${n > 1 ? 's' : ''}`;
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
}
