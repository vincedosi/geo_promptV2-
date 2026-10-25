import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { EnteteSectionComponent } from '../../../../ui/entete-section/entete-section.component';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { PlanCampagneService } from '../../etat/plan-campagne.service';
import { draftTotalBudget, fmtDateShort, fmtEUR } from '../../logique/plan/brouillon';
import { ENCART_ERREUR } from '../analyse/styles-analyse';
import { HallCampagnesComponent } from './hall-campagnes.component';
import { SectionCibleComponent } from './section-cible.component';

/** Les trois sections du panneau, de haut en bas. */
type SectionPlan = 'cible' | 'plateformes' | 'impressions';

/**
 * Le numéro d'« étape » que chaque section envoie au brouillon (A-2 : la section dépliée la plus basse), dans la
 * numérotation du wizard React (`PROG_STEP_ORDER` : cible 1, canaux 2…) — un brouillon repris de l'autre côté rouvre
 * au même endroit. « Impressions prévues » est le `ForecastStrip` de l'étape Canaux de React : 2 aussi.
 */
const ETAPE_DE_SECTION: Readonly<Record<SectionPlan, number>> = { cible: 1, plateformes: 2, impressions: 2 };
const ORDRE_SECTIONS: readonly SectionPlan[] = ['cible', 'plateformes', 'impressions'];

/**
 * ⑥ Plan — le panneau de l'étape (lot 6, T3 ; spec § 19, V1 = contrôle des impressions et du budget dépensé). Port de
 * l'onglet « Stratégie » de `MagelianOverlay.tsx` replié en UNE étape à sections (A-6) :
 *
 * - sans `?campagne=` : le hall (`mg-hall-campagnes`), précédé du message d'une campagne introuvable dans cet espace
 *   (le service a retiré le paramètre, A-1) ;
 * - avec : « ← Choisir une autre campagne », l'en-tête « Création / Modification — <nom> » (Modification = une stratégie
 *   existe déjà), la bannière « Brouillon restauré (date) · Repartir de zéro », trois `mg-entete-section` repliables
 *   — Cible (T4), Plateformes et budget, Impressions prévues (T5) — et le pied (récapitulatif ; le lancement en T6).
 *   Une section repliée est MASQUÉE, pas détruite : ses lectures (jeux, versions, organisations) et ses choix restent.
 *
 * La note « Un filtre de carte est actif… » est portée telle quelle (A-8), lue dans l'état de la carte, sans requête.
 * Un refus de rôle (`accesRefuse`, campagnes réservées au super_admin en V1) est DIT et les sections ne s'affichent
 * pas : rien n'y serait enregistrable. Tout l'état vit dans `PlanCampagneService` (page) ; le panneau reste monté (A1).
 */
@Component({
  selector: 'mg-panneau-plan',
  imports: [EnteteSectionComponent, HallCampagnesComponent, IconeComponent, SectionCibleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col', 'data-panneau-plan': '' },
  template: `
    @if (!plan.campagne()) {
      @if (plan.erreur(); as e) { <div data-erreur-plan role="alert" [class]="'mx-4 mt-3 ' + encartErreur">{{ e }}</div> }
      <mg-hall-campagnes />
    } @else {
      <div class="flex items-baseline gap-3 px-4 pb-3 pt-3">
        <button type="button" data-retour-hall (click)="plan.choisirCampagne(null)"
                class="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[12px] text-tertiary hover:text-primary">← Choisir une autre campagne</button>
        <span data-titre-plan class="min-w-0 truncate text-[13px] font-medium text-primary">{{ titre() }}</span>
      </div>
      <!-- A-8 : comme React, campagne ouverte seulement, sous l'en-tête (relecture 2, M-1). -->
      @if (etat.filtre()) {
        <div data-note-filtre class="mx-4 mb-3 flex items-start gap-2 rounded-[6px] border-fin border-default bg-elevated px-3 py-2.5">
          <mg-icone nom="info" [taille]="14" [trait]="1.5" class="mt-px shrink-0 text-teal" />
          <span class="text-[12px] leading-[1.5] text-secondary">Un filtre de carte est actif. Il ne s’applique pas à cette stratégie : une stratégie couvre toute la campagne.</span>
        </div>
      }
      @if (plan.erreur(); as e) { <div data-erreur-plan role="alert" [class]="'mx-4 mb-3 ' + encartErreur">{{ e }}</div> }
      @if (!plan.accesRefuse()) {
        @if (plan.restaure(); as r) {
          <div data-brouillon-restaure class="mx-4 mb-2.5 flex items-center gap-2.5 rounded-[6px] border-fin border-subtle px-3 py-1.5 text-[12px] text-secondary">
            Brouillon restauré ({{ dateRestauration() }})
            <button type="button" data-repartir-de-zero (click)="plan.repartirDeZero()"
                    class="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-primary underline decoration-teal underline-offset-2">Repartir de zéro</button>
          </div>
        }
        @if (!plan.prerempli()) { <div data-chargement-plan class="px-4 pb-3 font-mono text-[11px] text-tertiary">Chargement de la campagne…</div> }

        <mg-entete-section data-section="cible" libelle="Cible" repliable [ouvert]="ouvertes().cible" (ouvertChange)="basculer('cible', $event)" />
        <mg-section-cible data-corps-section="cible" class="px-4 py-3" [class.hidden]="!ouvertes().cible" />
        <mg-entete-section data-section="plateformes" libelle="Plateformes et budget" repliable [ouvert]="ouvertes().plateformes" (ouvertChange)="basculer('plateformes', $event)" />
        <div data-corps-section="plateformes" class="flex flex-col gap-3 px-4 py-3" [class.hidden]="!ouvertes().plateformes"></div>
        <mg-entete-section data-section="impressions" libelle="Impressions prévues" repliable [ouvert]="ouvertes().impressions" (ouvertChange)="basculer('impressions', $event)" />
        <div data-corps-section="impressions" class="flex flex-col gap-3 px-4 py-3" [class.hidden]="!ouvertes().impressions"></div>

        <div data-pied-plan class="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-subtle px-4 py-3 text-[12px] text-secondary">
          <span>Budget prévu <span data-recap-budget class="font-mono text-primary">{{ budget() }}</span></span>
          <span>Période <span data-recap-periode class="font-mono text-primary">{{ periode() }}</span></span>
          @if (plan.sauveLe()) { <span data-sauve class="ml-auto text-[11px] text-tertiary">Brouillon enregistré</span> }
        </div>
      }
    }
  `,
})
export class PanneauPlanComponent {
  protected readonly plan = inject(PlanCampagneService);
  protected readonly etat = inject(EtatCarteService);
  protected readonly encartErreur = ENCART_ERREUR;

  /** Les sections dépliées : locales à l'écran, jamais dans l'URL ; toutes ouvertes par défaut. */
  protected readonly ouvertes = signal<Readonly<Record<SectionPlan, boolean>>>({ cible: true, plateformes: true, impressions: true });

  protected readonly titre = computed(() => {
    const mode = this.plan.strategieExistante() ? 'Modification' : 'Création';
    const nom = this.plan.detail()?.name;
    return nom ? `${mode} — ${nom}` : mode;
  });
  /** `toLocaleString('fr-FR')`, comme la bannière de `CampaignCockpit`. */
  protected readonly dateRestauration = computed(() => {
    const r = this.plan.restaure();
    return r ? new Date(r.savedAt).toLocaleString('fr-FR') : '';
  });
  protected readonly budget = computed(() => fmtEUR(draftTotalBudget(this.plan.brouillon())));
  protected readonly periode = computed(() => {
    const d = this.plan.brouillon();
    return `${fmtDateShort(d.startDate)} → ${fmtDateShort(d.endDate)}`;
  });

  /** Un bandeau replié ou déplié : l'étape du brouillon devient la section dépliée la plus basse (A-2). */
  protected basculer(section: SectionPlan, ouvert: boolean): void {
    const suivantes = { ...this.ouvertes(), [section]: ouvert };
    this.ouvertes.set(suivantes);
    const basse = [...ORDRE_SECTIONS].reverse().find((s) => suivantes[s]);
    this.plan.definirEtape(basse ? ETAPE_DE_SECTION[basse] : ETAPE_DE_SECTION.cible);
  }
}
