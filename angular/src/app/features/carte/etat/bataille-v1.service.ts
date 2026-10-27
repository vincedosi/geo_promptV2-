import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { finalize, type Subscription } from 'rxjs';
import { BatailleService } from '../couches/bataille.service';
import { IsochronesApi, type StatutCache } from '../data/isochrones.api';
import { anneauxBruts, anneauxPourDecoupe, erreurDeFlux, messageEchecHttp, messageEvenement, pctApplication, poisDeBataille, type EvenementFlux } from '../logique/bataille/flux';
import { compteursProgression, journalInitialV1, remplacerProgression, tickJournal } from '../logique/bataille/journal';
import {
  type ContexteBataille, basculerPalier, corpsBatailleV1, corpsVerification, libelleTerritoire, parametresV1,
} from '../logique/bataille/parametres';
import type { BattleRing } from '../logique/modes-isochrones';
import { ContexteBatailleService } from './contexte-bataille.service';
import { CouchesCarteService } from './couches-carte.service';

/** Le résultat d'une bataille V1 (`BattleResult`, `types/spatial.ts`) — ce que l'outil en lit. */
interface ResultatV1 {
  error?: string;
  battleGeoJSON?: { features?: GeoJSON.Feature[] };
  poisForMap?: { id: string; nom: string; lat: number; lng: number; categorie?: string; adresse?: string; ville?: string }[];
  nb_pois?: number;
  battleCacheKey?: string;
}

/**
 * L'outil « Isochrones routiers (ORS) » : vérification du cache, bataille V1 en flux, puis découpe `ST_Difference` à
 * la demande — portage de `use-isochrone-battle.ts:119-133,221-305` et de `useMapDirectActions.ts:118-289,377-434`
 * (lot 4, T17). Les anneaux s'affichent BRUTS au fil du flux ; la découpe (« X BATAILLE ») les remplace.
 *
 * Aucune garde ici : le panneau Analyse appelle `verifierPerimetreOutil` AVANT chaque méthode de lancement (verrou
 * structurel `tests/unit/angular/panneau-analyse-garde.test.ts`). `lancer` passe en plus par la capacité en direct
 * (`ContexteBatailleService.sousBorne`, retours du 26/10, T4), sur TOUT périmètre (relecture 2, I-1) : la route V1 est
 * protégée et ne refait aucune borne (Q-3), l'écran est sa seule garde de capacité.
 *
 * Fourni par la PAGE carte, pas par le panneau : fermer le panneau ne coupe pas un calcul de deux minutes, et le
 * rouvrir retrouve son journal (React perdait l'un et l'autre en démontant le panneau). « Tout effacer » annule le flux
 * en cours et vide l'outil — React laissait le flux repeindre la carte qu'on venait de vider.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle.
 */
@Injectable()
export class BatailleV1Service {
  private readonly api = inject(IsochronesApi);
  private readonly bataille = inject(BatailleService);
  private readonly ctx = inject(ContexteBatailleService);

  readonly durees = signal<number[]>([10, 30]);
  readonly cache = signal<StatutCache | null>(null);
  readonly verification = signal(false);
  readonly chargement = signal(false);
  readonly journal = signal<string[]>([]);
  readonly progression = signal(0);
  readonly total = signal(0);
  readonly termines = signal(0);
  /** `battleRings` : les anneaux de la dernière bataille, prêts pour la découpe. */
  readonly anneauxDecoupe = signal<BattleRing[]>([]);
  /** `battleMeta` : la catégorie et le mode de la dernière bataille. */
  readonly meta = signal<{ categorie: string; mode: string } | null>(null);
  readonly application = signal(false);
  readonly applicationPct = signal(0);

  /** Le flux de la bataille. */
  private flux: Subscription | null = null;
  /**
   * Le flux de la découpe — un champ À PART (revue 1) : partager `flux` avec la bataille rendait la découpe orpheline
   * dès qu'un LANCER en écrasait la référence (ni « Tout effacer » ni la destruction ne l'annulaient plus).
   */
  private decoupe: Subscription | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** Le comptage de la capacité avant un lancement : un seul à la fois, le dernier clic gagne. */
  private borne: Subscription | null = null;

  constructor() {
    inject(CouchesCarteService).inscrireEffacement('bataille-v1', () => this.reinitialiser());
    inject(DestroyRef).onDestroy(() => this.arreter());
  }

  /** `toggleDuration` : la durée bascule, le statut du cache devient caduc. */
  basculerDuree(d: number): void {
    this.cache.set(null);
    this.durees.update((l) => basculerPalier(l, d));
  }

  viderJournal(): void {
    this.journal.set([]);
  }

  /** `handleCheckORS`. */
  verifierCache(): void {
    if (!this.ctx.unPoi() || this.durees().length === 0) return;
    this.verification.set(true);
    this.cache.set(null);
    this.api.verifierCache(corpsVerification(this.ctx.contexte(), this.durees()))
      .pipe(finalize(() => this.verification.set(false)))
      .subscribe({
        next: (statut) => this.cache.set(statut),
        error: (e: unknown) => this.journal.update((j) => [...j, `> ✕ Erreur vérif. cache : ${messageEchecHttp(e)}`]),
      });
  }

  /** `handleBattle(force)` : le flux de `/api/isochrone-battle`, un ticker d'une seconde tant qu'il coule. */
  lancer(force: boolean): void {
    if (!this.ctx.unPoi() || this.durees().length === 0 || this.chargement()) return;
    const ctx = this.ctx.contexte();
    const durees = this.durees();
    this.borne?.unsubscribe();
    // Capacité LOCALE aussi (relecture 2, I-1) : la route V1 est protégée et ne refait aucune borne, quel que soit le
    // périmètre — l'écran est sa seule garde contre les 60 s de Kong.
    const noter = (l: string) => this.journal.update((j) => [...j, l]);
    this.borne = this.ctx.sousBorne(ctx, durees, noter, () => this.lancerDans(ctx, durees, force), true);
  }

  private lancerDans(ctx: ContexteBataille, durees: readonly number[], force: boolean): void {
    if (this.chargement()) return;
    const params = parametresV1(ctx, durees, force);
    // LANCER reste actif pendant une découpe, comme React (`disabled` ne lit que `battleLoading`) : la découpe des
    // anneaux PRÉCÉDENTS est abandonnée, sinon elle repeindrait l'ancienne bataille par-dessus la nouvelle.
    this.annulerDecoupe();
    this.cache.set(null);
    this.progression.set(0);
    this.total.set(0);
    this.termines.set(0);
    this.journal.set(journalInitialV1(params.category, params.mode, params.max_minutes, libelleTerritoire(params, ctx.territoire, this.ctx.regions())));
    this.chargement.set(true);
    this.bataille.viderPartiels();
    const debut = Date.now();
    const ecoule = () => ((Date.now() - debut) / 1000).toFixed(1);
    let tick = 0;
    this.ticker = setInterval(() => this.journal.update((j) => tickJournal(j, ++tick, ecoule())), 1000);

    let resultat: ResultatV1 | null = null;
    this.flux = this.api.bataille(corpsBatailleV1(params, force)).pipe(finalize(() => this.arreterTicker())).subscribe({
      next: (e) => {
        if (e.type === 'result') { resultat = (e['data'] as ResultatV1 | undefined) ?? null; return; }
        if (e.type === 'partial_rings' && Array.isArray(e['rings']) && e['rings'].length) this.bataille.ajouterPartiels(e['rings']);
        this.progresser(e);
      },
      error: (err: unknown) => this.echouer(err),
      complete: () => {
        if (!resultat) { this.echouer(new Error('Réponse incomplète')); return; }
        if (resultat.error) { this.echouer(new Error(erreurDeFlux(resultat.error))); return; }
        this.terminer(resultat, params.category, params.mode, params.filtre_ville, ecoule());
      },
    });
  }

  /** « X BATAILLE (ST_Difference) » : la découpe des anneaux de la dernière bataille, en flux. */
  appliquer(): void {
    const anneaux = this.anneauxDecoupe();
    if (anneaux.length === 0 || this.application()) return;
    const categorie = this.meta()?.categorie ?? '';
    this.application.set(true);
    this.applicationPct.set(0);
    this.journal.update((j) => [...j, '> [BATAILLE] ST_Difference en cours…']);
    this.decoupe = this.api.appliquer(anneaux).pipe(finalize(() => this.application.set(false))).subscribe({
      next: (e) => {
        if (e.type === 'progress') this.noterApplication(String(e['message'] ?? ''), pctApplication(e['step']));
        if (e.type === 'result') {
          this.noterApplication(`${String(e['nb_rings'])} zones, ${String(e['nb_borders'])} bordures`, 95);
          const anneauxDecoupes = (e['battleGeoJSON'] as { features?: GeoJSON.Feature[] } | undefined)?.features ?? [];
          const bordures = (e['battleBorders'] as { features?: GeoJSON.Feature[] } | null | undefined)?.features ?? [];
          if (anneauxDecoupes.length > 0) this.bataille.peindre({ anneaux: anneauxDecoupes, bordures, categorie });
        }
      },
      error: (err: unknown) => this.journal.update((j) => [...j, `> ✕ ${messageEchecHttp(err) || 'Erreur bataille'}`]),
      complete: () => {
        this.applicationPct.set(100);
        this.journal.update((j) => [...j, '> ✓ Territoires découpés sans chevauchement']);
      },
    });
  }

  private noterApplication(msg: string, pct: number): void {
    this.journal.update((j) => [...j, `> ${msg}`]);
    this.applicationPct.set(pct);
  }

  /** Un événement de progression : compteurs, pourcentage, ligne remplacée en place (`use-isochrone-battle.ts:276-290`). */
  private progresser(e: EvenementFlux): void {
    const msg = messageEvenement(e);
    if (!msg) return;
    if (e.type === 'progress' && e['status'] !== 'bataille_postgis') {
      const total = Number(e['total'] ?? 0);
      this.progression.set(total > 0 ? Math.round((Number(e['completed'] ?? 0) / total) * 100) : 0);
    }
    const c = compteursProgression(msg);
    if (c.termines !== undefined) this.termines.set(c.termines);
    if (c.total !== undefined) this.total.set(c.total);
    this.journal.update((j) => remplacerProgression(j, msg));
  }

  /** Le résultat : anneaux bruts affichés, POI retenus et pointés, anneaux gardés pour la découpe. */
  private terminer(r: ResultatV1, categorie: string, mode: string, ville: string | undefined, ecoule: string): void {
    const features = r.battleGeoJSON?.features ?? [];
    if (features.length > 0) {
      this.bataille.viderPartiels();
      this.bataille.ajouterPartiels(anneauxBruts(features));
    }
    const pois = poisDeBataille(r.poisForMap, features, categorie);
    if (pois.length > 0) this.ctx.afficherPois(pois, categorie, ville);
    this.bataille.retenir(pois, r.battleCacheKey ?? null);
    this.progression.set(100);
    this.journal.update((j) => [...j, `> ✓ ${r.nb_pois ?? 0} POIs — isochrones affichés (${ecoule}s)`]);
    this.meta.set({ categorie, mode });
    this.anneauxDecoupe.set(anneauxPourDecoupe(features));
    this.chargement.set(false);
  }

  private echouer(err: unknown): void {
    this.journal.update((j) => [...j, `> ✕ ${messageEchecHttp(err)}`]);
    this.chargement.set(false);
  }

  private arreterTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  /** Le désabonnement déclenche `finalize`, qui rend le bouton de découpe. */
  private annulerDecoupe(): void {
    this.decoupe?.unsubscribe();
    this.decoupe = null;
  }

  private arreter(): void {
    this.flux?.unsubscribe();
    this.flux = null;
    this.borne?.unsubscribe();
    this.borne = null;
    this.annulerDecoupe();
    this.arreterTicker();
  }

  /** « Tout effacer » : flux annulé, outil remis à zéro (durées gardées : c'est un réglage, pas un résultat). */
  private reinitialiser(): void {
    this.arreter();
    this.chargement.set(false);
    this.application.set(false);
    this.cache.set(null);
    this.journal.set([]);
    this.anneauxDecoupe.set([]);
    this.meta.set(null);
    this.ctx.oublierRefus();
  }
}
