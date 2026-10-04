import { HttpErrorResponse } from '@angular/common/http';
import {
  DestroyRef, Injectable, type Signal, type WritableSignal, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { type Observable, firstValueFrom } from 'rxjs';
import { ChargementService } from '../../../core/chargement/chargement.service';
import { type EvenementSimulation, type ReglagesSimulation, type ReponseSimulation, SimulationApi } from '../data/simulation.api';
import {
  type Periode, type PointCourbe, type VueSimulation, construireVue, courbeAlignement,
} from '../logique/simulation/vue';
import { EtatRisqueService } from './etat-risque.service';

export type { ReglagesSimulation };

/** `'vide' | 'chargement' | 'echec' | 'pret'`, porté À CÔTÉ de la donnée (`ContexteSimulation.tsx:43`). */
export type EtatSimulation = 'vide' | 'chargement' | 'echec' | 'pret';

/** La progression d'un geste qui écrit (`ContexteSimulation.tsx:24-30`). */
export interface Progression {
  message: string;
  /** 0 à 100, ou `null` quand l'étape n'a pas d'avancement mesurable. */
  pourcentage: number | null;
  faites?: number;
  total?: number;
}

/** Les messages par défaut, MOT POUR MOT de `ContexteSimulation.tsx`. */
export const MESSAGES_SIMULATION = {
  lecture: 'Simulation illisible.',
  echec: 'La simulation a échoué.',
  interrompu: 'Le flux s’est interrompu avant la fin.',
  purge: 'Purge impossible.',
  preparation: 'Préparation de la simulation',
  recalage: 'Recalage du plan',
  purgeEnCours: 'Purge de la simulation',
  piste: 'Simulation de la campagne',
  pisteLecture: 'Lecture de la simulation',
} as const;

/**
 * Le message d'une réponse en erreur : le champ `error` du corps JSON (`data?.error` de React), le message par défaut
 * sinon. Un flux NDJSON est demandé en `responseType: 'text'` : son corps d'ERREUR arrive alors en texte, qu'on relit.
 */
export function messageSimulation(e: unknown, defaut: string): string {
  if (!(e instanceof HttpErrorResponse)) return defaut;
  let corps: unknown = e.error;
  if (typeof corps === 'string') {
    try {
      corps = JSON.parse(corps);
    } catch {
      return defaut;
    }
  }
  const erreur = corps && typeof corps === 'object' ? (corps as { error?: unknown }).error : null;
  return typeof erreur === 'string' && erreur ? erreur : defaut;
}

/**
 * L'état de l'étape ⑤ Campagne, partagé par ses quatre lecteurs — le panneau, le bandeau, la carte et le tableau des
 * zones (T17) : portage de `ContexteSimulation.tsx`.
 *
 * ── UN SEUL CHARGEMENT ───────────────────────────────────────────────────
 *
 * Chacun chargeant la simulation pour lui ferait quatre appels à une route qui agrège 168 000 lignes, et quatre
 * lectures qui pourraient ne pas voir la même version entre deux recalages. Fourni par l'ÉCRAN (A13).
 *
 * ── RIEN AVANT LA PREMIÈRE VISITE DE ⑤ ────────────────────────────────────
 *
 * Tant que `activer()` n'a pas été appelé, aucune requête ne part : les étapes ① à ④ ne paient pas une simulation
 * qu'elles n'affichent pas (`AvecSimulation`, `AnalysePopulationOverlay.tsx:1672-1686`). Une fois visitée, la
 * simulation reste en mémoire : le fil d'étapes continue de marquer ⑤ et le retour ne recharge rien. Elle se relit
 * quand le JEU change ; une réponse d'un autre jeu est périmée et n'est jamais rendue.
 *
 * ── LES GESTES QUI ÉCRIVENT ──────────────────────────────────────────────
 *
 * Simuler et Recaler sont des flux NDJSON lus par `HttpClient` (A9) : jeton, limiteur et session s'appliquent, et le
 * flux occupe une place du limiteur pendant ses ~11 s — voulu, c'est un appel lourd en base. Les événements
 * `insertion` font avancer le pourcentage ; `preparation` et `generation` le rendent indéterminé. Un flux qui
 * s'arrête sans événement final est un ÉCHEC, jamais un succès silencieux.
 */
@Injectable()
export class SimulationService {
  private readonly api = inject(SimulationApi);
  private readonly etatRisque = inject(EtatRisqueService);

  private readonly jeuId = computed(() => this.etatRisque.etat().jeu);
  private readonly actif = signal(false);

  private readonly _etat = signal<EtatSimulation>('vide');
  private readonly _erreur = signal<string | null>(null);
  private readonly _reponse = signal<ReponseSimulation | null>(null);
  /** Le jeu dont `_reponse` décrit la simulation. */
  private readonly jeuCharge = signal<string | null>(null);
  private readonly _progression = signal<Progression | null>(null);

  readonly etat: Signal<EtatSimulation> = this._etat.asReadonly();
  readonly erreur: Signal<string | null> = this._erreur.asReadonly();
  /** La réponse, ou `null` si elle décrit un AUTRE jeu que celui de l'URL. */
  readonly reponse: Signal<ReponseSimulation | null> = computed(() =>
    (this.jeuCharge() === this.jeuId() ? this._reponse() : null));
  /** La période affichée — elle pilote TOUT l'écran, bandeau, carte et tableau compris. */
  readonly periode: WritableSignal<Periode> = signal<Periode>('tout');
  readonly vue: Signal<VueSimulation | null> = computed(() => {
    const r = this.reponse();
    return r ? construireVue(r, this.periode()) : null;
  });
  readonly courbe: Signal<PointCourbe[]> = computed(() => {
    const r = this.reponse();
    return r ? courbeAlignement(r) : [];
  });
  /** Le bassin survolé ou choisi (sites sous-servis, carte et tableau de T17). */
  readonly zoneActive: WritableSignal<string | null> = signal<string | null>(null);
  readonly progression: Signal<Progression | null> = this._progression.asReadonly();
  /** Le jeu ouvert, tel que l'URL le nomme. */
  readonly jeu: Signal<string | null> = this.jeuId;

  /** Numéro de la dernière lecture : une réponse arrivée après une plus récente est ignorée. */
  private lecture = 0;
  private detruit = false;

  constructor() {
    const chargement = inject(ChargementService);
    // Les deux pistes de React (`usePiste`, l.104-105) : le geste en cours, avec SON message, et la lecture seule.
    effect(() => {
      const p = this._progression();
      chargement.declarer({ cle: 'simulation', libelle: p?.message ?? MESSAGES_SIMULATION.piste, actif: p !== null });
    });
    effect(() => {
      chargement.declarer({
        cle: 'simulation-lecture', libelle: MESSAGES_SIMULATION.pisteLecture,
        actif: this._etat() === 'chargement' && this._progression() === null,
      });
    });
    // Chargement à la première ouverture de ⑤, puis à chaque changement de jeu (`ContexteSimulation.tsx:128-133`).
    effect(() => {
      if (!this.actif()) return;
      const jeu = this.jeuId();
      untracked(() => {
        if (this.jeuCharge() === jeu && this._reponse()) return;
        void this.recharger();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      chargement.retirer('simulation');
      chargement.retirer('simulation-lecture');
    });
  }

  /** Première visite de ⑤ : avant, aucun appel. Idempotent. */
  activer(): void {
    this.actif.set(true);
  }

  /** Relit la simulation du jeu ouvert. */
  async recharger(): Promise<void> {
    const jeu = this.jeuId();
    if (!jeu) {
      this._etat.set('vide');
      this._reponse.set(null);
      return;
    }
    const n = ++this.lecture;
    this._etat.set('chargement');
    this._erreur.set(null);
    try {
      const r = await firstValueFrom(this.api.lire(jeu));
      if (n !== this.lecture || this.detruit) return;
      this.jeuCharge.set(jeu);
      this._reponse.set(r);
      this._etat.set('pret');
    } catch (e) {
      if (n !== this.lecture || this.detruit) return;
      this._erreur.set(messageSimulation(e, MESSAGES_SIMULATION.lecture));
      this._etat.set('echec');
    }
  }

  /** Lance la simulation v1 sur une version d'extraction ; la période passe sur la v1. */
  async simuler(version: number, reglages: Partial<ReglagesSimulation>): Promise<void> {
    const jeu = this.jeuId();
    if (!jeu) return;
    await this.executer(this.api.simuler(jeu, version, reglages), MESSAGES_SIMULATION.preparation);
    this.periode.set('v1');
  }

  /** Recale la simulation (v2) ; la période passe sur la campagne entière. */
  async recaler(): Promise<void> {
    const jeu = this.jeuId();
    if (!jeu) return;
    await this.executer(this.api.recaler(jeu), MESSAGES_SIMULATION.recalage);
    this.periode.set('tout');
  }

  /** Purge la simulation du jeu (campagne, impressions, extraction v2 de recalage). */
  async purger(): Promise<void> {
    const jeu = this.jeuId();
    if (!jeu) return;
    this._progression.set({ message: MESSAGES_SIMULATION.purgeEnCours, pourcentage: null });
    try {
      await firstValueFrom(this.api.purger(jeu), { defaultValue: null });
      if (this.detruit) return;
      this._progression.set(null);
      await this.recharger();
    } catch (e) {
      if (this.detruit) return;
      this._progression.set(null);
      // Comme React : l'état reste celui de la dernière lecture, seul le message dit l'échec.
      this._erreur.set(messageSimulation(e, MESSAGES_SIMULATION.purge));
    }
  }

  /**
   * Suit un flux NDJSON jusqu'au bout. ⚠ Le flux n'est PAS annulé — React ne l'annulait pas non plus. L'annuler
   * n'arrêterait rien côté serveur (la route écrit jusqu'au bout une fois la requête reçue), et un retour à ⑤ perdrait
   * l'affichage de la progression d'un travail qui continue. L'écran fermé n'écrit simplement plus rien.
   */
  private async executer(flux: Observable<EvenementSimulation>, libelle: string): Promise<void> {
    this._progression.set({ message: libelle, pourcentage: null });
    this._erreur.set(null);
    try {
      const fin = await new Promise<EvenementSimulation | null>((resolu, rejete) => {
        let dernier: EvenementSimulation | null = null;
        flux.subscribe({
          next: (e) => {
            dernier = e;
            if (this.detruit) return;
            if (e.etape === 'insertion') {
              this._progression.set({ message: e.message, pourcentage: e.pourcentage, faites: e.faites, total: e.total });
            } else if (e.etape === 'preparation' || e.etape === 'generation') {
              this._progression.set({ message: e.message, pourcentage: null });
            }
          },
          error: rejete,
          complete: () => resolu(dernier),
        });
      });
      if (!fin || fin.etape === 'erreur') {
        throw new Error(fin?.etape === 'erreur' ? fin.message : MESSAGES_SIMULATION.interrompu);
      }
      if (this.detruit) return;
      this._progression.set(null);
      await this.recharger();
    } catch (e) {
      if (this.detruit) return;
      this._progression.set(null);
      this._erreur.set(e instanceof HttpErrorResponse ? messageSimulation(e, MESSAGES_SIMULATION.echec)
        : e instanceof Error ? e.message : MESSAGES_SIMULATION.echec);
      this._etat.set('echec');
    }
  }
}
