import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { NotificationsComponent } from '../../../../ui/notifications/notifications.component';
import { etatLancement } from '../../etat/lancement-campagne';
import { LancementCampagneService, TITRE_CREATION, TITRE_MISE_A_JOUR } from '../../etat/lancement-campagne.service';
import { ParcoursService } from '../../etat/parcours.service';
import { PlanCampagneService } from '../../etat/plan-campagne.service';
import { fmtCpm, fmtDateShort, fmtEUR } from '../../logique/plan/brouillon';
import { ENCART_ERREUR } from '../analyse/styles-analyse';
import { CTA, TEXTE_SUCCES } from './styles-plan';

/** Le motif d'un bouton inactif parce qu'une AUTRE campagne est en cours de lancement. */
export const MOTIF_LANCEMENT_AILLEURS = 'Un lancement est en cours sur une autre campagne.';

/** Le bouton secondaire (« Modifier et relancer ») : contour neutre, texte secondaire. */
const SECONDAIRE = 'cursor-pointer rounded-[6px] border-fin border-default bg-transparent px-4 py-2.5 text-[13px] text-secondary transition-colors duration-150 hover:border-hover hover:text-primary';

/**
 * ⑥ Plan — le pied « Lancement » (lot 6, T6) : port de `StepLancement.tsx` réduit au chemin extraction (A-9), sans
 * fichiers custom bidding (spec § 19.4). Toujours visible sous les sections (A-6) :
 *
 * - le RÉCAPITULATIF — identité (et le renommage à venir), extraction, plateformes avec budget, CPM et impressions
 *   prévues, période, totaux (les `totaux` du service : ceux de la section Impressions et du PATCH) ;
 * - la VALIDITÉ (`etatLancement`, un `computed`) : chaque motif de blocage est DIT, le bouton reste inactif ;
 * - « Créer la campagne → » : DÉCLENCHE `LancementCampagneService` (fourni par la page, relecture 3) et AFFICHE son
 *   état — le pied peut être détruit en cours de séquence (autre campagne, autre étape), la séquence continue. Réussi :
 *   « ✓ Campagne créée » (« ✓ Plan mis à jour » si elle avait déjà un plan, V-5 ; le bouton dit alors « Mettre à jour
 *   le plan → »), « N CP au plan, dont M retenus · X % du plan en zone · Y % d'utile · Z impressions prévues »,
 *   « Préparer l'activation → ⑦ » et « Modifier et relancer » (relancer suit le même chemin, `rattacher` archive
 *   l'ancienne stratégie). Échec : le titre de l'étape et le message de la route, dans le pied ET en notification.
 *   L'issue s'affiche pour SA campagne seulement.
 */
@Component({
  selector: 'mg-pied-lancement',
  imports: [NotificationsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-2.5 border-t border-subtle px-4 py-3 text-[12px] text-secondary', 'data-pied-plan': '' },
  template: `
    <mg-notifications />
    @if (reussi(); as r) {
      <div data-lance class="flex flex-col gap-2">
        <span data-titre-lance class="text-[12px]" [class]="texteSucces">✓ {{ reussi()!.titre }}</span>
        <span data-message-lancement class="text-[12px] text-secondary">{{ r.message }}</span>
        <div class="flex flex-wrap gap-2">
          <button type="button" data-vers-activation [class]="cta" (click)="parcours.choisir('activation')">Préparer l’activation → ⑦</button>
          <button type="button" data-relancer [class]="secondaire" (click)="lancement.oublier(campagne())">Modifier et relancer</button>
        </div>
      </div>
    } @else {
      <div data-recap-lancement class="flex flex-col gap-1.5">
        <div><span class="text-[13px] font-medium text-primary">{{ recap().nom }}</span>&ngsp;<span class="text-[11.5px] text-tertiary">{{ recap().identite }}</span></div>
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
      @if (motifs().length > 0) {
        <ul data-motifs class="m-0 flex list-none flex-col gap-0.5 p-0 text-[11px] text-tertiary">
          @for (m of motifs(); track m) { <li>{{ m }}</li> }
        </ul>
      }
      @if (echec(); as e) { <div data-echec-lancement role="alert" [class]="encartErreur"><strong class="font-medium">{{ e.titre }}.</strong> {{ e.message }}</div> }
      <div class="flex items-center gap-3">
        <button type="button" data-lancer [class]="cta" [disabled]="!etat().demande || enCours()" (click)="lancer()">{{ libelleBouton() }}</button>
        @if (plan.sauveLe()) { <span data-sauve class="ml-auto text-[11px] text-tertiary">Brouillon enregistré</span> }
      </div>
    }
  `,
})
export class PiedLancementComponent {
  protected readonly plan = inject(PlanCampagneService);
  protected readonly parcours = inject(ParcoursService);
  protected readonly lancement = inject(LancementCampagneService);

  /** La coche « Je confirme ces liaisons » correspond à la sélection courante (section Plateformes). */
  readonly liaisonsConfirmees = input(false);

  protected readonly cta = `${CTA} px-4 py-2.5`;
  protected readonly secondaire = SECONDAIRE;
  protected readonly texteSucces = TEXTE_SUCCES;
  protected readonly encartErreur = ENCART_ERREUR;
  protected readonly campagne = computed(() => this.plan.campagne() ?? '');
  /** Une séquence est en vol (une seule à la fois, toutes campagnes confondues) : le bouton est inactif. */
  protected readonly enCours = this.lancement.enCours;
  /** La séquence en vol est celle de la campagne ouverte : « Création… » ne se lit que là (revue finale). */
  protected readonly enCoursIci = computed(() => this.enCours() && this.lancement.etat()?.campagne === this.plan.campagne());
  /** L'issue du dernier lancement, s'il porte sur la campagne ouverte. */
  private readonly issue = computed(() => {
    const e = this.lancement.etat();
    return e && e.campagne === this.plan.campagne() ? e : null;
  });
  protected readonly reussi = computed(() => {
    const e = this.issue();
    return e?.statut === 'reussi' ? { message: e.message, titre: e.miseAJour ? TITRE_MISE_A_JOUR : TITRE_CREATION } : null;
  });
  /** La campagne a déjà un plan (« Modification ») : le bouton met le plan à jour (revue finale, V-5). */
  private readonly miseAJour = computed(() => this.plan.strategieExistante() !== null);
  protected readonly libelleBouton = computed(() => {
    if (this.enCoursIci()) return this.miseAJour() ? 'Mise à jour…' : 'Création…';
    return this.miseAJour() ? 'Mettre à jour le plan →' : 'Créer la campagne →';
  });
  protected readonly echec = computed(() => {
    const e = this.issue();
    return e?.statut === 'echec' ? e : null;
  });

  private readonly libelle = this.plan.libelleCanal;

  protected readonly etat = computed(() => etatLancement({
    campagne: this.plan.campagne(),
    detail: this.plan.detail(),
    brouillon: this.plan.brouillon(),
    previsions: this.plan.previsions(),
    totaux: this.plan.totaux(),
    liaisonsConfirmees: this.liaisonsConfirmees(),
    libelle: this.libelle,
  }));

  /** Les motifs de blocage, et celui d'un lancement en vol sur une AUTRE campagne (un seul à la fois). */
  protected readonly motifs = computed(() => [
    ...this.etat().motifs,
    ...(this.enCours() && !this.enCoursIci() ? [MOTIF_LANCEMENT_AILLEURS] : []),
  ]);

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
        cpm: fmtCpm(p.cpm), impressions: nombre(p.impressions),
      })),
      budget: fmtEUR(t.budget),
      impressions: nombre(t.impressions),
      cpm: fmtCpm(t.cpmMoyen),
      periode: `${fmtDateShort(d.startDate)} → ${fmtDateShort(d.endDate)}`,
    };
  });

  protected lancer(): void {
    const demande = this.etat().demande;
    if (!demande) return;
    const x = this.plan.brouillon().jeuZones?.extraction;
    const cpAuPlan = x ? this.plan.cpDe(demande.jeu, x.version)?.canoniques ?? null : null;
    this.lancement.lancer(demande, this.plan.totaux().impressions, this.miseAJour(), cpAuPlan);
  }
}
