import { DestroyRef, Injectable, type Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CouvertureApi } from '../data/couverture.api';
import {
  type DecoupageAnalyse, PARAM_COUVERTURE, PARAM_ZONE_ANALYSE, type ResultatCouverture, type ResultatCroisements, ecrireParamCouverture,
  lireParamCouverture,
  lireZoneAnalyse,
} from '../logique/analyses/couverture';
import { messageErreurCouverture, refusDeLErreur } from '../logique/analyses/couverture-erreurs';
import { ecrireParametres } from './ecrire-parametres';
import { LectureAnnulable } from './lecture-annulable';

/**
 * ④ Analyse — la ZONE ANALYSÉE (lot 4, T7, arbitrage A-8) : la zone enregistrée de l'espace que ④ chiffre, sa cible et
 * son découpage, reflétés dans l'URL — `?zoneAnalyse=<uuid>` et `?couverture=<cible>.<forme|cp|iris>` (défaut
 * `ind.forme` : paramètre absent). Indépendante du filtre ① (on analyse une zone hors du périmètre) et de `?customZone=`
 * (`LienZoneService`, le créneau de bataille, qui RETIRE son paramètre après lecture : les deux ne se confondent pas).
 *
 * ── PATRON DE `ParcoursService` ───────────────────────────────────────────
 * Lu à la construction ; réécrit à chaque geste (`replaceUrl`, navigation RELATIVE à la route enfant active) ; relu à
 * chaque navigation qui ne vient pas de nous (retour, lien collé). Une valeur illisible est réécrite UNE fois sous sa
 * forme canonique. L'écriture passe par `ecrireParametres` (piège P-g : la page compte six écrivains d'URL ; deux
 * navigations du même tick ne perdent plus de paramètre).
 *
 * ── UNE RÉPONSE QUITTÉE N'EST JAMAIS AFFICHÉE (P-c) ───────────────────────
 * La lecture est une `LectureAnnulable` (désabonnement + jeton : une réponse quittée est jetée). Changer de zone, de cible ou de découpage efface le
 * résultat et annule la lecture en vol ; rien ne repart seul (aucun appel avant « Chiffrer »). La radio et le trafic
 * (T13) suivent la même règle, mais seul un changement de ZONE les efface — ou un chiffrage d'une autre version de sa
 * forme (`zone_maj` : un recalcul en ③ garde l'id), qui ne laisse jamais affichée la liste de l'ancienne. Un 404
 * (`zone_introuvable` : zone supprimée ou d'un autre espace — lien partagé) retire `?zoneAnalyse=` et dit le message.
 *
 * ── FOURNI PAR LA PAGE (P-e) ──────────────────────────────────────────────
 * `@Injectable()` sans `providedIn` : la zone survit à ④ → ① → ④ ; un changement d'espace RECRÉE la page, donc ce
 * service — à la destruction, la lecture en vol est annulée et plus rien n'est écrit dans l'URL.
 */
@Injectable()
export class ZoneAnalyseeService {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(CouvertureApi);

  private readonly _zoneId = signal<string | null>(lireZoneAnalyse(this.route.snapshot.queryParamMap.get(PARAM_ZONE_ANALYSE)));
  private readonly _reglage = signal(lireParamCouverture(this.route.snapshot.queryParamMap.get(PARAM_COUVERTURE)));
  private readonly lecture = new LectureAnnulable<ResultatCouverture>(messageErreurCouverture);
  /** Radio et trafic de la zone (T13) : ICI et non dans le composant, pour survivre au repli de l'accordéon (P-e). */
  private readonly lectureCroisements = new LectureAnnulable<ResultatCroisements>(messageErreurCouverture);

  /** L'id de la zone analysée, ou `null`. */
  readonly zoneId: Signal<string | null> = this._zoneId.asReadonly();
  readonly cible: Signal<string> = computed(() => this._reglage().cible);
  readonly decoupage: Signal<DecoupageAnalyse> = computed(() => this._reglage().decoupage);
  /** Le dernier chiffrage de (zone, cible, découpage) COURANTS ; `null` dès que l'un change. */
  readonly resultat: Signal<ResultatCouverture | null> = this.lecture.resultat.asReadonly();
  readonly enCours: Signal<boolean> = this.lecture.enCours.asReadonly();
  /** Le message d'un refus ou d'un échec, en français ; `null` sinon. */
  readonly erreur: Signal<string | null> = this.lecture.erreur.asReadonly();
  /** Radio et trafic de la zone COURANTE, lus au geste (quota partagé avec le chiffrage) ; effacés quand elle change. */
  readonly croisements = {
    resultat: this.lectureCroisements.resultat.asReadonly(),
    enCours: this.lectureCroisements.enCours.asReadonly(),
    erreur: this.lectureCroisements.erreur.asReadonly(),
  };

  /** Les valeurs BRUTES lues ou écrites en dernier (`null` = absent) : on ne réécrit l'URL que si elle diffère. */
  private dernierZone: string | null = this.route.snapshot.queryParamMap.get(PARAM_ZONE_ANALYSE);
  private dernierCouverture: string | null = this.route.snapshot.queryParamMap.get(PARAM_COUVERTURE);
  private detruit = false;

  constructor() {
    const abonnement = this.route.queryParamMap.subscribe((p) => {
      const bz = p.get(PARAM_ZONE_ANALYSE);
      const bc = p.get(PARAM_COUVERTURE);
      if (bz === this.dernierZone && bc === this.dernierCouverture) return;
      this.dernierZone = bz;
      this.dernierCouverture = bc;
      const zone = lireZoneAnalyse(bz);
      const reglage = lireParamCouverture(bc);
      const r = this._reglage();
      if (zone !== this._zoneId()) this.lectureCroisements.perimer();
      if (zone !== this._zoneId() || reglage.cible !== r.cible || reglage.decoupage !== r.decoupage) {
        this.lecture.perimer();
        this._zoneId.set(zone);
        this._reglage.set(reglage);
      }
      // Une valeur illisible qui ne change pas l'état ne ferait pas repasser l'effet : on canonicalise ici.
      this.ecrire();
    });

    // P-a : l'effet ne fait que LIRE ; l'écriture (navigation) est hors suivi.
    effect(() => {
      this._zoneId();
      this._reglage();
      untracked(() => this.ecrire());
    });

    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      abonnement.unsubscribe();
    });
  }

  /** Choisit (ou retire, `null`) la zone analysée. Le résultat de la précédente est effacé. */
  choisir(id: string | null): void {
    const zone = id === null ? null : lireZoneAnalyse(id);
    if (zone === this._zoneId()) return;
    this.lecture.perimer();
    this.lectureCroisements.perimer();
    this._zoneId.set(zone);
  }

  /** Change la cible et/ou le découpage. Le résultat est effacé ; rien ne repart seul. */
  regler(r: { cible?: string; decoupage?: DecoupageAnalyse }): void {
    const avant = this._reglage();
    const apres = { cible: r.cible ?? avant.cible, decoupage: r.decoupage ?? avant.decoupage };
    if (apres.cible === avant.cible && apres.decoupage === avant.decoupage) return;
    this.lecture.perimer();
    this._reglage.set(apres);
  }

  /** Demande la couverture de la zone courante ; un second appel annule le premier. Sans zone : ne fait rien. */
  chiffrer(): void {
    const id = this._zoneId();
    if (!id || this.detruit) return;
    this.lecture.perimer();
    const { cible, decoupage } = this._reglage();
    // Seule une liste DÉJÀ lue d'une autre version de la forme est périmée : une lecture en vol n'est pas annulée.
    this.lecture.lancer(this.api.couverture(id, cible, decoupage), (r) => {
      const lue = this.lectureCroisements.resultat();
      if (lue && lue.zone_maj !== r.zone_maj) this.lectureCroisements.perimer();
    }, this.siIntrouvable);
  }

  /** Demande la radio et le trafic de la zone courante ; un second appel annule le premier. Sans zone : rien. */
  lireCroisements(): void {
    const id = this._zoneId();
    if (!id || this.detruit) return;
    this.lectureCroisements.lancer(this.api.croisements(id), undefined, this.siIntrouvable);
  }

  /** Zone supprimée ou d'un autre espace (lien partagé) : on la retire. Rend vrai si c'était le cas. Public : la
   * couverture par rayon sur la zone analysée suit la même règle. */
  readonly siIntrouvable = (e: unknown): boolean => {
    const introuvable = refusDeLErreur(e) === 'zone_introuvable';
    if (introuvable) this.choisir(null);
    return introuvable;
  };

  /** Écrit l'état courant sous sa forme canonique, si l'URL ne le porte pas déjà. Jamais après destruction. */
  private ecrire(): void {
    if (this.detruit) return;
    const zone = this._zoneId();
    const couverture = ecrireParamCouverture(this._reglage());
    if (zone === this.dernierZone && couverture === this.dernierCouverture) return;
    this.dernierZone = zone;
    this.dernierCouverture = couverture;
    ecrireParametres(this.router, this.route.firstChild ?? this.route, {
      [PARAM_ZONE_ANALYSE]: zone, [PARAM_COUVERTURE]: couverture,
    });
  }
}
