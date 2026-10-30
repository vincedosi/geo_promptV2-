import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { ZonesApi } from '../../data/zones.api';
import {
  MESSAGE_RESOLUTION_ECHOUEE, OPERATIONS_ZONES, ORDRE_OPERATIONS, type OperationZones,
  libelleSelection, messageZoneCreee, nomDansSelection, nomZoneCreee, operationPossible,
} from '../../logique/zones/operations-zones';
import { messageErreurZone } from '../../logique/zones/perimetre-recette';

/**
 * La barre des opérations booléennes au-dessus de « Mes zones » — `ZonesOperations.tsx` (lot 4, T14), textes exacts.
 * Toujours montée, comme React (son état survit à une sélection vidée) ; la barre n'apparaît qu'avec une zone cochée,
 * les boutons s'activent à deux.
 *
 * Le geste ÉCRIT en base, en UN appel depuis le lot 3 : `POST /api/zones` avec la recette
 * `{ type: 'combinaison', operation, zones }` — le serveur calcule la forme, l'écrit et résout ses codes postaux. La
 * composition est la recette même (ids des membres, dans l'ordre : la première est la base). Sur un refus (409
 * « aucune surface en commun », 404 zone introuvable), RIEN n'est écrit et le message de la route est affiché.
 * L'intersection ne se fait qu'entre DEUX zones (la recette `combinaison` l'exige) : « Restreindre à » n'est actif qu'à deux.
 *
 * Défaut de React corrigé : la réussite vide la sélection, et la barre disparaissait avec elle — « Zone créée : … »
 * n'était jamais vu au moment de la création, puis resurgissait, périmé, à la sélection suivante. Ici le message reste
 * affiché seul, sous la forme de React, jusqu'à la prochaine opération — ou jusqu'au prochain geste de « Mes zones »
 * (`oublierMessage`, preuve T7 D-5 : il restait sous un 409 puis sous « Zone dupliquée »).
 */
@Component({
  selector: 'mg-operations-zones',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (selection().length > 0) {
      <div data-barre class="mb-[10px] rounded-[6px] border-fin border-subtle bg-elevated p-[10px]">
        <div data-compte class="mb-2 font-mono text-[10px] text-tertiary">{{ compte() }}</div>

        @if (selection().length >= 2) {
          <div data-base class="mb-2 text-[11px] leading-[1.5] text-secondary">
            Base de <em>Soustraire</em> et <em>Restreindre à</em> :
            <span class="text-primary">{{ base() }}</span>
          </div>
        }

        <div class="flex flex-wrap gap-1.5">
          @for (b of boutons(); track b.op) {
            <button
              type="button"
              [attr.data-operation]="b.op"
              [title]="b.aide"
              [disabled]="b.inactif"
              class="min-w-[92px] flex-1 rounded-[6px] border-fin border-teal bg-transparent px-[10px] py-[7px] text-[11px] font-medium text-teal"
              [class.cursor-pointer]="!b.inactif"
              [class.cursor-not-allowed]="b.inactif"
              [class.opacity-35]="b.inactif"
              (click)="lancer(b.op)"
            >{{ b.libelle }}</button>
          }
        </div>

        @if (selection().length < 2) {
          <div data-aide class="mt-2 text-[11px] text-tertiary">Cochez au moins deux zones. L’ordre compte : la première est la base.</div>
        }
        @if (erreur(); as e) {
          <div data-erreur role="alert" class="erreur mt-2 rounded-[4px] px-[9px] py-[7px] text-[11px] leading-[1.5] text-danger">{{ e }}</div>
        }
        <ng-container [ngTemplateOutlet]="reussite" />
      </div>
    } @else if (message()) {
      <div class="mb-[10px]"><ng-container [ngTemplateOutlet]="reussite" /></div>
    }
    <ng-template #reussite>
      @if (message(); as m) {
        <div data-message role="status" class="succes mt-2 rounded-[4px] px-[9px] py-[7px] text-[11px] leading-[1.5] text-success">{{ m }}</div>
      }
    </ng-template>
  `,
  // rgba(255,87,87,0.08/0.25) et rgba(61,255,160,0.08/0.2) de React : les jetons danger / success aux mêmes taux.
  styles: `
    .erreur { background: color-mix(in srgb, var(--danger) 8%, transparent); border: 0.5px solid color-mix(in srgb, var(--danger) 25%, transparent); }
    .succes { background: color-mix(in srgb, var(--success) 8%, transparent); border: 0.5px solid color-mix(in srgb, var(--success) 20%, transparent); }
  `,
})
export class OperationsZonesComponent {
  private readonly api = inject(ZonesApi);

  /** Ids des zones cochées, DANS L'ORDRE où elles l'ont été. */
  readonly selection = input.required<readonly string[]>();
  /** Noms, pour composer celui de la zone créée. */
  readonly noms = input.required<ReadonlyMap<string, string>>();
  readonly org = input.required<string>();
  /** La zone est créée : le parent vide la sélection et recharge la liste (`onTermine`). */
  readonly termine = output<void>();

  protected readonly enCours = signal<OperationZones | null>(null);
  protected readonly message = signal<string | null>(null);
  protected readonly erreur = signal<string | null>(null);
  private abonnement: Subscription | null = null;

  protected readonly compte = computed(() => libelleSelection(this.selection().length));
  protected readonly base = computed(() => nomDansSelection(this.noms(), this.selection()[0]));
  protected readonly boutons = computed(() => ORDRE_OPERATIONS.map((op) => {
    const d = OPERATIONS_ZONES[op];
    return {
      op, aide: d.aide,
      libelle: this.enCours() === op ? '…' : d.libelle,
      inactif: !operationPossible(op, this.selection().length) || this.enCours() !== null || !this.org(),
    };
  }));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.abonnement?.unsubscribe());
  }

  /** Un autre geste de « Mes zones » commence (recalcul, duplication) : la réussite d'avant n'est plus à dire. */
  oublierMessage(): void {
    this.message.set(null);
  }

  protected lancer(op: OperationZones): void {
    const selection = [...this.selection()];
    if (this.enCours() || !operationPossible(op, selection.length) || !this.org()) return;
    this.erreur.set(null);
    this.message.set(null);
    this.enCours.set(op);
    this.abonnement = this.api.enregistrer({
      nom: nomZoneCreee(op, selection, this.noms()).slice(0, 200),
      recette: { v: 1, type: 'combinaison', operation: op, zones: selection },
    }).subscribe({
      next: (reponse) => {
        this.enCours.set(null);
        // 207 : la zone EXISTE (codes non résolus). Elle est donc « terminée » comme une réussite — liste relue,
        // sélection vidée par le parent, aucun second envoi possible — et le message de la route le dit.
        this.message.set(reponse.status === 207
          ? (reponse.body?.message ?? MESSAGE_RESOLUTION_ECHOUEE)
          : messageZoneCreee(reponse.body?.count_cp, reponse.body?.surface_km2));
        this.termine.emit();
      },
      error: (e: { status?: number; error?: unknown }) => {
        this.enCours.set(null);
        this.erreur.set(messageErreurZone(e));
      },
    });
  }
}
