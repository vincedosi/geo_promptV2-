import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, type Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { CouvertureApi } from '../data/couverture.api';
import { type DetailJeuZone, JeuxApi } from '../data/jeux.api';
import { CIBLE_PAR_DEFAUT, DECOUPAGES, type Decoupage, type ResultatCouverture, lireZoneAnalyse } from '../logique/analyses/couverture';
import { messageErreurCouverture, refusDeLErreur } from '../logique/analyses/couverture-erreurs';
import {
  type BilanPlateforme, type ResultatCercles, SANS_RECETTE, bilanDe, cleCouverture, lectureRequise, parPlateforme, rangerCouverture,
} from '../logique/jeu/bilan';
import { mailleParDefaut } from '../logique/jeu/conversion';
import {
  type ChoixMaille, type ChoixParPlateforme, PARAM_EXTRACTION, PARAM_JEU, PARAM_MAILLES, PARAM_ZONE_JEU, type ParametresJeu, SEUIL_PAR_DEFAUT,
  ecrireMailles, lireMailles, lireParametresJeu, lireVersion, memesParametres, rayonParDefaut,
} from '../logique/jeu/mailles-url';
import { PLATEFORMES, type Maille, type Plateforme, type PlateformeGeo } from '../logique/jeu/plateformes';
import type { Recette } from '../logique/zones/recette';
import { ecrireParametres } from './ecrire-parametres';
import { FileLectures } from './file-lectures';
import { LectureAnnulable } from './lecture-annulable';

/** Le message d'un jeu RISQUE reçu par ⑤ — celui que le serveur rend dans l'autre sens (`charger-jeu.ts`). */
class JeuRisque extends Error {
  constructor() { super('Ce jeu de zones se gère dans le module risque.'); }
}

/**
 * ⑤ Jeu de zones — l'ÉTAT (lot 5, T9) : la zone convertie, le jeu enregistré ouvert, le choix de maille par
 * plateforme, et ce que chaque choix perd. Reflété dans l'URL (A-10) : `?zoneJeu=<uuid>` (une zone, avant
 * enregistrement) ou `?jeu=<uuid>` (un jeu enregistré : sa zone et ses choix sont dedans, `?zoneJeu=` disparaît),
 * `?mailles=` (les choix EXPLICITES — écarts aux défauts, ou au jeu ouvert), `?x=<version>` (une extraction du jeu).
 *
 * PATRON DE `ZoneAnalyseeService` : lu à la construction, réécrit à chaque geste par `ecrireParametres` (P-g), relu
 * à toute navigation extérieure, valeur illisible réécrite une fois ; un 404 (zone ou jeu) retire son paramètre.
 *
 * AUCUNE REQUÊTE NON DEMANDÉE (P-h) : ouvrir ⑤ ne lit rien ; `plateformes_geo` se lit UNE fois par page, à l'arrivée
 * d'une zone ou d'un jeu ; une conversion part par `valider` (la colonne), dans une FILE — une lecture en vol, au plus
 * une couverture par (zone, cible, découpage). Un seuil déplacé ne requête RIEN : `resumes` rejoue la conversion pure
 * en mémoire. Un pavage en cercles est calculé au SERVEUR pour un rayon ET un seuil : régler l'un ou l'autre le
 * périme (bilan absent, aucune requête) jusqu'au `valider` suivant — l'écran l'appelle au relâchement.
 *
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
  /** La date de mise à jour de la zone que le sélecteur connaît : elle entre dans la clé des couvertures (recalcul en ③). */
  private readonly _maj = signal<string | null>(null);
  private readonly _erreur = signal<string | null>(null);
  private readonly lectureJeu = new LectureAnnulable<DetailJeuZone>(messageErreurCouverture);
  private readonly lecturePlateformes = new LectureAnnulable<readonly PlateformeGeo[]>(messageErreurCouverture);
  private readonly file = new FileLectures();
  /** Les couvertures lues, par `cleCouverture` ; vidées au changement de zone, purgées si la forme a changé. */
  private readonly _couvertures = signal<ReadonlyMap<string, ResultatCouverture>>(new Map());
  private readonly _cercles = signal<Partial<Record<Plateforme, ResultatCercles>>>({});
  /** Le pavage demandé en dernier par plateforme (`zone|cible|rayon|seuil`) : un second `valider` identique n'en relance pas. */
  private readonly demandes = new Map<Plateforme, string>();
  /** Le message d'échec de chaque tâche de la file, par clé. */
  private readonly _erreursTaches = signal<ReadonlyMap<string, string>>(new Map());

  readonly zoneId: Signal<string | null> = this._zoneId.asReadonly();
  readonly jeuId: Signal<string | null> = this._jeuId.asReadonly();
  readonly extraction: Signal<number | null> = this._extraction.asReadonly();
  readonly recette: Signal<Recette | null> = this._recette.asReadonly();
  /** Le jeu enregistré ouvert, tel que la route le rend ; `null` sans jeu (ou pendant sa lecture). */
  readonly jeu: Signal<DetailJeuZone | null> = this.lectureJeu.resultat.asReadonly();
  /** La cible comptée : celle du jeu ouvert, sinon la population totale. */
  readonly cible: Signal<string> = computed(() => this.jeu()?.jeu.cible ?? CIBLE_PAR_DEFAUT);
  /** Le registre `plateformes_geo`, lu une fois par page. */
  readonly plateformes: Signal<readonly PlateformeGeo[]> = computed(() => this.lecturePlateformes.resultat() ?? []);
  /** Un message qui ne tient pas à une plateforme (zone ou jeu introuvable, registre illisible) ; `null` sinon. */
  readonly erreur: Signal<string | null> = computed(() => this._erreur() ?? this.lectureJeu.erreur() ?? this.lecturePlateformes.erreur());

  /** Les choix de base : ceux du jeu ouvert, sinon la maille par défaut de chaque plateforme (A-4), seuil 20 %. */
  private readonly base = computed<ChoixParPlateforme>(() => {
    const jeu = this.jeu();
    if (jeu) {
      return Object.fromEntries(jeu.plateformes.map((c) => [c.plateforme, c.rayon_m === null
        ? { maille: c.maille, seuil: c.seuil } : { maille: c.maille, seuil: c.seuil, rayon_m: c.rayon_m }]));
    }
    const regles = this.plateformes();
    const recette = this._recette();
    const choix: ChoixParPlateforme = {};
    for (const p of PLATEFORMES) {
      const maille = mailleParDefaut(regles, p, recette ?? SANS_RECETTE);
      if (maille) choix[p] = this.choixNeuf(maille, SEUIL_PAR_DEFAUT, undefined, this.regle(p, maille));
    }
    return choix;
  });

  /** Le choix courant de chaque plateforme : la base, et par-dessus les choix explicites. Vide sans zone. */
  readonly choix: Signal<ChoixParPlateforme> = computed(() => (this._zoneId() ? { ...this.base(), ...this._reglages() } : {}));

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
    parPlateforme(this.choix(), this.regleDe, (p, c, l) => (this.file.cles().has(this.tache(p, c, l)) ? true : undefined)));
  /** Le message d'échec de la conversion de chaque plateforme (refus en français). */
  readonly erreurs: Signal<Partial<Record<Plateforme, string>>> = computed(() =>
    parPlateforme(this.choix(), this.regleDe, (p, c, l) => this._erreursTaches().get(this.tache(p, c, l))));

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
      this._zoneId(); this._jeuId(); this._reglages(); this._extraction();
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

  /** Lit le registre des plateformes, une fois par page (aussi à la première ouverture du sélecteur, T10). */
  chargerPlateformes(): void {
    if (!this.detruit) this.lecturePlateformes.chargerUneFois(() => this.api.plateformes().pipe(map((r) => r.plateformes)));
  }

  /**
   * Choisit (ou retire, `null`) la zone à convertir. Une AUTRE zone ferme le jeu ouvert et efface tout résultat et
   * tout choix explicite. `recette` et `maj` (date de mise à jour) : ce que le sélecteur connaît — rappeler avec la
   * zone courante les renseigne (zone arrivée par l'URL) ; une autre `maj` (zone recalculée en ③) fait tout relire.
   */
  choisirZone(id: string | null, recette: Recette | null = null, maj: string | null = null): void {
    const zone = id === null ? null : lireZoneAnalyse(id);
    if (zone === this._zoneId() && this._jeuId() === null) {
      if (zone && recette) this._recette.set(recette);
      if (zone && maj !== null && maj !== this._maj()) {
        this.viderResultats();
        this._maj.set(maj);
      }
      return;
    }
    this.fermerJeu();
    this.viderResultats();
    this._reglages.set({});
    this._recette.set(recette);
    this._maj.set(maj);
    this._erreur.set(null);
    this._zoneId.set(zone);
  }

  /** Ouvre un jeu enregistré : sa zone, sa cible et ses choix remplacent l'état courant (l'URL passe à `?jeu=`). */
  charger(jeuId: string): void {
    const id = lireZoneAnalyse(jeuId);
    if (!id || this.detruit) return;
    this._reglages.set({});
    this._extraction.set(null);
    this._erreur.set(null);
    this.ouvrirJeu(id);
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
    if (!this._zoneId()) return;
    const actuel = this.choix()[plateforme];
    const maille = r.maille ?? actuel?.maille;
    if (!maille) return;
    const suivant = this.choixNeuf(maille, r.seuil ?? actuel?.seuil ?? SEUIL_PAR_DEFAUT, r.rayon ?? actuel?.rayon_m, this.regle(plateforme, maille));
    if (actuel && ecrireMailles({ [plateforme]: actuel }) === ecrireMailles({ [plateforme]: suivant })) return;
    this._reglages.update((avant) => ({ ...avant, [plateforme]: suivant }));
    this.oublierErreur(`cercles|${plateforme}`); // un refus de pavage valait pour l'ancien rayon ou l'ancien seuil
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
    if (this.detruit || !zone || !c || !ligne) return;
    const cible = this.cible();
    const besoin = lectureRequise(c, ligne, this._recette());
    const tache = this.tache(plateforme, c, ligne);
    if (besoin !== 'cercles') {
      const cle = this.cleCouv(besoin);
      if (this._couvertures().has(cle) || this.file.contient(tache)) return;
      this.oublierErreur(tache);
      this.file.ajouter(tache, () => this.couvertureApi.couverture(zone, cible, besoin), (r) => this.ranger(zone, cle, r), (e) => this.surEchec(tache, e));
      return;
    }
    const rayon = c.rayon_m;
    const demande = `${zone}|${cible}|${rayon}|${c.seuil}`;
    // Déjà lu, ou déjà demandé à l'identique (double relâchement) : rien ; un autre rayon remplace la demande en vol.
    if (rayon === undefined || bilanDe(c, ligne, this._recette(), this.cercles()[plateforme])
      || (this.file.contient(tache) && this.demandes.get(plateforme) === demande)) return;
    this.oublierErreur(tache);
    this.demandes.set(plateforme, demande);
    this.file.ajouter(tache, () => this.api.cercles(zone, { cible, rayon, seuil: c.seuil, plateforme }),
      (r) => this._cercles.update((avant) => ({ ...avant, [plateforme]: r })), (e) => this.surEchec(tache, e));
  }

  /** La ligne de `plateformes_geo` d'un couple, s'il est au registre. */
  private regle(plateforme: Plateforme, maille: Maille): PlateformeGeo | undefined {
    return this.plateformes().find((l) => l.plateforme === plateforme && l.maille === maille);
  }

  private readonly regleDe = (p: Plateforme, c: ChoixMaille) => this.regle(p, c.maille);

  private choixNeuf(maille: Maille, seuil: number, rayon: number | undefined, ligne: PlateformeGeo | undefined): ChoixMaille {
    return maille === 'cercle' ? { maille, seuil, rayon_m: rayon ?? rayonParDefaut(ligne, this._recette()) } : { maille, seuil };
  }

  private cleCouv(decoupage: Decoupage): string {
    return cleCouverture(this._zoneId() ?? '', this._maj(), this.cible(), decoupage);
  }

  /** La clé de la tâche qui chiffre ce choix : la couverture requise, ou le pavage de la plateforme. */
  private tache(p: Plateforme, c: ChoixMaille, ligne: PlateformeGeo): string {
    const besoin = lectureRequise(c, ligne, this._recette());
    return besoin === 'cercles' ? `cercles|${p}` : `couverture|${this.cleCouv(besoin)}`;
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

  /** Une zone introuvable (supprimée, d'un autre espace) est retirée et le message reste ; un autre refus est noté. */
  private surEchec(tache: string, e: unknown): void {
    const message = messageErreurCouverture(e);
    if (refusDeLErreur(e) === 'zone_introuvable') {
      this.choisirZone(null);
      this._erreur.set(message);
      return;
    }
    this._erreursTaches.update((m) => new Map(m).set(tache, message));
  }

  private oublierErreur(tache: string): void {
    const suite = new Map(this._erreursTaches());
    if (suite.delete(tache)) this._erreursTaches.set(suite);
  }

  private viderResultats(): void {
    this.file.vider();
    this._couvertures.set(new Map());
    this._cercles.set({});
    this._erreursTaches.set(new Map());
  }

  private fermerJeu(): void {
    this.lectureJeu.perimer();
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
    if (jeu !== this._jeuId()) {
      if (jeu) this.ouvrirJeu(jeu);
      else this.fermerJeu();
    }
    const zone = lireZoneAnalyse(b[PARAM_ZONE_JEU]);
    if (!jeu && zone !== this._zoneId()) {
      this.viderResultats();
      this._recette.set(null);
      this._maj.set(null);
      this._zoneId.set(zone);
    }
    const reglages = lireMailles(b[PARAM_MAILLES]);
    if (ecrireMailles(reglages) !== ecrireMailles(this._reglages())) this._reglages.set(reglages);
    this._extraction.set(jeu ? lireVersion(b[PARAM_EXTRACTION]) : null);
  }

  /** Écrit l'état courant sous sa forme canonique, si l'URL ne le porte pas déjà. Jamais après destruction. */
  private ecrire(): void {
    if (this.detruit) return;
    const jeu = this._jeuId();
    const x = this._extraction();
    const v: ParametresJeu = {
      [PARAM_ZONE_JEU]: jeu ? null : this._zoneId(),
      [PARAM_JEU]: jeu,
      [PARAM_MAILLES]: jeu || this._zoneId() ? ecrireMailles(this._reglages()) : null,
      [PARAM_EXTRACTION]: jeu && x !== null ? String(x) : null,
    };
    if (memesParametres(v, this.dernier)) return;
    this.dernier = v;
    ecrireParametres(this.router, this.route.firstChild ?? this.route, v);
  }
}
