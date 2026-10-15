import { HttpResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { type Subscription, firstValueFrom } from 'rxjs';
import { ENREGISTRER_FICHIER } from '../../../../core/http/telecharger';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { type CampagnePlan, ZonesCustomApi } from '../../data/zones-custom.api';
import { ExportZoneService } from '../../etat/export-zone.service';
import { PlanMediaService } from '../../etat/plan-media.service';
import { CIBLE_GROUPS, CIBLE_UNIT, type CibleKey } from '../../logique/zones/cibles';
import { normalizeShares } from '../../logique/zones/media-plan';
import {
  calculerPlan, cellulesPlan, celluleTotal, corpsInstantane, corpsPlan, dateEnregistrement, formaterEntier, lireMontant, poidsDesItems,
} from '../../logique/zones/plan-media';
import { csvPlanMedia, nomFichierPlan } from '../../logique/zones/plan-media-csv';
import { messageHttp } from '../../logique/zones/zones-affichees';
import { TableauPlanMediaComponent } from './tableau-plan-media.component';

/** Largeur du panneau (`PANEL_WIDTH`) : les boutons flottants de la carte s'en écartent. */
export const LARGEUR_PLAN_MEDIA = 600;

/** Les deux exports DSP pondérés, dans l'ordre de React (`ZoneMediaPlanPanel.tsx:632-635`). */
const EXPORTS_DSP = [
  { format: 'bidding_script', icone: 'fichier-bas', libelle: 'Script bidding DV360' },
  { format: 'tiktok_geo', icone: 'musique', libelle: 'Ciblage TikTok' },
] as const;
type FormatDsp = (typeof EXPORTS_DSP)[number]['format'];

/** Les champs de saisie (`inputStyle`) et leurs libellés (`labelStyle`). */
const CHAMP = 'w-full rounded-[6px] border-fin border-subtle bg-elevated px-[10px] py-[7px] font-mono text-[12px] text-primary outline-none';
const LIBELLE = 'mb-1 block text-[10.5px] text-tertiary';
/** Les boutons neutres sous le tableau (« Répartir au prorata », « Exporter le tableau (CSV) »). */
const BOUTON_NEUTRE = 'flex cursor-pointer items-center gap-1.5 rounded-[6px] border-fin border-default bg-transparent px-2.5 py-1.5 text-[11px] text-secondary';

interface EtatSauvegarde { saving: boolean; savedAt: string | null; error: string | null }
const SAUVEGARDE_VIERGE: EtatSauvegarde = { saving: false, savedAt: null, error: null };

/**
 * Le plan média des zones affichées — `app/map/_components/ZoneMediaPlanPanel.tsx` (lot 4, T15) : budget, CPM, cible,
 * tableau par item (% total, % France, volume, impressions, répétition, coût pour 1000, répartition modifiable),
 * rattachement à une campagne, export CSV du tableau et fichiers DSP pondérés.
 *
 * Les audiences et les totaux nationaux viennent de `PlanMediaService` (page) ; ce panneau ne garde que la SAISIE, et
 * la perd à la fermeture comme React. Tous les calculs sont dans `logique/zones/plan-media.ts`.
 *
 * ── ÉCRITURES ────────────────────────────────────────────────────────────
 * « Enregistrer » et « détacher » écrivent `geo_strategy.media_plan` de la campagne choisie ; un export DSP avec une
 * campagne fige un instantané (`campaign_plan_snapshot`). Les exports DSP sont des FICHIERS : rien n'est envoyé à
 * DV360 ni à TikTok.
 *
 * ── DÉFAUT DE REACT CORRIGÉ ──────────────────────────────────────────────
 * Choisir une campagne dont le plan vise une AUTRE cible perdait ses poids : l'effet « la cible change → prorata »
 * (`:217`) passait juste après le chargement. Ici seule une cible choisie à la main repart du prorata.
 */
@Component({
  selector: 'mg-plan-media',
  imports: [IconeComponent, TableauPlanMediaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <div data-plan-media class="absolute bottom-0 right-0 z-[45] flex flex-col overflow-hidden border-l-fin border-subtle bg-surface" [style.width.px]="largeur" [style.top.px]="haut()">
      <div class="flex shrink-0 items-center gap-2 border-b-fin border-subtle px-4 py-3">
        <div class="size-1.5 rounded-full bg-teal"></div>
        <span data-titre class="flex-1 text-[13px] font-medium text-primary">{{ titre() }}</span>
        <button type="button" title="Fermer" class="flex cursor-pointer border-0 bg-transparent p-[2px] text-tertiary" (click)="fermer.emit()">
          <mg-icone nom="croix" [taille]="15" />
        </button>
      </div>

      <div class="flex flex-1 flex-col gap-[14px] overflow-y-auto p-4">
        <div>
          <label [class]="libelle">Campagne rattachée</label>
          <div class="flex gap-1.5">
            <select data-campagne [class]="champ" class="flex-1 cursor-pointer !font-sans" (change)="choisirCampagne($any($event.target).value)">
              <option value="" [selected]="!campagneId()">— Aucune (plan non enregistré) —</option>
              @for (c of campagnes(); track c.id) {
                <option [value]="c.id" [selected]="c.id === campagneId()">{{ c.has_plan ? '● ' : '' }}{{ c.name }} · {{ c.dsp_source }}</option>
              }
            </select>
            <button
              type="button"
              data-enregistrer
              class="whitespace-nowrap rounded-[6px] border-0 px-[14px] py-[7px] text-[12px] font-medium"
              [class]="campagneId() ? 'bg-teal text-teal-fg' : 'bg-elevated text-tertiary'"
              [class.cursor-not-allowed]="!campagneId() || sauvegarde().saving"
              [class.cursor-pointer]="campagneId() && !sauvegarde().saving"
              [class.opacity-60]="sauvegarde().saving"
              [disabled]="!campagneId() || sauvegarde().saving || service.chargement()"
              [attr.title]="campagneId() ? 'Enregistrer le plan sur la campagne' : 'Choisir une campagne'"
              (click)="enregistrer()"
            >{{ sauvegarde().saving ? '…' : 'Enregistrer' }}</button>
          </div>
          @if (campagneId()) {
            <div class="mt-1 flex items-center gap-2.5">
              <span data-etat-plan class="font-mono text-[9px]" [class]="sauvegarde().error ? 'text-danger' : 'text-tertiary'">{{ etatPlan() }}</span>
              @if (sauvegarde().savedAt) {
                <button type="button" data-detacher class="cursor-pointer border-0 bg-transparent text-[9px] text-tertiary underline" (click)="detacher()">détacher</button>
              }
            </div>
          }
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <div>
            <label [class]="libelle">Budget (€)</label>
            <input data-budget [class]="champ" placeholder="50 000" inputmode="decimal" [value]="budget()" (input)="budget.set($any($event.target).value)" />
          </div>
          <div>
            <label [class]="libelle">CPM (€)</label>
            <input data-cpm [class]="champ" placeholder="6,50" inputmode="decimal" [value]="cpm()" (input)="cpm.set($any($event.target).value)" />
          </div>
          <div class="col-span-2">
            <label [class]="libelle">Cible</label>
            <select data-cible [class]="champ" class="cursor-pointer !font-sans" (change)="choisirCible($any($event.target).value)">
              @for (g of groupes; track g.group) {
                <optgroup [label]="g.group">
                  @for (o of g.options; track o[0]) {
                    <option [value]="o[0]" [selected]="o[0] === cible()">{{ o[1] }}</option>
                  }
                </optgroup>
              }
            </select>
          </div>
        </div>

        <div class="flex items-baseline justify-between rounded-[6px] border-fin border-subtle bg-elevated px-3 py-2">
          <span class="text-[11px] text-tertiary">Impressions totales (budget ÷ CPM × 1000)</span>
          <span data-impressions class="font-mono text-[14px] tabular-nums" [class]="impressions() === '—' ? 'text-tertiary' : 'text-teal'">{{ impressions() }}</span>
        </div>

        @if (service.chargement()) {
          <div class="py-5 text-center text-[12px] text-tertiary">Chargement des audiences…</div>
        } @else {
          <mg-tableau-plan-media [cellules]="cellules()" [total]="total()" [unite]="unite()" [saisie]="saisie()" (part)="changerPart($event)" />
          @if (service.lignes().length > 0) {
            <div class="flex flex-wrap gap-2">
              @if (saisie()) {
                <button type="button" data-prorata [class]="boutonNeutre" (click)="repartition.set(null)">
                  <mg-icone nom="tourner-gauche" [taille]="11" /> Répartir au prorata
                </button>
              }
              <button type="button" data-csv [class]="boutonNeutre" title="Télécharger le tableau (CSV, ouvrable dans Excel)" (click)="exporterCsv()">
                <mg-icone nom="fichier-bas" [taille]="11" /> Exporter le tableau (CSV)
              </button>
            </div>
            <div class="flex flex-col gap-1.5 border-t-fin border-subtle pt-3">
              <div class="text-[10.5px] text-tertiary">Générer les fichiers DSP avec les poids de la répartition</div>
              <div class="flex flex-wrap gap-2">
                @for (x of exportsDsp; track x.format) {
                  <button
                    type="button"
                    [attr.data-export]="x.format"
                    class="flex items-center gap-1.5 rounded-[6px] border-fin border-teal bg-transparent px-3 py-[7px] text-[11.5px] font-medium text-teal transition-[background-color] duration-150 ease-[var(--ease-hover)] hover:bg-teal-10"
                    [class.cursor-wait]="exportEnCours()"
                    [class.cursor-pointer]="!exportEnCours()"
                    [class.opacity-60]="exportEnCours()"
                    [disabled]="exportEnCours()"
                    (click)="exporterDsp(x.format)"
                  >
                    <mg-icone [nom]="x.icone" [taille]="12" [trait]="1.5" />
                    {{ exportEnCours() ? 'Génération…' : x.libelle }}
                  </button>
                }
              </div>
              @if (erreurExport(); as e) {
                <div data-erreur-export class="font-mono text-[10px] text-danger">{{ e }}</div>
              }
            </div>
          }
        }

        <div class="font-mono text-[9px] italic leading-[1.5] text-tertiary">
          Volumes cibles : carreaux INSEE 200m intersectant la zone (calculés à la capture) · % France : total national carreaux 5 km · les impressions suivent la colonne répartition.
        </div>
      </div>
    </div>
  `,
})
export class PlanMediaComponent {
  protected readonly service = inject(PlanMediaService);
  private readonly api = inject(ZonesCustomApi);
  private readonly exports = inject(ExportZoneService);
  private readonly enregistrerFichier = inject(ENREGISTRER_FICHIER);
  private readonly doc = inject(DOCUMENT);

  /** Haut du panneau : sous la barre de la carte, 0 en mode immersif (`topOffset`). */
  readonly haut = input.required<number>();
  readonly fermer = output<void>();

  protected readonly largeur = LARGEUR_PLAN_MEDIA;
  protected readonly champ = CHAMP;
  protected readonly libelle = LIBELLE;
  protected readonly boutonNeutre = BOUTON_NEUTRE;
  protected readonly groupes = CIBLE_GROUPS;
  protected readonly exportsDsp = EXPORTS_DSP;

  protected readonly budget = signal('');
  protected readonly cpm = signal('');
  protected readonly cible = signal<CibleKey>('total');
  /** La répartition saisie, `null` = prorata ; une autre liste de zones repart du prorata (`[cible, zones]`, `:217`). */
  protected readonly repartition = linkedSignal<string, Record<string, number> | null>({
    source: () => this.service.zones().map((z) => z.id).join('|'),
    computation: () => null,
  });

  protected readonly campagnes = signal<CampagnePlan[]>([]);
  protected readonly campagneId = signal('');
  protected readonly sauvegarde = signal<EtatSauvegarde>(SAUVEGARDE_VIERGE);
  protected readonly exportEnCours = signal(false);
  protected readonly erreurExport = signal<string | null>(null);

  private readonly budgetNum = computed(() => lireMontant(this.budget()));
  private readonly cpmNum = computed(() => lireMontant(this.cpm()));
  private readonly plan = computed(() => calculerPlan({
    lignes: this.service.lignes(), cible: this.cible(), repartition: this.repartition(),
    budget: this.budgetNum(), cpm: this.cpmNum(), totaux: this.service.totaux(),
  }));
  /** Une répartition saisie s'applique aux lignes (un plan stocké sur d'autres zones n'en est pas une). */
  protected readonly saisie = computed(() => this.plan().repartitionSaisie);
  protected readonly cellules = computed(() => cellulesPlan(this.service.lignes(), this.plan()));
  protected readonly total = computed(() => celluleTotal(this.plan(), this.budgetNum()));
  protected readonly impressions = computed(() => {
    const ti = this.plan().impressionsTotales;
    return ti ? formaterEntier(ti) : '—';
  });
  protected readonly unite = computed(() => CIBLE_UNIT[this.cible()]);
  protected readonly titre = computed(() => {
    const n = this.service.zones().length;
    return `Plan média — ${n} zone${n > 1 ? 's' : ''}`;
  });
  protected readonly etatPlan = computed(() => {
    const s = this.sauvegarde();
    return s.error ?? (s.savedAt ? dateEnregistrement(s.savedAt) : 'Plan non encore enregistré');
  });

  private readonly lectures = new Set<Subscription>();
  private lecturePlan: Subscription | null = null;
  /** Panneau détruit : une série d'exports DSP en cours s'arrête avant la zone suivante. */
  private detruit = false;

  constructor() {
    this.suivre(this.api.campagnesPlan().subscribe({ next: (r) => this.campagnes.set(r?.campaigns ?? []), error: () => undefined }));
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      for (const s of this.lectures) s.unsubscribe();
      this.lecturePlan?.unsubscribe();
    });
  }

  /** Une cible choisie à la main repart du prorata. */
  protected choisirCible(cible: CibleKey): void {
    this.cible.set(cible);
    this.repartition.set(null);
  }

  /** Une part tapée : les autres lignes se réajustent pour que la somme reste à 100 (`setZoneShare`). */
  protected changerPart({ id, valeur }: { id: string; valeur: string }): void {
    const ids = this.service.lignes().map((r) => r.id);
    this.repartition.set(normalizeShares(this.plan().repartition, id, parseFloat(valeur) || 0, ids));
  }

  /** Une campagne choisie : son plan stocké, s'il en a un, remplit budget, CPM, cible et poids (`:173-194`). */
  protected choisirCampagne(id: string): void {
    this.campagneId.set(id);
    this.lecturePlan?.unsubscribe();
    if (!id) return;
    this.sauvegarde.set(SAUVEGARDE_VIERGE);
    this.lecturePlan = this.api.planMedia(id).subscribe({
      next: (r) => {
        const plan = r?.plan;
        if (!plan?.zones) return;
        this.budget.set(plan.budget != null ? String(plan.budget) : '');
        this.cpm.set(plan.cpm != null ? String(plan.cpm) : '');
        this.cible.set(plan.cible);
        this.repartition.set(Object.keys(plan.weights ?? {}).length ? plan.weights : null);
        this.sauvegarde.set({ saving: false, savedAt: plan.updated_at ?? null, error: null });
      },
      error: () => undefined,
    });
  }

  /** « Enregistrer » : ÉCRIT le plan dans `geo_strategy.media_plan` de la campagne (`savePlan`). */
  protected enregistrer(): void {
    const campagne = this.campagneId();
    if (!campagne) return;
    this.sauvegarde.set({ saving: true, savedAt: null, error: null });
    this.suivre(this.api.enregistrerPlan(corpsPlan(this.envoi(campagne))).subscribe({
      next: (r) => {
        this.sauvegarde.set({ saving: false, savedAt: r?.plan?.updated_at ?? new Date().toISOString(), error: null });
        this.marquerPlan(campagne, true);
      },
      error: (e: unknown) => this.sauvegarde.set({ saving: false, savedAt: null, error: this.messageEcriture(e) }),
    }));
  }

  /** « détacher » : retire le plan de la campagne (`detachPlan`). */
  protected detacher(): void {
    const campagne = this.campagneId();
    if (!campagne) return;
    this.sauvegarde.set({ saving: true, savedAt: null, error: null });
    this.suivre(this.api.detacherPlan(campagne).subscribe({
      next: () => {
        this.sauvegarde.set(SAUVEGARDE_VIERGE);
        this.marquerPlan(campagne, false);
      },
      error: (e: unknown) => this.sauvegarde.set({ saving: false, savedAt: null, error: messageHttp(e, 'Erreur') }),
    }));
  }

  /** « Exporter le tableau (CSV) » : un fichier `;`, ouvrable dans Excel (`exportTableCsv`). */
  protected exporterCsv(): void {
    const nomCampagne = this.campagnes().find((c) => c.id === this.campagneId())?.name ?? '';
    const csv = csvPlanMedia({
      lignes: this.service.lignes(), plan: this.plan(), cible: this.cible(), budget: this.budgetNum(), cpm: this.cpmNum(), nomCampagne,
    });
    const corps = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    this.enregistrerFichier(this.doc, new HttpResponse({ body: corps }), nomFichierPlan(nomCampagne));
  }

  /**
   * Un fichier DSP par zone affichée, pondéré par la répartition pour une zone décomposable (`exportWeighted`). Le
   * premier échec arrête la série et s'affiche. Avec une campagne, l'instantané du plan poussé est figé ensuite — au
   * mieux : le fichier est déjà téléchargé, un instantané refusé ne le défait pas.
   */
  protected async exporterDsp(format: FormatDsp): Promise<void> {
    this.exportEnCours.set(true);
    this.erreurExport.set(null);
    const lignes = this.service.lignes();
    const plan = this.plan();
    for (const z of this.service.zones()) {
      if (this.detruit) return;
      const poids = poidsDesItems(z.id, lignes, plan.repartition);
      let echec: string | null;
      if (poids) {
        const params: Record<string, string> = { weights: JSON.stringify(poids) };
        if (format === 'tiktok_geo' && this.budgetNum() > 0) params['budget'] = String(this.budgetNum());
        echec = await this.exports.exporter(z.id, format, params);
      } else {
        echec = await this.exports.exporter(z.id, format);
      }
      if (echec) {
        this.exportEnCours.set(false);
        this.erreurExport.set(echec);
        return;
      }
    }
    const campagne = this.campagneId();
    const corps = campagne ? corpsInstantane({ ...this.envoi(campagne), format }) : null;
    if (corps) await firstValueFrom(this.api.instantane(corps)).catch(() => undefined);
    this.exportEnCours.set(false);
  }

  private envoi(campagne: string) {
    return {
      campagne, zones: this.service.zones(), lignes: this.service.lignes(), plan: this.plan(),
      budget: this.budgetNum(), cpm: this.cpmNum(), cible: this.cible(),
    };
  }

  /** « ● » devant la campagne qui porte (ou ne porte plus) un plan. */
  private marquerPlan(campagne: string, aUnPlan: boolean): void {
    this.campagnes.update((cs) => cs.map((c) => (c.id === campagne ? { ...c, has_plan: aUnPlan } : c)));
  }

  private messageEcriture(e: unknown): string {
    return (e as { status?: unknown } | null)?.status === 403 ? 'Campagne hors de votre organisation.' : messageHttp(e, 'Erreur');
  }

  private suivre(s: Subscription): void {
    if (s.closed) return;
    this.lectures.add(s);
    s.add(() => this.lectures.delete(s));
  }
}
