import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, type Signal, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { type Observable, type Subscription, catchError, map, of, switchMap, tap, throwError } from 'rxjs';
import { messageErreurApi } from '../../../core/http/erreurs';
import { type Campagne, type CanauxCampagne, type CpDExtraction, PlanApi, type StatutStrategie } from '../data/plan.api';
import { DEFAULT_PROG_DRAFT, type ProgDraft, deserializeDraft, serializeDraft } from '../logique/plan/brouillon';
import { remplirCanaux, remplirDepuisStrategie, remplirIdentite } from '../logique/plan/preremplissage';
import { lireZoneAnalyse } from '../logique/analyses/couverture';
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

class CampagneIntrouvable extends Error {}

/**
 * Un 404 = campagne absente, ou d'un autre espace (`checkCampaignAccess` des canaux rend 404, jamais 403). Un 403 de
 * `GET /api/admin/campaigns/[id]` (`requireAdmin`) dit le RÔLE, pas l'absence : il reste une erreur, le paramètre reste.
 */
const introuvable = (e: unknown) => (e instanceof HttpErrorResponse && e.status === 404 ? new CampagneIntrouvable() : e);

/**
 * ⑥ Plan — l'ÉTAT de la campagne courante (lot 6, T2) : la campagne (`?campagne=`), le brouillon `ProgDraft`, la
 * stratégie existante, les canaux de la campagne et les CP des extractions lus.
 *
 * PRÉREMPLISSAGE SÉQUENTIEL ANNULABLE : campagne → stratégie existante → brouillon serveur → canaux, UNE requête à la
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

  private readonly _campagne = signal<string | null>(null);
  private readonly _brouillon = signal<ProgDraft>(DEFAULT_PROG_DRAFT);
  private readonly _detail = signal<Campagne | null>(null);
  private readonly _strategie = signal<{ id: string; statut: StatutStrategie } | null>(null);
  private readonly _canaux = signal<CanauxCampagne | null>(null);
  private readonly _restaure = signal<{ savedAt: string } | null>(null);
  private readonly _prerempli = signal(false);
  private readonly _erreur = signal<string | null>(null);
  private readonly _etape = signal(ETAPE_MIN);
  private readonly _sauveLe = signal<string | null>(null);
  private readonly _cps = signal<ReadonlyMap<string, CpDExtraction>>(new Map());
  private readonly _erreursCp = signal<ReadonlyMap<string, string>>(new Map());

  readonly campagne: Signal<string | null> = this._campagne.asReadonly();
  readonly brouillon: Signal<ProgDraft> = this._brouillon.asReadonly();
  /** La campagne lue (`GET /api/admin/campaigns/[id]`), `null` avant sa lecture. */
  readonly detail: Signal<Campagne | null> = this._detail.asReadonly();
  /** La stratégie la plus récente de la campagne (le conteneur du plan), `null` s'il n'y en a pas. */
  readonly strategieExistante: Signal<{ id: string; statut: StatutStrategie } | null> = this._strategie.asReadonly();
  /** Catalogue, connexions et sélection stockée des canaux de la campagne. */
  readonly canaux: Signal<CanauxCampagne | null> = this._canaux.asReadonly();
  /** Un brouillon serveur a été restauré (bannière « Brouillon restauré · Repartir de zéro »). */
  readonly restaure: Signal<{ savedAt: string } | null> = this._restaure.asReadonly();
  /** Le préremplissage est fini : l'écran peut éditer, l'autosave écrire. */
  readonly prerempli: Signal<boolean> = this._prerempli.asReadonly();
  readonly erreur: Signal<string | null> = this._erreur.asReadonly();
  /** L'« étape » envoyée au brouillon : la section dépliée la plus basse (A-2). */
  readonly etape: Signal<number> = this._etape.asReadonly();
  /** L'heure de la dernière sauvegarde réussie (`last_saved_at`). */
  readonly sauveLe: Signal<string | null> = this._sauveLe.asReadonly();

  private jeton = 0;
  private chargement: Subscription | null = null;
  private minuterie: ReturnType<typeof setTimeout> | null = null;
  private brouillonId: string | null = null;
  private readonly lecturesCp = new Map<string, Subscription>();
  private detruit = false;

  constructor() {
    this.appliquerUrl(this.route.snapshot.queryParamMap.get(PARAM_CAMPAGNE));
    const abonnement = this.route.queryParamMap.subscribe((p) => this.appliquerUrl(p.get(PARAM_CAMPAGNE)));
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      abonnement.unsubscribe();
      this.annuler();
      for (const s of this.lecturesCp.values()) s.unsubscribe();
    });
  }

  /** Ouvre (ou ferme, `null`) une campagne : l'URL est réécrite, le préremplissage repart de zéro. */
  choisirCampagne(id: string | null): void {
    const valide = id === null ? null : lireZoneAnalyse(id);
    if (valide === this._campagne()) return;
    this.ouvrir(valide);
    this.ecrireUrl();
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
    this.arreterMinuterie();
    const id = this.brouillonId;
    this.brouillonId = null;
    if (id) this.api.supprimerBrouillon(id).subscribe({ error: () => undefined });
    const camp = this._detail();
    this._brouillon.set(camp ? remplirIdentite(DEFAULT_PROG_DRAFT, camp) : DEFAULT_PROG_DRAFT);
    this._restaure.set(null);
    this._etape.set(ETAPE_MIN);
  }

  /** Les CP achetés d'une extraction (d'une plateforme si donnée), s'ils sont lus. Une extraction est figée : jamais périmés. */
  cpDe(jeu: string, version: number, plateforme?: string): CpDExtraction | null {
    return this._cps().get(cleCp(jeu, version, plateforme)) ?? null;
  }

  erreurCp(jeu: string, version: number, plateforme?: string): string | null {
    return this._erreursCp().get(cleCp(jeu, version, plateforme)) ?? null;
  }

  /** Lit les CP d'une extraction, une fois par (jeu, version, plateforme) : au clic « Voir par CP » (A-11). */
  chargerCp(jeu: string, version: number, plateforme?: string): void {
    const cle = cleCp(jeu, version, plateforme);
    if (this.detruit || this._cps().has(cle) || this.lecturesCp.has(cle)) return;
    this._erreursCp.update((m) => sans(m, cle));
    this.lecturesCp.set(cle, this.api.cpExtraction(jeu, version, plateforme).subscribe({
      next: (r) => {
        this.lecturesCp.delete(cle);
        this._cps.update((m) => new Map(m).set(cle, r));
      },
      error: (e: unknown) => {
        this.lecturesCp.delete(cle);
        this._erreursCp.update((m) => new Map(m).set(cle, messageErreurApi(e)));
      },
    }));
  }

  /** Une valeur lue dans l'URL ; illisible (pas un uuid, même forme que `?zoneAnalyse=` et `?jeu=`), elle est retirée une fois. */
  private appliquerUrl(brut: string | null): void {
    const id = brut === null ? null : lireZoneAnalyse(brut);
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
    this._etape.set(ETAPE_MIN);
    this._sauveLe.set(null);
    this.brouillonId = null;
    if (id) this.preremplir(id);
  }

  /** Campagne → stratégie → brouillon → canaux, une requête à la fois, dans UN abonnement annulable. */
  private preremplir(id: string): void {
    const jeton = this.jeton;
    const enCours = () => jeton === this.jeton;
    this.chargement = this.api.campagne(id).pipe(
      catchError((e: unknown) => throwError(() => introuvable(e))),
      tap(({ campaign }) => {
        this._detail.set(campaign);
        this._brouillon.update((d) => remplirIdentite(d, campaign));
      }),
      // Best-effort comme React : une stratégie ou un brouillon illisible ne bloque pas le plan.
      switchMap(() => this.api.strategies().pipe(catchError(() => of({ strategies: [] })))),
      switchMap(({ strategies }) => {
        const s = strategies.find((x) => x.campaign_id === id);
        this._strategie.set(s ? { id: s.id, statut: s.status } : null);
        return s ? this.api.strategie(s.id).pipe(map((r) => r.strategy), catchError(() => of(null))) : of(null);
      }),
      tap((s) => { if (s) this._brouillon.update((d) => remplirDepuisStrategie(d, s)); }),
      switchMap(() => this.api.brouillons(id).pipe(catchError(() => of({ drafts: [] })))),
      tap(({ drafts }) => this.restaurer(drafts[0])),
      switchMap(() => this.api.canaux(id).pipe(catchError((e: unknown) => throwError(() => introuvable(e))))),
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
    if (!campagne || !this._prerempli() || this.detruit) return;
    this.arreterMinuterie();
    const jeton = this.jeton;
    this.minuterie = setTimeout(() => {
      this.minuterie = null;
      this.sauver(campagne, jeton).subscribe({ error: () => undefined });
    }, DELAI_AUTOSAVE_MS);
  }

  /** L'écriture du brouillon courant ; ignorée si la campagne a changé entre-temps (jeton). */
  private sauver(campagne: string, jeton: number): Observable<unknown> {
    const corps = { campaign_id: campagne, current_step: this._etape(), draft_data: serializeDraft(this._brouillon()) };
    return this.api.sauverBrouillon(corps).pipe(tap(({ draft }) => {
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

const cleCp = (jeu: string, version: number, plateforme?: string) => `${jeu}|${version}|${plateforme ?? ''}`;

function sans<V>(m: ReadonlyMap<string, V>, cle: string): ReadonlyMap<string, V> {
  if (!m.has(cle)) return m;
  const copie = new Map(m);
  copie.delete(cle);
  return copie;
}
