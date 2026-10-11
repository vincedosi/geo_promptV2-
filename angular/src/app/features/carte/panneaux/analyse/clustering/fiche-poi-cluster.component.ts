import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { couleurBadge, dateJourMois } from '../../../logique/clustering/panneau';
import type { PoiCluster } from '../../../logique/clustering/types';
import { EtatPanneauClustersService } from './etat-panneau-clusters.service';
import { STYLES_CLUSTERS } from './styles-clusters';

/**
 * La fiche du POI cliqué sur la carte (`ClusterPanel.tsx:510-587`) : nom, cluster, ville, et ses trois actions —
 * Comparer, Durées, Historique (relu à la demande, `GET /api/poi-clusters/history/[poiId]`).
 *
 * Le fond et le cadre prennent la teinte du cluster (8 % et 27 %, les `rgba(…,0.08)` et `…44` de React), par
 * `color-mix` sur `--teinte` : la couleur arrive de la base, elle ne passe qu'une fois validée (`couleurBadge`).
 */
@Component({
  selector: 'mg-fiche-poi-cluster',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fiche mb-1 rounded-[2px] px-3 py-[10px]" [style.--teinte]="couleur()">
      <div class="flex items-start justify-between">
        <div>
          <div class="mono text-[10px] font-bold text-primary">{{ poi().poi_name }}</div>
          <div class="mt-1 flex items-center gap-1.5">
            <span class="pastille size-2" [style.background]="couleur()"></span>
            <span class="mono text-[9px] text-secondary">{{ poi().cluster_label }}</span>
          </div>
          <div class="mono mt-[2px] text-[9px] text-tertiary">{{ poi().ville }} · {{ poi().categorie }}</div>
        </div>
        <button type="button" data-fermer-fiche aria-label="Fermer la fiche" class="fermer" (click)="etat.selection.set(null)">✕</button>
      </div>
      <div class="mt-2 flex gap-1.5">
        <button type="button" data-comparer class="bouton flex-1 text-[7px]!" (click)="etat.commencerComparaison()">Comparer</button>
        <button type="button" data-durees class="bouton flex-1 text-[7px]!" style="--teinte: var(--warning)"
                [class.actif]="dureesActives()" (click)="etat.basculerDurees(poi().poi_id)">Durées</button>
        <button type="button" data-historique class="bouton flex-1 text-[7px]!" style="--teinte: var(--success)"
                [class.actif]="historiqueVisible()" (click)="etat.basculerHistorique(poi().poi_id)">Historique</button>
      </div>
      @if (historiqueErreur(); as e) { <div data-erreur-historique role="alert" class="mono mt-2 text-[9px] text-danger">{{ e }}</div> }
      @if (historiqueVisible()) {
        <div class="mt-2 flex flex-col gap-1">
          <div class="etiquette">Historique</div>
          @for (h of historique(); track h.id) {
            <div class="tuile flex items-center justify-between px-2 py-1">
              <div>
                <span class="mono text-[9px] text-primary">Cluster {{ h.cluster_id }}</span>
                @if (h.changed) { <span class="ml-1 text-[8px] text-warning" title="Changement de cluster">⚡</span> }
                <div class="mono text-[8px] text-tertiary">v{{ h.model_version }} · {{ h.action }}</div>
              </div>
              <span class="mono text-[8px] text-tertiary">{{ h.date }}</span>
            </div>
          } @empty {
            <div class="mono text-[9px] text-tertiary">Aucun historique</div>
          }
        </div>
      }
    </div>
  `,
  styles: [STYLES_CLUSTERS, `
    .fiche { background: color-mix(in srgb, var(--teinte) 8%, transparent); border: 0.5px solid color-mix(in srgb, var(--teinte) 27%, transparent); }
    .fermer { background: none; border: 0; padding: 0; color: var(--text-secondary); cursor: pointer; font-size: 11px; }
  `],
})
export class FichePoiClusterComponent {
  readonly poi = input.required<PoiCluster>();
  protected readonly etat = inject(EtatPanneauClustersService);

  protected readonly couleur = computed(() => couleurBadge(this.poi().cluster_color));
  protected readonly dureesActives = computed(() => this.etat.dureesPoi() === this.poi().poi_id);
  protected readonly historiqueVisible = computed(() => this.etat.historiqueVisible() && this.etat.historiquePoi() === this.poi().poi_id);
  protected readonly historiqueErreur = computed(() => (this.etat.historiquePoi() === this.poi().poi_id ? this.etat.historiqueErreur() : null));
  protected readonly historique = computed(() => this.etat.historique().map((h) => ({ ...h, date: dateJourMois(h.created_at) })));
}
