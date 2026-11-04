import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { finalize, type Observable, type Subscription } from 'rxjs';
import { BatailleService } from '../couches/bataille.service';
import { IsochronesApi, type EvenementFlux, type StatutCache } from '../data/isochrones.api';
import { anneauxBruts, erreurDeFlux, messageEchecHttp, messageEvenement, messageEvenementV2, poisDeBataille } from '../logique/bataille/flux';
import { journalInitialRemplissage, journalInitialV2, lireMessageRemplissage } from '../logique/bataille/journal';
import {
  type ContexteBataille, basculerPalier, corpsRemplissage, corpsVerification, parametresRemplissage, parametresV2,
  parametresV2Zone,
} from '../logique/bataille/parametres';
import { ContexteBatailleService } from './contexte-bataille.service';
import { CouchesCarteService } from './couches-carte.service';
import { surChangement } from './lecture-annulable';
import { ZoneAnalyseeService } from './zone-analysee.service';

/** Les paliers proposés, en minutes (`BattleV2Tool.tsx:18`) — tous choisis par défaut. */
export const PALIERS_V2 = [10, 20, 30, 40, 50, 60, 90] as const;

/** Une zone pays : la bataille nationale se lance depuis ① (phrase de `app/api/isochrone-battle-v2/route.ts`, A-6). */
export const REFUS_BATAILLE_PAYS = 'Sur toute la France, la bataille se lance depuis l’étape ① (France métropolitaine).';

/** Le résultat d'une bataille V2 (`BattleV2Result`, `useMapDirectActions.ts:455-459`). */
interface ResultatV2 {
  error?: string;
  battleGeoJSON?: { features?: GeoJSON.Feature[] };
  poisForMap?: { id: string; nom: string; lat: number; lng: number; categorie?: string; adresse?: string; ville?: string }[];
  /**
   * La clé de cache du résultat (`isochrone-battle-v2/route.ts`), suffixée `__p<empreinte>` du PÉRIMÈTRE de l'appelant :
   * la capture la renvoie à `custom-geo/source/battle`, qui refuse toute clé d'un autre périmètre (③ finitions, T4).
   */
  battleCacheKey?: string;
}

/**
 * L'outil « Bataille V2 (multi-paliers) » : lit le cache d'isochrones et découpe en PostGIS, sans appel ORS ; le
 * remplissage ORS des POI manquants reste un geste explicite, qui enchaîne sur la bataille — portage de
 * `use-isochrone-battle.ts:103-117,136-219,307-336` et de `useMapDirectActions.ts:292-375,436-509` (lot 4, T17).
 *
 * Aucune garde ici : le panneau Analyse appelle `verifierPerimetreOutil` AVANT chaque méthode de lancement. Fourni par
 * la page carte (la bataille V1, qui partageait cet hébergement, est retirée d'Angular le 27/10). Sur la métropole, `lancer` et `remplir`
 * passent en plus par la capacité en direct (`ContexteBatailleService.sousBorne`, retours du 26/10, T4) : un comptage au
 * clic, sur le contexte figé ; un refus ne lance ni le remplissage ORS ni la V2.
 *
 * Défaut React corrigé : « ✓ Cache rempli (? isochrones) » — la fermeture lisait le compteur d'avant le flux ; ici le
 * nombre réellement reçu.
 *
 * ── SUR LA ZONE ANALYSÉE (④ finitions, T7, A-6) ───────────────────────────
 * Quand ④ analyse une zone, la bataille s'y applique par défaut (`surZone`, patron du score) : le corps porte `zone_id`
 * et aucun filtre de ① (`parametresV2Zone`), sans comptage de capacité (la route refait les 700 anneaux). Changer de
 * zone — ou basculer — ABANDONNE la bataille en vol : sa réponse ne peint jamais la carte (P-c). Un 404
 * `zone_introuvable` retire la zone de ④ (`ZoneAnalyseeService.siIntrouvable`). La vérification du cache et le
 * remplissage ORS restent sur ① (route protégée, qui ne connaît pas les zones ; la route de remplissage propre à la V2
 * est le n° 44 de l'Excel) : sur la zone, ils ne partent pas.
 *
 * Changer de zone VIDE aussi ce que l'outil affiche de la bataille précédente — journal, statut du cache, compteurs du
 * remplissage (D-4, décision du 04/11) : un journal resté là se lisait comme celui de la nouvelle zone. Seul un
 * remplissage ORS en cours garde son journal : il est l'opération du moment, pas la précédente. Le créneau peint sur la
 * carte n'est pas touché (il peut porter la zone d'un lien, et « Tout effacer » le vide), ni rien de persisté.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class BatailleV2Service {
  private readonly api = inject(IsochronesApi);
  private readonly bataille = inject(BatailleService);
  private readonly ctx = inject(ContexteBatailleService);
  private readonly analysee = inject(ZoneAnalyseeService);

  /** La zone analysée de ④, ou `null` : la bascule « Sur » n'a de sens qu'avec elle. */
  readonly zoneAnalysee = this.analysee.zoneId;
  /** « Sur : la zone analysée » (défaut) ou « le périmètre de ① ». */
  readonly surZone = signal(true);
  /** La zone sur laquelle la bataille part, ou `null` : le périmètre de ①. */
  readonly zoneBataille = computed(() => (this.surZone() ? this.zoneAnalysee() : null));
  /** La bataille porterait sur une zone PAYS (sa recette, lue sans requête) : la route la refuse, l'écran aussi (relecture 2). */
  readonly zonePays = computed(() => this.zoneBataille() !== null && this.analysee.ligne()?.recette?.type === 'pays');

  readonly paliers = signal<number[]>([...PALIERS_V2]);
  readonly cache = signal<StatutCache | null>(null);
  readonly verification = signal(false);
  readonly chargement = signal(false);
  readonly journal = signal<string[]>([]);
  readonly remplissage = signal(false);
  readonly remplissageTotal = signal(0);
  readonly remplissageTermines = signal(0);
  readonly remplissagePct = signal(0);
  readonly remplissageAnneaux = signal(0);

  private flux: Subscription | null = null;
  /** La revérification du cache après un remplissage, qui enchaîne sur la bataille. */
  private relecture: Subscription | null = null;
  /** Le comptage de la capacité, avant un lancement ou un remplissage : un seul à la fois, le dernier clic gagne. */
  private borne: Subscription | null = null;

  constructor() {
    inject(CouchesCarteService).inscrireEffacement('bataille-v2', () => this.reinitialiser());
    inject(DestroyRef).onDestroy(() => this.arreter());
    // P-c : une bataille en vol sur une zone quittée (ou une bascule) est abandonnée, sa réponse jetée ; puis D-4 :
    // l'affichage de la bataille précédente est vidé.
    surChangement(this.zoneBataille, () => {
      this.abandonner();
      this.viderAffichage();
    });
  }

  /** Un palier bascule ; le statut du cache devient caduc (`BattleV2Tool.tsx:106-111`). */
  basculerPalier(p: number): void {
    this.oublierCache();
    this.paliers.update((l) => basculerPalier(l, p));
  }

  oublierCache(): void {
    this.cache.set(null);
  }

  viderJournal(): void {
    this.journal.set([]);
  }

  /** `handleCheckV2`. */
  verifierCache(): void {
    if (!this.ctx.unPoi() || this.paliers().length === 0 || this.zoneBataille()) return;
    this.verification.set(true);
    this.cache.set(null);
    this.lireCache().pipe(finalize(() => this.verification.set(false))).subscribe({
      next: (statut) => this.cache.set(statut),
      error: (e: unknown) => this.noter(`> ✕ Erreur vérif. cache : ${messageEchecHttp(e)}`),
    });
  }

  /** `handleFillMissingV2` : le flux ORS de `/api/isochrone-battle`, puis cache revérifié et bataille V2 lancée. */
  remplir(): void {
    if (!this.ctx.unPoi() || this.paliers().length === 0 || this.remplissage() || this.zoneBataille()) return;
    const ctx = this.ctx.contexte();
    const paliers = this.paliers();
    this.sousBorne(ctx, paliers, () => this.remplirDans(ctx, paliers));
  }

  private remplirDans(ctx: ContexteBataille, paliers: readonly number[]): void {
    if (this.remplissage()) return;
    const params = parametresRemplissage(ctx, paliers);
    this.remplissage.set(true);
    this.cache.set(null);
    this.remplissageTotal.set(0);
    this.remplissageTermines.set(0);
    this.remplissagePct.set(0);
    this.remplissageAnneaux.set(0);
    this.journal.set(journalInitialRemplissage(ctx.categorie, ctx.mode, paliers));
    this.bataille.viderPartiels();
    this.flux = this.api.remplirCache(corpsRemplissage(params)).subscribe({
      next: (e) => this.lireRemplissage(e),
      error: (err: unknown) => {
        this.noter(`> ✕ ${messageEchecHttp(err)}`);
        this.remplissage.set(false);
      },
      complete: () => {
        this.remplissagePct.set(100);
        this.noter(`> ✓ Cache rempli (${this.remplissageAnneaux() || '?'} isochrones) — lancement Bataille V2...`);
        // Revérifier, puis enchaîner sur la bataille — même si la vérification échoue, comme React. Sur le contexte
        // FIGÉ au lancement (revue 1) : cet enchaînement ne repasse pas par la garde du panneau, et relire le filtre
        // courant ferait partir une V2 nationale si l'utilisateur l'a retiré pendant le remplissage.
        const enchainer = () => { this.remplissage.set(false); this.lancerDans(ctx, paliers, false); };
        this.relecture = this.lireCache(ctx, paliers).subscribe({ next: (s) => this.cache.set(s), error: enchainer, complete: enchainer });
      },
    });
  }

  /** `handleBattleV2(force)`, sur le contexte du moment — appelé par le panneau APRÈS sa garde. */
  lancer(force: boolean): void {
    if (!this.ctx.unPoi() || this.paliers().length === 0 || this.chargement() || this.zonePays()) return;
    const ctx = this.ctx.contexte();
    const paliers = this.paliers();
    const zone = this.zoneBataille();
    // Sur une zone : aucun comptage (il compterait toute la métropole) — la route refait la capacité.
    if (zone) this.lancerDans(ctx, paliers, force, zone);
    else this.sousBorne(ctx, paliers, () => this.lancerDans(ctx, paliers, force));
  }

  /** La capacité en direct, puis `suite` (le comptage précédent, s'il court encore, est abandonné). */
  private sousBorne(ctx: ContexteBataille, paliers: readonly number[], suite: () => void): void {
    this.borne?.unsubscribe();
    this.borne = this.ctx.sousBorne(ctx, paliers, (l) => this.noter(l), suite);
  }

  private lancerDans(ctx: ContexteBataille, paliers: readonly number[], force: boolean, zone: string | null = null): void {
    if (this.chargement()) return;
    const params = zone ? parametresV2Zone(ctx, paliers, force, zone) : parametresV2(ctx, paliers, force);
    this.chargement.set(true);
    this.journal.set(journalInitialV2(params.category, params.mode, paliers));
    this.bataille.viderPartiels();
    let resultat: ResultatV2 | null = null;
    this.flux = this.api.batailleV2(params).pipe(finalize(() => this.chargement.set(false))).subscribe({
      next: (e) => {
        if (e.type === 'result') { resultat = (e['data'] as ResultatV2 | undefined) ?? null; return; }
        const msg = messageEvenementV2(e);
        if (msg) this.noter(msg);
      },
      error: (err: unknown) => {
        this.noter(`> ✕ ${messageEchecHttp(err)}`);
        // Le flux lit son corps en TEXTE : le refus `zone_introuvable` (404, avant le flux) se relit en objet.
        if (zone) this.analysee.siIntrouvable(corpsLu(err));
      },
      complete: () => {
        if (!resultat) { this.noter('> ✕ Réponse incomplète'); return; }
        if (resultat.error) { this.noter(`> ✕ ${erreurDeFlux(resultat.error)}`); return; }
        this.terminer(resultat, params.category, 'filtre_ville' in params ? params.filtre_ville : undefined);
      },
    });
  }

  /**
   * Le résultat : appliqué au créneau avec SA clé (elle remplace une éventuelle clé `cg__`), POI pointés. La clé rend la
   * bataille capturable en zone (③ « Capturer zone custom », T4) ; sans clé, rien à capturer.
   */
  private terminer(r: ResultatV2, categorie: string, ville: string | undefined): void {
    const features = r.battleGeoJSON?.features ?? [];
    const pois = poisDeBataille(r.poisForMap ?? [], [], categorie);
    if (features.length > 0) this.bataille.appliquer({ anneaux: features, pois, cle: r.battleCacheKey || null, categorie });
    this.ctx.afficherPois(pois, categorie, ville);
    this.noter('> ✓ Bataille v2 affichée sur la carte');
  }

  /** Un événement du remplissage : anneaux bruts sur la carte, compteurs, journal mis à jour en place. */
  private lireRemplissage(e: EvenementFlux): void {
    if (e.type === 'partial_rings' && Array.isArray(e['rings']) && e['rings'].length) this.bataille.ajouterPartiels(e['rings']);
    if (e.type === 'result') {
      const features = (e['data'] as ResultatV2 | undefined)?.battleGeoJSON?.features ?? [];
      if (features.length > 0) {
        this.bataille.viderPartiels();
        this.bataille.ajouterPartiels(anneauxBruts(features));
      }
      return;
    }
    const msg = messageEvenement(e);
    if (!msg) return;
    const lu = lireMessageRemplissage(this.journal(), msg);
    this.journal.set(lu.journal);
    if (lu.total !== undefined) this.remplissageTotal.set(lu.total);
    if (lu.termines !== undefined) this.remplissageTermines.set(lu.termines);
    if (lu.pct !== undefined) this.remplissagePct.set(lu.pct);
    if (lu.anneaux !== undefined) this.remplissageAnneaux.update((n) => n + (lu.anneaux ?? 0));
  }

  private lireCache(ctx: ContexteBataille = this.ctx.contexte(), paliers: readonly number[] = this.paliers()): Observable<StatutCache> {
    return this.api.verifierCache(corpsVerification(ctx, paliers));
  }

  /** La zone de la bataille a changé : le flux en vol est désabonné (sa réponse jetée). */
  private abandonner(): void {
    // Un comptage de capacité en vol (lancement sur ①) part aussi : sa suite partirait sur le contexte quitté.
    this.borne?.unsubscribe();
    this.borne = null;
    if (!this.chargement()) return;
    this.flux?.unsubscribe();
    this.flux = null;
    this.chargement.set(false);
  }

  /** D-4 : journal, statut du cache et compteurs de la bataille précédente vidés — sauf pendant un remplissage ORS. */
  private viderAffichage(): void {
    if (this.remplissage()) return;
    this.journal.set([]);
    this.cache.set(null);
    this.remplissageTotal.set(0);
    this.remplissageTermines.set(0);
    this.remplissagePct.set(0);
    this.remplissageAnneaux.set(0);
  }

  private arreter(): void {
    this.flux?.unsubscribe();
    this.relecture?.unsubscribe();
    this.borne?.unsubscribe();
    this.flux = null;
    this.relecture = null;
    this.borne = null;
  }

  private noter(ligne: string): void {
    this.journal.update((j) => [...j, ligne]);
  }

  /** « Tout effacer » : flux annulé, outil remis à zéro (paliers gardés : c'est un réglage). */
  private reinitialiser(): void {
    this.arreter();
    this.chargement.set(false);
    this.remplissage.set(false);
    this.cache.set(null);
    this.journal.set([]);
    this.ctx.oublierRefus();
  }
}

/** Une erreur HTTP dont le corps est du texte JSON (flux NDJSON), relue en objet ; toute autre erreur, telle quelle. */
function corpsLu(e: unknown): unknown {
  if (!(e instanceof HttpErrorResponse) || typeof e.error !== 'string') return e;
  try {
    return new HttpErrorResponse({ status: e.status, statusText: e.statusText, url: e.url ?? undefined, error: JSON.parse(e.error) });
  } catch {
    return e;
  }
}
