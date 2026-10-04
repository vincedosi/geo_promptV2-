import { HttpErrorResponse } from '@angular/common/http';
import {
  DestroyRef, Injectable, type Signal, type WritableSignal, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { EMPTY, Observable, Subject, type Subscription, catchError, map, of, switchMap, timer } from 'rxjs';
import { ChargementService } from '../../../core/chargement/chargement.service';
import { estPerime } from '../../../core/chargement/chargement';
import { type Bandes, type Cible, ProfilRisqueApi, type RequeteBandes } from '../data/profil-risque.api';
import { ReferentielApi, type ReponseRefGeo } from '../data/referentiel.api';
import { type CompteSites, SitesRisqueApi } from '../data/sites-risque.api';
import { type ReponseCourbe, ZonesRisqueApi } from '../data/zones-risque.api';
import { codeProfil } from '../logique/code-profil';
import type { Dimension } from '../logique/dimensions';
import {
  type SegmentExploration, descendre, mailleExploree, perimetreExplore, peutDescendre, remonter,
} from '../logique/exploration';
import { NIVEAUX, type ProfilRayons, anneauxDuNiveau, profilDesGravites } from '../logique/profil';
import { EtatRisqueService } from './etat-risque.service';

/** Les contours d'une maille : `null` en chargement, `'indisponible'` après un échec (jamais gardé en cache). */
export type ContoursMaille = GeoJSON.Feature[] | null | 'indisponible';

/** Un territoire du fil d'Ariane, son nom résolu par le référentiel (`AnalysePopulationOverlay.tsx:114`). */
export interface Segment { niveau: 'region' | 'departement'; code: string; nom: string }

/** Un code de territoire et son libellé, pour les menus de périmètre. */
export interface UniteRef { code: string; nom: string }

export interface RefGeo {
  regions: UniteRef[];
  departements: UniteRef[];
  /** Les départements de chaque région : la route les rend IMBRIQUÉS, l'aplatir perdrait le rattachement. */
  deptsParRegion: Record<string, string[]>;
}

export type EtatChargementBandes = 'chargement' | 'echec' | 'pret';

/** Résultat de `use-bandes.ts` : l'état VOYAGE avec la donnée — un tableau vide confondait les trois. */
export interface ResultatBandes {
  etat: EtatChargementBandes;
  bandes: Bandes | null;
  erreur: string | null;
  /** 409 « pré-calcul absent » : seul cas où l'écran doit dire de lancer le script. */
  aConstruire: boolean;
}

/** Résultat de `use-courbe-rayon.ts`. */
export interface ResultatCourbe {
  data: ReponseCourbe | null;
  chargement: boolean;
  erreur: string | null;
  aConstruire: boolean;
}

export type PointCourbe = ReponseCourbe['courbes'][number]['points'][number];

/** Anti-rebond des bandes (`use-bandes.ts:112`) : un calcul national coûte 2,8 s, un geste en émet plusieurs. */
export const DELAI_BANDES_MS = 400;

const REF_VIDE: RefGeo = { regions: [], departements: [], deptsParRegion: {} };
const BANDES_INITIALES: ResultatBandes = { etat: 'chargement', bandes: null, erreur: null, aConstruire: false };
const BANDES_INACTIVES: ResultatBandes = { etat: 'pret', bandes: null, erreur: null, aConstruire: false };

/**
 * Les données PARTAGÉES de l'écran risque — portage des chargements de `AnalysePopulationOverlay.tsx`
 * (l.431-748) et de ses trois crochets `use-bandes.ts`, `use-courbe-rayon.ts`, `use-sites-compte.ts`.
 *
 * Fourni par l'ÉCRAN (`providers` de `RisquePage`, A13) : détruit avec lui, désabonnements compris.
 *
 * ── LES RÈGLES D'I/O SONT ICI, ET NULLE PART AILLEURS ────────────────────
 *
 * - Chaque chargement dépend d'une CLÉ TEXTE (`computed` sérialisé), jamais de l'état entier : basculer
 *   « Lecture des zones » change `etat()` sans changer aucune clé, donc ne relance rien (`etat-url.ts`).
 * - La clé est poussée dans un `Subject` par un `effect` (pas de `toObservable`, interdit dans un hôte),
 *   puis `switchMap` : un nouveau réglage ANNULE la requête du précédent — l'équivalent du jeton React
 *   (`mien !== jeton.current`), avec en plus l'abandon réel de l'appel. L'écran montre le résultat du
 *   DERNIER réglage, jamais de la dernière réponse arrivée.
 * - Les bandes attendent 400 ms DANS le `switchMap` : un réglage plus récent annule aussi l'attente, et
 *   une réponse ancienne arrivant pendant cette attente est déjà jetée (React l'écartait par son jeton).
 * - Cibles et référentiel : une fois par écran. Contours : une fois par échelle.
 * - Le limiteur de 3 appels simultanés reste celui de `HttpClient` : rien ici ne le contourne.
 */
@Injectable()
export class DonneesRisqueService {
  private readonly etatRisque = inject(EtatRisqueService);
  private readonly profilApi = inject(ProfilRisqueApi);
  private readonly zonesApi = inject(ZonesRisqueApi);
  private readonly sitesApi = inject(SitesRisqueApi);
  private readonly referentielApi = inject(ReferentielApi);
  private readonly chargement = inject(ChargementService);
  private readonly abonnements: Subscription[] = [];

  private readonly etat = this.etatRisque.etat;

  // ── Catalogue et référentiel : une fois par écran ──────────────────────
  private readonly _cibles = signal<Cible[]>([]);
  readonly cibles: Signal<Cible[]> = this._cibles.asReadonly();
  /** `'Population totale'` tant que le catalogue n'a pas répondu, comme React (l.664). */
  readonly libelleCible = computed(
    () => this._cibles().find((c) => c.code === this.etat().cible)?.libelle ?? 'Population totale',
  );

  private readonly _refGeo = signal<RefGeo>(REF_VIDE);
  /** `null` tant qu'il charge : un fil d'Ariane ne se résout pas contre un référentiel absent. */
  private readonly refStatut = signal<'chargement' | 'pret' | 'echec'>('chargement');
  readonly refGeo: Signal<RefGeo> = this._refGeo.asReadonly();

  // ── Le territoire étudié (A3) ───────────────────────────────────────────
  private readonly cleChemin = computed(() => this.etat().chemin.join('|'));
  /**
   * `etat.chemin` résolu contre le référentiel. Un élément sans préfixe `region:`/`departement:`, ou dont
   * le code n'existe pas, est IGNORÉ — jamais une erreur : une URL collée s'ouvre sur un état récupéré.
   * ⚠ Le préfixe est obligatoire : 18 codes INSEE désignent une région ET un département (sql/171).
   * Référentiel en échec : on garde l'élément sous son code (repli `?? code` de React, l.1077), plutôt
   * que de faire basculer en silence le calcul sur la France entière.
   * ⚠ Cas limite de ce repli, assumé : un élément BIEN FORMÉ mais inconnu (`region:99`) ne peut plus être
   * écarté sans référentiel — il part TEL QUEL vers les routes, et c'est le SERVEUR qui le valide (périmètre
   * inconnu → réponse vide ou refus explicite, jamais un calcul sur la France entière).
   */
  readonly chemin = computed<Segment[]>(() => {
    const brut = this.cleChemin();
    if (brut === '') return [];
    const statut = this.refStatut();
    const ref = this._refGeo();
    const segments: Segment[] = [];
    for (const el of brut.split('|')) {
      const lu = lireElementChemin(el);
      if (!lu) continue;
      const { niveau, code } = lu;
      const unite = (niveau === 'region' ? ref.regions : ref.departements).find((u) => u.code === code);
      if (unite) segments.push({ niveau, code, nom: unite.nom });
      else if (statut === 'echec') segments.push({ niveau, code, nom: code });
    }
    return segments;
  });
  /**
   * Un chemin demandé mais pas encore résolu : aucun calcul ne part, il partirait sur la France entière.
   * ⚠ On n'attend le référentiel QUE si au moins un élément est BIEN FORMÉ (`region:` / `departement:` suivi
   * d'un code) : un chemin entièrement illisible (`13`, `commune:13055`) sera ignoré quoi qu'il arrive, et
   * l'attendre retarderait le premier calcul pour rien.
   */
  private readonly cheminEnAttente = computed(() => this.refStatut() === 'chargement'
    && this.cleChemin() !== '' && this.cleChemin().split('|').some((el) => lireElementChemin(el) !== null));

  /** La maille CHOISIE (« Lister par »), locale comme React (A4). `null` = la maille naturelle. */
  readonly mailleChoisie: WritableSignal<Dimension | null> = signal(null);
  /** La maille d'un drill-down ordinaire : les ENFANTS du dernier segment (l.478-481). */
  readonly mailleNaturelle = computed<Dimension>(() => {
    const n = this.chemin().length;
    return n === 0 ? 'region' : n === 1 ? 'departement' : 'commune';
  });
  readonly dimension = computed<Dimension>(() => this.mailleChoisie() ?? this.mailleNaturelle());

  /** Libellés de nature, lus dans l'état (A5) — React les recevait du panneau Calques, vides par défaut. */
  private readonly cleNatures = computed(() => this.etat().natures.join(','));
  readonly natures = computed(() => (this.cleNatures() ? this.cleNatures().split(',') : []));
  private readonly cleGravites = computed(() => this.etat().gravites.join(','));

  /**
   * Ce qu'on CALCULE : le profil réglé, anneaux des seuils décochés vidés (l.316). Tout ce qui compte des
   * habitants lit celui-ci, jamais `etat.profil`.
   */
  readonly profilCalcul = computed<ProfilRayons>(() => profilDesGravites(this.etat().profil, this.etat().gravites));
  private readonly codeCalcul = computed(() => codeProfil(this.profilCalcul()));
  /** Le PLUS GRAND rayon du profil : c'est au bord de la zone qu'on lit le gain marginal (l.734). */
  readonly rayonMaxProfil = computed<number | null>(() => {
    const tous = NIVEAUX.flatMap((n) => anneauxDuNiveau(this.profilCalcul(), n));
    return tous.length > 0 ? Math.max(...tous) : null;
  });

  private readonly perimetre = computed(() => {
    const c = this.chemin();
    const dernier = c[c.length - 1];
    return dernier ? `${dernier.niveau}:${dernier.code}` : '';
  });

  // ── Les bandes (use-bandes.ts) ──────────────────────────────────────────
  private readonly requeteBandes = computed<RequeteBandes | null>(() => {
    if (this.cheminEnAttente()) return null;
    const c = this.chemin();
    return {
      profil: this.codeCalcul(),
      cible: this.etat().cible,
      maille: this.dimension(),
      parent: c.find((s) => s.niveau === 'departement')?.code ?? null,
      // ⚠ La RÉGION dans son propre champ, jamais dans `parent` (18 codes communs, sql/171).
      region: c.find((s) => s.niveau === 'region')?.code ?? null,
      natures: this.natures(),
    };
  });
  private readonly _bandes = signal<ResultatBandes>(BANDES_INITIALES);
  readonly bandes: Signal<ResultatBandes> = this._bandes.asReadonly();

  // ── L'exploration LOCALE du tableau de ③ (T11, `AnalysePopulationOverlay.tsx:520-672`) ──────────────────
  /*
   * ⚠ LOCALE ne veut pas dire « dans le composant de ③ » : React la tient dans le corps de l'écran (l.540), donc elle
   * SURVIT à un aller-retour ② ↔ ③ — et son second calcul avec. Le panneau d'étape, lui, est sous un `@switch` et se
   * démonte. Elle vit donc ici, à l'échelle de l'écran, mais HORS de l'URL et HORS de `etat` : le filtre Territoire
   * dit ce qu'on ÉTUDIE, l'exploration ce qu'on REGARDE dans le tableau. Elle ne touche JAMAIS à `etat.chemin`.
   */
  private readonly _exploration = signal<SegmentExploration[]>([]);
  readonly exploration: Signal<SegmentExploration[]> = this._exploration.asReadonly();
  /** L'unité SURVOLÉE (tableau ou mini-carte) : suit la souris et s'efface. */
  private readonly _actif = signal<string | null>(null);
  readonly actif: Signal<string | null> = this._actif.asReadonly();
  /** L'unité sur laquelle la mini-carte se cadre (T12) : tient jusqu'au clic suivant. Distincte du survol. */
  private readonly _selectionCarte = signal<string | null>(null);
  readonly selectionCarte: Signal<string | null> = this._selectionCarte.asReadonly();

  /** La maille réellement LISTÉE par ③ — explorée ou non (l.549). */
  readonly mailleTableau = computed<Dimension>(() => mailleExploree(this._exploration(), this.dimension()));

  /**
   * Second calcul, pour l'exploration de ③ : `null` — donc AUCUN appel — tant qu'on n'explore pas (l.665-672). Sans
   * ce garde-fou il doublerait chaque calcul, 2,8 s sur le national, pour un résultat identique au premier.
   * Le périmètre PART du filtre Territoire, lu seulement (`perimetreExplore`) ; la région dans `region`, jamais
   * dans `parent` (18 codes INSEE communs, sql/171).
   */
  readonly requeteExploree = computed<RequeteBandes | null>(() => {
    const exploration = this._exploration();
    if (exploration.length === 0) return null;
    const c = this.chemin();
    const perimetre = perimetreExplore(exploration, {
      region: c.find((s) => s.niveau === 'region')?.code ?? null,
      parent: c.find((s) => s.niveau === 'departement')?.code ?? null,
    });
    return {
      profil: this.codeCalcul(),
      cible: this.etat().cible,
      maille: this.mailleTableau(),
      parent: perimetre.parent,
      region: perimetre.region,
      natures: this.natures(),
    };
  });
  private readonly _bandesExplorees = signal<ResultatBandes>(BANDES_INACTIVES);
  readonly bandesExplorees: Signal<ResultatBandes> = this._bandesExplorees.asReadonly();
  /** Ce que le tableau de ③ (et sa mini-carte) affiche : l'exploré pendant une exploration, sinon le global (l.675). */
  readonly bandesTableau = computed<ResultatBandes>(
    () => (this._exploration().length > 0 ? this._bandesExplorees() : this._bandes()),
  );

  // ── La courbe (use-courbe-rayon.ts) ─────────────────────────────────────
  private readonly cleCourbe = computed<string | null>(() => (this.cheminEnAttente()
    ? null
    : JSON.stringify([this.etat().cible, this.cleGravites(), this.cleNatures(), this.perimetre()])));
  private readonly _courbe = signal<ResultatCourbe>({ data: null, chargement: false, erreur: null, aConstruire: false });
  readonly courbe: Signal<ResultatCourbe> = this._courbe.asReadonly();
  /** La courbe `'*'`, seule à porter l'incrément du profil entier (l.743). */
  readonly courbeTotale = computed<PointCourbe[] | null>(
    () => this._courbe().data?.courbes.find((c) => c.cle === '*')?.points ?? null,
  );

  // ── Les sites (use-sites-compte.ts) — ne dépendent PAS du profil ────────
  private readonly cleSites = computed<string | null>(() => (this.cheminEnAttente()
    ? null
    : JSON.stringify([this.cleGravites(), this.cleNatures(), this.perimetre()])));
  private readonly _compteSites = signal<{ compte: CompteSites | null; chargement: boolean }>({ compte: null, chargement: true });
  readonly compteSites = this._compteSites.asReadonly();

  /** Chiffres DÉJÀ à l'écran pendant un recalcul : ils décrivent le réglage précédent (`estPerime`). */
  readonly perime = computed(() => estPerime(this.chargement.etat().actif, this._bandes().bandes !== null));

  /**
   * La mini-carte de ③ : encodage (`part` par défaut) et palette de DONNÉES (`rouge` par défaut,
   * `AnalysePopulationOverlay.tsx:275,371`). Ici et non dans le panneau, qui se démonte sous le `@switch` des
   * étapes : React les garde à travers un aller-retour ② ↔ ③, l'overlay restant monté.
   */
  readonly encodage = signal<'part' | 'densite' | 'exposee'>('part');
  readonly palette = signal<string>('rouge');

  private readonly cacheContours = new Map<'region' | 'departement', WritableSignal<ContoursMaille>>();

  constructor() {
    this.abonnements.push(
      this.profilApi.cibles().subscribe({
        next: (r) => this._cibles.set(r.cibles ?? []),
        error: () => undefined, // le menu reste sur la cible par défaut (React, l.440)
      }),
      this.referentielApi.geo().subscribe({
        next: (r) => {
          this._refGeo.set(aplatirRef(r));
          this.refStatut.set('pret');
        },
        error: () => this.refStatut.set('echec'), // le sélecteur reste sur France entière
      }),
    );

    this.brancher(this.requeteBandes, this._bandes, false);
    this.brancher(this.requeteExploree, this._bandesExplorees, true);

    // Courbe : sans anti-rebond, comme React — la lecture est pré-agrégée, en millisecondes.
    this.relier(this.cleCourbe, (cle) => {
      const [cible, gravites, natures, perim] = JSON.parse(cle) as [string, string, string, string];
      const [niveau, code] = perim ? perim.split(':') : [null, null];
      this._courbe.update((p) => ({ ...p, chargement: true, erreur: null, aConstruire: false }));
      return this.zonesApi.courbe(gravites, {
        cible, natures: natures ? natures.split(',') : [], perimNiveau: niveau, perimCode: code,
      }).pipe(
        map((data) => ({ data, chargement: false, erreur: null, aConstruire: false })),
        catchError((e: unknown) => {
          const corps = corpsErreur(e);
          return of({
            data: null, chargement: false, aConstruire: Boolean(corps?.['a_construire']),
            erreur: typeof corps?.['error'] === 'string' ? (corps['error'] as string) : 'Courbe indisponible.',
          });
        }),
        map((r) => this._courbe.set(r)),
      );
    });

    this.relier(this.cleSites, (cle) => {
      const [gravites, natures, perim] = JSON.parse(cle) as [string, string, string];
      const [niveau, code] = perim ? perim.split(':') : [null, null];
      this._compteSites.update((p) => ({ ...p, chargement: true }));
      return this.sitesApi.compter({
        gravites: gravites ? gravites.split(',') : [],
        natures: natures ? natures.split(',') : [],
        perimNiveau: niveau as 'region' | 'departement' | null, perimCode: code,
      }).pipe(
        map((compte) => ({ compte, chargement: false })),
        catchError(() => of({ compte: null, chargement: false })),
        map((r) => this._compteSites.set(r)),
      );
    });

    // Libellés EXACTS de React (l.682-684) : ils disent le TRAVAIL, jamais la route.
    this.chargement.suivre('bandes', 'Calcul de la population par classe…', () => this._bandes().etat === 'chargement');
    this.chargement.suivre('courbe', 'Lecture de la courbe de couverture…', () => this._courbe().chargement);
    this.chargement.suivre('sites', 'Comptage des sites…', () => this._compteSites().chargement);

    inject(DestroyRef).onDestroy(() => this.abonnements.forEach((a) => a.unsubscribe()));
  }

  /**
   * Les contours d'une échelle, chargés au premier appel puis gardés (T12). À appeler hors d'un `computed`.
   *
   * ⚠ Un ÉCHEC n'est pas gardé : le signal passe à `'indisponible'` (l'écran le dit, au lieu d'un « Chargement des
   * contours… » éternel) et l'entrée est ÉVINCÉE du cache — le prochain appel pour cette échelle, c'est-à-dire le
   * prochain changement de maille qui y revient, redemande. Garder l'échec ferait d'une panne passagère une carte
   * absente jusqu'à la fermeture de l'écran. Le tableau, lui, fonctionne dans tous les cas (React, l.567).
   */
  contours(scale: 'region' | 'departement'): Signal<ContoursMaille> {
    let s = this.cacheContours.get(scale);
    if (!s) {
      const cible = signal<ContoursMaille>(null);
      s = cible;
      this.cacheContours.set(scale, cible);
      this.abonnements.push(this.referentielApi.contours(scale).subscribe({
        next: (fc) => cible.set(fc.features ?? []),
        error: () => {
          if (this.cacheContours.get(scale) === cible) this.cacheContours.delete(scale);
          cible.set('indisponible');
        },
      }));
    }
    return s.asReadonly();
  }

  /**
   * Le menu « Territoire » : `''` = France entière, sinon UN segment `niveau:code` (l.1070-1078). Efface le survol
   * ET la sélection : la maille change, et le code retenu désignerait au niveau suivant un homonyme (voir
   * `oublierUnite`). Et l'EXPLORATION du tableau de ③ repart du nouveau territoire.
   *
   * ⚠ Défaut de React corrigé (T11, mesuré au navigateur) : React garde l'exploration quand le filtre change.
   * Explorer l'Île-de-France puis choisir les Bouches-du-Rhône y affichait le fil « Bouches-du-Rhone › Île-de-France »
   * et un tableau vide — « Aucun carreau habité ne se trouve à moins de 10 km d'un site » —, le second calcul
   * croisant la région 11 avec le département 13. Une exploration est un chemin DANS le territoire du filtre : quand
   * le territoire change, ce chemin n'a plus de sens.
   */
  choisirTerritoire(valeur: '' | `${'region' | 'departement'}:${string}`): void {
    this.oublierUnite();
    this._exploration.set([]);
    this.etatRisque.maj({ chemin: valeur === '' ? [] : [valeur] });
  }

  /** Le fil d'Ariane : garder les `n` premiers segments RÉSOLUS (0 = France entière). Même effacement. */
  remonter(n: number): void {
    this.oublierUnite();
    this._exploration.set([]);
    this.etatRisque.maj({ chemin: this.chemin().slice(0, n).map((s) => `${s.niveau}:${s.code}`) });
  }

  /** ③, flèche droite d'une ligne : descendre dans l'unité. N'écrit RIEN dans l'état ni dans l'URL. */
  descendreExploration(code: string, nom: string): void {
    const maille = this.mailleTableau();
    if (!peutDescendre(maille)) return;
    this._exploration.update((c) => descendre(c, maille, code, nom));
    this.oublierUnite();
  }

  /** ③, flèche gauche : remonter d'un cran. À la racine, le second calcul s'arrête (requête nulle). */
  remonterExploration(): void {
    this._exploration.update(remonter);
    this.oublierUnite();
  }

  /** ③, le premier lien du fil local : revenir d'un coup au territoire du filtre. */
  quitterExploration(): void {
    this._exploration.set([]);
    this.oublierUnite();
  }

  /** ③, survol d'une ligne (ou d'une zone de la mini-carte) ; `null` à la sortie. */
  survoler(code: string | null): void {
    this._actif.set(code);
  }

  /** ③, clic sur une ligne OU sur la mini-carte : la mini-carte se cadre dessus. Ne descend pas, ne filtre rien. */
  selectionner(code: string): void {
    this._selectionCarte.set(code);
  }

  /**
   * L'unité survolée ou sélectionnée appartient au niveau qu'on QUITTE : la garder ferait surligner un code qui
   * n'existe plus — ou pire un HOMONYME, les nomenclatures INSEE de région et de département se recouvrant sur
   * 18 codes (sql/171 ; `AnalysePopulationOverlay.tsx:1419-1424`). Public : « Lister par » (barre commune) change
   * aussi la maille, et une région 93 sélectionnée y désignerait la Seine-Saint-Denis.
   */
  oublierUnite(): void {
    this._actif.set(null);
    this._selectionCarte.set(null);
  }

  /**
   * Une clé → un `Subject` (par un `effect`) → `switchMap`. `null` n'émet rien et annule l'appel en
   * cours : un chemin en attente de référentiel ne doit rien calculer.
   */
  private relier<T>(cle: Signal<T | null>, appel: (c: T) => Observable<unknown>): Subject<T | null> {
    const flux = new Subject<T | null>();
    this.abonnements.push(flux.pipe(switchMap((c) => (c === null ? EMPTY : appel(c)))).subscribe());
    // `untracked` : seule la CLÉ est une dépendance. Ce que lisent les abonnés synchrones de `flux` (le
    // `switchMap` appelle aussitôt `appel`, qui lit et écrit des signaux) ne doit pas s'y ajouter.
    effect(() => {
      const c = cle();
      untracked(() => flux.next(c));
    });
    return flux;
  }

  /** Les bandes : 400 ms d'attente PUIS l'appel, les deux dans le `switchMap` (voir l'en-tête). */
  private brancher(requete: Signal<RequeteBandes | null>, cible: WritableSignal<ResultatBandes>, inactiveSiNulle: boolean): void {
    const cle = computed(() => {
      const q = requete();
      return q === null ? null : JSON.stringify(q);
    });
    this.relier(cle, (c) => {
      const q = JSON.parse(c) as RequeteBandes;
      // Pendant le calcul on GARDE la valeur précédente : c'est elle qui s'estompe (`perime`).
      cible.update((p) => ({ ...p, etat: 'chargement' }));
      return timer(DELAI_BANDES_MS).pipe(
        switchMap(() => this.profilApi.bandes(q)),
        map((bandes): ResultatBandes => ({ etat: 'pret', bandes, erreur: null, aConstruire: false })),
        catchError((e: unknown) => {
          const corps = corpsErreur(e);
          return of<ResultatBandes>(corps === null
            ? { etat: 'echec', bandes: null, aConstruire: false, erreur: 'Le calcul des bandes n’a pas répondu.' }
            : {
              etat: 'echec', bandes: null, aConstruire: corps['a_construire'] === true,
              erreur: typeof corps['error'] === 'string' ? corps['error'] : 'Calcul des bandes indisponible.',
            });
        }),
        map((r) => cible.set(r)),
      );
    });
    if (inactiveSiNulle) {
      // Hors exploration : rien à charger, et un résultat « prêt, vide » plutôt qu'un chargement sans fin.
      effect(() => {
        if (requete() === null) cible.set(BANDES_INACTIVES);
      });
    }
  }
}

/** Un élément `niveau:code` de `etat.chemin`, ou `null` s'il est mal formé (préfixe inconnu, code vide). */
function lireElementChemin(el: string): { niveau: 'region' | 'departement'; code: string } | null {
  const i = el.indexOf(':');
  if (i < 0) return null;
  const niveau = el.slice(0, i);
  const code = el.slice(i + 1);
  if ((niveau !== 'region' && niveau !== 'departement') || code === '') return null;
  return { niveau, code };
}

/** Le corps JSON d'une réponse d'erreur, ou `null` (réseau, corps illisible) — React passait alors par son `catch`. */
function corpsErreur(e: unknown): Record<string, unknown> | null {
  if (!(e instanceof HttpErrorResponse) || e.status === 0) return null;
  return e.error && typeof e.error === 'object' ? (e.error as Record<string, unknown>) : null;
}

/** La route rend les départements IMBRIQUÉS dans leur région : on aplatit sans perdre le rattachement (l.452-466). */
function aplatirRef(j: ReponseRefGeo): RefGeo {
  const regions = (j.regions ?? []).map((x) => ({ code: x.code_region, nom: x.nom_region }));
  const departements = (j.regions ?? []).flatMap((x) => (x.depts ?? []).map((d) => ({ code: d.code_dept, nom: d.nom_dept })));
  const deptsParRegion: Record<string, string[]> = {};
  for (const x of j.regions ?? []) deptsParRegion[x.code_region] = (x.depts ?? []).map((d) => d.code_dept);
  return { regions, departements, deptsParRegion };
}
