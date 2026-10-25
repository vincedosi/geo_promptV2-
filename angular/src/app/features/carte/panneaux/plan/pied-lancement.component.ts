import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, linkedSignal, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { formaterDecimal, formaterNombre } from '../../../../core/format/nombre';
import { NotificationsComponent } from '../../../../ui/notifications/notifications.component';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { PlanApi } from '../../data/plan.api';
import { EchecLancement, etatLancement, lancerCampagne, messageLancement } from '../../etat/lancement-campagne';
import { ParcoursService } from '../../etat/parcours.service';
import { PlanCampagneService } from '../../etat/plan-campagne.service';
import { fmtDateShort, fmtEUR } from '../../logique/plan/brouillon';
import { resolveChannelAvailability } from '../../logique/plan/canaux';
import { TEXTE_SUCCES } from './styles-plan';

/** Le CTA principal (DESIGN_SYSTEM § 5) : `--text-primary` sur `--bg-primary`, inversé en clair par les jetons ; survol par l'opacité. */
const CTA = 'rounded-[6px] border-0 bg-[var(--text-primary)] px-4 py-2.5 text-[13px] font-medium text-[var(--bg-primary)] transition-opacity duration-150 enabled:cursor-pointer enabled:hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * ⑥ Plan — le pied « Lancement » (lot 6, T6) : port de `StepLancement.tsx` réduit au chemin extraction (A-9), sans
 * fichiers custom bidding (spec § 19.4). Toujours visible sous les sections (A-6) :
 *
 * - le RÉCAPITULATIF — identité (et le renommage à venir), extraction, plateformes avec budget, CPM et impressions
 *   prévues, période, totaux (les `totaux` du service : ceux de la section Impressions et du PATCH) ;
 * - la VALIDITÉ (`etatLancement`, un `computed`) : chaque motif de blocage est DIT, le bouton reste inactif ;
 * - « Créer la campagne → » : `lancerCampagne`, séquentiel ; tout échec est une notification (`mg-notifications`) au
 *   titre de l'étape et au message de la route ; la réussite aussi, avec « N codes postaux · X % du plan en zone ·
 *   Y % d'utile · Z impressions prévues ». Puis le brouillon serveur est jeté (`apresLancement`) et le pied propose
 *   « Préparer l'activation → ⑦ ». Relancer une campagne lancée suit le même chemin (`rattacher` archive l'ancienne).
 *
 * Une réponse revenue après un changement de campagne est notifiée (le serveur l'a écrite) mais n'écrit rien dans
 * l'état de la nouvelle.
 */
@Component({
  selector: 'mg-pied-lancement',
  imports: [NotificationsComponent],
  providers: [NotificationsService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-2.5 border-t border-subtle px-4 py-3 text-[12px] text-secondary', 'data-pied-plan': '' },
  template: `
    <mg-notifications />
    @if (lance(); as message) {
      <div data-lance class="flex flex-col gap-2">
        <span class="text-[12px]" [class]="texteSucces">✓ Campagne créée</span>
        <span data-message-lancement class="text-[12px] text-secondary">{{ message }}</span>
        <button type="button" data-vers-activation [class]="cta + ' self-start'" (click)="parcours.choisir('activation')">Préparer l’activation → ⑦</button>
      </div>
    } @else {
      <div data-recap-lancement class="flex flex-col gap-1.5">
        <div><span class="text-[13px] font-medium text-primary">{{ recap().nom }}</span> <span class="text-[11.5px] text-tertiary">{{ recap().identite }}</span></div>
        <div>Cible <span data-recap-extraction class="text-primary">{{ recap().extraction }}</span></div>
        @for (p of recap().plateformes; track p.code) {
          <div [attr.data-recap-plateforme]="p.code" class="font-mono text-[11px]">{{ p.libelle }} · {{ p.budget }} · CPM {{ p.cpm }} · {{ p.impressions }} imp.</div>
        }
        <div class="flex flex-wrap gap-x-4 gap-y-1">
          <span>Budget prévu <span data-recap-budget class="font-mono text-primary">{{ recap().budget }}</span></span>
          <span>Impressions <span data-recap-impressions class="font-mono text-primary">{{ recap().impressions }}</span></span>
          <span>CPM moyen <span data-recap-cpm class="font-mono text-primary">{{ recap().cpm }}</span></span>
          <span>Période <span data-recap-periode class="font-mono text-primary">{{ recap().periode }}</span></span>
        </div>
      </div>
      @if (etat().motifs.length > 0) {
        <ul data-motifs class="m-0 flex list-none flex-col gap-0.5 p-0 text-[11px] text-tertiary">
          @for (m of etat().motifs; track m) { <li>{{ m }}</li> }
        </ul>
      }
      <div class="flex items-center gap-3">
        <button type="button" data-lancer [class]="cta" [disabled]="!etat().demande || enCours()" (click)="lancer()">{{ enCours() ? 'Création…' : 'Créer la campagne →' }}</button>
        @if (plan.sauveLe()) { <span data-sauve class="ml-auto text-[11px] text-tertiary">Brouillon enregistré</span> }
      </div>
    }
  `,
})
export class PiedLancementComponent {
  protected readonly plan = inject(PlanCampagneService);
  protected readonly parcours = inject(ParcoursService);
  private readonly api = inject(PlanApi);
  private readonly notifications = inject(NotificationsService);

  /** La coche « Je confirme ces liaisons » correspond à la sélection courante (section Plateformes). */
  readonly liaisonsConfirmees = input(false);

  protected readonly cta = CTA;
  protected readonly texteSucces = TEXTE_SUCCES;
  protected readonly enCours = signal(false);
  /** Le message du lancement réussi de CETTE campagne ; oublié quand on en change. */
  protected readonly lance = linkedSignal<string | null, string | null>({ source: () => this.plan.campagne(), computation: () => null });
  private abonnement: Subscription | null = null;

  private readonly libelles = computed(() => {
    const c = this.plan.canaux();
    return new Map((c ? resolveChannelAvailability(c.catalog, c.connectedProviders, c.is_demo) : []).map((r) => [r.code, r.label]));
  });
  private readonly libelle = (code: string) => this.libelles().get(code) ?? code;

  protected readonly etat = computed(() => etatLancement({
    campagne: this.plan.campagne(),
    detail: this.plan.detail(),
    brouillon: this.plan.brouillon(),
    previsions: this.plan.previsions(),
    totaux: this.plan.totaux(),
    liaisonsConfirmees: this.liaisonsConfirmees(),
    libelle: this.libelle,
  }));

  protected readonly recap = computed(() => {
    const d = this.plan.brouillon();
    const t = this.plan.totaux();
    const actuel = this.plan.detail()?.name ?? '';
    const nom = d.name.trim() || actuel;
    const renomme = actuel && nom !== actuel ? `Sera renommée (actuellement « ${actuel} »)` : 'Nom de la campagne';
    const nombre = (n: number | null) => (n == null ? '—' : formaterNombre(n));
    return {
      nom: nom || '—',
      identite: [renomme, [d.advertiser.trim(), d.product.trim()].filter(Boolean).join(' · ')].filter(Boolean).join(' · '),
      extraction: d.jeuZones?.extraction ? `${d.jeuZones.nom} · extraction v${d.jeuZones.extraction.version}` : '—',
      plateformes: this.plan.previsions().map((p) => ({
        code: p.code, libelle: this.libelle(p.code), budget: fmtEUR(p.budget),
        cpm: p.cpm == null ? '—' : `${formaterDecimal(p.cpm, 2)} €`, impressions: nombre(p.impressions),
      })),
      budget: fmtEUR(t.budget),
      impressions: nombre(t.impressions),
      cpm: t.cpmMoyen == null ? '—' : `${formaterDecimal(t.cpmMoyen, 2)} €`,
      periode: `${fmtDateShort(d.startDate)} → ${fmtDateShort(d.endDate)}`,
    };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.abonnement?.unsubscribe());
  }

  protected lancer(): void {
    const demande = this.etat().demande;
    if (!demande || this.enCours()) return;
    const impressions = this.plan.totaux().impressions;
    this.enCours.set(true);
    this.abonnement = lancerCampagne(this.api, demande).subscribe({
      next: (r) => {
        const message = messageLancement(r, impressions);
        this.notifications.success('Campagne créée', message);
        if (this.plan.campagne() !== demande.campagne) return;
        this.plan.apresLancement(r.strategie, demande.identite);
        this.lance.set(message);
      },
      error: (e: unknown) => {
        this.enCours.set(false);
        if (e instanceof EchecLancement) this.notifications.error(e.titre, e.message);
        else this.notifications.error('Lancement impossible', 'Une erreur inattendue est survenue.');
      },
      complete: () => this.enCours.set(false),
    });
  }
}
