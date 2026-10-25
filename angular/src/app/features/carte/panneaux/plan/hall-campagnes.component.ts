import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { type Subscription, catchError, map, of, switchMap } from 'rxjs';
import { ConfirmationComponent } from '../../../../ui/confirmation/confirmation.component';
import { type CampagneListe, type ModeDemo, PlanApi } from '../../data/plan.api';
import { LectureAnnulable } from '../../etat/lecture-annulable';
import { PlanCampagneService, messageErreurCampagnes } from '../../etat/plan-campagne.service';
import { ENCART_ERREUR } from '../analyse/styles-analyse';

/** La source des campagnes nées dans l'application, sans import DSP (`MAGELIAN_SOURCE`, `lib/campaigns/blank-campaign.ts`). */
const SOURCE_COQUILLE = 'magelian';

/** Ce que le hall lit, en une passe : les campagnes, celles qui ont une stratégie, et la date du dernier autosave. */
interface ListesHall {
  campagnes: CampagneListe[];
  avecStrategie: ReadonlySet<string>;
  brouillonLe: ReadonlyMap<string, string>;
}

/** Une ligne du hall, mise en forme une fois (aucune méthode dans le gabarit). */
interface LigneHall {
  id: string;
  name: string;
  /** « brouillon · 25/10/2026 » si un autosave existe, sinon `null`. */
  badge: string | null;
}

const LIGNE = 'mb-1.5 flex items-center gap-3 rounded-[8px] border-fin border-subtle px-3.5 py-[11px]';

/**
 * ⑥ Plan — le hall, quand aucune campagne n'est ouverte (`?campagne=` vide) : port de `CreationHall`
 * (`components/magelian/CreationHall.tsx`) et des listes de `MagelianOverlay.tsx` (lot 6, T3, A-1). Trois blocs :
 * « Nouvelle campagne » ; « Reprendre une création » (coquilles nées ici SANS stratégie, badge brouillon d'après les
 * autosaves, suppression confirmée par `mg-confirmation`) ; « Modifier une campagne lancée » (toute campagne avec
 * stratégie). Une campagne peut figurer des deux côtés, comme en React (`partitionCampaigns`). L'interrupteur « Mode
 * démo » de l'en-tête de l'overlay est porté ici (A-7), même route, optimiste avec retour arrière.
 *
 * Lectures : campagnes → stratégies → brouillons en UNE chaîne séquentielle (React les lançait ensemble ; CLAUDE.md
 * borne à 3 appels simultanés, et le mode démo part à côté), à chaque montage du hall — revenir au hall relit, comme
 * l'overlay rafraîchissait « au retour au hall ». Stratégies et brouillons illisibles = listes vides (best-effort de
 * React) ; la liste des campagnes refusée (401/403 : réservée au super_admin en V1) le DIT.
 *
 * Écarts à React, listés au rapport : le badge brouillon et « Modifier » gardent leur bord teal mais écrivent en
 * `--text-primary` (le teal en texte tombe sous 3:1 sur fond clair) ; un échec de suppression est dit (React se taisait).
 */
@Component({
  selector: 'mg-hall-campagnes',
  imports: [ConfirmationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col px-4 py-3', 'data-hall-campagnes': '' },
  template: `
    <div class="mb-3.5 flex items-start gap-3">
      <p class="m-0 flex-1 text-[13px] leading-[1.6] text-secondary">
        Crée une nouvelle campagne, reprends une création en cours ou reprogramme une campagne déjà lancée.
      </p>
      @if (demo()?.can_toggle) {
        <label data-mode-demo class="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] text-secondary">
          <input type="checkbox" class="accent-teal" [checked]="demo()?.demo_mode" (change)="basculerDemo($any($event.target).checked)" />
          Mode démo
        </label>
      }
    </div>

    <button type="button" data-nouvelle-campagne [disabled]="creation()" (click)="creer()"
            class="self-start rounded-[6px] border-0 bg-primary px-5 py-[11px] text-[13px] font-medium text-page enabled:cursor-pointer disabled:cursor-wait">
      {{ creation() ? 'Création…' : 'Nouvelle campagne' }}
    </button>

    @if (lecture.enCours()) { <div class="mt-[18px] text-[12px] text-tertiary">Chargement…</div> }
    @if (erreur(); as e) { <div data-erreur-hall role="alert" [class]="'mt-3 ' + encartErreur">{{ e }}</div> }

    @if (coquilles().length > 0) {
      <div class="mb-2.5 mt-[22px] flex items-center gap-2">
        <span aria-hidden="true" class="size-1.5 rounded-full bg-teal"></span>
        <span class="text-[12px] font-medium text-primary">Reprendre une création</span>
      </div>
      @for (c of coquilles(); track c.id) {
        <div [class]="ligne" [attr.data-coquille]="c.id">
          <button type="button" (click)="plan.choisirCampagne(c.id)"
                  class="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-[13px] text-primary">{{ c.name }}</button>
          @if (c.badge) {
            <span data-badge-brouillon class="shrink-0 rounded-[4px] border-fin border-[var(--brand-teal-30)] px-2 py-0.5 font-mono text-[10px] text-primary">{{ c.badge }}</span>
          }
          <button type="button" data-supprimer (click)="aSupprimer.set(c)"
                  class="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[11px] text-tertiary hover:text-primary">Supprimer</button>
        </div>
      }
    }

    @if (lancees().length > 0) {
      <div class="mb-2.5 mt-[22px] flex items-center gap-2">
        <span aria-hidden="true" class="size-1.5 rounded-full bg-teal"></span>
        <span class="text-[12px] font-medium text-primary">Modifier une campagne lancée</span>
      </div>
      @for (c of lancees(); track c.id) {
        <div [class]="ligne" [attr.data-lancee]="c.id">
          <span class="min-w-0 flex-1 truncate text-[13px] text-primary">{{ c.name }}</span>
          <button type="button" data-modifier (click)="plan.choisirCampagne(c.id)"
                  class="shrink-0 cursor-pointer rounded-[6px] border-fin border-teal bg-transparent px-3 py-[5px] text-[11px] font-medium text-primary hover:bg-teal-10">Modifier</button>
        </div>
      }
    }

    <mg-confirmation [ouvert]="aSupprimer() !== null" titre="Supprimer cette campagne ?" [message]="messageSuppression()"
                     libelleConfirmer="Supprimer" variante="danger" [enCours]="suppression()"
                     (confirmer)="supprimer()" (annuler)="annulerSuppression()" />
  `,
})
export class HallCampagnesComponent {
  protected readonly plan = inject(PlanCampagneService);
  private readonly api = inject(PlanApi);

  protected readonly ligne = LIGNE;
  protected readonly encartErreur = ENCART_ERREUR;

  protected readonly lecture = new LectureAnnulable<ListesHall>(messageErreurCampagnes);
  protected readonly demo = signal<ModeDemo | null>(null);
  protected readonly creation = signal(false);
  protected readonly suppression = signal(false);
  protected readonly aSupprimer = signal<LigneHall | null>(null);
  /** Un échec de création ou de suppression (la lecture a le sien). */
  private readonly erreurAction = signal<string | null>(null);
  /** Les coquilles supprimées depuis la lecture : retirées sans relire. */
  private readonly supprimees = signal<ReadonlySet<string>>(new Set());

  protected readonly erreur = computed(() => this.erreurAction() ?? this.lecture.erreur());
  private readonly campagnes = computed(() => (this.lecture.resultat()?.campagnes ?? []).filter((c) => !this.supprimees().has(c.id)));
  protected readonly coquilles = computed<LigneHall[]>(() => {
    const l = this.lecture.resultat();
    if (!l) return [];
    return this.campagnes()
      .filter((c) => c.dsp_source === SOURCE_COQUILLE && !l.avecStrategie.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, badge: badgeBrouillon(l.brouillonLe.get(c.id)) }));
  });
  protected readonly lancees = computed<LigneHall[]>(() => {
    const l = this.lecture.resultat();
    return l ? this.campagnes().filter((c) => l.avecStrategie.has(c.id)).map((c) => ({ id: c.id, name: c.name, badge: null })) : [];
  });
  protected readonly messageSuppression = computed(() => {
    const c = this.aSupprimer();
    return c ? `« ${c.name} » et son brouillon seront supprimés — action irréversible.` : '';
  });

  private readonly envois: Subscription[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => { for (const s of this.envois) s.unsubscribe(); });
    this.lecture.lancer(this.api.campagnes().pipe(
      switchMap((campagnes) => this.api.strategies().pipe(
        map((r) => new Set(r.strategies.map((s) => s.campaign_id))),
        catchError(() => of(new Set<string>())),
        map((avecStrategie) => ({ campagnes, avecStrategie })),
      )),
      switchMap((l) => this.api.brouillons().pipe(
        map((r) => new Map(r.drafts.map((d) => [d.campaign_id, d.last_saved_at]))),
        catchError(() => of(new Map<string, string>())),
        map((brouillonLe) => ({ ...l, brouillonLe })),
      )),
    ));
    // Le mode démo : best-effort, comme l'overlay (un échec masque l'interrupteur).
    this.envois.push(this.api.modeDemo().subscribe({ next: (d) => this.demo.set(d), error: () => undefined }));
  }

  protected creer(): void {
    if (this.creation()) return;
    this.creation.set(true);
    this.erreurAction.set(null);
    this.envois.push(this.plan.creerCampagne().subscribe({
      next: () => this.creation.set(false),
      error: (e: unknown) => {
        this.creation.set(false);
        this.erreurAction.set(messageErreurCampagnes(e));
      },
    }));
  }

  protected supprimer(): void {
    const c = this.aSupprimer();
    if (!c || this.suppression()) return;
    this.suppression.set(true);
    this.erreurAction.set(null);
    this.envois.push(this.api.supprimerCampagne(c.id).subscribe({
      next: () => {
        this.supprimees.update((s) => new Set(s).add(c.id));
        this.finSuppression();
      },
      error: (e: unknown) => {
        this.erreurAction.set(messageErreurCampagnes(e));
        this.finSuppression();
      },
    }));
  }

  protected annulerSuppression(): void {
    if (!this.suppression()) this.aSupprimer.set(null);
  }

  /** Optimiste, comme l'overlay : la case bascule tout de suite et revient en arrière si la route refuse. */
  protected basculerDemo(on: boolean): void {
    const avant = this.demo();
    if (!avant) return;
    this.demo.set({ ...avant, demo_mode: on });
    this.envois.push(this.api.basculerModeDemo(on).subscribe({ error: () => this.demo.set({ ...avant, demo_mode: !on }) }));
  }

  private finSuppression(): void {
    this.suppression.set(false);
    this.aSupprimer.set(null);
  }
}

/** « brouillon · 25/10/2026 » (`toLocaleDateString('fr-FR')`, comme `CreationHall`) ; sans autosave, `null`. */
function badgeBrouillon(le: string | undefined): string | null {
  return le ? `brouillon · ${new Date(le).toLocaleDateString('fr-FR')}` : null;
}
