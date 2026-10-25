import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, untracked } from '@angular/core';
import { messageErreurApi } from '../../../../core/http/erreurs';
import { PlanApi, type RessourcesDv360 } from '../../data/plan.api';
import { LectureAnnulable } from '../../etat/lecture-annulable';
import type { PlatformLinks } from '../../logique/plan/liens-plateformes';
import { CADRE_LIAISON, LIBELLE_NIVEAU, SAISIE_LIAISON, TEXTE_SUCCES } from './styles-plan';

type Element = RessourcesDv360['items'][number];

/** Le message de `GET /api/dsp/dv360/resources` : connexion absente dite en français, détail de l'API DV360 sinon. */
export function messageDv360(e: unknown): string {
  const corps = e instanceof HttpErrorResponse ? (e.error as { error?: unknown; detail?: unknown } | null) : null;
  if (corps?.error === 'dv360_not_connected') return 'DV360 non connecté pour cette organisation (Administration → Système → Connexions API).';
  if (typeof corps?.detail === 'string' && corps.detail) return corps.detail;
  return messageErreurApi(e);
}

/**
 * ⑥ Plan — la liaison DV360 par l'API (lot 6, T5) : port de `Dv360LinkPanel.tsx`, cascade annonceur → campagne DV360
 * → insertion order, lue à la demande par `GET /api/dsp/dv360/resources` (connexion de l'espace propriétaire de la
 * campagne). Écrit IDs et noms dans l'entrée `dv360` des liaisons : ⑦ pousse le ciblage et ⑧ lit les rapports par elle.
 *
 * Chaque niveau remet à zéro ceux d'en dessous. Un seul insertion order : présélectionné (sans écraser un choix
 * stocké). Les annonceurs sont lus au montage (l'accordéon s'ouvre), chaque niveau inférieur quand le supérieur est
 * connu — y compris préchargé depuis le stocké, comme React. Une lecture relancée annule la précédente (P-c).
 *
 * Écart à React : la ligne d'état disait « le push bidding cible cet insertion order » ; le custom bidding est hors V1
 * (spec § 19) — elle dit « ✓ liée ».
 */
@Component({
  selector: 'mg-liaison-dv360',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-liaison-dv360': '' },
  template: `
    <div [class]="cadre">
      <div class="flex items-baseline gap-2.5">
        <span class="text-[12px] font-medium text-primary">Liaison DV360</span>
        <span data-etat-liaison class="text-[11px]" [class]="complete() ? texteSucces : 'text-tertiary'">
          {{ complete() ? '✓ liée' : 'annonceur, campagne et insertion order' }}
        </span>
      </div>
      @if (erreur(); as e) { <div role="alert" class="text-[12px] text-danger">{{ e }}</div> }
      @for (n of niveaux(); track n.cle) {
        <label class="block">
          <span [class]="libelleNiveau">{{ n.libelle }}</span>
          <select [attr.data-niveau]="n.cle" [class]="saisie + ' cursor-pointer'" [class.text-tertiary]="!n.valeur" [disabled]="n.inactif || n.lecture.enCours()"
                  (change)="choisir(n.cle, $any($event.target).value)">
            <option value="" [selected]="!n.valeur">{{ n.lecture.enCours() ? 'Chargement…' : n.invite }}</option>
            @for (it of n.lecture.resultat()?.items ?? []; track it.id) {
              <option [value]="it.id" [selected]="it.id === n.valeur">{{ it.name }}</option>
            }
          </select>
        </label>
      }
    </div>
  `,
})
export class LiaisonDv360Component {
  private readonly api = inject(PlanApi);

  readonly campagne = input.required<string>();
  readonly liens = input<PlatformLinks | undefined>(undefined);
  readonly changement = output<PlatformLinks>();

  protected readonly cadre = CADRE_LIAISON;
  protected readonly saisie = SAISIE_LIAISON;
  protected readonly libelleNiveau = LIBELLE_NIVEAU;
  protected readonly texteSucces = TEXTE_SUCCES;

  private readonly annonceurs = new LectureAnnulable<RessourcesDv360>(messageDv360);
  private readonly campagnes = new LectureAnnulable<RessourcesDv360>(messageDv360);
  private readonly ordres = new LectureAnnulable<RessourcesDv360>(messageDv360);

  private readonly annonceur = computed(() => this.liens()?.['advertiser_id'] ?? '');
  private readonly campagneDv = computed(() => this.liens()?.['campaign_id'] ?? '');
  private readonly ordre = computed(() => this.liens()?.['insertion_order_id'] ?? '');

  protected readonly complete = computed(() => !!(this.annonceur() && this.campagneDv() && this.ordre()));
  protected readonly erreur = computed(() => this.annonceurs.erreur() ?? this.campagnes.erreur() ?? this.ordres.erreur());
  protected readonly niveaux = computed(() => [
    { cle: 'advertiser', libelle: 'Annonceur', invite: 'Choisir un annonceur', valeur: this.annonceur(), inactif: false, lecture: this.annonceurs },
    { cle: 'campaign', libelle: 'Campagne DV360', invite: 'Choisir une campagne', valeur: this.campagneDv(), inactif: !this.annonceur(), lecture: this.campagnes },
    { cle: 'insertion_order', libelle: 'Insertion order', invite: 'Choisir un insertion order', valeur: this.ordre(), inactif: !this.campagneDv(), lecture: this.ordres },
  ] as const);

  constructor() {
    // P-a : chaque effet LIT les identifiants du niveau supérieur ; la lecture part hors suivi.
    effect(() => {
      const c = this.campagne();
      untracked(() => this.annonceurs.lancer(this.api.ressourcesDv360(c)));
    });
    effect(() => {
      const c = this.campagne();
      const a = this.annonceur();
      untracked(() => (a ? this.campagnes.lancer(this.api.ressourcesDv360(c, a)) : this.campagnes.perimer()));
    });
    effect(() => {
      const c = this.campagne();
      const a = this.annonceur();
      const k = this.campagneDv();
      untracked(() => {
        if (!a || !k) return this.ordres.perimer();
        this.ordres.lancer(this.api.ressourcesDv360(c, a, k), (r) => {
          // Un seul insertion order → présélection, sans écraser un choix déjà stocké.
          const seul = r.items.length === 1 ? r.items[0] : undefined;
          if (seul && !this.ordre()) this.changement.emit({ ...(this.liens() ?? {}), insertion_order_id: seul.id, insertion_order_name: seul.name });
        });
      });
    });
  }

  /** Un niveau choisi (ou vidé) : les niveaux inférieurs repartent de zéro. */
  protected choisir(niveau: 'advertiser' | 'campaign' | 'insertion_order', id: string): void {
    const l = this.liens() ?? {};
    const it = this.trouver(niveau, id);
    if (niveau === 'advertiser') {
      this.changement.emit(it ? { advertiser_id: it.id, advertiser_name: it.name } : {});
    } else if (niveau === 'campaign') {
      const haut = { advertiser_id: this.annonceur(), advertiser_name: l['advertiser_name'] };
      this.changement.emit(it ? { ...haut, campaign_id: it.id, campaign_name: it.name } : haut);
    } else {
      this.changement.emit({ ...l, insertion_order_id: it?.id, insertion_order_name: it?.name });
    }
  }

  private trouver(niveau: 'advertiser' | 'campaign' | 'insertion_order', id: string): Element | undefined {
    const lecture = niveau === 'advertiser' ? this.annonceurs : niveau === 'campaign' ? this.campagnes : this.ordres;
    return lecture.resultat()?.items.find((i) => i.id === id);
  }
}
