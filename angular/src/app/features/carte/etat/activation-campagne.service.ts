import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, type Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { type Subscription, concatMap, map, of, tap } from 'rxjs';
import { messageErreurApi } from '../../../core/http/erreurs';
import { ActivationApi, type LigneFlux, type LotActivation, type Prevol } from '../data/activation.api';
import { JeuxApi } from '../data/jeux.api';
import { type BandeauActivation, bandeauActivation, lotAbouti } from '../logique/activation/bandeau';
import { type CarteActivation, cartesActivation } from '../logique/activation/cartes';
import { lireLineItems, refusLineItems } from '../logique/activation/line-items';
import type { PlateformeGeo } from '../logique/jeu/plateformes';
import { PlanCampagneService } from './plan-campagne.service';

/** Le message d'une poussée refusée avant son flux : `message ?? error` comme React (`ActivationPanel.tsx:189`). */
export function messagePoussee(e: unknown): string {
  if (e instanceof HttpErrorResponse && e.status !== 0) {
    let corps: unknown = e.error;
    if (typeof corps === 'string') {
      try { corps = JSON.parse(corps); } catch { corps = null; }
    }
    const c = corps as { message?: unknown; error?: unknown } | null;
    if (c && typeof c.message === 'string' && c.message) return c.message;
    if (c && typeof c.error === 'string' && c.error) return c.error;
  }
  return messageErreurApi(e);
}

/** Un message lié à SA campagne : affiché sur elle seule. */
interface MessageDe { campagne: string; texte: string }

/**
 * ⑦ Activation — l'ÉTAT de l'étape pour la campagne courante (lot 7, T3) : pré-vol, historique, cartes par plateforme,
 * bandeau, poussée DV360, publication du plan, annulation d'un lot.
 *
 * AUCUNE LECTURE AVANT L'ESPACE VALIDÉ (piège n° 3) : les routes admin ne filtrent pas l'espace pour le super_admin ;
 * rien ne part tant que `PlanCampagneService` n'a pas fini son préremplissage (`verifierEspace`) pour CETTE campagne
 * (`prerempli && detail.id === campagne`, accès non refusé). Jamais sur le seul `?campagne=`.
 *
 * LECTURE SÉQUENTIELLE ANNULABLE : pré-vol → historique → registre des plateformes (une fois) → extractions du jeu du
 * plan si `PlanCampagneService` ne les a pas déjà, en UN abonnement. Changer de campagne le désabonne et invalide son
 * jeton : une réponse tardive de A ne s'écrit jamais dans B. Relue après une poussée, une publication, une annulation.
 *
 * LA POUSSÉE APPARTIENT À SA CAMPAGNE (A-10) : changer de campagne ou d'étape ne l'interrompt pas — son flux reste lié
 * à A et réapparaît quand on revient sur A ; sur B, `pousseeEnCours` dit qu'une poussée tourne ailleurs. Un changement
 * d'ESPACE recrée la page, donc ce service : l'abonnement est coupé, la requête abandonnée, et le serveur s'arrête à la
 * cible suivante en clôturant le lot (`cancel()` puis `finally` de la route `pousser`).
 *
 * Fourni par la PAGE (`carte.fournisseurs.ts`), jamais à la racine. Valeurs dérivées en `computed` ; un seul `effect`,
 * qui déclenche la lecture (une API impérative) quand la campagne validée change.
 */
@Injectable()
export class ActivationCampagneService {
  private readonly plan = inject(PlanCampagneService);
  private readonly api = inject(ActivationApi);
  private readonly jeux = inject(JeuxApi);

  private readonly _prevol = signal<Prevol | null>(null);
  private readonly _lots = signal<readonly LotActivation[]>([]);
  private readonly _registre = signal<PlateformeGeo[] | null>(null);
  private readonly _chargement = signal(false);
  private readonly _erreurLecture = signal<string | null>(null);
  private readonly _erreur = signal<MessageDe | null>(null);
  private readonly _annulation = signal<MessageDe | null>(null);
  private readonly _flux = signal<{ campagne: string; lignes: readonly LigneFlux[] } | null>(null);
  private readonly _pousseeEnCours = signal<{ campagne: string } | null>(null);
  private readonly _publication = signal<string | null>(null);

  /** La campagne dont l'espace est VALIDÉ ; `null` tant que rien ne doit être lu. */
  readonly validee: Signal<string | null> = computed(() => {
    const c = this.plan.campagne();
    return c && this.plan.prerempli() && !this.plan.accesRefuse() && this.plan.detail()?.id === c ? c : null;
  });

  readonly prevol: Signal<Prevol | null> = this._prevol.asReadonly();
  readonly lots: Signal<readonly LotActivation[]> = this._lots.asReadonly();
  readonly chargement: Signal<boolean> = this._chargement.asReadonly();
  /** L'erreur de lecture, sinon celle d'un geste (poussée, publication) de la campagne courante. */
  readonly erreur: Signal<string | null> = computed(() => this._erreurLecture() ?? this.deCourante(this._erreur()));
  /** Le message de la route d'annulation, affiché tel quel (il dit ce qui N'A PAS été fait). */
  readonly messageAnnulation: Signal<string | null> = computed(() => this.deCourante(this._annulation()));
  /** Le flux de la poussée de la campagne courante (en cours ou terminée), vide sinon. */
  readonly flux: Signal<readonly LigneFlux[]> = computed(() => {
    const f = this._flux();
    return f && f.campagne === this.plan.campagne() ? f.lignes : [];
  });
  /** La poussée en cours, quelle que soit sa campagne : sur une autre, l'écran désactive Pousser (A-10). */
  readonly pousseeEnCours: Signal<{ campagne: string } | null> = this._pousseeEnCours.asReadonly();
  /** Une publication est en cours pour la campagne courante. */
  readonly publication: Signal<boolean> = computed(() => this._publication() !== null && this._publication() === this.plan.campagne());

  /** La pastille de ⑦ (A-11) : un lot `termine` ou `partiel` (donc non annulé) pour la campagne courante, lu dans l'historique chargé. */
  readonly renseignee: Signal<boolean> = computed(() => this._lots().some(lotAbouti));

  readonly cartes: Signal<CarteActivation[]> = computed(() => {
    const canaux = this.plan.canaux()?.selected;
    if (!this.validee() || !canaux) return [];
    const extraction = this.plan.extraction();
    return cartesActivation({
      canaux: [...canaux.dsps, ...canaux.socials],
      extraction,
      typeJeu: extraction ? (extraction.plateformes === null ? 'risque' : 'zone') : null,
      prevol: this._prevol(),
      registre: this._registre() ?? [],
    });
  });
  readonly bandeau: Signal<BandeauActivation> = computed(() => bandeauActivation(this.cartes(), this._lots()));

  private jeton = 0;
  private lecture: Subscription | null = null;
  private poussee: Subscription | null = null;
  private derniere: string | null = null;
  private detruit = false;

  constructor() {
    effect(() => {
      const c = this.validee();
      untracked(() => {
        if (c === this.derniere) return;
        this.derniere = c;
        this.ouvrir(c);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      this.annulerLecture();
      // Changement d'espace : la requête est abandonnée ; le serveur clôt le lot à la cible suivante (voir l'en-tête).
      this.poussee?.unsubscribe();
    });
  }

  /** Relit pré-vol et historique de la campagne courante ; ce qui est affiché le reste jusqu'aux réponses. */
  relire(): void {
    const c = this.validee();
    if (c && !this.detruit) this.lire(c);
  }

  /**
   * Pousse le ciblage DV360 vers les line items saisis. Refusé sans appel : pas de campagne validée, une poussée en
   * cours (ici ou ailleurs), un pré-vol non activable, un annonceur vide, une saisie sans identifiant ou au-delà de 50.
   */
  pousser(advertiserId: string, lineItems: string): void {
    const c = this.validee();
    const annonceur = advertiserId.trim();
    if (!c || this.detruit || this._pousseeEnCours() || !this._prevol()?.activable || !annonceur) return;
    const refus = refusLineItems(lireLineItems(lineItems));
    if (refus) {
      this._erreur.set({ campagne: c, texte: refus });
      return;
    }
    const { ids } = lireLineItems(lineItems);
    this._erreur.set(null);
    this._pousseeEnCours.set({ campagne: c });
    this._flux.set({ campagne: c, lignes: [] });
    const fin = () => {
      this.poussee = null;
      this._pousseeEnCours.set(null);
      if (this.validee() === c) this.relire();
    };
    this.poussee = this.api.pousser(c, { canal: 'dv360', advertiser_id: annonceur, cibles: ids.map((line_item_id) => ({ line_item_id })) })
      .subscribe({
        next: (l) => this._flux.update((f) => (f && f.campagne === c ? { campagne: c, lignes: [...f.lignes, l] } : f)),
        error: (e: unknown) => {
          this._erreur.set({ campagne: c, texte: messagePoussee(e) });
          fin();
        },
        complete: fin,
      });
  }

  /** Publie le plan (`strategie.id` du pré-vol), puis relit : le motif levé disparaît. */
  publier(): void {
    const c = this.validee();
    const s = this._prevol()?.strategie;
    if (!c || !s || this.detruit || this._publication()) return;
    this._publication.set(c);
    this._erreur.set(null);
    this.api.publier(s.id).subscribe({
      next: () => {
        this._publication.set(null);
        if (this.validee() === c) this.relire();
      },
      error: (e: unknown) => {
        this._publication.set(null);
        this._erreur.set({ campagne: c, texte: messageErreurApi(e) });
      },
    });
  }

  /** Marque un lot annulé (confirmé par l'écran) ; le message de la route est affiché tel quel, succès ou refus. */
  annuler(lot: string): void {
    const c = this.validee();
    if (!c || this.detruit) return;
    this._annulation.set(null);
    this.api.annuler(c, lot).subscribe({
      next: (r) => {
        this._annulation.set({ campagne: c, texte: r.message });
        if (this.validee() === c) this.relire();
      },
      error: (e: unknown) => this._annulation.set({ campagne: c, texte: messageErreurApi(e) }),
    });
  }

  private deCourante(m: MessageDe | null): string | null {
    return m && m.campagne === this.plan.campagne() ? m.texte : null;
  }

  /** Une nouvelle campagne validée (ou aucune) : l'état de la précédente est effacé, puis lu. */
  private ouvrir(c: string | null): void {
    this.annulerLecture();
    this._prevol.set(null);
    this._lots.set([]);
    this._erreurLecture.set(null);
    if (c) this.lire(c);
  }

  private lire(c: string): void {
    this.annulerLecture();
    const jeton = this.jeton;
    const valide = () => jeton === this.jeton;
    this._chargement.set(true);
    this._erreurLecture.set(null);
    this.lecture = this.api.prevol(c).pipe(
      tap((p) => { if (valide()) this._prevol.set(p); }),
      concatMap(() => this.api.historique(c)),
      tap((h) => { if (valide()) this._lots.set(h.lots ?? []); }),
      concatMap(() => (this._registre() ? of(null) : this.jeux.plateformes().pipe(map((r) => r.plateformes)))),
      tap((r) => { if (r && valide()) this._registre.set(r); }),
      concatMap(() => {
        const jeu = this.plan.brouillon().jeuZones;
        if (!jeu?.extraction || this.plan.extraction()) return of(null);
        return this.jeux.extractions(jeu.id).pipe(map((r) => ({ jeu: jeu.id, liste: r.extractions })));
      }),
    ).subscribe({
      next: (x) => {
        if (!valide()) return;
        if (x) this.plan.retenirExtractions(x.jeu, x.liste);
        this.lecture = null;
        this._chargement.set(false);
      },
      error: (e: unknown) => {
        if (!valide()) return;
        this.lecture = null;
        this._chargement.set(false);
        this._erreurLecture.set(messageErreurApi(e));
      },
    });
  }

  private annulerLecture(): void {
    this.lecture?.unsubscribe();
    this.lecture = null;
    this.jeton++;
    this._chargement.set(false);
  }
}
