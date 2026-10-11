import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { GraphiqueComponent } from '../../../../../../graphiques/graphique.component';
import { libelleCourt } from '../../../../logique/clustering/libelles';
import { optionBarresGroupees } from '../../../../logique/clustering/options-graphiques';
import { formaterValeur, jetonEcart, profilReference, variables } from '../../../../logique/clustering/rapport';
import { RadarComponent } from '../radar.component';
import { STYLES_RAPPORT, cadreGraphique, couleurCluster, type DonneesRapport } from './commun-rapport';

/**
 * Onglet « Comparaison » (`TabComparaison`, `ClusterDetails.tsx:575-702`) : radar superposé de tous les clusters
 * contre la France, barres groupées par variable (en %), tableau des écarts en points. Sans moyennes nationales, seul
 * le radar reste — comme React.
 */
@Component({
  selector: 'mg-onglet-comparaison',
  imports: [GraphiqueComponent, RadarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panneau-rapport">
      <div class="titre">Radar superposé — {{ d().cids.length }} clusters vs France</div>
      <div class="flex justify-center">
        <mg-radar variante="rapport" [taille]="340" [profils]="radar().profils" [couleurs]="radar().couleurs" [libelles]="radar().libelles"
                  [cles]="vars()" [reference]="radar().reference" libelle="Radar superposé des clusters" />
      </div>
    </div>
    @if (groupees(); as g) {
      <div class="panneau-rapport">
        <div class="titre">Comparaison par feature — clusters vs France</div>
        <mg-graphique [option]="g" [hauteur]="hauteurGroupees()" libelle="Comparaison par variable, clusters et moyenne nationale" />
      </div>
    }
    @if (ecarts(); as lignes) {
      <div class="panneau-rapport">
        <div class="titre">Delta vs moyenne France (en points de %)</div>
        <div class="overflow-auto">
          <table class="w-full border-collapse">
            <thead>
              <tr class="border-b-fin border-subtle">
                <th class="px-[10px] py-[7px] text-left text-[11px] font-normal text-tertiary">Feature</th>
                <th class="px-[10px] py-[7px] text-right text-[11px] font-normal text-tertiary">Moy. Fr</th>
                @for (c of entetes(); track c.cid) { <th class="px-[10px] py-[7px] text-right text-[11px] font-normal" [style.color]="c.couleur">{{ c.label }}</th> }
              </tr>
            </thead>
            <tbody>
              @for (l of lignes; track l.variable) {
                <tr class="ligne-fine">
                  <td class="px-[10px] py-[5px] text-[11px] text-secondary">{{ l.libelle }}</td>
                  <td class="mono px-[10px] py-[5px] text-right text-[9px] text-tertiary">{{ l.reference }}</td>
                  @for (v of l.valeurs; track $index) { <td class="mono px-[10px] py-[5px] text-right text-[9px]" [style.color]="v.couleur">{{ v.texte }}</td> }
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
  // Panneaux empilés SANS écart, comme React (des `Panel` dans un simple `<div>`).
  styles: STYLES_RAPPORT,
})
export class OngletComparaisonComponent {
  readonly d = input.required<DonneesRapport>();
  private readonly cadre = cadreGraphique();

  protected readonly vars = computed(() => variables(this.d().modele));
  protected readonly entetes = computed(() => this.d().cids.map((cid) => ({
    cid, label: this.d().resume[cid]?.label ?? `C${cid}`, couleur: couleurCluster(this.d(), cid, this.cadre().absente),
  })));
  protected readonly radar = computed(() => ({
    profils: this.d().cids.map((c) => this.d().resume[c]?.avg_profile ?? {}),
    couleurs: this.entetes().map((e) => e.couleur),
    libelles: this.entetes().map((e) => e.label),
    reference: profilReference(this.d().france),
  }));
  protected readonly hauteurGroupees = computed(() => Math.max(400, this.vars().length * 28 + 60));
  protected readonly groupees = computed(() => {
    const france = this.d().france;
    if (!france) return null;
    const vars = this.vars();
    const enPourcent = (v: number) => parseFloat((v * 100).toFixed(2));
    return optionBarresGroupees(
      vars.map(libelleCourt),
      this.entetes().map((e) => ({ nom: e.label, couleur: e.couleur, valeurs: vars.map((f) => enPourcent(this.d().resume[e.cid]?.avg_profile[f] ?? 0)) })),
      vars.map((f) => enPourcent(france[f]?.avg ?? 0)),
      this.cadre(),
    );
  });
  protected readonly ecarts = computed(() => {
    const france = this.d().france;
    if (!france) return null;
    return this.vars().map((variable) => {
      const ref = france[variable]?.avg ?? 0;
      return {
        variable, libelle: libelleCourt(variable), reference: formaterValeur(variable, ref),
        valeurs: this.d().cids.map((cid) => {
          const delta = (this.d().resume[cid]?.avg_profile[variable] ?? 0) - ref;
          return { texte: `${delta >= 0 ? '+' : ''}${formaterValeur(variable, delta)}`, couleur: `var(--${jetonEcart(delta)})` };
        }),
      };
    });
  });
}
