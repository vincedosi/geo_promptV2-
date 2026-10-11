import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { GraphiqueComponent } from '../../../../../../graphiques/graphique.component';
import { optionBarres, optionNuagePca } from '../../../../logique/clustering/options-graphiques';
import { jetonSilhouette, pourcent1 } from '../../../../logique/clustering/panneau';
import { imputesParCluster, libelleSilhouette } from '../../../../logique/clustering/rapport';
import { STYLES_RAPPORT, cadreGraphique, couleurCluster, type DonneesRapport } from './commun-rapport';

/**
 * Onglet « Qualité » (`TabQualite`, `ClusterDetails.tsx:705-872`) : silhouette, réduction PCA, taille des clusters
 * (repère « idéal » = équilibre parfait), secret statistique INSEE (POI aux variables imputées), nuage PC1 / PC2.
 */
@Component({
  selector: 'mg-onglet-qualite',
  imports: [GraphiqueComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid grid-cols-2 gap-5">
      <div class="panneau-rapport" [style.--teinte]="teinteSilhouette()">
        <div class="titre">Score de silhouette</div>
        <div class="mb-2 flex items-baseline gap-2">
          <span class="mono text-[36px] text-[var(--teinte)]">{{ silhouette() }}</span>
          <span class="text-[10px] text-[var(--teinte)]">{{ libelle() }}</span>
        </div>
        <div class="fond-barre mb-[10px] h-1.5 rounded-[1px]"><div class="h-full rounded-[1px] bg-[var(--teinte)]" [style.width.%]="largeurSilhouette()"></div></div>
        <div class="mono text-[10px] text-secondary">Échelle : -1 (mauvais) → 0 → 1 (parfait).<br />Score ≥ 0.50 : clusters bien séparés.<br />Score ≥ 0.30 : structure raisonnable.</div>
      </div>
      <div class="panneau-rapport">
        <div class="titre">Réduction dimensionnelle (PCA)</div>
        <div class="mb-2 flex items-baseline gap-2">
          <span class="mono text-[28px] text-teal">{{ d().modele.n_pca_components }}</span>
          <span class="text-[10px] text-secondary">composantes</span>
        </div>
        <div class="fond-barre mb-[10px] h-1.5 rounded-[1px]"><div class="h-full rounded-[1px] bg-teal" [style.width.%]="largeurVariance()"></div></div>
        <div class="mono text-[10px] text-secondary">{{ variance() }} de variance expliquée<br />sur {{ d().modele.feature_names.length }} features initiales.</div>
      </div>
      <div class="panneau-rapport">
        <div class="titre">Taille des clusters</div>
        <mg-graphique [option]="tailles()" [hauteur]="hauteurTailles()" libelle="Taille des clusters" />
        <div class="mono mt-2 text-[10px] text-tertiary">Équilibre idéal : {{ ideal() }} POI / cluster</div>
      </div>
      <div class="panneau-rapport">
        <div class="titre">Secret statistique INSEE</div>
        <div class="mono mb-[10px] text-[11px] text-primary">{{ nombreImputes() }} / {{ d().pois.length }} POI avec features imputées</div>
        <div class="flex flex-col gap-1">
          @for (c of imputes(); track c.cid) {
            <div class="flex items-center gap-2">
              <span class="pastille size-2" [style.background]="c.couleur"></span>
              <span class="mono flex-1 text-[10px] text-secondary">{{ c.label }}</span>
              <span class="mono text-[10px]" [class.text-warning]="c.nombre > 0" [class.text-success]="c.nombre === 0">{{ c.nombre }} imputés</span>
            </div>
          }
        </div>
      </div>
      @if (nuage(); as n) {
        <div class="panneau-rapport pleine-largeur">
          <div class="titre">Scatter PCA — PC1 vs PC2 ({{ d().pois.length }} POI)</div>
          <mg-graphique [option]="n" [hauteur]="480" libelle="Nuage des POI sur les deux premières composantes" />
        </div>
      }
    </div>
  `,
  styles: [STYLES_RAPPORT, `.fond-barre { background: var(--border-subtle); }`],
})
export class OngletQualiteComponent {
  readonly d = input.required<DonneesRapport>();
  private readonly cadre = cadreGraphique();

  private readonly s = computed(() => this.d().modele.silhouette_score);
  protected readonly silhouette = computed(() => this.s().toFixed(3));
  protected readonly libelle = computed(() => libelleSilhouette(this.s()));
  protected readonly teinteSilhouette = computed(() => `var(--${jetonSilhouette(this.s())})`);
  protected readonly largeurSilhouette = computed(() => Math.min(100, this.s() * 100));
  protected readonly largeurVariance = computed(() => Number((this.d().modele.variance_explained * 100).toFixed(0)));
  protected readonly variance = computed(() => pourcent1(this.d().modele.variance_explained));

  private readonly clusters = computed(() => this.d().cids.map((cid) => ({
    cid, label: this.d().resume[cid]?.label ?? `C${cid}`, couleur: couleurCluster(this.d(), cid, this.cadre().absente), count: this.d().resume[cid]?.count ?? 0,
  })));
  /** `total / cids.length` : React arrondit le repère (`Math.round`) et l'affiche en `toFixed(0)`. */
  protected readonly ideal = computed(() => (this.d().pois.length / this.d().cids.length).toFixed(0));
  protected readonly hauteurTailles = computed(() => Math.max(120, this.d().cids.length * 36 + 30));
  protected readonly tailles = computed(() => optionBarres(
    this.clusters().map((c) => ({ nom: c.label, valeur: c.count, couleur: c.couleur })), this.cadre(),
    { largeurAxe: 130, margeDroite: 48, ideal: Math.round(this.d().pois.length / this.d().cids.length) },
  ));
  protected readonly nombreImputes = computed(() => this.d().pois.filter((p) => p.imputed_features.length > 0).length);
  protected readonly imputes = computed(() => {
    const parCluster = imputesParCluster(this.d().pois);
    return this.clusters().map((c) => ({ ...c, nombre: parCluster[c.cid] ?? 0 }));
  });
  protected readonly nuage = computed(() => {
    const groupes = this.clusters().map((c) => ({
      nom: c.label, couleur: c.couleur,
      points: this.d().pois
        .filter((p) => String(p.cluster_id) === c.cid && (p.pca_components?.length ?? 0) >= 2)
        .map((p) => ({ x: parseFloat((p.pca_components[0] ?? 0).toFixed(4)), y: parseFloat((p.pca_components[1] ?? 0).toFixed(4)), nom: p.poi_name, ville: p.ville })),
    }));
    return groupes.some((g) => g.points.length > 0) ? optionNuagePca(groupes, this.cadre()) : null;
  });
}
