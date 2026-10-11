import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { GraphiqueComponent } from '../../../../../../graphiques/graphique.component';
import { optionBarres, optionDonut } from '../../../../logique/clustering/options-graphiques';
import { lignesModele, profilReference, variables } from '../../../../logique/clustering/rapport';
import { RadarComponent } from '../radar.component';
import { STYLES_RAPPORT, cadreGraphique, couleurCluster, type DonneesRapport } from './commun-rapport';

/**
 * Onglet « Résumé » (`TabResume`, `ClusterDetails.tsx:256-366`) : le modèle en chiffres, la répartition (anneau), la
 * distribution (barres) et le radar d'ensemble avec la référence nationale.
 *
 * Couleurs : celles des clusters rendues par la route (celles de la CARTE). React y substituait sa propre table
 * (`CLUSTER_COLORS`, teal en tête et le vert fluo réservé au statut) : un même cluster changeait de couleur entre la
 * carte et son rapport. Défaut corrigé.
 */
@Component({
  selector: 'mg-onglet-resume',
  imports: [GraphiqueComponent, RadarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid grid-cols-2 gap-5">
      <div class="panneau-rapport">
        <div class="titre">Modèle v{{ d().modele.version }}</div>
        @for (l of lignes(); track l[0]) {
          <div class="ligne-fine flex justify-between py-[5px]">
            <span class="text-[11px] text-secondary">{{ l[0] }}</span>
            <span class="mono text-[11px] text-primary">{{ l[1] }}</span>
          </div>
        }
      </div>
      <div class="panneau-rapport">
        <div class="titre">Répartition des clusters</div>
        <mg-graphique [option]="donut()" [hauteur]="220" libelle="Répartition des clusters" />
        <div class="mono mt-1 text-center text-[10px] text-tertiary">{{ total() }} POI classifiés</div>
      </div>
      <div class="panneau-rapport">
        <div class="titre">Distribution — nb POI par cluster</div>
        <mg-graphique [option]="barres()" [hauteur]="hauteurBarres()" libelle="Nombre de POI par cluster" />
      </div>
      <div class="panneau-rapport pleine-largeur">
        <div class="titre">Profils moyens — vue d'ensemble</div>
        <div class="flex justify-center">
          <mg-radar variante="rapport" [taille]="300" [profils]="radar().profils" [couleurs]="radar().couleurs" [libelles]="radar().libelles"
                    [cles]="radar().cles" [reference]="radar().reference" libelle="Profils moyens, vue d'ensemble" />
        </div>
      </div>
    </div>
  `,
  styles: STYLES_RAPPORT,
})
export class OngletResumeComponent {
  readonly d = input.required<DonneesRapport>();
  private readonly cadre = cadreGraphique();

  protected readonly lignes = computed(() => lignesModele(this.d().modele));
  private readonly parts = computed(() => this.d().cids.map((c) => ({
    nom: this.d().resume[c]?.label ?? `C${c}`, valeur: this.d().resume[c]?.count ?? 0, couleur: couleurCluster(this.d(), c, this.cadre().absente),
  })));
  protected readonly total = computed(() => this.parts().reduce((s, p) => s + p.valeur, 0));
  protected readonly donut = computed(() => optionDonut(this.parts(), this.cadre()));
  protected readonly barres = computed(() => optionBarres(this.parts(), this.cadre(), { largeurAxe: 140 }));
  protected readonly hauteurBarres = computed(() => Math.max(120, this.d().cids.length * 36 + 20));
  protected readonly radar = computed(() => ({
    profils: this.d().cids.map((c) => this.d().resume[c]?.avg_profile ?? {}),
    couleurs: this.d().cids.map((c) => couleurCluster(this.d(), c, this.cadre().absente)),
    libelles: this.d().cids.map((c) => this.d().resume[c]?.label ?? `C${c}`),
    cles: variables(this.d().modele),
    reference: profilReference(this.d().france),
  }));
}
