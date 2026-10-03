import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formaterDecimal, formaterNombre } from '../../../../core/format/nombre';
import { KpiComponent } from '../../../../ui/kpi/kpi.component';
import type { CompteSites } from '../../data/sites-risque.api';
import { partsDeNature } from '../../logique/palette-natures';

/** L'avertissement « aucun site », MOT POUR MOT de `PanneauSites.tsx:91-92`. */
export const MESSAGE_AUCUN_SITE = 'Aucun site ne passe les filtres. Tout l’écran sera vide — ce n’est pas '
  + 'une absence de population exposée, c’est une absence de site à exposer.';

/**
 * ① Sites — ce que les filtres retiennent, et de quoi ces sites menacent. Portage de `PanneauSites.tsx`.
 *
 * ── IL MONTRE LE FILTRE, IL NE LE REPOSE PAS ─────────────────────────────
 *
 * Les régimes vivent dans la barre COMMUNE : les recopier ici donnerait deux commandes pour un seul réglage. Le
 * panneau lit le compte DÉJÀ chargé par `DonneesRisqueService` (le même que le bandeau KPI) : aucun appel à lui.
 *
 * ── LA BARRE EMPILÉE SE CALCULE SUR LES EFFECTIFS ────────────────────────
 *
 * Les largeurs viennent des effectifs, jamais des parts arrondies : sept arrondis à une décimale ne totalisent pas
 * 100, et la barre finirait par un trou ou un débordement. Les teintes sont des JETONS (`var(--nature-n)`) posés
 * dans le DOM — la même source que les courbes de l'étape ②, pour qu'une nature garde sa couleur partout.
 */
@Component({
  selector: 'mg-panneau-sites',
  imports: [KpiComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (chargement()) {
      <p class="m-0 text-[11px] leading-[1.55] text-tertiary">Comptage des sites…</p>
    } @else if (compte(); as c) {
      <div class="flex flex-col gap-4">
        <mg-kpi [valeur]="valeurKpi()" libelle="sites retenus" [note]="noteKpi()" accent [taille]="22" />

        <!-- « 421 sur 1 259 » se lit « les filtres écartent les deux tiers » : le dénominateur dit qu'un filtre est resté coché. -->
        @if (c.retenus === 0) {
          <p class="m-0 text-[11px] leading-[1.55] text-warning">{{ messageAucunSite }}</p>
        }

        @if (parts().length > 0) {
          <div class="flex flex-col gap-2">
            <span class="text-[11px] text-tertiary">De quoi ces sites menacent</span>

            <div role="img" [attr.aria-label]="libelleBarre()"
                 class="flex h-[10px] w-full overflow-hidden rounded-[3px] bg-[var(--border-subtle)]">
              @for (p of parts(); track p.libelle) {
                <!-- Un filet entre segments : deux teintes voisines de luminosité proche se liraient comme une seule. -->
                <span [title]="p.titre" [style.width.%]="p.largeur" [style.background]="p.teinte"
                      class="border-r-fin border-solid border-[var(--bg-level-1)]"></span>
              }
            </div>

            <!-- La légende EST la liste des effectifs : deux blocs obligeraient à l'aller-retour couleur → nom → chiffre. -->
            @for (p of parts(); track p.libelle) {
              <div data-role="nature" class="flex items-center gap-2">
                <span aria-hidden="true" class="size-[9px] shrink-0 rounded-[2px]" [style.background]="p.teinte"></span>
                <span data-role="libelle-nature" [title]="p.libelle"
                      class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px]"
                      [class.text-tertiary]="p.regroupee" [class.text-secondary]="!p.regroupee">{{ p.libelle }}</span>
                <span data-role="pct" class="min-w-[38px] text-right font-mono text-[10.5px] text-tertiary">{{ p.pct }}</span>
                <span data-role="n" class="min-w-[46px] text-right font-mono text-[11px] text-primary">{{ p.n }}</span>
              </div>
            }

            <!-- L'écart doit valoir zéro : une barre plus courte que son total ne se voit pas à l'œil. -->
            @if (ecart(); as e) {
              <p class="m-0 text-[11px] leading-[1.55] text-warning">{{ e }}</p>
            }

            <p class="m-0 text-[11px] leading-[1.55] text-tertiary">
              ⚠ Un site porte souvent plusieurs natures de risque ; celle comptée ici est sa nature
              <strong>dominante</strong>, déduite du rang de sa rubrique ICPE. Les segments s’additionnent donc bien
              au total des sites retenus, mais ils ne disent pas tout de chaque site.
              @if (regroupement()) {
                Les natures les moins nombreuses sont regroupées : au-delà de huit teintes, deux natures se
                ressembleraient.
              }
            </p>
          </div>
        }
      </div>
    } @else {
      <p class="m-0 text-[11px] leading-[1.55] text-warning">
        Le comptage des sites n’a pas abouti. Les autres étapes restent utilisables : ce panneau ne conditionne aucun
        calcul.
      </p>
    }
  `,
})
export class PanneauSitesComponent {
  readonly compte = input.required<CompteSites | null>();
  readonly chargement = input.required<boolean>();
  /** Le territoire regardé, pour dire à quoi le total se rapporte (« la France entière » par défaut). */
  readonly libelleTerritoire = input.required<string>();

  protected readonly messageAucunSite = MESSAGE_AUCUN_SITE;

  private readonly brutes = computed(() => partsDeNature(this.compte()?.par_nature ?? {}));
  private readonly totalNatures = computed(() => this.brutes().reduce((t, p) => t + p.n, 0));

  /** Les parts prêtes à peindre : largeur sur les EFFECTIFS, textes déjà formatés (aucune méthode dans le gabarit). */
  protected readonly parts = computed(() => {
    const total = this.totalNatures();
    return this.brutes().map((p) => ({
      libelle: p.libelle,
      teinte: p.teinte,
      regroupee: p.regroupee,
      largeur: (p.n / total) * 100,
      pct: `${formaterDecimal(p.pct)} %`,
      n: formaterNombre(p.n),
      titre: `${p.libelle} — ${formaterNombre(p.n)} sites (${formaterDecimal(p.pct)} %)`,
    }));
  });

  protected readonly regroupement = computed(() => this.brutes().some((p) => p.regroupee));
  protected readonly libelleBarre = computed(
    () => `Répartition des ${formaterNombre(this.totalNatures())} sites par nature de risque`,
  );

  protected readonly valeurKpi = computed(() => {
    const c = this.compte();
    return c ? `${formaterNombre(c.retenus)} / ${formaterNombre(c.total)}` : '—';
  });
  protected readonly noteKpi = computed(() => `sur ${this.libelleTerritoire()} — le total porte le même territoire`);

  /**
   * L'écart entre la somme des natures et les sites retenus. Il doit valoir ZÉRO (chaque site compte sous sa nature
   * dominante, mesuré 1 259 = 1 259) ; on ne le suppose pas pour autant — `null` s'il est nul.
   */
  protected readonly ecart = computed<string | null>(() => {
    const c = this.compte();
    const e = c ? c.retenus - this.totalNatures() : 0;
    if (e === 0) return null;
    const a = Math.abs(e);
    return `⚠ ${formaterNombre(a)} site${a > 1 ? 's' : ''}${e > 0 ? ' ne sont rattachés à aucune nature' : ' sont comptés deux fois'} : `
      + 'la barre ne couvre pas exactement le total retenu.';
  });
}
