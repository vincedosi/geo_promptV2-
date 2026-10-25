import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import type { Subscription } from 'rxjs';
import { IconeComponent } from '../../../ui/icone/icone.component';
import { type CampagneListe, PlanApi } from '../data/plan.api';
import { LectureAnnulable } from '../etat/lecture-annulable';
import { PlanCampagneService, messageErreurCampagnes } from '../etat/plan-campagne.service';

/** Le déclencheur : le gabarit des boutons neutres de la barre (`BOUTON_NEUTRE` de `mg-barre-parcours`). */
const DECLENCHEUR = 'flex max-w-[260px] cursor-pointer items-center gap-1.5 rounded-[6px] border-fin border-default bg-transparent px-[10px] py-[5px] text-[11px] transition-colors duration-150 ease-[var(--ease-hover)] hover:border-hover hover:bg-elevated';
/** Une option de la liste : celle du menu d'organisation de `mg-badge-session`. */
const OPTION = 'flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-[10px] py-[7px] text-left text-[12px] transition-colors duration-150 ease-[var(--ease-hover)] hover:bg-elevated disabled:cursor-wait';

/**
 * ⑥-⑧ — la campagne courante, choisie dans la BARRE du parcours (lot 6, T3, A-1 ; spec § 13-14, Q2 tranchée). Monté
 * par `mg-barre-parcours` aux étapes `plan`, `activation` et `live` ; aux deux dernières, encore « bientôt », il n'écrit
 * que `?campagne=` (par `PlanCampagneService.choisirCampagne`, seul écrivain de ce paramètre).
 *
 * ── AUCUNE LECTURE À L'OUVERTURE DE L'ÉTAPE ───────────────────────────────
 * La liste (`GET /api/admin/campaigns`, l'espace actif) n'est lue qu'au PREMIER clic, une fois par composant (patron
 * de `mg-choix-zone-analysee`). Elle est relue à l'ouverture seulement si la campagne courante n'y figure pas (créée
 * depuis le hall du panneau ⑥, ou arrivée par un lien). Le nom affiché vient de la campagne LUE par le service
 * (`detail`), sinon de la liste.
 *
 * « Nouvelle campagne » en tête (A-1) : `PlanCampagneService.creerCampagne` (POST, puis la coquille est ouverte).
 * Un refus de rôle (401/403 : campagnes réservées au super_admin en V1, décision de Vincent) se DIT dans la liste
 * (`messageErreurCampagnes`), jamais en silence.
 *
 * Contrat AIDA : la liste est rendue DANS l'arbre (`absolute`, jamais un portail) ; aucun écouteur sur le document —
 * elle se ferme à la sortie du focus (`focusout` de l'hôte), sur Échap (consommé : la carte ignore un Échap
 * `defaultPrevented`, comme pour `mg-badge-session`) et au choix.
 */
@Component({
  selector: 'mg-choix-campagne',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative shrink-0',
    'data-choix-campagne': '',
    '(keydown.escape)': 'echap($event)',
    '(focusout)': 'sortieFocus($event)',
  },
  template: `
    <button #declencheur type="button" data-declencheur-campagne [class]="declencheur" (click)="basculer()"
            [attr.aria-expanded]="ouvert()" aria-controls="mg-liste-campagnes" [attr.title]="'Campagne : ' + nomCourant()">
      <span class="shrink-0 text-tertiary">Campagne</span>
      <span data-nom-campagne class="min-w-0 truncate text-primary">{{ nomCourant() }}</span>
      <mg-icone [nom]="ouvert() ? 'chevron-haut' : 'chevron-bas'" [taille]="12" [trait]="1.5" class="shrink-0 text-tertiary" />
    </button>
    @if (ouvert()) {
      <!-- tabindex -1 : un clic dans la liste hors d'un bouton y garde le focus, la sortie du focus ne la ferme pas. -->
      <div id="mg-liste-campagnes" data-liste-campagnes tabindex="-1"
           class="absolute right-0 top-[calc(100%+4px)] z-[20000] flex max-h-[360px] w-[280px] flex-col overflow-y-auto rounded-[8px] border-fin border-default bg-surface p-1 outline-none">
        <button type="button" data-nouvelle-campagne [class]="option + ' font-medium text-primary'" [disabled]="creation()" (click)="creer()">
          <mg-icone nom="plus" [taille]="13" [trait]="1.5" class="shrink-0 text-tertiary" />{{ creation() ? 'Création…' : 'Nouvelle campagne' }}
        </button>
        <div class="my-1 h-[0.5px] shrink-0 bg-subtle"></div>
        @if (lecture.enCours()) { <div class="px-[10px] py-[7px] font-mono text-[11px] text-tertiary">Chargement…</div> }
        @if (erreur(); as e) { <p data-erreur-campagnes role="alert" class="m-0 px-[10px] py-[7px] text-[11px] text-danger">{{ e }}</p> }
        @for (c of campagnes(); track c.id) {
          <button type="button" [attr.data-campagne]="c.id" [attr.aria-current]="c.id === plan.campagne() ? 'true' : null" (click)="choisir(c.id)"
                  [class]="option + (c.id === plan.campagne() ? ' text-primary' : ' text-secondary')">
            @if (c.id === plan.campagne()) { <span class="size-[5px] shrink-0 rounded-full bg-teal"></span> }
            <span class="min-w-0 truncate">{{ c.name }}</span>
          </button>
        } @empty {
          @if (lecture.resultat() !== null && !erreur()) {
            <p data-aucune-campagne class="m-0 px-[10px] py-[7px] text-[11px] text-tertiary">Aucune campagne dans cet espace.</p>
          }
        }
      </div>
    }
  `,
})
export class ChoixCampagneComponent {
  protected readonly plan = inject(PlanCampagneService);
  private readonly api = inject(PlanApi);
  private readonly hote = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly declencheurBouton = viewChild.required<ElementRef<HTMLButtonElement>>('declencheur');

  protected readonly declencheur = DECLENCHEUR;
  protected readonly option = OPTION;

  protected readonly ouvert = signal(false);
  protected readonly creation = signal(false);
  private readonly erreurCreation = signal<string | null>(null);
  protected readonly lecture = new LectureAnnulable<CampagneListe[]>(messageErreurCampagnes);
  /** Les coquilles créées ici depuis la lecture : en tête, la plus récente d'abord (comme la route). */
  private readonly creees = signal<ReadonlyArray<{ id: string; name: string }>>([]);
  protected readonly campagnes = computed(() => {
    const lues = this.lecture.resultat() ?? [];
    return [...this.creees().filter((c) => !lues.some((l) => l.id === c.id)), ...lues];
  });
  protected readonly erreur = computed(() => this.erreurCreation() ?? this.lecture.erreur());

  /** Le nom de la campagne courante : lue par le service, sinon trouvée dans la liste ; « Aucune » sans campagne. */
  protected readonly nomCourant = computed(() => {
    const id = this.plan.campagne();
    if (!id) return 'Aucune';
    return this.plan.detail()?.name ?? this.campagnes().find((c) => c.id === id)?.name ?? '…';
  });

  private envoi: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.envoi?.unsubscribe());
  }

  protected basculer(): void {
    if (this.ouvert()) return this.ouvert.set(false);
    this.ouvert.set(true);
    this.erreurCreation.set(null);
    const id = this.plan.campagne();
    const connue = !id || this.campagnes().some((c) => c.id === id);
    if (this.lecture.resultat() !== null && !connue) this.lecture.lancer(this.api.campagnes());
    else this.lecture.chargerUneFois(() => this.api.campagnes());
  }

  protected choisir(id: string): void {
    this.fermer();
    this.plan.choisirCampagne(id);
  }

  protected creer(): void {
    if (this.creation()) return;
    this.creation.set(true);
    this.erreurCreation.set(null);
    this.envoi = this.plan.creerCampagne().subscribe({
      next: (c) => {
        this.creation.set(false);
        this.creees.update((l) => [c, ...l]);
        this.fermer();
      },
      error: (e: unknown) => {
        this.creation.set(false);
        this.erreurCreation.set(messageErreurCampagnes(e));
      },
    });
  }

  /** Échap ferme la liste et rend le focus au déclencheur ; consommé, il ne remonte pas jusqu'à la pile de la carte. */
  protected echap(e: Event): void {
    if (!this.ouvert()) return;
    e.preventDefault();
    e.stopPropagation();
    this.fermer();
    this.declencheurBouton().nativeElement.focus();
  }

  /** Le focus quitte le sélecteur (clic sur la carte, tabulation) : la liste se ferme. */
  protected sortieFocus(e: FocusEvent): void {
    const vers = e.relatedTarget as Node | null;
    if (!vers || !this.hote.nativeElement.contains(vers)) this.ouvert.set(false);
  }

  private fermer(): void {
    this.ouvert.set(false);
  }
}

