import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { formaterDecimal, formaterNombre } from '../../../../core/format/nombre';
import { BandeauKpiComponent } from '../../../../ui/bandeau-kpi/bandeau-kpi.component';
import { KpiComponent } from '../../../../ui/kpi/kpi.component';
import { Cellule, EnteteCellule } from '../../../../ui/tableau/cellules';
import { PlanCampagneService } from '../../etat/plan-campagne.service';
import { nombreUnites } from '../../logique/jeu/ecran';
import type { Plateforme } from '../../logique/jeu/plateformes';
import { fmtEUR } from '../../logique/plan/brouillon';
import { resolveChannelAvailability } from '../../logique/plan/canaux';
import { repartitionParCp } from '../../logique/plan/impressions';
import { CANAL_DE_PLATEFORME } from '../../logique/plan/plateformes-canaux';
import { lireMontant, poserMontant } from '../../logique/plan/saisie';
import { ENCART_ERREUR } from '../analyse/styles-analyse';
import { SAISIE_MONTANT } from './styles-plan';

/** Les lignes d'une répartition par CP affichées avant « Voir tout » (A-11). */
export const LIGNES_CP_VISIBLES = 50;

/** Le code `plateformes_geo` d'un canal (l'inverse de `CANAL_DE_PLATEFORME`, A-5) : la clé du résumé et de la route CP. */
const PLATEFORME_DE_CANAL = new Map(Object.entries(CANAL_DE_PLATEFORME).map(([p, c]) => [c, p as Plateforme]));

/** « 7,25 € » ; `—` sans valeur. */
const euros2 = (n: number | null) => (n == null ? '—' : `${formaterDecimal(n, 2)} €`);

/** Le libellé d'un code de canal, lu dans le catalogue des canaux de la campagne (le code à défaut). */
function libellesCanaux(plan: PlanCampagneService) {
  return computed(() => {
    const c = plan.canaux();
    return new Map((c ? resolveChannelAvailability(c.catalog, c.connectedProviders, c.is_demo) : []).map((r) => [r.code, r.label]));
  });
}

/**
 * ⑥ Plan — la section « Impressions prévues » (lot 6, T5 ; A-10, A-11) : remplace le `ForecastStrip` de React (sans
 * audience ni « % France », qui reposaient sur le panier de zones, A-9). Une ligne par plateforme cochée : son budget
 * (repris de la section Plateformes, lecture seule), son CPM prévu (€, saisi ici), ses impressions prévues — budget ÷
 * CPM × 1 000, un `computed` du service (`previsions`), jamais recopié —, la maille et le nombre d'unités de
 * l'extraction. « Voir par CP » pour une plateforme qui achète au code postal : ses CP lus AU CLIC (A-11, mis en cache
 * par le service), répartis par la formule de `planned_share` ; 50 lignes puis « Voir tout ». Une ligne de total :
 * budget, impressions, CPM moyen pondéré — les valeurs mêmes que le lancement envoie (`totaux`).
 */
@Component({
  selector: 'mg-section-impressions',
  imports: [Cellule, EnteteCellule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-3', 'data-section-impressions': '' },
  template: `
    <p class="m-0 text-[13px] leading-[1.6] text-secondary">
      Saisis le CPM prévu de chaque plateforme : ses impressions prévues valent budget ÷ CPM × 1 000. Ce sont elles que l’étape ⑧ comparera au livré.
    </p>
    @if (lignes().length === 0) {
      <div data-aucune-plateforme class="text-[12px] text-tertiary">Coche au moins une plateforme en section Plateformes et budget.</div>
    }
    @for (l of lignes(); track l.code) {
      <div [attr.data-prevision]="l.code" class="flex flex-col gap-2 rounded-[8px] border-fin border-subtle px-3 py-2.5">
        <div class="flex items-center gap-3">
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="text-[13px] font-medium text-primary">{{ l.libelle }}</span>
            <span data-maille class="text-[11px] text-tertiary">{{ l.maille }}</span>
          </span>
          <label class="inline-flex items-center gap-1.5">
            <span class="text-[11px] text-tertiary">CPM prévu</span>
            <input type="number" min="0" step="0.1" data-cpm [class]="saisieMontant + ' !w-[84px]'" placeholder="CPM" [attr.aria-label]="'CPM prévu ' + l.libelle + ' (€)'"
                   [value]="l.cpm ?? ''" (input)="poserCpm(l.code, $event)" />
            <span class="font-mono text-[12px] text-tertiary">€</span>
          </label>
        </div>
        <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-tertiary">
          <span>Budget <span data-budget-ligne class="font-mono text-secondary">{{ l.budget }}</span></span>
          <span>Impressions prévues <span data-impressions-ligne class="font-mono text-primary">{{ l.impressions }}</span></span>
          @if (l.auCp && l.chiffree) {
            <button type="button" data-voir-cp (click)="basculerCp(l.code)"
                    class="ml-auto cursor-pointer border-0 bg-transparent p-0 text-[11px] text-primary underline decoration-teal underline-offset-2">{{ l.ouvert ? 'Masquer' : 'Voir par CP' }}</button>
          }
        </div>
        @if (l.ouvert) {
          @if (l.erreur; as e) { <div role="alert" [class]="encartErreur">{{ e }}</div> }
          @else if (!l.cps) { <div class="font-mono text-[11px] text-tertiary">Lecture des codes postaux…</div> }
          @else {
            <div class="max-h-[320px] overflow-auto">
              <table [attr.data-tableau-cp]="l.code" class="w-full border-collapse">
                <thead><tr class="border-b-fin border-default">
                  <th mgTh alignement="gauche">Code postal</th>
                  <th mgTh explication="Multiplicateur de l’extraction : la part du CP vaut ce poids ÷ la somme des poids des CP de la plateforme">Poids</th>
                  <th mgTh>Impressions</th>
                </tr></thead>
                <tbody>
                  @for (c of l.cps.visibles; track c.code_postal) {
                    <tr class="border-b-fin border-subtle"><td mgTd alignement="gauche">{{ c.code_postal }}</td><td mgTd>{{ c.poids }}</td><td mgTd>{{ c.impressions }}</td></tr>
                  }
                </tbody>
              </table>
            </div>
            @if (l.cps.reste > 0) {
              <button type="button" data-voir-tout (click)="voirTout(l.code)"
                      class="cursor-pointer self-start border-0 bg-transparent p-0 text-[11px] text-primary underline decoration-teal underline-offset-2">Voir tout ({{ l.cps.total }})</button>
            }
          }
        }
      </div>
    }
    @if (lignes().length > 0) {
      <div data-total-prevu class="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t-fin border-subtle px-0.5 pt-2.5 text-[11px] text-tertiary">
        <span>Total</span>
        <span>Budget <span data-total-budget class="font-mono text-[13px] text-primary">{{ total().budget }}</span></span>
        <span>Impressions <span data-total-impressions class="font-mono text-[13px] text-primary">{{ total().impressions }}</span></span>
        <span>CPM moyen <span data-total-cpm class="font-mono text-[13px] text-primary">{{ total().cpm }}</span></span>
      </div>
      @if (manquants(); as m) { <div data-cpm-manquant role="status" class="text-[11px] text-secondary">{{ m }}</div> }
    }
  `,
})
export class SectionImpressionsComponent {
  private readonly plan = inject(PlanCampagneService);

  protected readonly saisieMontant = SAISIE_MONTANT;
  protected readonly encartErreur = ENCART_ERREUR;

  /** Les plateformes dont la répartition par CP est dépliée, et celles montrées en entier. */
  private readonly ouverts = signal<ReadonlySet<string>>(new Set());
  private readonly entiers = signal<ReadonlySet<string>>(new Set());
  private readonly libelles = libellesCanaux(this.plan);

  protected readonly lignes = computed(() => {
    const x = this.plan.extraction();
    const jeu = this.plan.brouillon().jeuZones;
    return this.plan.previsions().map((p) => {
      const plateforme = PLATEFORME_DE_CANAL.get(p.code);
      const resume = x?.plateformes?.find((r) => r.plateforme === plateforme);
      const auCp = resume?.maille === 'cp' && !!jeu && !!x && !!plateforme;
      const ouvert = auCp && this.ouverts().has(p.code);
      const lus = ouvert ? this.plan.cpDe(jeu!.id, x!.version, plateforme) : null;
      const reparties = lus ? repartitionParCp(p.impressions, lus.cp) : null;
      const limite = this.entiers().has(p.code) ? Infinity : LIGNES_CP_VISIBLES;
      return {
        code: p.code,
        libelle: this.libelles().get(p.code) ?? p.code,
        budget: fmtEUR(p.budget),
        cpm: p.cpm,
        impressions: p.impressions == null ? '—' : formaterNombre(p.impressions),
        chiffree: p.impressions != null,
        maille: resume ? nombreUnites(resume.n_unites ?? 0, resume.maille) : x ? 'Hors de l’extraction' : '—',
        auCp,
        ouvert,
        erreur: ouvert ? this.plan.erreurCp(jeu!.id, x!.version, plateforme) : null,
        cps: reparties && {
          visibles: reparties.slice(0, limite).map((c) => ({ code_postal: c.code_postal, poids: formaterDecimal(c.multiplicateur, 3), impressions: formaterNombre(c.impressions) })),
          reste: Math.max(0, reparties.length - limite),
          total: formaterNombre(reparties.length),
        },
      };
    });
  });

  protected readonly total = computed(() => {
    const t = this.plan.totaux();
    return { budget: fmtEUR(t.budget), impressions: t.impressions == null ? '—' : formaterNombre(t.impressions), cpm: euros2(t.cpmMoyen) };
  });

  protected readonly manquants = computed(() => {
    const m = this.plan.totaux().cpmManquants;
    return m.length ? `CPM prévu manquant : ${m.map((c) => this.libelles().get(c) ?? c).join(', ')}` : null;
  });

  protected poserCpm(code: string, e: Event): void {
    const v = lireMontant((e.target as HTMLInputElement).value);
    this.plan.modifier((d) => poserMontant(d, 'cpmPrevus', code, v));
  }

  /** « Voir par CP » : les CP de la plateforme sont lus au premier clic, une fois (A-11). */
  protected basculerCp(code: string): void {
    const ouvert = !this.ouverts().has(code);
    this.ouverts.update((s) => bascule(s, code, ouvert));
    const jeu = this.plan.brouillon().jeuZones;
    const x = this.plan.extraction();
    const plateforme = PLATEFORME_DE_CANAL.get(code);
    if (ouvert && jeu && x && plateforme) this.plan.chargerCp(jeu.id, x.version, plateforme);
  }

  protected voirTout(code: string): void {
    this.entiers.update((s) => bascule(s, code, true));
  }
}

function bascule(s: ReadonlySet<string>, code: string, present: boolean): ReadonlySet<string> {
  const suite = new Set(s);
  if (present) suite.add(code);
  else suite.delete(code);
  return suite;
}

/**
 * ⑥ Plan — le bandeau de l'étape (lot 6, T5) : budget, impressions prévues, CPM moyen pondéré, plateformes cochées et
 * codes postaux au plan. Les trois premiers sont les `totaux` du service — ceux de la section Impressions et du
 * lancement. « CP au plan » = les CP que `rattacher` écrira (`multiplicateur > 0`) : lus une fois par extraction, dès
 * qu'elle est connue (une lecture indexée, ≤ 7 000 lignes, mise en cache par le service).
 */
@Component({
  selector: 'mg-bandeau-plan',
  imports: [BandeauKpiComponent, KpiComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-bandeau-plan': '' },
  template: `
    <mg-bandeau-kpi>
      <mg-kpi data-kpi="budget" [taille]="22" [valeur]="budget()" libelle="Budget prévu" note="somme des plateformes" />
      <mg-kpi data-kpi="impressions" [taille]="22" [valeur]="impressions()" libelle="Impressions prévues" note="budget ÷ CPM × 1 000" accent />
      <mg-kpi data-kpi="cpm" [taille]="22" [valeur]="cpm()" libelle="CPM moyen" note="pondéré par les impressions" />
      <mg-kpi data-kpi="plateformes" [taille]="22" [valeur]="plateformes()" libelle="Plateformes" note="cochées" />
      <mg-kpi data-kpi="cp" [taille]="22" [valeur]="cp()" libelle="CP au plan" note="de l’extraction choisie" />
    </mg-bandeau-kpi>
  `,
})
export class BandeauPlanComponent {
  private readonly plan = inject(PlanCampagneService);

  protected readonly budget = computed(() => fmtEUR(this.plan.totaux().budget));
  protected readonly impressions = computed(() => {
    const n = this.plan.totaux().impressions;
    return n == null ? '—' : formaterNombre(n);
  });
  protected readonly cpm = computed(() => euros2(this.plan.totaux().cpmMoyen));
  protected readonly plateformes = computed(() => formaterNombre(this.plan.previsions().length));
  protected readonly cp = computed(() => {
    const jeu = this.plan.brouillon().jeuZones;
    const x = this.plan.extraction();
    const lus = jeu && x ? this.plan.cpDe(jeu.id, x.version) : null;
    return lus ? formaterNombre(lus.total) : '—';
  });

  private readonly jeu = computed(() => this.plan.brouillon().jeuZones?.id ?? null);

  constructor() {
    // P-a : l'effet LIT l'extraction connue ; la lecture (une par extraction, le service ignore une relecture) part hors suivi.
    effect(() => {
      const jeu = this.jeu();
      const x = this.plan.extraction();
      if (jeu && x) untracked(() => this.plan.chargerCp(jeu, x.version));
    });
  }
}
