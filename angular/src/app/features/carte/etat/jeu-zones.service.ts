import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, type Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { CouvertureApi } from '../data/couverture.api';
import { type DetailJeuZone, JeuxApi, type ModePlan } from '../data/jeux.api';
import { MODE_PLAN_DEFAUT_ZONE } from '../../risques/logique/jeu';
import { CIBLE_PAR_DEFAUT, DECOUPAGES, type Decoupage, type ResultatCouverture, lireCible, lireZoneAnalyse } from '../logique/analyses/couverture';
import { messageErreurCouverture } from '../logique/analyses/couverture-erreurs';
import {
  type BilanPlateforme, type ResultatCercles, bilanDe, choixDeBase, choixNeuf, cleCouverture, daterCouvertures, lectureRequise, parPlateforme, rangerCouverture,
} from '../logique/jeu/bilan';
import {
  type ChoixMaille, type ChoixParPlateforme, PARAM_EXTRACTION, PARAM_JEU, PARAM_MAILLES, PARAM_ZONE_JEU, type ParametresJeu, SEUIL_PAR_DEFAUT,
  PARAM_CIBLE_JEU, PARAM_MODE_JEU, ecrireMailles, lireMailles, lireModeJeu, lireParametresJeu, lireVersion, memesParametres, parametresDe,
} from '../logique/jeu/mailles-url';
import { mailleSansObjet } from '../logique/jeu/conversion';
import { MESSAGE_JEU_RISQUE } from '../logique/jeu/ecran';
import type { Maille, Plateforme, PlateformeGeo } from '../logique/jeu/plateformes';
import type { Recette } from '../logique/zones/recette';
import { ecrireParametres } from './ecrire-parametres';
import { TachesJeu, cleTache } from './jeu-zones-taches';
import { LectureAnnulable } from './lecture-annulable';

/** Un jeu RISQUE reçu par ⑤ : la phrase que le serveur rend dans l'autre sens (`MESSAGE_JEU_RISQUE`). */
class JeuRisque extends Error {
  constructor() { super(MESSAGE_JEU_RISQUE); }
}

/**
 * ⑤ Jeu de zones — l'ÉTAT (lot 5, T9) : la zone convertie, le jeu enregistré ouvert, le choix de maille par
 * plateforme, et ce que chaque choix perd. Reflété dans l'URL (A-10) : `?zoneJeu=<uuid>` (une zone, avant
 * enregistrement) ou `?jeu=<uuid>` (un jeu enregistré : sa zone et ses choix sont dedans, `?zoneJeu=` disparaît),
 * `?mailles=` (les choix EXPLICITES — écarts aux défauts, ou au jeu ouvert), `?x=<version>` (une extraction du jeu),
 * `?cibleJeu=` / `?modeJeu=` (cible et mode avant enregistrement, hors défauts ; ⑤ finitions, T5).
 *
 * PATRON DE `ZoneAnalyseeService` : lu à la construction, réécrit à chaque geste par `ecrireParametres` (P-g), relu
 * à toute navigation extérieure, valeur illisible réécrite une fois ; un 404 (zone ou jeu) retire son paramètre.
 *
 * AUCUNE REQUÊTE NON DEMANDÉE (P-h) : ouvrir ⑤ ne lit rien ; `plateformes_geo` se lit UNE fois par page, à l'arrivée
 * d'une zone ou d'un jeu ; une conversion part par `valider` (la colonne), dans une FILE — une lecture en vol, au plus
 * une couverture par (zone, cible, découpage). Un seuil déplacé ne requête RIEN : `resumes` rejoue la conversion pure
 * en mémoire. Un pavage en cercles est calculé au SERVEUR pour un rayon ET un seuil : régler l'un ou l'autre le
 * périme (bilan absent, aucune requête) jusqu'au `valider` suivant — l'écran l'appelle au relâchement. Rien ne
 * se lit tant que la recette de la zone n'est pas CONNUE (`_recetteConnue`).
 * P-c : chaque lecture porte un jeton (`FileLectures`, `LectureAnnulable`) ; changer de zone vide la file et tout
 * résultat. P-e : fourni par la PAGE (`carte.fournisseurs.ts`), le jeu survit à ⑤ → ① → ⑤ ; détruit (changement
 * d'espace), tout est annulé et plus rien n'est écrit dans l'URL.
 */
@Injectable()
export class JeuZonesService {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(JeuxApi);
  private readonly couvertureApi = inject(CouvertureApi);

  private readonly _zoneId = signal<string | null>(null);
  private readonly _jeuId = signal<string | null>(null);
  private readonly _reglages = signal<ChoixParPlateforme>({});
  private readonly _extraction = signal<number | null>(null);
  /** La recette de la zone (exactitude, défauts) : du jeu ouvert, ou donnée par le sélecteur ; `null` inconnue. */
  private readonly _recette = signal<Recette | null>(null);
  /** Recette CONNUE (sélecteur, jeu), même illisible (`null`) ; sinon ni choix ni lecture : une zone pays aurait les
   *  défauts d'une zone locale (DV360 au CP, 5 956 lignes ; pavage Meta refusé) — relecture 2. */
  private readonly _recetteConnue = signal(false);
  /** La cible et le mode choisis AVANT enregistrement (`?cibleJeu=`, `?modeJeu=`, ⑤ finitions T5) ; un jeu ouvert porte les siens. */
  private readonly _cibleChoisie = signal<string | null>(null);
  private readonly _modeChoisi = signal<ModePlan | null>(null);
  /** La date de mise à jour de la zone que le sélecteur connaît : elle entre dans la clé des couvertures (recalcul en ③). */
  private readonly _maj = signal<string | null>(null);
  /** Incrémenté quand la zone courante (non enregistrée) vient d'être recalculée : le sélecteur relit sa date. */
  private readonly _relectureZone = signal(0);
  private readonly _erreur = signal<string | null>(null);
  private readonly lectureJeu = new LectureAnnulable<DetailJeuZone>(messageErreurCouverture);
  private readonly lecturePlateformes = new LectureAnnulable<readonly PlateformeGeo[]>(messageErreurCouverture);
  /** La file des conversions et leurs échecs (T0 des finitions) ; une zone introuvable la retire, message gardé. */
  private readonly taches = new TachesJeu((message) => {
    this.choisirZone(null);
    this._erreur.set(message);
  });
  /** Les couvertures lues, par `cleCouverture` ; vidées au changement de zone, purgées si la forme a changé. */
  private readonly _couvertures = signal<ReadonlyMap<string, ResultatCouverture>>(new Map());
  private readonly _cercles = signal<Partial<Record<Plateforme, ResultatCercles>>>({});

  readonly zoneId: Signal<string | null> = this._zoneId.asReadonly();
  readonly jeuId: Signal<string | null> = this._jeuId.asReadonly();
  readonly extraction: Signal<number | null> = this._extraction.asReadonly();
  readonly recette: Signal<Recette | null> = this._recette.asReadonly();
  /** La date de la forme courante : la changer vide les conversions, et l'écran les redemande. */
  readonly maj: Signal<string | null> = this._maj.asReadonly();
  readonly relectureZone: Signal<number> = this._relectureZone.asReadonly();
  /** Le jeu enregistré ouvert, tel que la route le rend ; `null` sans jeu (ou pendant sa lecture). */
  readonly jeu: Signal<DetailJeuZone | null> = this.lectureJeu.resultat.asReadonly();
  /** La cible comptée : celle du jeu ouvert (elle ne change pas, PATCH), sinon la choisie, sinon la population totale. */
  readonly cible: Signal<string> = computed(() => this.jeu()?.jeu.cible ?? this._cibleChoisie() ?? CIBLE_PAR_DEFAUT);
  /** Le mode de plan : le choisi (enregistré par « Enregistrer les réglages »), sinon celui du jeu, sinon exclusif (ARB-2, A1). */
  readonly modePlan: Signal<ModePlan> = computed(() => this._modeChoisi() ?? this.jeu()?.jeu.mode_plan ?? MODE_PLAN_DEFAUT_ZONE);
  /** Le registre `plateformes_geo`, lu une fois par page. */
  readonly plateformes: Signal<readonly PlateformeGeo[]> = computed(() => this.lecturePlateformes.resultat() ?? []);
  /** Un message qui ne tient pas à une plateforme (zone ou jeu introuvable, registre illisible) ; `null` sinon. */
  readonly erreur: Signal<string | null> = computed(() => this._erreur() ?? this.lectureJeu.erreur() ?? this.lecturePlateformes.erreur());

  /** Les choix de base : ceux du jeu ouvert, sinon la maille par défaut de chaque plateforme (A-4), seuil 20 %. */
  private readonly base = computed<ChoixParPlateforme>(() => choixDeBase(this.jeu()?.plateformes ?? null, this.plateformes(), this._recette()));

  /**
   * Le choix courant de chaque plateforme : la base, et par-dessus les choix explicites. Vide sans zone. Un choix
   * explicite SANS OBJET pour la recette (`mailleSansObjet` : cercles sur une zone pays, pays sur une zone locale) est
   * ignoré, sans être effacé — la plateforme garde son défaut et ne lance aucune lecture (⑤ finitions, T4).
   */
  readonly choix: Signal<ChoixParPlateforme> = computed(() => {
    if (!this._zoneId() || !this._recetteConnue()) return {};
    const recette = this._recette();
    const explicites = Object.entries(this._reglages()).filter(([, c]) => mailleSansObjet(recette, c.maille) === null);
    return { ...this.base(), ...Object.fromEntries(explicites) };
  });
  /**
   * Un jeu ouvert dont l'écran ne montre plus l'enregistré : des choix ou un mode qui en diffèrent. Une extraction fige
   * l'ENREGISTRÉ (A-11) : tant que c'est vrai, l'écran fait d'abord enregistrer les réglages (relecture T10-12).
   */
  readonly modifie: Signal<boolean> = computed(() => {
    const jeu = this.jeu();
    return !!jeu && (ecrireMailles(this.choix()) !== ecrireMailles(this.base()) || this.modePlan() !== jeu.jeu.mode_plan);
  });

  /** Les couvertures lues pour la zone et la cible COURANTES, par découpage. */
  readonly couvertures: Signal<Partial<Record<Decoupage, ResultatCouverture>>> = computed(() => {
    const sortie: Partial<Record<Decoupage, ResultatCouverture>> = {};
    for (const d of DECOUPAGES) {
      const r = this._couvertures().get(this.cleCouv(d));
      if (r) sortie[d] = r;
    }
    return sortie;
  });

  /** Le dernier pavage en cercles lu pour chaque plateforme, s'il est de la zone et de la cible courantes. */
  readonly cercles: Signal<Partial<Record<Plateforme, ResultatCercles>>> = computed(() => {
    const zone = this._zoneId();
    const cible = this.cible();
    return Object.fromEntries(Object.entries(this._cercles()).filter(([, r]) => r.zone_id === zone && r.cible === cible));
  });

  /**
   * Le bilan de chaque plateforme pour son choix COURANT, sans requête (`bilanDe`). Une plateforme absente : rien de
   * lu, ou un pavage périmé (autre rayon, autre seuil).
   */
  readonly resumes: Signal<Partial<Record<Plateforme, BilanPlateforme>>> = computed(() =>
    parPlateforme(this.choix(), this.regleDe, (p, c, l) => bilanDe(c, l, this._recette(), this.lu(p, c, l))));
  /** Les plateformes dont la conversion est en file ou en vol. */
  readonly enCours: Signal<Partial<Record<Plateforme, true>>> = computed(() =>
    parPlateforme(this.choix(), this.regleDe, (p, c, l) => (this.taches.contient(this.tache(p, c, l)) ? true : undefined)));
  /** Le message d'échec de la conversion de chaque plateforme (refus en français). */
  readonly erreurs: Signal<Partial<Record<Plateforme, string>>> = computed(() =>
    parPlateforme(this.choix(), this.regleDe, (p, c, l) => this.taches.erreur(this.tache(p, c, l))));

  private dernier: ParametresJeu = lireParametresJeu(this.route.snapshot.queryParamMap);
  private detruit = false;

  constructor() {
    this.appliquerUrl(this.dernier);
    const abonnement = this.route.queryParamMap.subscribe((p) => {
      const b = lireParametresJeu(p);
      if (memesParametres(b, this.dernier)) return;
      this.dernier = b;
      this.appliquerUrl(b);
      // Une valeur illisible qui ne change pas l'état ne ferait pas repasser l'effet : on canonicalise ici.
      this.ecrire();
    });
    // P-a : les effets ne font que LIRE ; navigation et lecture sont hors suivi.
    effect(() => {
      this._zoneId(); this._jeuId(); this._reglages(); this._extraction(); this._cibleChoisie(); this._modeChoisi();
      untracked(() => this.ecrire());
    });
    effect(() => {
      if (this._zoneId() || this._jeuId()) untracked(() => this.chargerPlateformes());
    });
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      abonnement.unsubscribe();
    });
  }

  /** Lit le registre des plateformes, une fois par page, à l'arrivée d'une zone ou d'un jeu (effet du constructeur). */
  private chargerPlateformes(): void {
    if (!this.detruit) this.lecturePlateformes.chargerUneFois(() => this.api.plateformes().pipe(map((r) => r.plateformes)));
  }

  /**
   * Choisit (ou retire, `null`) la zone à convertir. Une AUTRE zone ferme le jeu ouvert et efface tout résultat et
   * tout choix explicite. `recette` et `maj` (date de mise à jour) : ce que le sélecteur connaît — rappeler avec la
   * zone courante les renseigne (zone arrivée par l'URL) ; une autre `maj` (zone recalculée en ③) fait tout relire.
   * `recette` : `undefined` = inconnue (rien ne se lit), `null` = illisible. */
  choisirZone(id: string | null, recette?: Recette | null, maj: string | null = null): void {
    const zone = id === null ? null : lireZoneAnalyse(id);
    if (zone === this._zoneId() && this._jeuId() === null) {
      if (zone && recette !== undefined) {
        this._recette.set(recette);
        this._recetteConnue.set(true);
      }
      if (zone && maj !== null && maj !== this._maj()) {
        // Sans date jusqu'ici (zone venue de l'URL) : la date est ADOPTÉE, rien n'est jeté ni annulé ; une AUTRE date
        // (zone recalculée en ③) fait tout relire.
        if (this._maj() === null) this._couvertures.update((c) => daterCouvertures(c, zone, maj));
        else this.viderResultats();
        this._maj.set(maj);
      }
      return;
    }
    this.fermerJeu();
    this.viderResultats();
    this._reglages.set({});
    this._recette.set(recette ?? null);
    this._recetteConnue.set(recette !== undefined);
    this._maj.set(maj);
    this._erreur.set(null);
    this._zoneId.set(zone);
  }

  /** La cible comptée avant enregistrement ; sans effet sur un jeu ouvert (sa cible est fixée, un autre jeu en change). */
  choisirCible(code: string): void {
    if (!this._jeuId()) this._cibleChoisie.set(code);
  }

  choisirMode(mode: ModePlan): void {
    this._modeChoisi.set(mode);
  }

  /**
   * Zone recalculée (« Mes zones ») : la courante, sans jeu ouvert (sa zone ne se recalcule pas, 409), fait relire sa
   * ligne au sélecteur ; sa NOUVELLE date vide dans `choisirZone` les conversions de l'ancienne forme (revue finale, 2).
   */
  zoneRecalculee(id: string): void {
    if (!this.detruit && this._jeuId() === null && lireZoneAnalyse(id) === this._zoneId()) this._relectureZone.update((n) => n + 1);
  }

  /**
   * Adopte un jeu tout juste enregistré (POST, détail recomposé par l'écran) ou réglé (PATCH, réponse de la route),
   * SANS le relire : l'URL passe à `?jeu=`, `?zoneJeu=` et `?mailles=` disparaissent (ils sont dans le jeu). Un jeu
   * d'une autre zone que la courante (réponse tardive) est ignoré.
   */
  adopter(detail: DetailJeuZone): void {
    if (this.detruit || detail.jeu.custom_geo_zone_id !== this._zoneId()) return;
    this.lectureJeu.perimer();
    this.lectureJeu.resultat.set(detail);
    this._reglages.set({});
    this._modeChoisi.set(null);
    this._cibleChoisie.set(null); // le jeu porte sa cible (relecture 2)
    this._jeuId.set(detail.jeu.id);
  }

  /** Désigne une extraction du jeu ouvert (`?x=`), ou aucune. Sans jeu : rien. */
  choisirExtraction(version: number | null): void {
    if (this._jeuId()) this._extraction.set(version);
  }

  /**
   * Règle la maille, le seuil ou le rayon d'une plateforme — SANS requête (P-h). Une maille cercle reçoit un rayon
   * (le choisi, l'ancien, sinon `rayonParDefaut`) ; une autre n'en porte pas. Sans zone : rien.
   */
  regler(plateforme: Plateforme, r: { maille?: Maille; seuil?: number; rayon?: number }): void {
    if (!this._zoneId() || !this._recetteConnue()) return;
    const actuel = this.choix()[plateforme];
    const maille = r.maille ?? actuel?.maille;
    if (!maille || mailleSansObjet(this._recette(), maille)) return;
    const suivant = choixNeuf(maille, r.seuil ?? actuel?.seuil ?? SEUIL_PAR_DEFAUT, r.rayon ?? actuel?.rayon_m, this.regle(plateforme, maille), this._recette());
    if (actuel && ecrireMailles({ [plateforme]: actuel }) === ecrireMailles({ [plateforme]: suivant })) return;
    this._reglages.update((avant) => ({ ...avant, [plateforme]: suivant }));
    this.taches.oublier(`cercles|${plateforme}`); // un refus de pavage valait pour l'ancien rayon ou l'ancien seuil
  }

  /**
   * Lance la conversion qu'il manque à la plateforme pour son choix courant : la couverture du découpage (forme pour
   * une maille exacte) si elle n'est ni lue ni en file, ou le pavage en cercles s'il n'est pas à ce rayon et à ce
   * seuil (un pavage en file pour un autre rayon est remplacé). À la demande de la colonne, et au relâchement d'une
   * réglette de rayon.
   */
  valider(plateforme: Plateforme): void {
    const zone = this._zoneId();
    const c = this.choix()[plateforme];
    const ligne = c ? this.regle(plateforme, c.maille) : undefined;
    if (this.detruit || !zone || !c || !ligne || !this._recetteConnue()) return;
    const cible = this.cible();
    const besoin = lectureRequise(c, ligne, this._recette());
    const tache = this.tache(plateforme, c, ligne);
    if (besoin !== 'cercles') {
      if (this._couvertures().has(this.cleCouv(besoin)) || this.taches.contient(tache)) return;
      // La clé se calcule à l'ARRIVÉE : une date adoptée pendant le vol range la lecture sous la clé datée.
      this.taches.ajouter(tache, () => this.couvertureApi.couverture(zone, cible, besoin),
        (r) => this.ranger(zone, cleCouverture(zone, this._maj(), cible, besoin), r));
      return;
    }
    const rayon = c.rayon_m;
    // Déjà lu : rien ; déjà demandé à l'identique (double relâchement), `paver` n'en relance pas.
    if (rayon === undefined || bilanDe(c, ligne, this._recette(), this.cercles()[plateforme])) return;
    this.taches.paver(plateforme, `${zone}|${cible}|${rayon}|${c.seuil}`, tache,
      () => this.api.cercles(zone, { cible, rayon, seuil: c.seuil, plateforme }), (r) => this._cercles.update((avant) => ({ ...avant, [plateforme]: r })));
  }

  /** La ligne de `plateformes_geo` d'un couple, s'il est au registre. */
  private regle(plateforme: Plateforme, maille: Maille): PlateformeGeo | undefined {
    return this.plateformes().find((l) => l.plateforme === plateforme && l.maille === maille);
  }

  private readonly regleDe = (p: Plateforme, c: ChoixMaille) => this.regle(p, c.maille);

  private cleCouv(decoupage: Decoupage): string {
    return cleCouverture(this._zoneId() ?? '', this._maj(), this.cible(), decoupage);
  }

  /** La clé de la tâche qui chiffre ce choix (`cleTache`). */
  private tache(p: Plateforme, c: ChoixMaille, ligne: PlateformeGeo): string {
    return cleTache(p, c, ligne, this._recette(), this._zoneId(), this.cible());
  }

  /** La lecture EN MÉMOIRE que requiert ce choix, si elle est là. */
  private lu(p: Plateforme, c: ChoixMaille, ligne: PlateformeGeo): ResultatCouverture | ResultatCercles | undefined {
    const besoin = lectureRequise(c, ligne, this._recette());
    return besoin === 'cercles' ? this.cercles()[p] : this._couvertures().get(this.cleCouv(besoin));
  }

  /** Range une couverture ; lue sur une autre version de la forme (recalcul en ③), les pavages de la zone partent aussi. */
  private ranger(zone: string, cle: string, r: ResultatCouverture): void {
    const { cache, purgee } = rangerCouverture(this._couvertures(), cle, r);
    this._couvertures.set(cache);
    if (purgee) this._cercles.update((k) => Object.fromEntries(Object.entries(k).filter(([, v]) => v.zone_id !== zone)));
  }

  private viderResultats(): void {
    this.taches.vider();
    this._couvertures.set(new Map());
    this._cercles.set({});
  }

  private fermerJeu(): void {
    this.lectureJeu.perimer();
    this._modeChoisi.set(null);
    this._jeuId.set(null);
    this._extraction.set(null);
  }

  /** Lit le jeu ; un jeu risque est refusé ; un 404 ou un jeu risque retire `?jeu=` (le message reste). */
  private ouvrirJeu(id: string): void {
    this.lectureJeu.perimer();
    this._jeuId.set(id);
    const lecture = this.api.lire(id).pipe(map((r) => {
      if (r.jeu.type !== 'zone') throw new JeuRisque();
      return r as DetailJeuZone;
    }));
    this.lectureJeu.lancer(lecture, (r) => {
      if (r.jeu.custom_geo_zone_id !== this._zoneId()) {
        this.viderResultats();
        this._maj.set(null);
      }
      this._zoneId.set(r.jeu.custom_geo_zone_id);
      this._recette.set(r.zone.recette);
      this._recetteConnue.set(true);
    }, (e) => {
      if (e instanceof JeuRisque || (e instanceof HttpErrorResponse && e.status === 404)) {
        this._jeuId.set(null);
        this._extraction.set(null);
      }
    });
  }

  /** L'état d'une URL lue (construction, navigation extérieure). `?jeu=` l'emporte sur `?zoneJeu=`. */
  private appliquerUrl(b: ParametresJeu): void {
    const jeu = lireZoneAnalyse(b[PARAM_JEU]);
    const zone = lireZoneAnalyse(b[PARAM_ZONE_JEU]);
    // Une autre zone ou un autre jeu arrive par l'URL (« Mes zones », retour) : le message d'avant ne vaut plus.
    if (jeu !== this._jeuId() || (!jeu && zone !== this._zoneId())) this._erreur.set(null);
    if (jeu !== this._jeuId()) {
      if (jeu) this.ouvrirJeu(jeu);
      else this.fermerJeu();
    }
    if (!jeu && zone !== this._zoneId()) {
      this.viderResultats();
      this._recette.set(null);
      this._recetteConnue.set(false);
      this._maj.set(null);
      this._zoneId.set(zone);
    }
    if (!jeu) {
      this._cibleChoisie.set(lireCible(b[PARAM_CIBLE_JEU]));
      this._modeChoisi.set(lireModeJeu(b[PARAM_MODE_JEU]));
    }
    const reglages = lireMailles(b[PARAM_MAILLES]);
    if (ecrireMailles(reglages) !== ecrireMailles(this._reglages())) this._reglages.set(reglages);
    this._extraction.set(jeu ? lireVersion(b[PARAM_EXTRACTION]) : null);
  }

  /** Écrit l'état courant sous sa forme canonique, si l'URL ne le porte pas déjà. Jamais après destruction. */
  private ecrire(): void {
    if (this.detruit) return;
    const avant = { cible: this._cibleChoisie(), mode: this._modeChoisi() };
    const v = parametresDe(this._jeuId(), this._zoneId(), this._reglages(), this._extraction(), avant);
    if (memesParametres(v, this.dernier)) return;
    this.dernier = v;
    ecrireParametres(this.router, this.route.firstChild ?? this.route, v);
  }
}
