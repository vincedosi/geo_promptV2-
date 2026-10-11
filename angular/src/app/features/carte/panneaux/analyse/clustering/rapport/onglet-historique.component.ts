import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { STYLES_RAPPORT, type DonneesRapport } from './commun-rapport';

/**
 * Onglet « Historique » (`TabHistorique`, `ClusterDetails.tsx:909-954`) : la correspondance des clusters depuis la
 * version précédente, la couverture des POI et ceux dont des variables ont été imputées (secret statistique).
 */
@Component({
  selector: 'mg-onglet-historique',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panneau-rapport mb-4">
      <div class="mb-3 text-[12px] text-tertiary">Version {{ d().modele.version }}</div>
      @if (correspondances(); as liste) {
        <div class="mono mb-[10px] text-[11px] text-secondary">Mapping des clusters depuis la version précédente :</div>
        <div class="flex flex-col gap-1">
          @for (c of liste; track c.ancien) {
            <div class="flex items-center gap-2">
              <span class="mono text-[10px] text-tertiary">C{{ c.ancien }} (v{{ c.versionPrecedente }})</span>
              <span class="mono text-[10px] text-secondary">→</span>
              <span class="pastille size-2" [style.background]="c.couleur"></span>
              <span class="mono text-[10px] text-primary">C{{ c.nouveau }} (v{{ d().modele.version }})</span>
            </div>
          }
        </div>
      } @else {
        <div class="mono text-[11px] text-secondary">Première version — pas de mapping de continuité disponible.</div>
      }
    </div>
    <div class="panneau-rapport">
      <div class="mb-3 text-[12px] text-tertiary">Couverture de données par POI</div>
      <div class="mono mb-3 text-[11px] text-secondary">
        Entraîné sur {{ d().modele.n_poi_trained }} POI. Durée isochrone : {{ d().modele.duration_minutes }} min {{ d().modele.mode }}.
      </div>
      @if (imputes().length > 0) {
        <div class="mb-2 text-[11px] text-warning">POI avec imputation</div>
        <div class="max-h-[240px] overflow-auto">
          @for (p of imputes(); track p.poi_id) {
            <div class="ligne-fine flex justify-between py-[5px]">
              <span class="mono text-[10px] text-primary">{{ p.poi_name }}</span>
              <span class="mono text-[9px] text-warning">{{ p.variables }}</span>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: STYLES_RAPPORT,
})
export class OngletHistoriqueComponent {
  readonly d = input.required<DonneesRapport>();

  /** `C{ancien} (v{n-1}) → C{nouveau} (vN)`, teinte du NOUVEAU cluster ; `null` pour une première version. */
  protected readonly correspondances = computed(() => {
    const m = this.d().modele;
    if (!m.cluster_mapping_from_previous) return null;
    return Object.entries(m.cluster_mapping_from_previous).map(([ancien, nouveau]) => ({
      ancien, nouveau, versionPrecedente: m.version - 1,
      couleur: this.d().resume[String(nouveau)]?.color ?? 'var(--donnee-absente)',
    }));
  });
  protected readonly imputes = computed(() => this.d().pois
    .filter((p) => p.imputed_features.length > 0)
    .map((p) => ({ ...p, variables: p.imputed_features.join(', ') })));
}
