import {
  ChangeDetectionStrategy, Component, DestroyRef, Injector, afterNextRender, computed, effect, inject, input, linkedSignal, output, untracked,
} from '@angular/core';
import { ApercuClusteringService } from '../../../couches/apercu-clustering.service';
import type { CorpsLancementClustering } from '../../../logique/clustering/assistant';
import { EtapeExecutionComponent } from './assistant/etape-execution.component';
import { EtapeParametresComponent } from './assistant/etape-parametres.component';
import { EtapePerimetreComponent } from './assistant/etape-perimetre.component';
import { EtapeTypesComponent } from './assistant/etape-types.component';
import { EtatAssistantClusteringService } from './assistant/etat-assistant-clustering.service';
import { STYLES_ASSISTANT } from './assistant/styles-assistant';
import { CalculClusteringService } from './calcul-clustering.service';

/**
 * L'assistant de calcul du clustering — portage de `app/map/_components/ClusteringWizard.tsx` (lot 4, T20) : quatre
 * étapes (types de POI, périmètre, paramètres, exécution) par-dessus le panneau de clusters, qui l'ouvre.
 *
 * ── LE LANCEMENT EST GARDÉ PLUS HAUT ─────────────────────────────────────
 * « Lancer » ÉMET le corps du POST (`lancer`) ; il remonte jusqu'à `mg-panneau-analyse`, qui passe par
 * `verifierPerimetreOutil('clustering')` (refus de la France entière, NOMMÉ) avant d'appeler
 * `CalculClusteringService.lancer` — verrou structurel `panneau-analyse-garde.test.ts`. Le refus redescend par `refus`
 * (le message de garde du panneau) et s'affiche dans l'étape 3, où React l'affichait (`launchError`). Seul le refus
 * opposé à CE clic est retenu (`refusCapte`) : un refus posé ensuite par un AUTRE outil (bataille, score) ne le remplace
 * pas, et il s'efface dès que la garde ne refuse plus rien (filtre posé), au « Retour » et au lancement admis.
 *
 * ── CE QUE LA FERMETURE ARRÊTE ───────────────────────────────────────────
 * Détruit (✕, « Fermer », panneau fermé), l'assistant arrête le sondage du job et efface l'aperçu des POI sur la carte
 * (`onWizardClose`). L'aperçu suit les types et « métropolitaine uniquement » (`onHighlight`, best effort).
 */
@Component({
  selector: 'mg-assistant-clustering',
  imports: [EtapeExecutionComponent, EtapeParametresComponent, EtapePerimetreComponent, EtapeTypesComponent],
  providers: [EtatAssistantClusteringService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'absolute inset-0 z-[600] flex flex-col bg-surface font-mono', role: 'region', 'aria-label': 'Assistant de clustering' },
  template: `
    <div class="flex items-center justify-between border-b-fin border-default px-4 pb-[10px] pt-[14px]">
      <div class="flex items-center gap-[10px]">
        <span class="inter text-[13px] font-semibold tracking-[1px] text-teal">Clustering</span>
        <span class="inter text-[11px] tracking-[0.5px] text-secondary">wizard</span>
      </div>
      <div class="flex items-center gap-1.5" aria-hidden="true">
        @for (p of pastilles(); track p.n) {
          <div class="pastille-etape" [class.active]="p.active" [class.faite]="p.faite">{{ p.faite ? '✓' : p.n }}</div>
          @if (p.n < 4) { <div class="trait" [class.fait]="p.faite"></div> }
        }
      </div>
      <button type="button" data-fermer aria-label="Fermer l'assistant" class="fermer text-[14px] text-secondary" (click)="fermer.emit()">✕</button>
    </div>

    <div data-corps class="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-4">
      @switch (etat.etape()) {
        @case (1) { <mg-etape-types /> }
        @case (2) { <mg-etape-perimetre /> }
        @case (3) { <mg-etape-parametres [erreur]="erreur()" /> }
        @case (4) { <mg-etape-execution (voirModeles)="voirModeles.emit()" /> }
      }
    </div>

    <div class="flex shrink-0 justify-between gap-2 border-t-fin border-default px-4 py-3">
      @if (etat.etape() === 2 || etat.etape() === 3) {
        <button type="button" data-retour class="pied neutre" (click)="revenir()">Retour</button>
      } @else { <div></div> }

      @if (etat.etape() === 1 || etat.etape() === 2) {
        <button type="button" data-suivant class="pied principal px-5!" [disabled]="etat.types().length === 0" (click)="etat.suivant()">Suivant</button>
      }
      @if (etat.etape() === 3) {
        <button type="button" data-lancer class="pied lancer px-5!" [disabled]="!etat.peutLancer()" (click)="demanderLancement()">
          {{ calcul.lancement() ? 'Lancement...' : 'Lancer' }}
        </button>
      }
      @if (etat.etape() === 4 && calcul.termine()) {
        <div class="flex gap-2">
          <button type="button" data-fermer-fin class="pied neutre" (click)="fermer.emit()">Fermer</button>
          <button type="button" data-voir-resultats class="pied voir" (click)="voirModeles.emit()">Voir résultats</button>
        </div>
      }
    </div>
  `,
  styles: [STYLES_ASSISTANT, `
    .pastille-etape { width: 24px; height: 24px; border-radius: 2px; border: 0.5px solid var(--border-default); color: var(--text-secondary);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-family: var(--font-mono); font-size: 10px;
      transition: background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out); }
    .pastille-etape.active { border-color: var(--brand-teal); background: color-mix(in srgb, var(--brand-teal) 10%, transparent); color: var(--brand-teal); }
    .pastille-etape.faite { border-color: var(--success); background: color-mix(in srgb, var(--success) 8%, transparent); color: var(--success); }
    .trait { width: 12px; height: 1px; background: var(--border-default); transition: background-color 180ms var(--ease-out); }
    .trait.fait { background: var(--success); }
    .fermer { background: none; border: 0; cursor: pointer; padding: 2px 6px; line-height: 1; }
    .pied { padding: 8px 16px; border-radius: 2px; cursor: pointer; background: transparent; border: 0.5px solid var(--border-default);
      color: var(--text-secondary); font-family: var(--font-sans); font-size: 9px; letter-spacing: 1px; }
    .pied:disabled { cursor: not-allowed; }
    .pied.principal:not(:disabled) { background: color-mix(in srgb, var(--brand-teal) 10%, transparent); border-color: var(--brand-teal); color: var(--brand-teal); }
    .pied.lancer:not(:disabled), .pied.voir { background: color-mix(in srgb, var(--success) 8%, transparent); border-color: var(--success); color: var(--success); }
    .pied.voir { border-color: color-mix(in srgb, var(--success) 27%, transparent); }
  `],
})
export class AssistantClusteringComponent {
  protected readonly etat = inject(EtatAssistantClusteringService);
  protected readonly calcul = inject(CalculClusteringService);
  private readonly apercu = inject(ApercuClusteringService);

  /** Le message de garde du panneau Analyse (`verifierPerimetreOutil('clustering')`), `null` si le lancement est admis. */
  readonly refus = input<string | null>(null);
  /** Le corps du `POST /api/poi-clusters/run` : le panneau Analyse garde, puis lance. */
  readonly lancer = output<CorpsLancementClustering>();
  readonly fermer = output<void>();
  /** « Voir résultats » : retour à la liste des modèles (React : un lien vers `/clusters`, page inexistante). */
  readonly voirModeles = output<void>();

  private readonly injecteur = inject(Injector);
  /**
   * Le refus de la garde opposé au DERNIER clic sur « Lancer ». `attente` : le clic vient d'être refusé, le message
   * redescend au rendu suivant par `refus` — le premier message reçu est le nôtre ; ensuite, un changement de `refus`
   * vient d'un autre outil et ne le remplace pas. `refus` à `null` (filtre posé) efface tout.
   */
  private readonly refusCapte = linkedSignal<string | null, RefusCapte>({
    source: this.refus,
    computation: (r, precedent) => {
      const p = precedent?.value ?? null;
      if (r === null) return null;
      return p?.attente ? { attente: false, texte: r } : p;
    },
  });
  /** Le refus affiché : celui de la garde opposé au clic, sinon celui du serveur (503 « script absent »…). */
  protected readonly erreur = computed(() => {
    const c = this.refusCapte();
    const garde = c === null ? null : c.attente ? this.refus() : c.texte;
    return garde ?? this.calcul.erreur();
  });

  protected readonly pastilles = computed(() => {
    const e = this.etat.etape();
    return [1, 2, 3, 4].map((n) => ({ n, active: e === n, faite: e > n }));
  });

  constructor() {
    this.calcul.reinitialiser();
    // L'aperçu sur la carte : une API impérative, d'où l'effet (`useEffect([selectedTypes, metropolitaine])`).
    effect(() => {
      const types = this.etat.types();
      const metropolitaine = this.etat.metropolitaine();
      untracked(() => this.apercu.afficher(types, metropolitaine));
    });
    inject(DestroyRef).onDestroy(() => {
      this.calcul.reinitialiser();
      this.apercu.effacer();
    });
  }

  protected demanderLancement(): void {
    this.lancer.emit(this.etat.corps());
    // Garde passée ⇔ le panneau a appelé `CalculClusteringService.lancer`, SYNCHRONE : `lancement` est vrai dès ici.
    if (this.calcul.lancement()) {
      this.refusCapte.set(null);
      return;
    }
    this.refusCapte.set({ attente: true });
    // Refusé avec le MÊME texte qu'avant le clic, `refus` ne change pas : on retient alors la valeur après rendu.
    afterNextRender(() => this.refusCapte.update((c) => {
      if (!c?.attente) return c;
      const r = this.refus();
      return r === null ? null : { attente: false, texte: r };
    }), { injector: this.injecteur });
  }

  /** « Retour » : l'étape change, le refus du dernier clic n'a plus d'objet. */
  protected revenir(): void {
    this.refusCapte.set(null);
    this.etat.retour();
  }
}

/** `attente` : un clic vient d'être refusé, son message n'est pas encore redescendu ; sinon, le message retenu. */
type RefusCapte = { attente: true } | { attente: false; texte: string } | null;
