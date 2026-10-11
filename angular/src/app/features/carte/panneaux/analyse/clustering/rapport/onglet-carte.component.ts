import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { poisParCluster } from '../../../../logique/clustering/rapport';
import { STYLES_RAPPORT, type DonneesRapport } from './commun-rapport';

/**
 * Onglet « Carte » (`TabCarte`, `ClusterDetails.tsx:369-432`) : les POI de chaque cluster, imputations et carreaux
 * couverts. Le lien « Carte principale » de React (`<Link href="/map">`) menait à la page… où le rapport est déjà
 * ouvert : il devient un simple texte — la carte est derrière le tiroir (lien relatif inutile, B-liens relatifs).
 */
@Component({
  selector: 'mg-onglet-carte',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panneau-rapport mono mb-4 px-4! py-[14px]! text-[11px] text-secondary">
      La visualisation cartographique est disponible via la <span class="text-teal">Carte principale</span> (onglet Clustering). {{ d().pois.length }} POI classifiés.
    </div>
    @for (g of groupes(); track g.cid) {
      <div class="panneau-rapport mb-3 overflow-hidden p-0!" [style.--teinte]="g.couleur">
        <div class="entete flex items-center gap-2 px-4 py-[10px]">
          <span class="pastille size-[10px]" [style.background]="g.couleur"></span>
          <span class="text-[12px] text-primary">{{ g.libelle }}</span>
          <span class="mono ml-1 text-[10px] text-tertiary">— {{ g.pois.length }} POI</span>
        </div>
        <div class="max-h-[200px] overflow-auto">
          @for (p of g.pois; track p.poi_id) {
            <div class="ligne flex items-center justify-between px-4 py-1.5">
              <div>
                <span class="mono text-[11px] text-primary">{{ p.poi_name }}</span>
                <span class="mono ml-2 text-[10px] text-tertiary">{{ p.ville }}</span>
              </div>
              <div class="flex gap-2">
                @if (p.imputed_features.length > 0) { <span class="impute rounded-[2px] px-1 py-px text-[10px] text-warning">{{ p.imputed_features.length }} imputés</span> }
                <span class="mono text-[9px] text-tertiary">{{ p.n_carreaux_intersected ?? '—' }} carreaux</span>
              </div>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [STYLES_RAPPORT, `
    .entete { border-bottom: 0.5px solid var(--border-subtle); background: color-mix(in srgb, var(--teinte) 6%, transparent); }
    .ligne { border-bottom: 0.5px solid color-mix(in srgb, var(--border-subtle) 6%, transparent); }
    .impute { background: color-mix(in srgb, var(--warning) 8%, transparent); border: 0.5px solid color-mix(in srgb, var(--warning) 19%, transparent); }
  `],
})
export class OngletCarteComponent {
  readonly d = input.required<DonneesRapport>();

  protected readonly groupes = computed(() => poisParCluster(this.d().pois).map(([cid, pois]) => ({
    cid, pois,
    couleur: this.d().resume[String(cid)]?.color ?? 'var(--donnee-absente)',
    libelle: this.d().modele.cluster_labels[String(cid)] ?? `Cluster ${cid}`,
  })));
}
