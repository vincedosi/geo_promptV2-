import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { type OrganisationsCampagne, PlanApi } from '../../data/plan.api';
import { LectureAnnulable } from '../../etat/lecture-annulable';
import { PlanCampagneService, messageErreurCampagnes } from '../../etat/plan-campagne.service';
import type { ProgDraft } from '../../logique/plan/brouillon';
import { LIBELLE_CHAMP } from '../analyse/styles-analyse';
import { SourcePlanComponent } from './source-plan.component';
import { SAISIE } from './styles-plan';

/** Les trois champs d'identité de la campagne, persistés au lancement (PATCH) s'ils ont changé. */
type ChampIdentite = 'name' | 'advertiser' | 'product';

/**
 * ⑥ Plan — la section Cible (lot 6, T4) : la partie IDENTITÉ de `StepCible` (`components/campaign/wizard/steps/
 * StepCible.tsx`) — nom, annonceur, produit, textes et indications repris à la lettre — et les organisations de la
 * campagne (`GET /api/admin/campaigns/[id]/organizations`, en lecture seule ; React ne s'en servait que pour sa
 * galerie de zones), puis la source du plan (`mg-source-plan`, l'extraction). Le panier de zones et l'indicateur à
 * seuil ne sont PAS portés (A-9) : ils n'existaient que pour une courbe d'enchère, hors V1.
 *
 * Chaque frappe passe par `PlanCampagneService.modifier` (brouillon autosauvé, jamais muté). Les organisations sont
 * lues une fois par campagne, APRÈS son préremplissage (une requête à la fois avec la liste des jeux de la source).
 */
@Component({
  selector: 'mg-section-cible',
  imports: [SourcePlanComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4', 'data-section-cible': '' },
  template: `
    <label class="flex flex-col">
      <span [class]="libelleChamp">Nom de la campagne</span>
      <input type="text" data-champ="name" [class]="saisie" placeholder="Nom affiché partout (sélecteur, suivi, exports)"
             [value]="brouillon().name" [disabled]="!plan.prerempli()" (input)="saisir('name', $event)" />
    </label>
    <div class="grid grid-cols-2 gap-3">
      <label class="flex flex-col">
        <span [class]="libelleChamp">Annonceur</span>
        <input type="text" data-champ="advertiser" [class]="saisie" placeholder="Marque ou société annonceur"
               [value]="brouillon().advertiser" [disabled]="!plan.prerempli()" (input)="saisir('advertiser', $event)" />
      </label>
      <label class="flex flex-col">
        <span [class]="libelleChamp">Produit</span>
        <input type="text" data-champ="product" [class]="saisie" placeholder="Produit ou offre mis en avant"
               [value]="brouillon().product" [disabled]="!plan.prerempli()" (input)="saisir('product', $event)" />
      </label>
    </div>
    <div class="flex flex-col" data-organisations>
      <span [class]="libelleChamp">Organisations de la campagne</span>
      @if (organisations.enCours()) { <span class="font-mono text-[11px] text-tertiary">Chargement…</span> }
      @if (organisations.erreur(); as e) { <span role="alert" class="text-[11px] text-danger">{{ e }}</span> }
      @if (nomsOrganisations(); as noms) { <span data-noms-organisations class="text-[12px] text-secondary">{{ noms }}</span> }
    </div>
    <mg-source-plan />
  `,
})
export class SectionCibleComponent {
  protected readonly plan = inject(PlanCampagneService);
  private readonly api = inject(PlanApi);

  protected readonly libelleChamp = LIBELLE_CHAMP;
  protected readonly saisie = SAISIE;
  protected readonly brouillon = this.plan.brouillon;

  protected readonly organisations = new LectureAnnulable<OrganisationsCampagne>(messageErreurCampagnes);
  /** « Espace A (propriétaire) · Espace B » ; « Aucune » si la campagne n'est liée à aucune. */
  protected readonly nomsOrganisations = computed(() => {
    const r = this.organisations.resultat();
    if (!r) return null;
    return r.organizations.length === 0 ? 'Aucune' : r.organizations.map((o) => (o.is_owner ? `${o.name} (propriétaire)` : o.name)).join(' · ');
  });

  constructor() {
    // P-a : l'effet LIT la campagne et la fin de son préremplissage ; la lecture part hors suivi, une fois par campagne.
    let lue: string | null = null;
    effect(() => {
      const id = this.plan.campagne();
      const pret = this.plan.prerempli() && !this.plan.accesRefuse();
      untracked(() => {
        if (id === lue) return;
        // Une autre campagne : celles de la précédente disparaissent tout de suite, la lecture attend le préremplissage.
        this.organisations.perimer();
        if (!id || !pret) return;
        lue = id;
        this.organisations.lancer(this.api.organisationsCampagne(id));
      });
    });
  }

  protected saisir(champ: ChampIdentite, e: Event): void {
    const valeur = (e.target as HTMLInputElement).value;
    this.plan.modifier((d): ProgDraft => ({ ...d, [champ]: valeur }));
  }
}
