import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { ClustersService } from '../../../couches/clusters.service';
import type { CorpsLancementClustering } from '../../../logique/clustering/assistant';
import { dateCourte, jetonSilhouette } from '../../../logique/clustering/panneau';
import { PanneauClustersComponent } from './panneau-clusters.component';
import { RapportClustersComponent } from './rapport/rapport-clusters.component';

/**
 * L'accordéon « Clustering » du panneau Analyse — portage de `filter-panel/ClusteringSection.tsx` (lot 4, T19) : la
 * liste des modèles calculés (lue à CHAQUE ouverture, jamais au montage), le rapport d'un modèle au clic, et le
 * panneau de clusters sous « + Nouveau clustering ».
 *
 * « Charger les clusters » est RELAYÉ (`charger`) : le panneau Analyse garde le périmètre, puis charge. Le lancement d'un
 * calcul par l'assistant (T20) aussi (`lancerCalcul`), et son refus redescend (`refusCalcul`) — le relais de
 * `verifierPerimetreClustering` que React passait en prop jusqu'au wizard.
 *
 * Défaut React corrigé : une liste en échec (403, panne) s'affichait « Aucun modèle calculé » — le message de la route
 * s'affiche à la place. La bordure du badge SIL (`${couleur}40`, couleur invalide pour un `var()`) devient la teinte à
 * 25 % (`color-mix`), en 0,5 px.
 */
@Component({
  selector: 'mg-section-clustering',
  imports: [PanneauClustersComponent, RapportClustersComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col' },
  template: `
    <button type="button" data-accordeon="clustering" [attr.aria-expanded]="ouverte()" (click)="basculer()"
      class="flex w-full cursor-pointer items-center gap-2 border-b-fin border-l-2 border-t border-b-subtle border-l-[color-mix(in_srgb,var(--brand-teal)_25%,transparent)] border-t-subtle bg-elevated px-[14px] py-[10px] transition-[background-color] duration-[180ms] ease-[var(--ease-out)]">
      <span aria-hidden="true" class="size-1.5 shrink-0 rounded-full bg-teal"></span>
      <span class="flex-1 text-left text-[12px] font-medium text-primary">
        Clustering
        @if (clusters.visible()) { <span class="ml-1.5 text-success" aria-label="clusters affichés">●</span> }
      </span>
      <span class="text-[10px] text-tertiary">{{ ouverte() ? '▲' : '▼' }}</span>
    </button>

    @if (ouverte()) {
      <div class="border-b-fin border-subtle">
        @if (!nouveauCalcul()) {
          <div class="px-3 py-[10px]">
            @for (m of modeles(); track m.version) {
              <div role="button" tabindex="0" [attr.data-modele]="m.version" (click)="versionOuverte.set(m.version)" (keydown.enter)="versionOuverte.set(m.version)"
                   class="modele mb-1.5 cursor-pointer rounded-lg border-fin border-subtle bg-elevated px-3 py-[10px]">
                <div class="mb-1 flex items-center gap-1.5">
                  <span class="font-mono text-[12px] font-medium text-primary">v{{ m.version }}</span>
                  <span class="silhouette rounded-[2px] px-1 py-px font-mono text-[9px]" [style.--teinte]="m.teinte">SIL {{ m.silhouette }}</span>
                  <span class="ml-auto font-mono text-[10px] text-tertiary">{{ m.date }}</span>
                </div>
                <div class="font-mono text-[10px] text-secondary">{{ m.k }} clusters · {{ m.n_poi_trained }} POI · {{ m.duration_minutes }}min {{ m.mode }}</div>
              </div>
            }
            @if (modeles().length === 0) {
              @if (clusters.erreurModeles(); as e) {
                <div data-erreur role="alert" class="py-3 text-center font-mono text-[11px] text-danger">{{ e }}</div>
              } @else {
                <div class="py-3 text-center font-mono text-[11px] text-tertiary">{{ clusters.chargementModeles() ? 'Chargement…' : 'Aucun modèle calculé' }}</div>
              }
            }
            <button type="button" data-nouveau (click)="nouveauCalcul.set(true)"
              class="w-full cursor-pointer rounded-lg border-fin border-teal bg-transparent px-4 py-2 text-[12px] font-medium text-teal transition-[background-color] duration-[180ms] ease-[var(--ease-out)] hover:bg-[color-mix(in_srgb,var(--brand-teal)_10%,transparent)]">
              + Nouveau clustering
            </button>
          </div>
        } @else {
          <div>
            <button type="button" data-liste (click)="nouveauCalcul.set(false)"
              class="block w-full cursor-pointer border-0 border-b-fin border-subtle bg-transparent px-3 py-2 text-left font-mono text-[11px] text-tertiary">
              ← Liste des modèles
            </button>
            <div class="min-h-[400px]"><mg-panneau-clusters [refusCalcul]="refusCalcul()" (charger)="charger.emit()" (lancerCalcul)="lancerCalcul.emit($event)" (voirModeles)="nouveauCalcul.set(false)" /></div>
          </div>
        }
      </div>
    }

    @if (versionOuverte(); as v) { <mg-rapport-clusters [version]="v" (fermer)="versionOuverte.set(null)" /> }
  `,
  styles: `
    .modele { transition: border-color 200ms var(--ease-out); }
    .modele:hover { border-color: var(--brand-teal-30); }
    .silhouette { color: var(--teinte); border: 0.5px solid color-mix(in srgb, var(--teinte) 25%, transparent); }
  `,
})
export class SectionClusteringComponent {
  protected readonly clusters = inject(ClustersService);
  /** « Charger les clusters », relayé au panneau Analyse qui garde le périmètre. */
  readonly charger = output<void>();
  /** Le refus de la garde du calcul (panneau Analyse), relayé jusqu'à l'assistant. */
  readonly refusCalcul = input<string | null>(null);
  /** Le lancement d'un calcul par l'assistant, relayé au panneau Analyse qui le garde. */
  readonly lancerCalcul = output<CorpsLancementClustering>();

  /** Fermée à l'ouverture du panneau (`analyseOpen.clustering: false`). */
  protected readonly ouverte = signal(false);
  protected readonly nouveauCalcul = signal(false);
  protected readonly versionOuverte = signal<number | null>(null);
  protected readonly modeles = computed(() => this.clusters.modeles().map((m) => ({
    ...m, silhouette: m.silhouette_score.toFixed(3), teinte: `var(--${jetonSilhouette(m.silhouette_score)})`, date: dateCourte(m.created_at),
  })));

  protected basculer(): void {
    this.ouverte.update((o) => !o);
    if (this.ouverte()) this.clusters.chargerModeles();
  }
}
