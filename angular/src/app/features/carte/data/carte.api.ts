import { HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { type Observable, timeout } from 'rxjs';
import type { Bbox } from '../../../carte/bbox';
import { HttpBaseService } from '../../../core/http/http-base.service';

/** Un point d'intérêt — recopie de `POI` (`types/poi.ts`). */
export interface POI {
  id: string;
  nom: string;
  lat: number;
  lng: number;
  categorie: string;
  sous_categorie?: string;
  adresse?: string;
  ville?: string;
  region?: string;
  departement?: string;
  code_departement?: string;
  code_postal?: string;
  date_import?: string;
  organization_id?: string;
  data_source_id?: string;
  metadata?: unknown;
  /** Classement OOH (outil du copilote). */
  rank?: number | null;
  /** Audience estimée (outil du copilote). */
  audience?: number | null;
  /** Score OOH composite (outil du copilote). */
  score_ooh?: number | null;
}

/** Les points affichés et leur emprise — recopie de `ZoneData` (`types/spatial.ts:68-81`). */
export interface ZoneData {
  ville: string;
  region?: string | null;
  departement?: string | null;
  categorie_poi?: string | null;
  rayon_metres: number | null;
  rayon_poi_metres: number | null;
  coordonnees: { lat: number; lng: number };
  pois: POI[];
  nb_pois: number;
  categories: Record<string, number>;
  /** Couleurs propres par catégorie, ex. `{ lycee: '#000000' }`. */
  couleur_overrides?: Record<string, string>;
}

/** Le panneau cliqué, ouvert dans le tiroir Street View — recopie de `SelectedBillboard` (`types/map.ts`). */
export interface SelectedBillboard {
  id: string;
  nom: string;
  lat: number;
  lng: number;
  format?: string;
  score?: number | null;
  audience?: number | null;
  rank?: number | null;
  regie?: string;
}

/**
 * Le corps de `POST /api/map/pois` — `DirectPOISearchParams` (`filter-panel/types.ts`) complété de la `bbox`, que
 * l'appelant n'ajoute QUE si `bboxPourRequete(filtre)` est défini (`useMapDirectActions.ts:94-99`).
 */
export interface CorpsPois {
  poi_types: string[];
  scope: 'metro' | 'all' | null;
  regions: string[];
  depts: string[];
  ville: string;
  rayon_poi: string | null;
  poi_natures: Record<string, string[]>;
  bbox?: readonly [number, number, number, number];
}

/** Le corps de `POST /api/map/ooh` (`useMapDirectActions.ts:65-71`). */
export interface CorpsOoh {
  regies: string[];
  bbox?: readonly [number, number, number, number];
}

/** Un type de POI du catalogue ; la route rend aussi, dans un vieux format, une simple chaîne. */
export type CategoriePoi = { id: string; label: string } | string;

/** Délais de React (`AbortSignal.timeout`, `useMapDirectActions.ts:71,101`). */
export const DELAI_POIS_MS = 25000;
export const DELAI_OOH_MS = 15000;

/**
 * Les données ponctuelles de la carte principale : POI, panneaux OOH, arrêts de transport, catalogue des catégories
 * et des natures, masque d'un territoire.
 *
 * ⚠ `/api/map/pois` est un **POST** (`app/api/map/pois/route.ts:67`, le seul verbe exporté) : `ARCHITECTURE.md`
 * l'annonçait en GET jusqu'à la tâche 8 du lot 4.
 *
 * ── RÈGLES D'I/O (CLAUDE.md § Disk I/O) ─────────────────────────────────
 * - Aucun appel au chargement de la page : chaque requête part d'un geste (bouton « Afficher… ») ou, pour le
 *   catalogue, de la première ouverture de la section POI — et UNE fois par écran (`CataloguePoiService`).
 * - Les arrêts de transport ne portent que sur la carte VISIBLE (bbox `toFixed(4)`, `page.tsx:487-496`).
 * - POI et OOH ne reçoivent une bbox que si un filtre géographique est actif (`bboxPourRequete`).
 *
 * Fourni par la ROUTE (`FOURNISSEURS_DISTANTS`), comme tout service d'API (garde `modele-aida.test.ts`).
 */
@Injectable()
export class CarteApi extends HttpBaseService {
  /** `POST /api/map/pois`, 25 s au plus comme React. */
  pois(corps: CorpsPois): Observable<ZoneData> {
    return this.httpClient.post<ZoneData>(`${this.baseUrl}/map/pois`, corps).pipe(timeout(DELAI_POIS_MS));
  }

  /** `GET /api/map/categories` ; `rafraichir` rejoue le DISTINCT côté serveur (`?refresh=1`, `use-poi-catalog.ts:63-66`). */
  categories(rafraichir = false): Observable<{ categories?: CategoriePoi[]; error?: string }> {
    return this.httpClient.get<{ categories?: CategoriePoi[]; error?: string }>(
      `${this.baseUrl}/map/categories${rafraichir ? '?refresh=1' : ''}`,
    );
  }

  /** `GET /api/map/poi-natures?categorie=…` (`use-poi-catalog.ts:52`). */
  poiNatures(categorie: string): Observable<{ natures?: string[] }> {
    return this.httpClient.get<{ natures?: string[] }>(`${this.baseUrl}/map/poi-natures`, {
      params: new HttpParams().set('categorie', categorie),
    });
  }

  /** `POST /api/map/ooh`, 15 s au plus comme React. */
  ooh(corps: CorpsOoh): Observable<ZoneData> {
    return this.httpClient.post<ZoneData>(`${this.baseUrl}/map/ooh`, corps).pipe(timeout(DELAI_OOH_MS));
  }

  /**
   * `GET /api/map/transport?west=&south=&east=&north=[&types=]` — bbox à 4 décimales, types joints par une virgule et
   * omis s'il n'y en a aucun (`page.tsx:491`). L'adresse est écrite telle quelle, comme React (aucun encodage).
   */
  transport(b: Bbox, types: readonly string[]): Observable<ZoneData> {
    const [o, s, e, n] = b.map((v) => v.toFixed(4));
    const suite = types.length ? `&types=${types.join(',')}` : '';
    return this.httpClient.get<ZoneData>(`${this.baseUrl}/map/transport?west=${o}&south=${s}&east=${e}&north=${n}${suite}`);
  }

  /** `POST /api/map/territory-mask` : la géométrie d'un territoire, pour le masque de la carte. */
  territoryMask(scale: 'region' | 'departement' | 'cp', codes: readonly string[]): Observable<unknown> {
    return this.httpClient.post<unknown>(`${this.baseUrl}/map/territory-mask`, { scale, codes });
  }
}
