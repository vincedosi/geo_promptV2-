import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { type Subscription, switchMap } from 'rxjs';
import { ZonesCustomApi } from '../../data/zones-custom.api';
import {
  MESSAGE_RESOLUTION_ECHOUEE, MESSAGE_SAUVEGARDE_ECHOUEE, OPERATIONS_ZONES, ORDRE_OPERATIONS, type OperationZones, corpsOperation,
  libelleSelection, messageRefusOperation, messageZoneCreee, nomDansSelection, nomZoneCreee,
} from '../../logique/zones/operations-zones';

/**
 * La barre des opérations booléennes au-dessus de « Mes zones » — `ZonesOperations.tsx` (lot 4, T14), textes exacts.
 * Toujours montée, comme React (son état survit à une sélection vidée) ; la barre n'apparaît qu'avec une zone cochée,
 * les boutons s'activent à deux.
 *
 * Le geste ÉCRIT en base : la route calcule la géométrie (`/source/{composite,intersection,difference}`), puis
 * `/api/custom-geo/save` enregistre la zone et résout ses codes postaux — c'est cette liste qui part au DSP. Sur un
 * refus (409 « aucune surface en commun »), RIEN n'est enregistré : la sauvegarde n'est pas appelée. La composition
 * est gardée en clair dans `source_metadata` (opération, ids et noms des membres, surface).
 *
 * Défaut de React corrigé : la réussite vide la sélection, et la barre disparaissait avec elle — « Zone créée : … »
 * n'était jamais vu au moment de la création, puis resurgissait, périmé, à la sélection suivante. Ici le message reste
 * affiché seul, sous la forme de React, jusqu'à la prochaine opération.
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
  private readonly api = inject(ZonesCustomApi);

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
      inactif: this.selection().length < d.min || this.enCours() !== null || !this.org(),
    };
  }));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.abonnement?.unsubscribe());
  }

  protected lancer(op: OperationZones): void {
    const selection = [...this.selection()];
    const org = this.org();
    if (this.enCours() || selection.length < OPERATIONS_ZONES[op].min || !org) return;
    this.enCours.set(op);
    this.erreur.set(null);
    this.message.set(null);
    const d = OPERATIONS_ZONES[op];
    const noms = this.noms();
    // Ce que la route de l'opération a rendu : un échec APRÈS elle est celui de la sauvegarde.
    let geometrieRecue = false;
    let surface: number | null = null;

    this.abonnement = this.api.operation(d.source, corpsOperation(op, selection)).pipe(
      switchMap((geo) => {
        geometrieRecue = true;
        surface = geo.surface_km2 ?? null;
        return this.api.enregistrer({
          name: nomZoneCreee(op, selection, noms).slice(0, 200),
          source_type: d.source,
          source_metadata: {
            operation: op,
            member_zone_ids: selection,
            member_zone_names: selection.map((id) => nomDansSelection(noms, id)),
            surface_km2: surface,
          },
          geometry: geo.geometry,
          org_id: org,
        });
      }),
    ).subscribe({
      next: (reponse) => {
        this.enCours.set(null);
        if (reponse.status === 207) {
          this.erreur.set(MESSAGE_RESOLUTION_ECHOUEE);
          return;
        }
        this.message.set(messageZoneCreee(reponse.body?.count_cp, surface));
        this.termine.emit();
      },
      error: (e: unknown) => {
        this.enCours.set(null);
        const r = e as { status?: number; error?: unknown };
        this.erreur.set(geometrieRecue ? MESSAGE_SAUVEGARDE_ECHOUEE : messageRefusOperation(r.status ?? 0, r.error));
      },
    });
  }
}
