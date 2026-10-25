import { ChangeDetectionStrategy, Component, computed, inject, model } from '@angular/core';
import { PlanCampagneService } from '../../etat/plan-campagne.service';
import { NOM_PLATEFORME, nombreUnites } from '../../logique/jeu/ecran';
import { fmtEUR, linksSelectionHash } from '../../logique/plan/brouillon';
import type { ResolvedChannel } from '../../logique/plan/canaux';
import type { PlatformLinks } from '../../logique/plan/liens-plateformes';
import { preselectionDepuisExtraction, resumeDuCanal } from '../../logique/plan/plateformes-canaux';
import { basculerPlateforme, lireMontant, poserMontant } from '../../logique/plan/saisie';
import { LIBELLE_CHAMP } from '../analyse/styles-analyse';
import { LiaisonCanalComponent } from './liaison-canal.component';
import { RecapCanauxComponent } from './recap-canaux.component';
import { SAISIE, SAISIE_MONTANT } from './styles-plan';

type Liste = 'dsps' | 'socials';

/**
 * ⑥ Plan — la section « Plateformes et budget » (lot 6, T5) : port de `StepCanaux.tsx` SANS le bloc « Ad server
 * (mesure) » ni `AbsorbPanel` (hors V1, spec § 19). Plateformes DSP et réseaux filtrées aux connexions de l'espace
 * (toutes en démo) ; une ligne € par plateforme cochée, le budget global n'en est que la somme (lecture seule) ;
 * l'accordéon de liaison sous chaque plateforme cochée (⑦ pousse le ciblage et ⑧ lit les rapports par ces liaisons) ;
 * le récapitulatif du câblage et sa coche « Je confirme ces liaisons », RÉINITIALISÉE dès que la sélection ou une
 * liaison change (`linksSelectionHash`) ; la période.
 *
 * A-5 : l'extraction choisie en section Cible a PRÉ-COCHÉ ses plateformes ; en face de chacune, sa maille et son taux
 * d'utile (lecture seule). Une plateforme de l'extraction sans canal (« non reliée ») ou indisponible est dite.
 *
 * Le catalogue vient du préremplissage (`PlanCampagneService.canaux`, aucune requête ici). La coche vit dans le panneau
 * (`confirmation`, l'empreinte confirmée) : le pied de lancement la lit. Écarts à React : les lignes sont des cases à
 * cocher (`role="checkbox"`, React disait `radio` d'une sélection multiple) ; décocher retire budget et CPM prévu
 * (`basculerPlateforme`) ; le lead est le mémo de React, sans la phrase sur le pacing (hors V1).
 */
@Component({
  selector: 'mg-section-plateformes',
  imports: [LiaisonCanalComponent, RecapCanauxComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4', 'data-section-plateformes': '' },
  template: `
    <p class="m-0 text-[13px] leading-[1.6] text-secondary">
      Le <strong class="font-medium text-primary">« où ça tourne »</strong> et le <strong class="font-medium text-primary">« combien »</strong> :
      chaque plateforme cochée porte sa ligne de budget. Le global n’est que la somme.
    </p>

    @if (!plan.canaux()) {
      @if (!plan.prerempli()) { <div class="text-[12px] text-tertiary">Chargement…</div> }
    } @else if (disponibles().length === 0) {
      <div data-aucun-canal class="text-[13px] text-tertiary">Aucun canal connecté. Configure une connexion dans Administration → Système → Connexions API.</div>
    } @else {
      @if (horsCatalogue(); as h) { <div data-hors-catalogue role="status" class="text-[11px] leading-[1.5] text-secondary">{{ h }}</div> }
      @for (g of groupes(); track g.liste) {
        <div class="flex flex-col" [attr.data-groupe]="g.liste">
          <span [class]="libelleChamp">{{ g.titre }}</span>
          <div class="flex flex-col gap-2">
            @for (r of g.lignes; track r.canal.code) {
              <div role="checkbox" tabindex="0" [attr.aria-checked]="r.cochee" [attr.data-plateforme]="r.canal.code"
                   (click)="basculer(g.liste, r.canal.code)" (keydown.enter)="basculer(g.liste, r.canal.code)"
                   (keydown.space)="basculer(g.liste, r.canal.code); $event.preventDefault()"
                   class="flex cursor-pointer items-center gap-3 rounded-[8px] border-fin px-3.5 py-3 transition-[border-color,background-color] duration-150"
                   [class]="r.cochee ? 'border-teal bg-[color-mix(in_srgb,var(--brand-teal)_7%,transparent)]' : 'border-subtle hover:border-hover hover:bg-elevated'">
                <span aria-hidden="true" class="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border-fin"
                      [class]="r.cochee ? 'border-teal' : 'border-default'">
                  @if (r.cochee) { <span class="h-[7px] w-[7px] rounded-full bg-teal"></span> }
                </span>
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="text-[13px] font-medium text-primary">{{ r.canal.label }}</span>
                  <span class="text-[11px] text-tertiary">{{ g.sous }}</span>
                  @if (r.extraction) { <span data-maille-extraction class="font-mono text-[10.5px] text-secondary">{{ r.extraction }}</span> }
                </span>
                @if (r.cochee) {
                  <span class="inline-flex items-center gap-1.5" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
                    <input type="number" min="0" step="100" data-budget [class]="saisieMontant" placeholder="budget" aria-label="Budget de la plateforme (€)"
                           [value]="r.budget ?? ''" (input)="poserBudget(r.canal.code, $event)" />
                    <span class="font-mono text-[12px] text-tertiary">€</span>
                  </span>
                } @else {
                  <span class="rounded-[4px] border-fin px-2 py-0.5 text-[10px]"
                        [class]="r.canal.connected ? 'border-teal text-primary' : 'border-default text-tertiary'">{{ r.canal.connected ? 'connecté' : 'démo' }}</span>
                }
              </div>
              @if (r.cochee && (r.canal.link_levels?.length ?? 0) > 0) {
                <mg-liaison-canal [canal]="r.canal" [campagne]="campagne()" [liens]="brouillon().channelLinks[r.canal.code]"
                                  (changement)="poserLiens(r.canal.code, $event)" />
              }
            } @empty {
              <div class="text-[12px] text-tertiary">{{ g.vide }}</div>
            }
          </div>
        </div>
      }

      <div class="flex items-center justify-between border-t-fin border-subtle px-0.5 pt-2.5">
        <span class="text-[11px] text-tertiary">Budget global (somme)</span>
        <span data-budget-global class="font-mono text-[15px] text-primary">{{ budgetGlobal() }}</span>
      </div>

      @if (selection()) {
        <div class="flex flex-col">
          <span [class]="libelleChamp">Récapitulatif du câblage</span>
          <mg-recap-canaux [brouillon]="brouillon()" [catalogue]="catalogue()" />
          <label class="mt-2.5 flex cursor-pointer items-center gap-2 text-[12.5px] text-primary">
            <input type="checkbox" data-confirmer-liaisons class="accent-[var(--brand-teal)]" [checked]="confirmee()"
                   (change)="confirmation.set($any($event.target).checked ? empreinte() : null)" />
            Je confirme ces liaisons
          </label>
        </div>
      }

      <div class="flex flex-col">
        <span [class]="libelleChamp">Période</span>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex flex-col">
            <span class="mb-1.5 text-[10px] text-tertiary">Début</span>
            <input type="date" data-debut [class]="saisie + ' font-mono'" [value]="brouillon().startDate" (input)="poserDate('startDate', $event)" />
          </label>
          <label class="flex flex-col">
            <span class="mb-1.5 text-[10px] text-tertiary">Fin</span>
            <input type="date" data-fin [class]="saisie + ' font-mono'" [value]="brouillon().endDate" (input)="poserDate('endDate', $event)" />
          </label>
        </div>
      </div>
    }
  `,
})
export class SectionPlateformesComponent {
  protected readonly plan = inject(PlanCampagneService);

  /** L'empreinte (`linksSelectionHash`) que l'utilisateur a confirmée ; tenue par le panneau, lue par le pied. */
  readonly confirmation = model<string | null>(null);

  protected readonly libelleChamp = LIBELLE_CHAMP;
  protected readonly saisie = SAISIE;
  protected readonly saisieMontant = SAISIE_MONTANT;
  protected readonly brouillon = this.plan.brouillon;
  protected readonly campagne = computed(() => this.plan.campagne() ?? '');

  protected readonly catalogue = computed((): readonly ResolvedChannel[] => this.plan.catalogue() ?? []);
  protected readonly disponibles = computed(() => this.catalogue().filter((c) => c.available));
  protected readonly selection = computed(() => this.brouillon().channels.dsps.length + this.brouillon().channels.socials.length > 0);
  protected readonly empreinte = computed(() => linksSelectionHash(this.brouillon().channels, this.brouillon().channelLinks));
  protected readonly confirmee = computed(() => this.confirmation() === this.empreinte());
  /**
   * Le budget global : `totaux().budget` du service, celui du bandeau, du pied et du PATCH (F-2). `draftTotalBudget`
   * (React) donne la même somme ; il reste porté et verrouillé par le test de parité.
   */
  protected readonly budgetGlobal = computed(() => fmtEUR(this.plan.totaux().budget));

  /** A-5 : la maille et le taux d'utile de la plateforme d'un canal dans l'extraction (un jeu risque : au CP, V-7). */
  private resumeExtraction(code: string): string | null {
    const r = resumeDuCanal(this.plan.extraction(), code);
    if (!r) return null;
    const utile = r.utile && (r.utile === 'exacte' ? r.utile : `${r.utile} d’utile`);
    return ['Extraction : ' + nombreUnites(r.nUnites, r.maille), utile].filter(Boolean).join(' · ');
  }

  /** Les plateformes de l'extraction qui ne se cochent pas : sans canal, ou ni connectées ni en démo. */
  protected readonly horsCatalogue = computed(() => {
    const x = this.plan.extraction();
    if (!x?.plateformes || this.catalogue().length === 0) return null;
    const { nonRelies, indisponibles } = preselectionDepuisExtraction(x.plateformes, this.catalogue(), this.brouillon().channels);
    const nom = (p: string) => NOM_PLATEFORME[p as keyof typeof NOM_PLATEFORME] ?? p;
    const phrases = [
      nonRelies.length ? `Non reliées à un canal : ${nonRelies.map(nom).join(', ')}.` : '',
      indisponibles.length ? `Ni connectées ni en démo : ${indisponibles.map(nom).join(', ')}.` : '',
    ].filter(Boolean);
    return phrases.length ? `Plateformes de l’extraction non cochées. ${phrases.join(' ')}` : null;
  });

  protected readonly groupes = computed(() => {
    const d = this.brouillon();
    const lignes = (cat: 'dsp' | 'social', liste: Liste) => this.disponibles().filter((c) => c.category === cat).map((canal) => ({
      canal,
      cochee: d.channels[liste].includes(canal.code),
      budget: (d.channelBudgets[canal.code] as number | undefined) ?? null,
      extraction: this.resumeExtraction(canal.code),
    }));
    return [
      { liste: 'dsps' as const, titre: 'DSP', sous: 'DSP', vide: 'Aucun DSP disponible.', lignes: lignes('dsp', 'dsps') },
      { liste: 'socials' as const, titre: 'Réseaux sociaux', sous: 'Social', vide: 'Aucun réseau disponible.', lignes: lignes('social', 'socials') },
    ];
  });

  protected basculer(liste: Liste, code: string): void {
    this.plan.modifier((d) => basculerPlateforme(d, liste, code));
  }

  protected poserBudget(code: string, e: Event): void {
    const v = lireMontant((e.target as HTMLInputElement).value);
    this.plan.modifier((d) => poserMontant(d, 'channelBudgets', code, v));
  }

  protected poserLiens(code: string, liens: PlatformLinks): void {
    this.plan.modifier((d) => ({ ...d, channelLinks: { ...d.channelLinks, [code]: liens } }));
  }

  protected poserDate(champ: 'startDate' | 'endDate', e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.plan.modifier((d) => ({ ...d, [champ]: v }));
  }
}
