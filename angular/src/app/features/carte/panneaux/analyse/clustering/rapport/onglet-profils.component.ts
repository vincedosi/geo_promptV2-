import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { GraphiqueComponent } from '../../../../../../graphiques/graphique.component';
import { optionBarresEcart } from '../../../../logique/clustering/options-graphiques';
import { ecartsFrance, jetonIndex, lignesTableauProfils, profilReference, revenusIndex, variables } from '../../../../logique/clustering/rapport';
import { RadarComponent } from '../radar.component';
import { STYLES_RAPPORT, cadreGraphique, type DonneesRapport } from './commun-rapport';

/**
 * Onglet « Profils » (`TabProfils` + `FeatureRow`, `ClusterDetails.tsx:192-572`) : une carte par cluster (radar contre
 * la moyenne nationale, index de revenu, écarts à la France), puis le tableau de toutes les variables, côte à côte.
 * Le repère national `#6b7280` du tableau devient `--text-tertiary`.
 */
@Component({
  selector: 'mg-onglet-profils',
  imports: [GraphiqueComponent, RadarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-6 grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4">
      @for (c of cartes(); track c.cid) {
        <div class="panneau-rapport p-4!">
          <div class="mb-3 flex items-center gap-1.5">
            <span class="pastille size-[10px]" [style.background]="c.couleur"></span>
            <span class="text-[12px] text-primary">{{ c.label }}</span>
            <span class="mono ml-auto text-[9px] text-tertiary">{{ c.count }} POI</span>
          </div>
          <mg-radar variante="rapport" [taille]="200" [profils]="[c.profil]" [couleurs]="[c.couleur]" [libelles]="[c.label]" [cles]="vars()"
                    [reference]="reference()" [legendeReference]="false" [libelle]="'Profil du cluster ' + c.label" />
          @if (c.index !== null) {
            <div class="mt-[10px] mb-2 text-center">
              <span class="text-[11px] text-tertiary">Revenu index </span>
              <span class="mono text-[16px] font-bold" [style.color]="c.teinteIndex">{{ c.index }}</span>
              <span class="text-[11px] text-tertiary"> / 100 = moy. France</span>
            </div>
          }
          @if (c.ecarts) {
            <div class="mt-[10px] mb-1.5 text-[11px] text-tertiary">Écart vs France</div>
            <mg-graphique [option]="c.ecarts" [hauteur]="hauteurEcarts()" [libelle]="'Écart à la moyenne nationale, ' + c.label" />
          }
        </div>
      }
    </div>
    <div class="panneau-rapport overflow-auto p-0!">
      <table class="w-full border-collapse">
        <thead>
          <tr class="border-b-fin border-subtle">
            <th class="p-2 text-left text-[11px] font-normal text-tertiary">Feature</th>
            @for (c of cartes(); track c.cid) { <th class="p-2 text-left text-[11px] font-normal" [style.color]="c.couleur">{{ c.label }}</th> }
            @if (d().france) { <th class="p-2 text-left text-[11px] font-normal text-tertiary">Moy. France</th> }
          </tr>
        </thead>
        <tbody>
          @for (l of tableau(); track l.variable) {
            <tr class="ligne-fine">
              <td class="px-2 py-1.5 text-[11px] whitespace-nowrap text-secondary">{{ l.libelle }}</td>
              @for (v of l.valeurs; track v.cid) {
                <td class="px-2 py-1.5">
                  <div class="flex items-center gap-1">
                    <div class="fond-barre relative h-1.5 min-w-[60px] flex-1 rounded-[1px]">
                      <div class="absolute inset-y-0 left-0 rounded-[1px] opacity-[0.67]" [style.width.%]="v.largeur" [style.background]="v.couleur"></div>
                      @if (l.repereFrance !== null) { <div class="repere absolute -top-px -bottom-px w-px" [style.left.%]="l.repereFrance"></div> }
                    </div>
                    <span class="mono text-[9px] whitespace-nowrap text-primary">{{ v.texte }}</span>
                    @if (v.index !== null) { <span class="index mono rounded-[2px] px-1 py-px text-[8px]" [style.--teinte]="v.teinteIndex">{{ v.index }}</span> }
                  </div>
                </td>
              }
              @if (l.texteFrance !== null) { <td class="mono px-2 py-1.5 text-[9px] text-tertiary">{{ l.texteFrance }}</td> }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [STYLES_RAPPORT, `
    .fond-barre { background: var(--border-subtle); }
    .repere { background: var(--text-tertiary); }
    .index { color: var(--teinte); background: color-mix(in srgb, var(--teinte) 8%, transparent); border: 0.5px solid color-mix(in srgb, var(--teinte) 19%, transparent); }
  `],
})
export class OngletProfilsComponent {
  readonly d = input.required<DonneesRapport>();
  private readonly cadre = cadreGraphique();

  protected readonly vars = computed(() => variables(this.d().modele));
  protected readonly reference = computed(() => profilReference(this.d().france));
  protected readonly hauteurEcarts = computed(() => this.vars().length * 18 + 20);
  protected readonly cartes = computed(() => {
    const { resume, france, cids } = this.d();
    const refRevenu = france?.['revenu_moyen']?.avg;
    return cids.filter((cid) => resume[cid]).map((cid) => {
      const s = resume[cid];
      const index = refRevenu !== undefined && s.avg_profile['revenu_moyen'] !== undefined ? revenusIndex(s.avg_profile['revenu_moyen'], refRevenu) : null;
      return {
        cid, label: s.label, count: s.count, couleur: s.color, profil: s.avg_profile, index,
        teinteIndex: index !== null ? `var(--${jetonIndex(index)})` : '',
        ecarts: france ? optionBarresEcart(ecartsFrance(s, this.vars(), france), this.cadre()) : null,
      };
    });
  });
  protected readonly tableau = computed(() => lignesTableauProfils(this.vars(), this.d().cids, this.d().resume, this.d().france).map((l) => ({
    ...l, valeurs: l.valeurs.map((v) => ({ ...v, teinteIndex: v.index !== null ? `var(--${jetonIndex(v.index)})` : '' })),
  })));
}
