import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { finalize, type Observable, type Subscription } from 'rxjs';
import { BatailleService } from '../couches/bataille.service';
import { IsochronesApi, type EvenementFlux, type StatutCache } from '../data/isochrones.api';
import { anneauxBruts, erreurDeFlux, messageEchecHttp, messageEvenement, messageEvenementV2, poisDeBataille } from '../logique/bataille/flux';
import { journalInitialRemplissage, journalInitialV2, lireMessageRemplissage } from '../logique/bataille/journal';
import { basculerPalier, corpsBatailleV1, corpsVerification, parametresRemplissage, parametresV2 } from '../logique/bataille/parametres';
import { ContexteBatailleService } from './contexte-bataille.service';
import { CouchesCarteService } from './couches-carte.service';

/** Les paliers proposés, en minutes (`BattleV2Tool.tsx:18`) — tous choisis par défaut. */
export const PALIERS_V2 = [10, 20, 30, 40, 50, 60, 90] as const;

/** Le résultat d'une bataille V2 (`BattleV2Result`, `useMapDirectActions.ts:455-459`). */
interface ResultatV2 {
  error?: string;
  battleGeoJSON?: { features?: GeoJSON.Feature[] };
  poisForMap?: { id: string; nom: string; lat: number; lng: number; categorie?: string; adresse?: string; ville?: string }[];
}

/**
 * L'outil « Bataille V2 (multi-paliers) » : lit le cache d'isochrones et découpe en PostGIS, sans appel ORS ; le
 * remplissage ORS des POI manquants reste un geste explicite, qui enchaîne sur la bataille — portage de
 * `use-isochrone-battle.ts:103-117,136-219,307-336` et de `useMapDirectActions.ts:292-375,436-509` (lot 4, T17).
 *
 * Aucune garde ici : le panneau Analyse appelle `verifierPerimetreOutil` AVANT chaque méthode de lancement. Même
 * hébergement que `BatailleV1Service` (la page carte), même « Tout effacer ».
 *
 * Défaut React corrigé : « ✓ Cache rempli (? isochrones) » — la fermeture lisait le compteur d'avant le flux ; ici le
 * nombre réellement reçu.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class BatailleV2Service {
  private readonly api = inject(IsochronesApi);
  private readonly bataille = inject(BatailleService);
  private readonly ctx = inject(ContexteBatailleService);

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

  constructor() {
    inject(CouchesCarteService).inscrireEffacement('bataille-v2', () => this.reinitialiser());
    inject(DestroyRef).onDestroy(() => this.arreter());
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
    if (!this.ctx.unPoi() || this.paliers().length === 0) return;
    this.verification.set(true);
    this.cache.set(null);
    this.lireCache().pipe(finalize(() => this.verification.set(false))).subscribe({
      next: (statut) => this.cache.set(statut),
      error: (e: unknown) => this.noter(`> ✕ Erreur vérif. cache : ${messageEchecHttp(e)}`),
    });
  }

  /** `handleFillMissingV2` : le flux ORS de `/api/isochrone-battle`, puis cache revérifié et bataille V2 lancée. */
  remplir(): void {
    if (!this.ctx.unPoi() || this.paliers().length === 0 || this.remplissage()) return;
    const ctx = this.ctx.contexte();
    const params = parametresRemplissage(ctx, this.paliers());
    this.remplissage.set(true);
    this.cache.set(null);
    this.remplissageTotal.set(0);
    this.remplissageTermines.set(0);
    this.remplissagePct.set(0);
    this.remplissageAnneaux.set(0);
    this.journal.set(journalInitialRemplissage(ctx.categorie, ctx.mode, this.paliers()));
    this.bataille.viderPartiels();
    this.flux = this.api.bataille(corpsBatailleV1(params, false)).subscribe({
      next: (e) => this.lireRemplissage(e),
      error: (err: unknown) => {
        this.noter(`> ✕ ${messageEchecHttp(err)}`);
        this.remplissage.set(false);
      },
      complete: () => {
        this.remplissagePct.set(100);
        this.noter(`> ✓ Cache rempli (${this.remplissageAnneaux() || '?'} isochrones) — lancement Bataille V2...`);
        // Revérifier, puis enchaîner sur la bataille — même si la vérification échoue, comme React.
        const enchainer = () => { this.remplissage.set(false); this.lancer(false); };
        this.relecture = this.lireCache().subscribe({ next: (s) => this.cache.set(s), error: enchainer, complete: enchainer });
      },
    });
  }

  /** `handleBattleV2(force)`. */
  lancer(force: boolean): void {
    if (!this.ctx.unPoi() || this.paliers().length === 0 || this.chargement()) return;
    const params = parametresV2(this.ctx.contexte(), this.paliers(), force);
    this.chargement.set(true);
    this.journal.set(journalInitialV2(params.category, params.mode, this.paliers()));
    this.bataille.viderPartiels();
    let resultat: ResultatV2 | null = null;
    this.flux = this.api.batailleV2(params).pipe(finalize(() => this.chargement.set(false))).subscribe({
      next: (e) => {
        if (e.type === 'result') { resultat = (e['data'] as ResultatV2 | undefined) ?? null; return; }
        const msg = messageEvenementV2(e);
        if (msg) this.noter(msg);
      },
      error: (err: unknown) => this.noter(`> ✕ ${messageEchecHttp(err)}`),
      complete: () => {
        if (!resultat) { this.noter('> ✕ Réponse incomplète'); return; }
        if (resultat.error) { this.noter(`> ✕ ${erreurDeFlux(resultat.error)}`); return; }
        this.terminer(resultat, params.category, params.filtre_ville);
      },
    });
  }

  /** Le résultat : appliqué au créneau (qui perd une éventuelle clé `cg__`), POI pointés. */
  private terminer(r: ResultatV2, categorie: string, ville: string | undefined): void {
    const features = r.battleGeoJSON?.features ?? [];
    const pois = poisDeBataille(r.poisForMap ?? [], [], categorie);
    if (features.length > 0) this.bataille.appliquer({ anneaux: features, pois, cle: null, categorie });
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

  private lireCache(): Observable<StatutCache> {
    return this.api.verifierCache(corpsVerification(this.ctx.contexte(), this.paliers()));
  }

  private arreter(): void {
    this.flux?.unsubscribe();
    this.relecture?.unsubscribe();
    this.flux = null;
    this.relecture = null;
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
  }
}
