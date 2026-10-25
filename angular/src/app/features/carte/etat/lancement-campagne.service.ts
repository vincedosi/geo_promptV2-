import { DestroyRef, Injectable, type Signal, computed, inject, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { PlanApi } from '../data/plan.api';
import { type DemandeLancement, EchecLancement, lancerCampagne, messageLancement } from './lancement-campagne';
import { PlanCampagneService } from './plan-campagne.service';

/** Le titre d'une issue réussie : création d'une campagne, ou mise à jour du plan d'une campagne lancée (V-5). */
export const TITRE_CREATION = 'Campagne créée';
export const TITRE_MISE_A_JOUR = 'Plan mis à jour';

/** L'état du dernier lancement : sa campagne, son issue, et ce que l'écran en dit. */
export type EtatLancementCampagne =
  | { campagne: string; statut: 'en_cours' }
  | { campagne: string; statut: 'reussi'; message: string; /** La campagne avait déjà un plan (V-5). */ miseAJour: boolean }
  | { campagne: string; statut: 'echec'; titre: string; message: string };

/**
 * ⑥ Plan — l'ORCHESTRATION du lancement (lot 6, relecture 3, Important 1) : la séquence `lancerCampagne`, son état et
 * ses notifications, hors du pied qui ne fait plus qu'afficher et déclencher.
 *
 * Fourni par la PAGE (`FOURNISSEURS_PLAN`, P-e), jamais à la racine : il survit à « ← Choisir une autre campagne » et au
 * changement d'étape, qui DÉTRUISENT le pied. Avant, le pied se désabonnait à sa destruction : quitté après `rattacher`,
 * il laissait une stratégie active sans `kpi_target` ni dates, et des canaux non écrits, sans rien dire. La séquence
 * n'est plus coupée qu'à la destruction de la page (changement d'espace).
 *
 * Un lancement à la fois. Son issue reste lisible au retour sur sa campagne (`etat`, porteur de la campagne) ; les
 * notifications partent du service (`NotificationsService` fourni par la page, la pile vit dans le pied).
 * Réussi sur la campagne ouverte : `apresLancement` (brouillon jeté, stratégie existante, identité). Réussi alors qu'on
 * en a ouvert une autre : son brouillon serveur est jeté quand même (`jeterBrouillonsDe`), sans toucher à l'état de la
 * campagne ouverte. Échoué APRÈS `rattacher` : la stratégie écrite est active en base, elle devient l'existante
 * (`poserStrategie`, revue finale m3) ; le brouillon reste.
 */
@Injectable()
export class LancementCampagneService {
  private readonly api = inject(PlanApi);
  private readonly plan = inject(PlanCampagneService);
  private readonly notifications = inject(NotificationsService);

  private readonly _etat = signal<EtatLancementCampagne | null>(null);
  readonly etat: Signal<EtatLancementCampagne | null> = this._etat.asReadonly();
  /** Une séquence est en vol, quelle que soit sa campagne. */
  readonly enCours = computed(() => this._etat()?.statut === 'en_cours');

  private abonnement: Subscription | null = null;
  private detruit = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      this.abonnement?.unsubscribe();
    });
  }

  /**
   * Lance la séquence ; ignoré si une autre est en vol. `impressions` : le total affiché, repris dans le message.
   * `miseAJour` : la campagne avait déjà un plan — l'issue se dit « Plan mis à jour » (revue finale, V-5).
   */
  lancer(demande: DemandeLancement, impressions: number | null, miseAJour = false): void {
    if (this.enCours() || this.detruit) return;
    const campagne = demande.campagne;
    this._etat.set({ campagne, statut: 'en_cours' });
    this.abonnement = lancerCampagne(this.api, demande).subscribe({
      next: (r) => {
        const message = messageLancement(r, impressions);
        this._etat.set({ campagne, statut: 'reussi', message, miseAJour });
        this.notifications.success(miseAJour ? TITRE_MISE_A_JOUR : TITRE_CREATION, message);
        if (this.plan.campagne() === campagne) this.plan.apresLancement(r.strategie, demande.identite);
        else this.plan.jeterBrouillonsDe(campagne);
      },
      error: (e: unknown) => {
        const { titre, message } = e instanceof EchecLancement ? e : { titre: 'Lancement impossible', message: 'Une erreur inattendue est survenue.' };
        if (e instanceof EchecLancement && e.strategie) this.plan.poserStrategie(campagne, e.strategie);
        this._etat.set({ campagne, statut: 'echec', titre, message });
        this.notifications.error(titre, message);
      },
    });
  }

  /** « Modifier et relancer » : l'issue terminée de cette campagne est oubliée, le pied repasse au récapitulatif. */
  oublier(campagne: string): void {
    const e = this._etat();
    if (e && e.campagne === campagne && e.statut !== 'en_cours') this._etat.set(null);
  }
}
