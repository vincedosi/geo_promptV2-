import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, signal } from '@angular/core';
import type {
  DryRunResult, GeocodeDetailedResult, ImportProgress, ImportReport, LogLevel,
} from '../../logique/types/import-poi';
import {
  type ActionGeocodage, type ConfigImport, type ReponseCorrection, type ReponseGeocodage, type StatsGeocodage,
} from '../data/import-poi.api';
import { ImportPoiPreparation, corpsJson } from './import-poi-preparation';

export type { CorrespondanceGeo } from './import-poi-preparation';

/** Étapes dont l'accès dépend de la précédente : 02 à 03b (T12), 03c, 04 et 05 (T13). */
export type EtapeImportPoi = '02' | '03' | '03b' | '03c' | '04' | '05';

/** Filtre du tableau de géocodage (`GeocodeFilter`, `GeocodeStep.tsx:30`). */
export type FiltreGeocodage = 'all' | 'green' | 'orange' | 'red';

/** Une ligne du journal d'import (`LogLine` de `ImportLogPanel.tsx`, sans l'horodatage que React n'affiche pas). */
export interface LigneJournalImport {
  level: LogLevel;
  line: string;
}

/** Ce que `mg-progression-import` affiche (C5) : étape NOMMÉE d'après la route, compteur, fin, échec. */
export interface EtatProgressionImport {
  etape: string;
  traitees: number | null;
  total: number | null;
  termine: boolean;
  echec: string | null;
}

/** Les compteurs du dernier événement qui portait un total (la ligne « traites / inseres / ignores / erreurs »). */
export interface CompteursImport {
  processed: number;
  total: number;
  /** Absents des événements qui ne les portent pas (React n'affiche alors pas leur compteur). */
  inserted?: number;
  ignored?: number;
  errors?: number;
}

/** Règle du lot 3 : un flux fini sans événement final est un échec, jamais un succès silencieux. */
export const MESSAGE_INTERROMPU = 'Le flux s’est interrompu avant la fin.';

/**
 * Étape d'une progression d'INSERTION : la route n'y joint aucun `message` (`execute/route.ts:202-211`) ; on
 * la nomme de ses propres mots, ceux du journal qui l'ouvre (« Insertion en base Supabase (N lignes)... », l.197).
 */
export const ETAPE_INSERTION = 'Insertion en base Supabase';

/**
 * Le message d'un refus HTTP : l'`error` du corps (objet JSON, ou texte JSON du flux), sinon `HTTP <statut>` ;
 * « Failed to fetch » (le message de `fetch`) sans réponse du serveur.
 */
function messageRefus(e: unknown): string {
  if (!(e instanceof HttpErrorResponse)) return e instanceof Error ? e.message : String(e);
  if (e.status === 0) return 'Failed to fetch';
  let corps: unknown = e.error;
  if (typeof corps === 'string') {
    try {
      corps = JSON.parse(corps);
    } catch {
      corps = null;
    }
  }
  const erreur = corps && typeof corps === 'object' ? (corps as { error?: unknown }).error : undefined;
  return typeof erreur === 'string' && erreur ? erreur : `HTTP ${e.status}`;
}

/**
 * L'état du parcours d'import POI (lot 6) : ce que `app/admin/import/page.tsx` garde au niveau de la PAGE, fourni
 * par `ImportPoiPage` et détruit avec elle. Les étapes 01 à 03b viennent d'`ImportPoiPreparation` (T12) ; ce
 * service y ajoute (T13) :
 *
 * - **03c — géocodage** (mode adresse) : `geocode/batch` (la BAN, service EXTERNE, appelée par le serveur pour
 *   toutes les lignes ; une lecture, annulée par un nouveau fichier et à la destruction), puis les corrections
 *   ligne à ligne (`geocode/update`, réécrit un fichier temporaire du serveur : jamais désabonnée) ;
 * - **04 — essai à blanc** (`dry-run`, une lecture) ;
 * - **05 — import en flux SSE** (`execute`, ⚠ ÉCRIT) : confirmation d'abord (C6), jamais désabonné (C13),
 *   journal, progression nommée (C5), rapport ; un flux tronqué est un échec nommé.
 */
@Injectable()
export class ImportPoiService extends ImportPoiPreparation {
  // ── 03c — géocodage (mode adresse) ──
  /** Identifiant des résultats gardés par le serveur (fichier temporaire), joint à l'essai et à l'import. */
  readonly geocodeId = signal<string | null>(null);
  readonly resultatsGeocodage = signal<GeocodeDetailedResult[]>([]);
  readonly statsGeocodage = signal<StatsGeocodage | null>(null);
  readonly geocodageEnCours = signal(false);
  readonly erreurGeocodage = signal<string | null>(null);
  readonly filtreGeocodage = signal<FiltreGeocodage>('all');
  /** `rowIndex` de la ligne dont le formulaire de correction est ouvert. */
  readonly ligneEditee = signal<number | null>(null);
  readonly adresseEditee = signal('');
  readonly latEditee = signal('');
  readonly lngEditee = signal('');
  readonly correctionEnCours = signal(false);
  readonly geocodageValide = signal(false);

  // ── 04 — essai à blanc ──
  readonly essai = signal<DryRunResult | null>(null);
  readonly essaiEnCours = signal(false);

  // ── 05 — import ──
  /** La boîte « Lancer l'import reel en base Supabase ? » (le `confirm()` de React, C6). */
  readonly confirmationImport = signal(false);
  readonly importEnCours = signal(false);
  /** `importProgress` de React : le dernier événement du flux qui n'est pas un `log` (ou l'échec). */
  readonly progression = signal<ImportProgress | null>(null);
  readonly etatProgression = signal<EtatProgressionImport | null>(null);
  readonly compteurs = signal<CompteursImport | null>(null);
  readonly rapport = signal<ImportReport | null>(null);
  /** `firstError` de l'événement `complete` : la première erreur SQL, affichée sous le rapport. */
  readonly premiereErreur = signal<string | null>(null);
  readonly journal = signal<LigneJournalImport[]>([]);

  /**
   * Accès aux étapes, mêmes conditions que le rendu de React (`page.tsx:465, 481, 496, 511, 544, 555`) : en mode
   * adresse, 04 reste fermée tant que le géocodage n'est pas VALIDÉ (`isGeocodeReady`, l.426) ; 05 s'ouvre sur
   * un essai réussi qui a trouvé au moins une ligne valide (sans autre condition, comme React).
   */
  readonly etapeAccessible = computed<Record<EtapeImportPoi, boolean>>(() => {
    const analysee = this.analyse()?.success === true;
    const categorie = analysee && this.categorie().length > 0;
    const geo = categorie && this.geolocalisationComplete();
    const adresse = this.modeGeo() === 'address';
    const essai = this.essai();
    return {
      '02': analysee,
      '03': categorie,
      '03b': geo && this.colonnes().length > 0,
      '03c': geo && adresse,
      '04': geo && (!adresse || this.geocodageValide()),
      '05': essai?.success === true && essai.stats.validRows > 0,
    };
  });

  /** Chaque import ouvre une « génération » : un nouveau fichier ou la destruction fait ignorer la suite du flux. */
  private generation = 0;

  /**
   * Un nouveau fichier (`handleFileUpload`, `page.tsx:139-141`) : l'essai à blanc, le rapport et la progression
   * repartent de zéro, le journal aussi. Écart voulu : le GÉOCODAGE aussi — React le gardait, et son `geocodeId`
   * (les coordonnées de l'ANCIEN fichier, ligne par ligne) partait avec l'essai et l'import du nouveau.
   * Un import en cours n'est pas annulé (C13) : sa suite est ignorée.
   */
  protected reinitialiserAval(): void {
    this.lectures.get('essai')?.unsubscribe();
    this.lectures.get('geocodage')?.unsubscribe();
    this.essai.set(null);
    this.essaiEnCours.set(false);
    this.geocodageEnCours.set(false);
    this.oublierImport();
    this.oublierGeocodage();
  }

  // ── 03c — géocodage ──

  /** `handleGeocodeBatch` (`page.tsx:221-259`) : toutes les adresses du fichier envoyées à la BAN par la route. */
  geocoder(): void {
    const fichier = this.analyse()?.fileId;
    if (!fichier) return;
    this.oublierGeocodage();
    this.geocodageEnCours.set(true);
    const gc = this.configGeo();
    const fin = (message: string | null, data?: ReponseGeocodage) => {
      if (message !== null) this.erreurGeocodage.set(message);
      else if (data) {
        this.geocodeId.set(data.geocodeId ?? null);
        this.resultatsGeocodage.set(data.results ?? []);
        this.statsGeocodage.set(data.stats ?? null);
      }
      this.geocodageEnCours.set(false);
    };
    this.lire('geocodage', this.api.geocoder({
      fileId: fichier, colAdresse: gc.colAdresse, colCodePostal: gc.colCodePostal, colVille: gc.colVille,
    }), (data) => {
      if (!data.success) fin(data.error || 'Erreur geocodage');
      else fin(null, data);
    }, (e) => {
      const corps = corpsJson<ReponseGeocodage>(e);
      fin(corps ? corps.error || 'Erreur geocodage' : messageRefus(e));
    });
  }

  /** « Corriger » / « Fermer » d'une ligne (`GeocodeStep.tsx:256-261`) : recopie l'adresse et les coordonnées. */
  ouvrirEdition(r: GeocodeDetailedResult): void {
    this.ligneEditee.set(this.ligneEditee() === r.rowIndex ? null : r.rowIndex);
    this.adresseEditee.set(r.inputAddress);
    this.latEditee.set(r.lat?.toString() || '');
    this.lngEditee.set(r.lng?.toString() || '');
  }

  /**
   * `handleGeocodeUpdateRow` (`page.tsx:261-287`). Réécrit le fichier temporaire du serveur : jamais
   * désabonnée, sa suite ignorée après destruction ou après un nouveau géocodage. Écart voulu : un refus est
   * NOTIFIÉ (React l'avalait, la ligne restait telle quelle sans un mot).
   */
  corriger(rowIndex: number, action: ActionGeocodage): void {
    const geocodeId = this.geocodeId();
    if (!geocodeId) return;
    this.correctionEnCours.set(true);
    const perime = () => this.detruit || geocodeId !== this.geocodeId();
    const echec = (message?: string) => {
      this.notifications.error('Correction du géocodage échouée', message);
      this.correctionEnCours.set(false);
    };
    this.api.corrigerGeocodage({ geocodeId, rowIndex, action }).subscribe({
      next: (data) => {
        if (perime()) return;
        if (!data.success || !data.updatedResult) echec(data.error);
        else this.appliquerCorrection(rowIndex, data);
      },
      error: (e: unknown) => {
        if (perime()) return;
        const corps = corpsJson<ReponseCorrection>(e);
        echec(corps ? corps.error : messageRefus(e));
      },
    });
  }

  validerGeocodage(): void {
    this.geocodageValide.set(true);
  }

  /** « Relancer tout le geocodage » (`GeocodeStep.tsx:363-369`) : retour au bouton de lancement. */
  relancerGeocodage(): void {
    this.oublierGeocodage();
  }

  // ── 04 — essai à blanc ──

  /** `handleDryRun` (`page.tsx:293-326`) : les 100 premières lignes, rien en base. */
  essayer(): void {
    const config = this.config({ limit: 100 });
    if (!config) return;
    this.essaiEnCours.set(true);
    this.essai.set(null);
    this.lire('essai', this.api.essayer(config), (data) => {
      this.essai.set(data);
      this.essaiEnCours.set(false);
    }, (e) => {
      this.essai.set(corpsJson<DryRunResult>(e) ?? ({ success: false, error: messageRefus(e) } as DryRunResult));
      this.essaiEnCours.set(false);
    });
  }

  // ── 05 — import ──

  /** « LANCER L'IMPORT REEL » : la confirmation d'abord (le `confirm()` de React, l.334), rien n'est envoyé. */
  demanderImport(): void {
    if (!this.analyse()?.fileId || this.importEnCours()) return;
    this.confirmationImport.set(true);
  }

  annulerImport(): void {
    this.confirmationImport.set(false);
  }

  /**
   * `handleImport` (`page.tsx:332-410`), une fois confirmé. ⚠ ÉCRIT (une source, les POI). Jamais désabonné, ni
   * par la destruction ni par un nouveau fichier (C13) : la génération fait ignorer la suite.
   */
  confirmerImport(): void {
    this.confirmationImport.set(false);
    const config = this.config({
      sourceName: this.nomSource().trim() || undefined,
      organizationId: this.organisationId(),
      importedColumns: this.colonnesImportees().length > 0 ? this.colonnesImportees() : undefined,
      filterFields: this.champsFiltres().length > 0 ? this.champsFiltres() : undefined,
    });
    if (!config || this.importEnCours()) return;
    const generation = ++this.generation;
    const actuel = () => !this.detruit && generation === this.generation;
    let fini = false;
    this.importEnCours.set(true);
    this.rapport.set(null);
    this.progression.set(null);
    this.premiereErreur.set(null);
    this.compteurs.set(null);
    this.journal.set([]);
    this.etatProgression.set({ etape: 'Lancement', traitees: null, total: null, termine: false, echec: null });

    this.api.importer(config).subscribe({
      next: (evt) => {
        if (!actuel()) return;
        if (evt.type === 'complete' || evt.type === 'error') fini = true;
        this.evenement(evt);
      },
      error: (e: unknown) => {
        if (!actuel()) return;
        this.echouer(messageRefus(e));
        this.importEnCours.set(false);
      },
      complete: () => {
        if (!actuel()) return;
        if (!fini) this.echouer(MESSAGE_INTERROMPU);
        this.importEnCours.set(false);
      },
    });
  }

  /** Un événement du flux, lu comme React (l.384-399), plus la progression nommée (C5). */
  private evenement(evt: ImportProgress): void {
    if (evt.type === 'log') {
      const ligne = evt.logLine;
      if (ligne) this.journal.update((j) => [...j, { level: evt.logLevel || 'info', line: ligne }]);
      return;
    }
    this.progression.set(evt);
    if (evt.type === 'error') {
      this.echouer(evt.message ?? 'Erreur import', false);
      return;
    }
    if (evt.type === 'complete') {
      if (evt.report) this.rapport.set(evt.report);
      this.premiereErreur.set(evt.firstError ?? null);
      this.etatProgression.update((p) => (p ? { ...p, termine: true } : p));
      return;
    }
    // `progress` et `geocode` : l'étape est le message de la route ; un total nul (« Parsing du fichier... ») n'en est pas un.
    const total = evt.total && evt.total > 0 ? evt.total : null;
    this.etatProgression.update((p) => (p ? {
      ...p,
      etape: evt.message ?? ETAPE_INSERTION,
      traitees: total === null ? null : evt.processed ?? 0,
      total,
    } : p));
    if (total !== null) {
      this.compteurs.set({
        processed: evt.processed ?? 0, total, inserted: evt.inserted, ignored: evt.ignored, errors: evt.errors,
      });
    }
  }

  /**
   * L'échec d'un import : React met `{ type: 'error', message }` à la place de la progression (l.406) ; la barre
   * garde le pourcentage atteint, le journal le dit aussi.
   */
  private echouer(message: string, remplacer = true): void {
    if (remplacer) this.progression.set({ type: 'error', message });
    this.journal.update((j) => [...j, { level: 'error', line: `! ${message}` }]);
    this.etatProgression.update((p) => ({ ...(p ?? { etape: 'Lancement', traitees: null, total: null, termine: false }), echec: message }));
  }

  /** Le corps commun à l'essai et à l'import (`page.tsx:299-311, 342-357`), `geocodeId` en mode adresse. */
  private config(plus: Partial<ConfigImport>): ConfigImport | null {
    const fileId = this.analyse()?.fileId;
    if (!fileId) return null;
    const config: ConfigImport = {
      fileId, dataType: 'poi', category: this.categorie(), mapping: this.correspondance(), geolocation: this.configGeo(), ...plus,
    };
    const geocodeId = this.geocodeId();
    if (this.modeGeo() === 'address' && geocodeId) config.geocodeId = geocodeId;
    return config;
  }

  private appliquerCorrection(rowIndex: number, data: ReponseCorrection): void {
    const corrigee = data.updatedResult;
    if (corrigee) this.resultatsGeocodage.update((rs) => rs.map((r) => (r.rowIndex === rowIndex ? corrigee : r)));
    this.statsGeocodage.set(data.stats ?? null);
    this.ligneEditee.set(null);
    this.adresseEditee.set('');
    this.latEditee.set('');
    this.lngEditee.set('');
    this.correctionEnCours.set(false);
  }

  /**
   * Retour au bouton de lancement. Une correction encore en vol appartient à l'ANCIENNE session : sa réponse sera
   * ignorée (`perime`), donc ses boutons ne doivent pas rester désactivés.
   */
  private oublierGeocodage(): void {
    this.correctionEnCours.set(false);
    this.geocodeId.set(null);
    this.resultatsGeocodage.set([]);
    this.statsGeocodage.set(null);
    this.geocodageValide.set(false);
    this.erreurGeocodage.set(null);
  }

  /** Un nouveau fichier : l'import affiché est oublié, un flux encore ouvert n'écrira plus l'écran. */
  private oublierImport(): void {
    this.generation++;
    this.importEnCours.set(false);
    this.confirmationImport.set(false);
    this.rapport.set(null);
    this.progression.set(null);
    this.etatProgression.set(null);
    this.compteurs.set(null);
    this.premiereErreur.set(null);
    this.journal.set([]);
  }
}
