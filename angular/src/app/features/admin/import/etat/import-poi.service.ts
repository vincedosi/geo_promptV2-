import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type { Observable, Subscription } from 'rxjs';
import { NotificationsService } from '../../../../ui/notifications/notifications.service';
import { CategoriesPoiApi, type ReponseCategoriesPoi } from '../../commun/data/categories-poi.api';
import { OrganisationsListeApi, type ReponseOrganisationsListe } from '../../commun/data/organisations-liste.api';
import type { GeoConfig, GeoMode, ParseResult } from '../../logique/types/import-poi';
import { ImportPoiApi } from '../data/import-poi.api';
import {
  CATEGORIES_REPLI, ORGANISATION_DEFAUT, type Correspondance, type OptionCategoriePoi,
} from '../logique/constantes';

/** Étapes dont l'accès dépend de la précédente (T12) ; T13 ajoute 03c, 04 et 05. */
export type EtapeImportPoi = '02' | '03' | '03b';

/** Colonnes de géolocalisation (`geoMapping` de React) : `colLat`, `colLng`, `colAdresse`, `colCodePostal`, `colVille`, `colX`, `colY`. */
export type CorrespondanceGeo = Record<string, string>;

/**
 * Corps d'un refus HTTP tel que React l'aurait lu par `res.json()` : un objet JSON est rendu, tout le
 * reste (réseau coupé, corps HTML ou vide) vaut « illisible » — `res.json()` aurait levé.
 */
function corpsJson<T = Record<string, unknown>>(e: unknown): T | null {
  if (!(e instanceof HttpErrorResponse) || e.status === 0) return null;
  const corps: unknown = e.error;
  if (corps === null || typeof corps !== 'object' || corps instanceof Event || corps instanceof Error) return null;
  // Une réponse 2xx dont le JSON est invalide arrive en `{ error: SyntaxError, text }`.
  if ((corps as { error?: unknown }).error instanceof Error) return null;
  return corps as T;
}

/** Catégories de la route → options de l'étape 02 (`page.tsx:108-112`). */
function options(data: ReponseCategoriesPoi): OptionCategoriePoi[] | null {
  if (!data.success || !data.categories) return null;
  return data.categories.map((c) => ({ val: c.categorie, label: c.label_fr || c.categorie, icone: c.icone || '' }));
}

/**
 * L'état du parcours d'import POI (lot 6, T12) : ce que `app/admin/import/page.tsx` garde au niveau de la
 * PAGE (l.35-94), fourni par `ImportPoiPage` et détruit avec elle — revenir sur l'écran repart vide, comme
 * un nouveau montage de React. Les étapes le lisent et l'écrivent ; T13 y ajoute géocodage, essai à blanc
 * et import en flux (et consomme `configGeo`, `nomSource`, `organisationId`, `organisations`).
 *
 * - **Lectures du montage** (`charger`) : organisations et catégories, UNE fois par écran (cache avant
 *   appel). Échecs : organisations ignorées ; catégories → le repli codé en dur de React quand la réponse
 *   est illisible (réseau, corps non JSON), une liste vide quand la route répond `{ success: false }`.
 * - **Dépôt** (`analyser`) : une lecture (la route n'écrit rien en base) — annulée par un dépôt plus récent
 *   et à la destruction.
 * - **Création de catégorie** : une ÉCRITURE ; jamais désabonnée, sa suite ignorée après destruction.
 *
 * Écarts à React, voulus : un dépôt plus récent ANNULE le précédent (React gardait la réponse arrivée la
 * dernière, pas celle du dernier fichier) ; un refus de création de catégorie est NOTIFIÉ (React l'avalait,
 * le bouton revenait sans un mot) ; un corps d'analyse illisible dit « HTTP <statut> » (React affichait le
 * message de `SyntaxError`).
 */
@Injectable()
export class ImportPoiService {
  private readonly api = inject(ImportPoiApi);
  private readonly categoriesApi = inject(CategoriesPoiApi);
  private readonly organisationsApi = inject(OrganisationsListeApi);
  private readonly notifications = inject(NotificationsService);

  // ── 01 — dépôt ──
  /** Les fichiers déposés (un bundle Shapefile en compte plusieurs) ; le premier est celui qu'on affiche. */
  readonly fichiers = signal<File[]>([]);
  readonly analyse = signal<ParseResult | null>(null);
  readonly analyseEnCours = signal(false);

  // ── 02 — catégorie ──
  readonly categorie = signal('');
  readonly categories = signal<OptionCategoriePoi[]>([]);
  readonly nouvelleCategorie = signal('');
  readonly creationEnCours = signal(false);

  // ── 03 — correspondance ──
  readonly correspondance = signal<Correspondance>({});
  readonly modeGeo = signal<GeoMode>('gps');
  readonly correspondanceGeo = signal<CorrespondanceGeo>({});

  // ── 03b — colonnes ──
  readonly colonnesImportees = signal<string[]>([]);
  readonly champsFiltres = signal<string[]>([]);

  // ── 05 — import (champs de React lus par T13) ──
  readonly nomSource = signal('');
  readonly organisationId = signal(ORGANISATION_DEFAUT);
  readonly organisations = signal<{ id: string; name: string }[]>([]);

  /** Les colonnes du fichier analysé (`parseResult?.columns || []`). */
  readonly colonnes = computed(() => this.analyse()?.columns ?? []);

  /** `isStep3Valid` (`page.tsx:419-423`) : la géolocalisation du mode choisi est renseignée. */
  readonly geolocalisationComplete = computed(() => {
    const geo = this.correspondanceGeo();
    const m = this.correspondance();
    switch (this.modeGeo()) {
      case 'gps': return !!(geo['colLat'] && geo['colLng']);
      case 'address': return !!(geo['colAdresse'] || m.adresse || geo['colVille'] || m.ville);
      default: return !!(geo['colX'] && geo['colY']);
    }
  });

  /** Accès aux étapes, mêmes conditions que le rendu de React (`page.tsx:465, 481, 496`). */
  readonly etapeAccessible = computed<Record<EtapeImportPoi, boolean>>(() => {
    const analysee = this.analyse()?.success === true;
    const categorie = analysee && this.categorie().length > 0;
    return {
      '02': analysee,
      '03': categorie,
      '03b': categorie && this.geolocalisationComplete() && this.colonnes().length > 0,
    };
  });

  /** `buildGeoConfig` (`page.tsx:206-215`) : les colonnes du mode choisi, l'adresse retombant sur le mapping standard. */
  readonly configGeo = computed<GeoConfig>(() => {
    const geo = this.correspondanceGeo();
    const m = this.correspondance();
    const mode = this.modeGeo();
    if (mode === 'gps') return { mode, colLat: geo['colLat'], colLng: geo['colLng'] };
    if (mode === 'address') {
      return {
        mode,
        colAdresse: geo['colAdresse'] || m.adresse,
        colCodePostal: geo['colCodePostal'] || m.code_postal,
        colVille: geo['colVille'] || m.ville,
      };
    }
    return { mode, colX: geo['colX'], colY: geo['colY'] };
  });

  private detruit = false;
  private charge = false;
  private readonly lectures = new Map<string, Subscription>();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      for (const l of this.lectures.values()) l.unsubscribe();
    });
  }

  /** Les deux lectures du montage (`page.tsx:93-126`), une fois par écran. */
  charger(): void {
    if (this.charge) return;
    this.charge = true;
    this.lire('organisations', this.organisationsApi.lister(), (d) => this.appliquerOrganisations(d), (e) => {
      const corps = corpsJson<ReponseOrganisationsListe>(e);
      if (corps) this.appliquerOrganisations(corps);
    });
    this.lire('categories', this.categoriesApi.lister(), (d) => this.appliquerCategories(d), (e) => {
      const corps = corpsJson<ReponseCategoriesPoi>(e);
      if (corps) this.appliquerCategories(corps);
      else this.categories.set([...CATEGORIES_REPLI]);
    });
  }

  /** `handleFileUpload` (`page.tsx:132-186`). */
  analyser(fichiers: File[]): void {
    if (fichiers.length === 0) return;
    this.fichiers.set(fichiers);
    this.analyseEnCours.set(true);
    this.analyse.set(null);
    this.lire('analyse', this.api.analyser(fichiers), (data) => {
      this.analyse.set(data);
      this.appliquerAnalyse(data);
      this.analyseEnCours.set(false);
    }, (e) => {
      const corps = corpsJson<ParseResult>(e);
      if (corps) {
        this.analyse.set(corps);
        this.appliquerAnalyse(corps);
      } else {
        const message = e instanceof HttpErrorResponse && e.status !== 0 ? `HTTP ${e.status}` : 'Failed to fetch';
        this.analyse.set({ success: false, error: message } as ParseResult);
      }
      this.analyseEnCours.set(false);
    });
  }

  choisirCategorie(val: string): void {
    this.categorie.set(val);
  }

  /** `handleCreateCategory` (`CategoryStep.tsx:44-68`) : POST, relecture de la liste, la catégorie créée choisie. */
  creerCategorie(): void {
    const nom = this.nouvelleCategorie().trim();
    if (!nom || this.creationEnCours()) return;
    this.creationEnCours.set(true);
    // Une écriture : jamais désabonnée, sa suite est seulement ignorée après destruction.
    this.categoriesApi.creer(nom).subscribe({
      next: (data) => {
        if (this.detruit) return;
        if (!data.success) {
          this.echecCreation(data.error);
          return;
        }
        const categorie = data.categorie ?? '';
        this.lire('relecture', this.categoriesApi.lister(), (d) => {
          this.appliquerCategories(d);
          this.finirCreation(categorie);
        }, (e) => {
          const corps = corpsJson<ReponseCategoriesPoi>(e);
          if (corps) {
            this.appliquerCategories(corps);
            this.finirCreation(categorie);
          } else {
            this.creationEnCours.set(false);
          }
        });
      },
      error: (e: unknown) => {
        if (this.detruit) return;
        const corps = corpsJson(e);
        this.echecCreation(typeof corps?.['error'] === 'string' ? corps['error'] : undefined);
      },
    });
  }

  /** Un champ standard : « — Non mappe — » le retire (`v || undefined`, `MappingStep.tsx:234`). */
  associer(champ: string, colonne: string): void {
    this.correspondance.update((m) => ({ ...m, [champ]: colonne || undefined }));
  }

  /** Une colonne de géolocalisation : la valeur telle quelle, chaîne vide comprise (`MappingStep.tsx:273-290`). */
  associerGeo(cle: string, colonne: string): void {
    this.correspondanceGeo.update((g) => ({ ...g, [cle]: colonne }));
  }

  choisirModeGeo(mode: GeoMode): void {
    this.modeGeo.set(mode);
  }

  /** `toggleImport` (`ColumnSelectionStep.tsx:68-74`) : décocher retire aussi la colonne des filtres. */
  basculerImport(colonne: string): void {
    const avant = this.colonnesImportees();
    const apres = avant.includes(colonne) ? avant.filter((c) => c !== colonne) : [...avant, colonne];
    this.colonnesImportees.set(apres);
    if (!apres.includes(colonne)) this.champsFiltres.update((f) => f.filter((x) => x !== colonne));
  }

  basculerFiltre(colonne: string): void {
    this.champsFiltres.update((f) => (f.includes(colonne) ? f.filter((x) => x !== colonne) : [...f, colonne]));
  }

  /** « Tout importer » : les colonnes LIBRES seulement (`unmappedCols`). */
  toutImporter(libres: string[]): void {
    this.colonnesImportees.set([...libres]);
  }

  toutExclure(): void {
    this.colonnesImportees.set([]);
    this.champsFiltres.set([]);
  }

  effacerFiltres(): void {
    this.champsFiltres.set([]);
  }

  /** Ce qu'une analyse réussie pose en aval (`page.tsx:158-179`) ; la catégorie, elle, est gardée (React). */
  private appliquerAnalyse(data: ParseResult): void {
    if (data.success && data.suggestedMapping) {
      const suggere: Correspondance = {};
      for (const [cle, val] of Object.entries(data.suggestedMapping)) if (val) suggere[cle] = val;
      this.correspondance.set(suggere);
      const geo: CorrespondanceGeo = {};
      if (suggere['lat']) {
        geo['colLat'] = suggere['lat'];
        this.modeGeo.set('gps');
      }
      if (suggere['lng']) geo['colLng'] = suggere['lng'];
      if (suggere['x']) geo['colX'] = suggere['x'];
      if (suggere['y']) geo['colY'] = suggere['y'];
      this.correspondanceGeo.set(geo);
    }
    if (data.success && data.columns) {
      this.colonnesImportees.set(data.columns.map((c) => c.name));
      this.champsFiltres.set([]);
    }
  }

  private appliquerOrganisations(data: ReponseOrganisationsListe): void {
    if (data.success && data.organizations) this.organisations.set(data.organizations.map((o) => ({ id: o.id, name: o.name })));
  }

  private appliquerCategories(data: ReponseCategoriesPoi): void {
    const liste = options(data);
    if (liste) this.categories.set(liste);
  }

  private finirCreation(categorie: string): void {
    this.categorie.set(categorie);
    this.nouvelleCategorie.set('');
    this.creationEnCours.set(false);
  }

  private echecCreation(message?: string): void {
    this.notifications.error('Création de la catégorie échouée', message);
    this.creationEnCours.set(false);
  }

  /** Une lecture annulable, rangée sous sa clé : une nouvelle lecture de même clé annule la précédente. */
  private lire<T>(cle: string, source: Observable<T>, ok: (d: T) => void, ko: (e: unknown) => void): void {
    this.lectures.get(cle)?.unsubscribe();
    const s = source.subscribe({
      next: (d) => {
        this.lectures.delete(cle);
        ok(d);
      },
      error: (e: unknown) => {
        this.lectures.delete(cle);
        ko(e);
      },
    });
    if (!s.closed) this.lectures.set(cle, s);
  }
}
