import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ClustersService } from '../../../couches/clusters.service';
import { couleurBadge, deltasComparaison, pourcent1, pourcent1Signe, premierSegment } from '../../../logique/clustering/panneau';
import type { PoiCluster } from '../../../logique/clustering/types';
import { EtatPanneauClustersService } from './etat-panneau-clusters.service';
import { RadarComponent } from './radar.component';
import { STYLES_CLUSTERS } from './styles-clusters';

/**
 * La comparaison de deux POI (`CompareView`, `ClusterPanel.tsx:922-1066`) : en-têtes cliquables (la carte vole au POI),
 * radar des deux profils et de la moyenne du cluster de A, « Delta par feature », verdict. Écarts calculés par
 * `deltasComparaison` (logique pure).
 *
 * Couleurs : la moyenne du cluster `#666666` → `--text-tertiary` ; l'écart `#3dffa0` / `#f87171` → `--success` /
 * `--danger` ; le cadre violet `#261a35` → `--border-default` (DESIGN_SYSTEM : pas de violet).
 */
@Component({
  selector: 'mg-comparaison-poi',
  imports: [RadarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (vue(); as v) {
      <div class="flex flex-col gap-[14px]">
        <div class="flex items-center justify-between">
          <div class="etiquette">Comparaison</div>
          <button type="button" class="bouton px-[7px]! py-[3px]! text-[7px]!" (click)="etat.quitterComparaison()">Fermer</button>
        </div>
        <div class="grid grid-cols-2 gap-1.5">
          @for (p of v.entetes; track $index) {
            <button type="button" class="entete w-full cursor-pointer rounded-[2px] bg-elevated px-2 py-[7px] text-left" [style.--teinte]="p.couleur" (click)="voler(p.poi)">
              <div class="mono text-[8px] font-bold text-primary">{{ p.nom }}</div>
              <div class="mt-[3px] flex items-center gap-1">
                <span class="pastille size-1.5" [style.background]="p.couleur"></span>
                <span class="inter text-[6.5px] text-secondary">{{ p.cluster }}</span>
              </div>
            </button>
          }
        </div>
        @if (etat.cles().length >= 3) {
          <div class="tuile p-[10px]">
            <div class="etiquette">Profils comparés</div>
            <mg-radar [profils]="v.radar.profils" [couleurs]="v.radar.couleurs" [libelles]="v.radar.libelles" [cles]="etat.cles()" [taille]="180" libelle="Profils comparés" />
          </div>
        }
        <div>
          <div class="etiquette">Delta par feature</div>
          <div class="flex flex-col gap-[2px]">
            @for (d of v.lignes; track d.cle) {
              <div class="tuile px-2 py-1">
                <div class="mb-[3px] flex justify-between">
                  <span class="inter text-[7px] text-secondary">{{ d.libelle }}</span>
                  <div class="mono flex gap-[10px] text-[8px]">
                    <span [style.color]="v.couleurA">{{ d.texteA }}</span>
                    <span [style.color]="v.couleurB">{{ d.texteB }}</span>
                    <span class="font-bold" [class.text-success]="d.positif" [class.text-danger]="!d.positif">{{ d.texteDelta }}</span>
                  </div>
                </div>
                <div class="barre">
                  <div class="h-full rounded-[1px] transition-[width] duration-200 ease-linear" [class.bg-success]="d.positif" [class.bg-danger]="!d.positif" [style.width.%]="d.largeur"></div>
                </div>
              </div>
            }
          </div>
        </div>
        <div class="verdict rounded-[2px] px-3 py-[10px]">
          <div class="etiquette">Verdict</div>
          <div class="mono text-[9px] leading-[1.7] text-primary">{{ v.verdict }}</div>
          @if (v.differences.length) {
            <div class="mt-1.5 flex flex-col gap-[3px]">
              @for (f of v.differences; track f; let i = $index) { <div class="mono text-[8px] text-secondary">{{ i + 1 }}. {{ f }}</div> }
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [STYLES_CLUSTERS, `
    .entete { border: 0.5px solid color-mix(in srgb, var(--teinte) 33%, transparent); }
    .verdict { background: color-mix(in srgb, var(--brand-teal) 6%, transparent); border: 0.5px solid color-mix(in srgb, var(--brand-teal) 20%, transparent); }
  `],
})
export class ComparaisonPoiComponent {
  protected readonly etat = inject(EtatPanneauClustersService);
  private readonly clusters = inject(ClustersService);

  protected readonly vue = computed(() => {
    const a = this.etat.comparaisonA();
    const b = this.etat.comparaisonB();
    if (!a || !b) return null;
    const resume = this.etat.resume();
    const clA = resume[String(a.cluster_id)];
    const { lignes, principales } = deltasComparaison(a, b, resume, this.etat.cles());
    const couleurA = couleurBadge(a.cluster_color);
    const couleurB = couleurBadge(b.cluster_color);
    const meme = a.cluster_id === b.cluster_id;
    return {
      couleurA, couleurB,
      entetes: [a, b].map((poi, i) => ({
        poi, couleur: i === 0 ? couleurA : couleurB,
        nom: poi.poi_name.slice(0, 18) || poi.poi_id.slice(0, 8), cluster: premierSegment(poi.cluster_label).slice(0, 14),
      })),
      radar: {
        profils: [a.profile_features, b.profile_features, ...(clA ? [clA.avg_profile] : [])],
        couleurs: [couleurA, couleurB, 'var(--text-tertiary)'],
        libelles: [a.poi_name.slice(0, 10), b.poi_name.slice(0, 10), 'Moy. cluster'],
      },
      lignes: lignes.map((d) => ({
        ...d, positif: d.delta > 0, texteA: pourcent1(d.valA), texteB: pourcent1(d.valB), texteDelta: pourcent1Signe(d.delta),
        largeur: Math.min(100, Math.abs(d.delta) * 500),
      })),
      verdict: meme ? `Même cluster (${premierSegment(a.cluster_label)}). Profils similaires.` : 'Clusters distincts. Différences principales :',
      differences: meme ? [] : principales,
    };
  });

  /** Un en-tête : la carte vole au POI (`poi.lat && onFlyTo(…)` — sans latitude, rien). */
  protected voler(poi: PoiCluster): void {
    if (poi.lat) this.clusters.voler(poi.lat, poi.lng!, 12);
  }
}
