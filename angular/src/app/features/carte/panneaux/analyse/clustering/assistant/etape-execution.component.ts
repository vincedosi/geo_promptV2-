import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { libellePerimetre } from '../../../../logique/clustering/assistant';
import { featureSelectionLabel } from '../../../../logique/clustering/feature-themes';
import { CalculClusteringService } from '../calcul-clustering.service';
import { EtatAssistantClusteringService } from './etat-assistant-clustering.service';
import { STYLES_ASSISTANT } from './styles-assistant';

/** Les 3 000 derniers caractères du journal (`jobLog.slice(-3000)`). */
const JOURNAL_MAX = 3000;

/**
 * Étape 4 de l'assistant — « Exécution » (`ClusteringWizard.tsx:681-757`) : le résumé de la configuration, le job
 * (identifiant, statut sondé, fin du journal) et le message de fin.
 *
 * Défauts React corrigés :
 * - le message de fin d'un job RÉUSSI n'était jamais vu : `onJobStarted` refermait le wizard dans le même tic que
 *   l'arrivée de `done`. Il reste affiché ici, la liste des modèles est relue derrière ;
 * - son lien « voir les résultats → » menait à `/clusters`, une page qui n'existe pas (404) : il ramène à la liste des
 *   modèles de la section (`voirModeles`).
 */
@Component({
  selector: 'mg-etape-execution',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-3' },
  template: `
    <div class="intertitre">4 / 4 — Exécution</div>

    <div data-resume class="tuile mono px-3 py-[10px] text-[10px] leading-[2] text-secondary">
      <div><span class="text-tertiary">Types    :</span>&ngsp;<span class="text-primary">{{ etat.types().join(', ') }}</span></div>
      <div><span class="text-tertiary">Périmètre:</span>&ngsp;<span class="text-primary">{{ perimetre() }}</span></div>
      <div><span class="text-tertiary">Variables:</span>&ngsp;<span class="text-primary">{{ variables() }}</span></div>
      <div><span class="text-tertiary">Durée    :</span>&ngsp;<span class="text-primary">{{ etat.duree() }} min — {{ etat.transport() }}</span></div>
      @if (etat.dryRun()) { <div class="text-warning">! Mode dry-run — aucune écriture</div> }
    </div>

    @if (calcul.jobId(); as id) {
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <span class="mono text-[10px] text-tertiary">Job ID :</span>
          <span class="mono text-[10px] text-secondary">{{ id.slice(0, 8) }}…</span>
          <span data-statut-job class="statut inter rounded-[1px] px-[7px] py-[2px] text-[9px] tracking-[1px]" [style.--teinte]="teinteStatut()">{{ calcul.statut() || 'pending' }}</span>
        </div>

        @if (journal(); as j) {
          <pre data-journal class="journal mono m-0 max-h-[220px] overflow-y-auto rounded-[2px] px-[10px] py-2 text-[9px] leading-[1.6] text-secondary">{{ j }}</pre>
        }

        @if (calcul.termine() && calcul.statut() === 'done') {
          <div data-fin="done" role="status" class="encart succes mono px-3 py-[10px] text-[11px]!">
            ✓ Isochrones mis en cache. Lancez <code class="mono text-[10px]">--mode full-retrain</code> pour entraîner le modèle, puis
            <button type="button" class="lien" (click)="voirModeles.emit()">voir les résultats →</button>
          </div>
        }
        @if (calcul.termine() && calcul.statut() === 'failed') {
          <div data-fin="failed" role="alert" class="encart erreur mono px-3 py-[10px] text-[11px]!">! Clustering échoué — voir les logs ci-dessus.</div>
        }
      </div>
    }
  `,
  styles: [STYLES_ASSISTANT, `
    .statut { color: var(--teinte); background: color-mix(in srgb, var(--teinte) 8%, transparent); border: 0.5px solid color-mix(in srgb, var(--teinte) 27%, transparent); }
    .journal { background: var(--bg-level-0); border: 0.5px solid var(--border-default); white-space: pre-wrap; word-break: break-all; }
    .lien { background: none; border: 0; padding: 0; font: inherit; color: inherit; text-decoration: underline; cursor: pointer; }
  `],
})
export class EtapeExecutionComponent {
  protected readonly etat = inject(EtatAssistantClusteringService);
  protected readonly calcul = inject(CalculClusteringService);
  /** « voir les résultats → » : retour à la liste des modèles, relue à la fin du job. */
  readonly voirModeles = output<void>();

  protected readonly perimetre = computed(() => libellePerimetre(this.etat.metropolitaine(), this.etat.regions().length));
  protected readonly variables = computed(() => featureSelectionLabel(this.etat.variables()));
  protected readonly journal = computed(() => this.calcul.journal().slice(-JOURNAL_MAX));
  /** Vert terminé, rouge échoué, ambre sinon (en attente, en cours). */
  protected readonly teinteStatut = computed(() => {
    const s = this.calcul.statut();
    return s === 'done' ? 'var(--success)' : s === 'failed' ? 'var(--danger)' : 'var(--warning)';
  });
}
