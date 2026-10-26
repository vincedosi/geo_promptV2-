import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, type Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { type Subscription, concatMap, map, of, tap } from 'rxjs';
import { messageErreurApi } from '../../../core/http/erreurs';
import { ActivationApi, type LigneFlux, type LotActivation, type MotifPrevol, type Prevol } from '../data/activation.api';
import { type ExtractionJeu, JeuxApi } from '../data/jeux.api';
import { type BandeauActivation, bandeauActivation, lotAbouti } from '../logique/activation/bandeau';
import { type CarteActivation, cartesActivation } from '../logique/activation/cartes';
import { lireLineItems, refusLineItems } from '../logique/activation/line-items';
import { texteMotif } from '../logique/activation/motifs';
import type { PlateformeGeo } from '../logique/jeu/plateformes';
import { ParcoursService } from './parcours.service';
import { PlanCampagneService } from './plan-campagne.service';

/**
 * Le message d'un geste refusé (poussée avant son flux, publication, annulation) — UN seul lecteur pour les trois
 * (revue finale du lot 7, F-5) : le premier motif du corps s'il y en a (le 409 de `pousser`), par `texteMotif` pour ne
 * jamais dire « stratégie » (M-5) ; sinon `message ?? error` comme React (`ActivationPanel.tsx:189`), jamais un code
 * brut comme `lot_en_cours` (M-4) ; sinon `messageErreurApi`. Le corps peut être du texte (`responseType: 'text'`).
 */
export function messageGeste(e: unknown): string {
  if (e instanceof HttpErrorResponse && e.status !== 0) {
    let corps: unknown = e.error;
    if (typeof corps === 'string') {
      try { corps = JSON.parse(corps); } catch { corps = null; }
    }
    const c = corps as { message?: unknown; error?: unknown; motifs?: unknown } | null;
    const m = Array.isArray(c?.motifs) ? (c.motifs[0] as Partial<MotifPrevol> | undefined) : undefined;
    if (m && typeof m.code === 'string' && typeof m.message === 'string') return texteMotif({ code: m.code, message: m.message });
    if (c && typeof c.message === 'string' && c.message) return c.message;
    if (c && typeof c.error === 'string' && c.error) return c.error;
  }
  return messageErreurApi(e);
}

/**
 * Le message d'une annulation réussie (preuve du lot 7, C-5) : la route rend un texte technique (« route de push »,
 * « geo IDs »), partagé avec React et laissé tel quel côté serveur ; l'écran Angular dit la même chose clairement.
 * DV360 est le seul canal poussé (`CorpsPoussee.canal`). Un REFUS garde le message de la route (`messageGeste`).
 */
export const MESSAGE_ANNULATION =
  'Lot marqué annulé. Les zones déjà envoyées restent actives chez DV360 : retirez-les dans DV360 si nécessaire.';

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
 * LECTURE SÉQUENTIELLE ANNULABLE : pré-vol → historique → registre des plateformes (une fois) → versions du jeu dont le
 * pré-vol nomme l'extraction (une fois par jeu), en UN abonnement. L'extraction des cartes est celle du PLAN LANCÉ
 * (`prevol.extraction`, lue sur la stratégie), jamais celle du brouillon de ⑥, qui a pu changer depuis ; les versions
 * lues sont aussi retenues dans `PlanCampagneService`. Une version absente des versions lues (relance sur une nouvelle
 * extraction du même jeu) fait relire la liste du jeu. Changer de campagne le désabonne et invalide son
 * jeton : une réponse tardive de A ne s'écrit jamais dans B. Relue après une poussée, une publication, une annulation.
 * À LA DEMANDE (revue finale du lot 7, M-3) : hors de ⑦, seule l'historique est lue (elle sert la pastille, A-11) ; la
 * lecture complète part à la première entrée dans ⑦ pour la campagne, puis à chaque relecture de celle-ci.
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
  private readonly parcours = inject(ParcoursService);
  private readonly api = inject(ActivationApi);
  private readonly jeux = inject(JeuxApi);

  private readonly _prevol = signal<Prevol | null>(null);
  private readonly _lots = signal<readonly LotActivation[]>([]);
  private readonly _registre = signal<PlateformeGeo[] | null>(null);
  private readonly _extractions = signal<ReadonlyMap<string, readonly ExtractionJeu[]>>(new Map());
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
  /**
   * Le message de la dernière annulation (il dit ce qui N'A PAS été fait) : `MESSAGE_ANNULATION`, ou le refus de la
   * route. Effacé au début d'une poussée, d'une publication ou d'un changement de campagne (preuve du lot 7, C-3).
   */
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
    const x = this._prevol()?.extraction;
    const extraction = (x && this._extractions().get(x.zone_set_id)?.find((v) => v.version === x.version)) || null;
    return cartesActivation({
      canaux: [...canaux.dsps, ...canaux.socials],
      extraction,
      prevol: this._prevol(),
      registre: this._registre() ?? [],
    });
  });
  readonly bandeau: Signal<BandeauActivation> = computed(() => bandeauActivation(this.cartes(), this._lots()));

  private jeton = 0;
  private lecture: Subscription | null = null;
  private poussee: Subscription | null = null;
  private derniere: string | null = null;
  private derniereStrategie: string | null = null;
  /** La campagne dont la lecture COMPLÈTE a été lancée (pré-vol compris) ; `null` tant qu'on n'est pas entré dans ⑦. */
  private complete: string | null = null;
  private detruit = false;

  constructor() {
    effect(() => {
      const c = this.validee();
      // Un lancement en ⑥ pose la stratégie de la campagne ouverte : le pré-vol lu avant est périmé, il est relu.
      const strategie = this.plan.strategieExistante()?.id ?? null;
      const dansActivation = this.parcours.etape() === 'activation';
      untracked(() => {
        if (c !== this.derniere) {
          this.derniere = c;
          this.derniereStrategie = strategie;
          this.ouvrir(c);
        } else if (strategie !== this.derniereStrategie) {
          this.derniereStrategie = strategie;
          this.relire();
        } else if (dansActivation && c && this.complete !== c) {
          // Première entrée dans ⑦ pour cette campagne : la lecture complète, différée jusqu'ici (M-3).
          this.relire();
        }
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      this.annulerLecture();
      // Changement d'espace : la requête est abandonnée ; le serveur clôt le lot à la cible suivante (voir l'en-tête).
      this.poussee?.unsubscribe();
    });
  }

  /**
   * Relit la campagne courante ; ce qui est affiché le reste jusqu'aux réponses. Lecture complète (pré-vol, historique,
   * registre, versions) dans ⑦ ou si elle y a déjà été faite ; ailleurs, l'historique seul, qui sert la pastille.
   */
  relire(): void {
    const c = this.validee();
    if (c && !this.detruit) this.lire(c, this.parcours.etape() === 'activation' || this.complete === c);
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
    this._annulation.set(null);
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
          this._erreur.set({ campagne: c, texte: messageGeste(e) });
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
    this._annulation.set(null);
    this.api.publier(s.id).subscribe({
      next: () => {
        this._publication.set(null);
        if (this.validee() === c) this.relire();
      },
      error: (e: unknown) => {
        this._publication.set(null);
        this._erreur.set({ campagne: c, texte: messageGeste(e) });
      },
    });
  }

  /** Marque un lot annulé (confirmé par l'écran) : `MESSAGE_ANNULATION` en cas de succès, le message de la route sinon. */
  annuler(lot: string): void {
    const c = this.validee();
    if (!c || this.detruit) return;
    this._annulation.set(null);
    this.api.annuler(c, lot).subscribe({
      next: () => {
        this._annulation.set({ campagne: c, texte: MESSAGE_ANNULATION });
        if (this.validee() === c) this.relire();
      },
      error: (e: unknown) => this._annulation.set({ campagne: c, texte: messageGeste(e) }),
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
    this._annulation.set(null);
    this.complete = null;
    if (c) this.lire(c, this.parcours.etape() === 'activation');
  }

  /** `complet` faux : l'historique seul (la pastille de ⑦, A-11) — rien d'autre n'est lu hors de ⑦ (M-3). */
  private lire(c: string, complet: boolean): void {
    this.annulerLecture();
    const jeton = this.jeton;
    const valide = () => jeton === this.jeton;
    this._chargement.set(true);
    this._erreurLecture.set(null);
    if (!complet) {
      this.lecture = this.api.historique(c).subscribe({
        next: (h) => { if (valide()) this._lots.set(h.lots ?? []); },
        error: (e: unknown) => {
          if (!valide()) return;
          this.lecture = null;
          this._chargement.set(false);
          this._erreurLecture.set(messageErreurApi(e));
        },
        complete: () => {
          if (!valide()) return;
          this.lecture = null;
          this._chargement.set(false);
        },
      });
      return;
    }
    this.complete = c;
    this.lecture = this.api.prevol(c).pipe(
      tap((p) => { if (valide()) this._prevol.set(p); }),
      concatMap(() => this.api.historique(c)),
      tap((h) => { if (valide()) this._lots.set(h.lots ?? []); }),
      concatMap(() => (this._registre() ? of(null) : this.jeux.plateformes().pipe(map((r) => r.plateformes)))),
      tap((r) => { if (r && valide()) this._registre.set(r); }),
      concatMap(() => {
        // Par (jeu, version) : une extraction est figée, mais la LISTE d'un jeu grandit — une relance en ⑥ sur sa v2
        // après une lecture de sa v1 doit relire la liste (relecture 2, I-1).
        const x = this._prevol()?.extraction;
        const jeu = x?.zone_set_id;
        if (!x || !jeu || this._extractions().get(jeu)?.some((v) => v.version === x.version)) return of(null);
        return this.jeux.extractions(jeu).pipe(map((r) => ({ jeu, liste: r.extractions })));
      }),
    ).subscribe({
      next: (x) => {
        if (!valide()) return;
        if (x) {
          this._extractions.update((m) => new Map(m).set(x.jeu, x.liste));
          this.plan.retenirExtractions(x.jeu, x.liste);
        }
        this.lecture = null;
        this._chargement.set(false);
      },
      error: (e: unknown) => {
        if (!valide()) return;
        this.lecture = null;
        this.complete = null;
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
