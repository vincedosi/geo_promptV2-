import { DestroyRef, Injectable, type Signal, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { type Observable, type Subscription, catchError, concatMap, from, map, of, switchMap, tap, throwError } from 'rxjs';
import { messageErreurApi } from '../../../core/http/erreurs';
import { OrganisationsApi } from '../../session/data/organisations.api';
import type { ExtractionJeu } from '../data/jeux.api';
import { type Campagne, type CanauxCampagne, type CorpsCampagne, type CorpsCanaux, type CpDExtraction, PlanApi, type StatutStrategie } from '../data/plan.api';
import { DEFAULT_PROG_DRAFT, type ProgDraft, deserializeDraft, serializeDraft } from '../logique/plan/brouillon';
import { type ResolvedChannel, resolveChannelAvailability } from '../logique/plan/canaux';
import { previsions, totauxPrevus } from '../logique/plan/impressions';
import { remplirCanaux, remplirDepuisStrategie, remplirIdentite } from '../logique/plan/preremplissage';
import { lireUuid } from '../logique/analyses/couverture';
import { CpsExtractions } from './cps-extractions';
import { AccesRefuse, CampagneIntrouvable, MESSAGE_RESERVE_ADMIN, classer, verifierEspace } from './erreurs-campagnes';
import { ecrireParametres } from './ecrire-parametres';

/** Le paramètre d'URL de la campagne courante (spec § 5, A-1). */
export const PARAM_CAMPAGNE = 'campagne';

/** Le message d'une campagne absente ou d'un autre espace (A-1) : le paramètre est alors retiré. */
export const MESSAGE_CAMPAGNE_INTROUVABLE = 'Campagne introuvable dans cet espace.';

/** Le débit de l'autosave, celui de `useDraftAutosave` (React) : une écriture au plus par seconde de calme. */
export const DELAI_AUTOSAVE_MS = 1000;

/** Les numéros d'étape que `bidding_strategy_drafts.current_step` accepte (`DraftUpsertSchema`). */
const ETAPE_MIN = 1;
const ETAPE_MAX = 5;


/**
 * ⑥ Plan — l'ÉTAT de la campagne courante (lot 6, T2) : la campagne (`?campagne=`), le brouillon `ProgDraft`, la
 * stratégie existante, les canaux de la campagne et les CP des extractions lus.
 *
 * PRÉREMPLISSAGE SÉQUENTIEL ANNULABLE : campagne → espace actif (`verifierEspace`) → stratégie existante → brouillon serveur → canaux, UNE requête à la
 * fois (≤ 3 simultanées, CLAUDE.md), dans un seul abonnement. Changer de campagne le DÉSABONNE (les requêtes partent à
 * la corbeille) et invalide son jeton : la réponse tardive de A ne s'écrit jamais dans B. Le brouillon serveur PRIME
 * sur la stratégie (règle `restoredAppliedRef` de React) ; seule l'identité de la campagne en complète les champs vides.
 *
 * AUTOSAVE : `modifier` et `definirEtape` (gestes de l'écran) programment une écriture débouncée
 * (`DELAI_AUTOSAVE_MS`) ; le préremplissage écrit le signal directement et ne programme RIEN — on ne ressauve pas ce
 * qu'on vient de lire. Zoneless : la minuterie écrit des signaux (`sauveLe`), la vue suit. Aucun `effect`.
 *
 * P-e : fourni par la PAGE (`carte.fournisseurs.ts`) ; détruit (changement d'espace), tout est annulé et plus rien
 * n'est écrit dans l'URL ni au serveur.
 */
@Injectable()
export class PlanCampagneService {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(PlanApi);
  private readonly organisations = inject(OrganisationsApi);

  private readonly _campagne = signal<string | null>(null);
  private readonly _brouillon = signal<ProgDraft>(DEFAULT_PROG_DRAFT);
  private readonly _detail = signal<Campagne | null>(null);
  private readonly _strategie = signal<{ id: string; statut: StatutStrategie } | null>(null);
  private readonly _canaux = signal<CanauxCampagne | null>(null);
  private readonly _restaure = signal<{ savedAt: string } | null>(null);
  private readonly _prerempli = signal(false);
  private readonly _erreur = signal<string | null>(null);
  private readonly _accesRefuse = signal(false);
  private readonly _etape = signal(ETAPE_MIN);
  private readonly _sauveLe = signal<string | null>(null);
  private readonly _extractions = signal<ReadonlyMap<string, readonly ExtractionJeu[]>>(new Map());

  readonly campagne: Signal<string | null> = this._campagne.asReadonly();
  readonly brouillon: Signal<ProgDraft> = this._brouillon.asReadonly();
  /** La campagne lue (`GET /api/admin/campaigns/[id]`), `null` avant sa lecture. */
  readonly detail: Signal<Campagne | null> = this._detail.asReadonly();
  /** La stratégie la plus récente de la campagne (le conteneur du plan), `null` s'il n'y en a pas. */
  readonly strategieExistante: Signal<{ id: string; statut: StatutStrategie } | null> = this._strategie.asReadonly();
  /** Catalogue, connexions et sélection stockée des canaux de la campagne. */
  readonly canaux: Signal<CanauxCampagne | null> = this._canaux.asReadonly();
  /**
   * Le catalogue RÉSOLU (disponibilité selon les connexions de l'espace, ou démo), `null` avant la lecture des canaux.
   * Une seule résolution pour la source, les plateformes, les impressions et le pied (revue finale, F-1).
   */
  readonly catalogue: Signal<readonly ResolvedChannel[] | null> = computed(() => {
    const c = this._canaux();
    return c ? resolveChannelAvailability(c.catalog, c.connectedProviders, c.is_demo) : null;
  });
  private readonly libelles = computed(() => new Map((this.catalogue() ?? []).map((r) => [r.code, r.label])));
  /** Le libellé d'un code de canal, lu dans le catalogue (le code à défaut). Réactif : lit un `computed`. */
  readonly libelleCanal = (code: string): string => this.libelles().get(code) ?? code;
  /** Un brouillon serveur a été restauré (bannière « Brouillon restauré · Repartir de zéro »). */
  readonly restaure: Signal<{ savedAt: string } | null> = this._restaure.asReadonly();
  /** Le préremplissage est fini : l'écran peut éditer, l'autosave écrire. */
  readonly prerempli: Signal<boolean> = this._prerempli.asReadonly();
  readonly erreur: Signal<string | null> = this._erreur.asReadonly();
  /** Le rôle ne permet pas la gestion des campagnes (401/403) : préremplissage terminé, aucune écriture. */
  readonly accesRefuse: Signal<boolean> = this._accesRefuse.asReadonly();
  /** L'« étape » envoyée au brouillon : la section dépliée la plus basse (A-2). */
  readonly etape: Signal<number> = this._etape.asReadonly();
  /** L'heure de la dernière sauvegarde réussie (`last_saved_at`). */
  readonly sauveLe: Signal<string | null> = this._sauveLe.asReadonly();

  /**
   * L'extraction du brouillon avec son résumé figé, dès que la section Cible a lu les versions de son jeu (`retenir
   * Extractions`) : les sections Plateformes et Impressions y lisent maille, unités et taux d'utile (A-5, A-10).
   */
  readonly extraction: Signal<ExtractionJeu | null> = computed(() => {
    const j = this._brouillon().jeuZones;
    return (j?.extraction && this._extractions().get(j.id)?.find((x) => x.id === j.extraction?.id)) || null;
  });
  /** Les plateformes cochées (DSP puis réseaux), chiffrées : budget, CPM prévu, impressions prévues (A-10). */
  readonly previsions = computed(() => {
    const d = this._brouillon();
    return previsions([...d.channels.dsps, ...d.channels.socials], d.channelBudgets, d.cpmPrevus ?? {});
  });
  /** Les totaux affichés ET envoyés au lancement (`total_budget`, `kpi_target`, `forecast_cpm`) : une seule source. */
  readonly totaux = computed(() => totauxPrevus(this.previsions()));

  /**
   * Jeton de la CAMPAGNE : invalidé à chaque changement de campagne. Le préremplissage et la sauvegarde d'une campagne
   * quittée ne s'écrivent plus dans l'état de la suivante — mais rien n'est supprimé : son brouillon reste valide.
   */
  private jeton = 0;
  /**
   * Remises à zéro du BROUILLON, PAR CAMPAGNE : incrémentée quand son brouillon est jeté (`jeterBrouillonsDe`). Une
   * sauvegarde déjà partie, ou un brouillon serveur en cours de lecture, d'avant la remise ne s'appliquent plus, et la
   * ligne recréée par la sauvegarde est supprimée (relecture 1). Un changement de campagne ne la touche pas : sinon il
   * supprimerait le brouillon en vol de la précédente. Par campagne (revue finale) : « Repartir de zéro » sur B ne
   * supprime pas la sauvegarde de A revenue après coup.
   */
  private readonly remises = new Map<string, number>();
  private remiseDe(campagne: string): number {
    return this.remises.get(campagne) ?? 0;
  }
  private chargement: Subscription | null = null;
  private minuterie: ReturnType<typeof setTimeout> | null = null;
  private brouillonId: string | null = null;
  private readonly cps = new CpsExtractions((jeu, version, plateforme) => this.api.cpExtraction(jeu, version, plateforme));
  private detruit = false;

  constructor() {
    this.appliquerUrl(this.route.snapshot.queryParamMap.get(PARAM_CAMPAGNE));
    const abonnement = this.route.queryParamMap.subscribe((p) => this.appliquerUrl(p.get(PARAM_CAMPAGNE)));
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      abonnement.unsubscribe();
      this.annuler();
      this.cps.annuler();
    });
  }

  /** Ouvre (ou ferme, `null`) une campagne : l'URL est réécrite, le préremplissage repart de zéro. */
  choisirCampagne(id: string | null): void {
    const valide = id === null ? null : lireUuid(id);
    if (valide === this._campagne()) return;
    this.ouvrir(valide);
    this.ecrireUrl();
  }

  /** « Nouvelle campagne » (hall et sélecteur) : la coquille naît côté serveur (nom par défaut), puis elle est ouverte. */
  creerCampagne(): Observable<{ id: string; name: string }> {
    return this.api.creerCampagne().pipe(map((r) => r.campaign), tap((c) => { if (!this.detruit) this.choisirCampagne(c.id); }));
  }

  /** Un geste de l'écran sur le brouillon : jamais muté, autosauvé après `DELAI_AUTOSAVE_MS` de calme. */
  modifier(maj: (d: ProgDraft) => ProgDraft): void {
    this._brouillon.update(maj);
    this.programmerSauvegarde();
  }

  /** La section dépliée la plus basse (1 à 5) ; un changement se sauve comme une modification (React). */
  definirEtape(n: number): void {
    const etape = Math.min(ETAPE_MAX, Math.max(ETAPE_MIN, Math.round(n)));
    if (etape === this._etape()) return;
    this._etape.set(etape);
    this.programmerSauvegarde();
  }

  /** « Repartir de zéro » : le brouillon serveur est jeté, le défaut repart, prérempli de l'identité de la campagne. */
  repartirDeZero(): void {
    const campagne = this._campagne();
    if (campagne) this.jeterBrouillonsDe(campagne);
    const camp = this._detail();
    this._brouillon.set(camp ? remplirIdentite(DEFAULT_PROG_DRAFT, camp) : DEFAULT_PROG_DRAFT);
    this._restaure.set(null);
    this._etape.set(ETAPE_MIN);
  }

  /** Les versions lues d'un jeu (section Cible) : une extraction est figée, la liste vaut pour la vie de la page. */
  retenirExtractions(jeu: string, liste: readonly ExtractionJeu[]): void {
    this._extractions.update((m) => new Map(m).set(jeu, liste));
  }

  /**
   * Le lancement a réussi (T6) : le brouillon serveur n'a plus lieu d'être (`handleLaunched` de React), la stratégie
   * écrite devient l'existante (« Modification », pastille ⑥) et l'identité persistée remplace celle lue. Les canaux
   * ÉCRITS par le lancement (`PUT canaux`) remplacent ceux lus au préremplissage — ⑦ en tire ses cartes et l'annonceur
   * DV360 (lot 7, relecture 2, I-2) ; une sous-clé absente du corps garde sa valeur, comme côté serveur.
   */
  apresLancement(strategie: string, identite: CorpsCampagne | null, canaux?: CorpsCanaux): void {
    const campagne = this._campagne();
    if (campagne) this.jeterBrouillonsDe(campagne);
    this._restaure.set(null);
    if (canaux) {
      const ecrits = Object.fromEntries(Object.entries(canaux).filter(([, v]) => v !== undefined));
      this._canaux.update((c) => (c ? { ...c, selected: { ...c.selected, ...ecrits } } : c));
    }
    this._strategie.set({ id: strategie, statut: 'active' });
    if (identite) this._detail.update((c) => (c ? { ...c, ...identite, name: identite.name ?? c.name } : c));
  }

  /** Les CP achetés d'une extraction (d'une plateforme si donnée), s'ils sont lus. Une extraction est figée : jamais périmés. */
  cpDe(jeu: string, version: number, plateforme?: string): CpDExtraction | null {
    return this.cps.de(jeu, version, plateforme);
  }

  erreurCp(jeu: string, version: number, plateforme?: string): string | null {
    return this.cps.erreur(jeu, version, plateforme);
  }

  /** Lit les CP d'une extraction, une fois par (jeu, version, plateforme) : au clic « Voir par CP » (A-11). */
  chargerCp(jeu: string, version: number, plateforme?: string): void {
    if (!this.detruit) this.cps.charger(jeu, version, plateforme);
  }

  /**
   * Une étape du lancement a échoué APRÈS `rattacher` (revue finale, m3) : la stratégie écrite est active en base. Sur
   * la campagne ouverte, elle devient l'existante (titre « Modification », pastille ⑥) ; le brouillon est GARDÉ.
   */
  poserStrategie(campagne: string, strategie: string): void {
    if (campagne === this._campagne()) this._strategie.set({ id: strategie, statut: 'active' });
  }

  /**
   * Jette le brouillon serveur d'une campagne — LE seul chemin (« Repartir de zéro », lancement réussi, campagne ouverte
   * ou non ; revue finale F-6). Campagne QUITTÉE : ses brouillons sont lus puis supprimés, au mieux (`discard` de
   * React). Campagne OUVERTE : l'autosave s'arrête et la `remise` change (relecture 1) — l'identifiant connu est
   * supprimé, une sauvegarde partie avant supprime la ligne qu'elle recrée, et un brouillon encore en lecture par le
   * préremplissage est supprimé à son retour au lieu d'être restauré (m4 : lancement réussi pendant le préremplissage).
   */
  jeterBrouillonsDe(campagne: string): void {
    if (this.detruit) return;
    if (campagne !== this._campagne()) {
      this.supprimerBrouillons(this.api.brouillons(campagne).pipe(map((r) => r.drafts.filter((d) => d.campaign_id === campagne))));
      return;
    }
    this.arreterMinuterie();
    this.remises.set(campagne, this.remiseDe(campagne) + 1);
    const id = this.brouillonId;
    this.brouillonId = null;
    if (id) this.api.supprimerBrouillon(id).subscribe({ error: () => undefined });
  }

  /** Supprime, une à une et au mieux, les lignes de brouillon données. */
  private supprimerBrouillons(lignes: Observable<readonly { id: string }[]>): void {
    lignes.pipe(
      concatMap((l) => from(l)),
      concatMap((d) => this.api.supprimerBrouillon(d.id)),
    ).subscribe({ error: () => undefined });
  }

  /** Une valeur lue dans l'URL ; illisible (pas un uuid, même forme que `?zoneAnalyse=` et `?jeu=`), elle est retirée une fois. */
  private appliquerUrl(brut: string | null): void {
    const id = brut === null ? null : lireUuid(brut);
    if (id !== this._campagne()) this.ouvrir(id);
    if (brut !== null && id === null) this.ecrireUrl();
  }

  private ouvrir(id: string | null): void {
    this.annuler();
    this._campagne.set(id);
    this._brouillon.set(DEFAULT_PROG_DRAFT);
    this._detail.set(null);
    this._strategie.set(null);
    this._canaux.set(null);
    this._restaure.set(null);
    this._prerempli.set(false);
    this._erreur.set(null);
    this._accesRefuse.set(false);
    this._etape.set(ETAPE_MIN);
    this._sauveLe.set(null);
    this.brouillonId = null;
    if (id) this.preremplir(id);
  }

  /** Campagne → stratégie → brouillon → canaux, une requête à la fois, dans UN abonnement annulable. */
  private preremplir(id: string): void {
    const jeton = this.jeton;
    const remise = this.remiseDe(id);
    const enCours = () => jeton === this.jeton;
    this.chargement = this.api.campagne(id).pipe(
      catchError((e: unknown) => throwError(() => classer(e))),
      // Une campagne d'un AUTRE espace est introuvable ici (D-1) : rien d'elle ne s'écrit dans l'état.
      switchMap((r) => verifierEspace(r.campaign, this.organisations, this.api).pipe(map(() => r))),
      tap(({ campaign }) => {
        this._detail.set(campaign);
        this._brouillon.update((d) => remplirIdentite(d, campaign));
      }),
      // Best-effort comme React : une stratégie ou un brouillon illisible ne bloque pas le plan.
      // La SEULE plus récente de la campagne (`?campaign_id=`, `limit(1)`), jamais toute la liste de l'espace.
      switchMap(() => this.api.strategies(id).pipe(catchError(() => of({ strategies: [] })))),
      switchMap(({ strategies }) => {
        const s = strategies.find((x) => x.campaign_id === id);
        this._strategie.set(s ? { id: s.id, statut: s.status } : null);
        return s ? this.api.strategie(s.id).pipe(map((r) => r.strategy), catchError(() => of(null))) : of(null);
      }),
      tap((s) => { if (s) this._brouillon.update((d) => remplirDepuisStrategie(d, s)); }),
      switchMap(() => this.api.brouillons(id).pipe(catchError(() => of({ drafts: [] })))),
      // Brouillon jeté pendant la lecture (« Repartir de zéro », lancement réussi) : supprimé, jamais restauré par-dessus.
      tap(({ drafts }) => {
        if (remise === this.remiseDe(id)) this.restaurer(drafts[0]);
        else if (!this.detruit) this.supprimerBrouillons(of(drafts.filter((d) => d.campaign_id === id)));
      }),
      switchMap(() => this.api.canaux(id).pipe(catchError((e: unknown) => throwError(() => classer(e))))),
    ).subscribe({
      next: (c) => {
        if (!enCours()) return;
        this._canaux.set(c);
        this._brouillon.update((d) => remplirCanaux(d, c.selected));
        this._prerempli.set(true);
      },
      error: (e: unknown) => {
        if (!enCours()) return;
        if (e instanceof CampagneIntrouvable) {
          this.ouvrir(null);
          this._erreur.set(MESSAGE_CAMPAGNE_INTROUVABLE);
          this.ecrireUrl();
        } else if (e instanceof AccesRefuse) {
          this._accesRefuse.set(true);
          this._erreur.set(MESSAGE_RESERVE_ADMIN);
          this._prerempli.set(true);
        } else {
          this._erreur.set(messageErreurApi(e));
        }
      },
    });
  }

  /** Le brouillon serveur PRIME (React : `restoredAppliedRef`) ; l'identité n'en complète que les champs vides. */
  private restaurer(ligne: { id: string; draft_data: unknown; current_step: number; last_saved_at: string } | undefined): void {
    const lu = ligne ? deserializeDraft(ligne.draft_data) : null;
    if (!ligne || !lu) return;
    const camp = this._detail();
    this.brouillonId = ligne.id;
    this._brouillon.set(camp ? remplirIdentite(lu, camp) : lu);
    this._etape.set(Math.min(ETAPE_MAX, Math.max(ETAPE_MIN, ligne.current_step ?? ETAPE_MIN)));
    this._restaure.set({ savedAt: ligne.last_saved_at });
  }

  private programmerSauvegarde(): void {
    const campagne = this._campagne();
    if (!campagne || !this._prerempli() || this._accesRefuse() || this.detruit) return;
    this.arreterMinuterie();
    const jeton = this.jeton;
    const remise = this.remiseDe(campagne);
    this.minuterie = setTimeout(() => {
      this.minuterie = null;
      this.sauver(campagne, jeton, remise).subscribe({ error: () => undefined });
    }, DELAI_AUTOSAVE_MS);
  }

  /**
   * L'écriture du brouillon courant. Revenue après « Repartir de zéro » : la ligne qu'elle a recréée APRÈS la suppression
   * est rejetée. Revenue après un changement de campagne : seulement ignorée — c'est le brouillon VALIDE de la campagne
   * quittée, et son identifiant ou son heure ne s'écrivent pas dans l'état de la nouvelle.
   */
  private sauver(campagne: string, jeton: number, remise: number): Observable<unknown> {
    const corps = { campaign_id: campagne, current_step: this._etape(), draft_data: serializeDraft(this._brouillon()) };
    return this.api.sauverBrouillon(corps).pipe(tap(({ draft }) => {
      if (remise !== this.remiseDe(campagne)) {
        if (!this.detruit) this.api.supprimerBrouillon(draft.id).subscribe({ error: () => undefined });
        return;
      }
      if (jeton !== this.jeton) return;
      this.brouillonId = draft.id;
      this._sauveLe.set(draft.last_saved_at);
    }));
  }

  /** Désabonne le préremplissage, arrête l'autosave et invalide le jeton. */
  private annuler(): void {
    this.chargement?.unsubscribe();
    this.chargement = null;
    this.arreterMinuterie();
    this.jeton++;
  }

  private arreterMinuterie(): void {
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
  }

  private ecrireUrl(): void {
    if (!this.detruit) void ecrireParametres(this.router, this.route, { [PARAM_CAMPAGNE]: this._campagne() });
  }
}
