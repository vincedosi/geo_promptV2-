import { HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { type Observable, timeout } from 'rxjs';
import type { Bbox } from '../../../carte/bbox';
import { HttpBaseService } from '../../../core/http/http-base.service';
import { SOURCE_TMJA } from '../logique/palettes-donnees-carte';

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
  /** Classement OOH (copilote retiré : plus aucun producteur ; champ lu seulement). */
  rank?: number | null;
  /** Audience estimée (copilote retiré : plus aucun producteur). */
  audience?: number | null;
  /** Score OOH composite (copilote retiré : plus aucun producteur). */
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
  /**
   * `/api/map/transport` seulement : la borne de la route (5 000 arrêts, `BORNE_ARRETS`) est atteinte et la liste est
   * COUPÉE (sql/241 lit `p_limite + 1` lignes pour le savoir). Absent des autres routes. Lu par la légende.
   */
  tronque?: boolean;
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

/** D'où vient une catégorie (droits sur la carte, T2) : du socle commun à tous les espaces, ou de l'espace actif. */
export type OrigineCategorie = 'commune' | 'espace';

/**
 * Un type de POI du catalogue ; la route rend aussi, dans un vieux format, une simple chaîne. `origine` : une catégorie
 * dont au moins un POI visible vient d'une source privée de l'espace actif (ou partagée avec lui) est « espace » ;
 * « commune » sinon. Absent d'une réponse ancienne : lu « commune » (`typeDePoi`).
 */
export type CategoriePoi = { id: string; label: string; origine?: OrigineCategorie } | string;

/** Réponse de `GET /api/map/pprt` (`PprtLayer.tsx:63-73`). `n_total` est compté AVANT la limite. */
export interface CollectionPprt {
  type: 'FeatureCollection';
  features: GeoJSON.Feature[];
  n_total?: number;
  n_rendus?: number;
  tolerance_deg?: number;
}

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

  /**
   * Les tuiles MVT du flux routier, `…/api/tmja-tiles/{z}/{x}/{y}?v=v10` (`useMapInit.ts:391-396`, T9) : aucun appel
   * `HttpClient`, MapLibre les lit dans son worker — d'où l'adresse ABSOLUE, comme `CarreauxApi.urlTuiles`.
   */
  urlTuilesTmja(): string {
    return `${this.urlAbsolue('tmja-tiles/{z}/{x}/{y}')}?v=${SOURCE_TMJA.version}`;
  }

  /**
   * `GET /api/map/pprt?bbox=[&types=][&limite=]` — périmètres PPRT de la carte VISIBLE (lot 4, T12), `types` omis s'il n'y
   * en a aucun (`PprtLayer.tsx:128-133`), `limite` seulement si l'appelant la fixe (React n'en envoie pas : défaut 700
   * de la route). RPC `jsonb` : aucune troncature PostgREST, la borne est `limite` (qui coupe les PLUS PETITES zones).
   */
  pprt(bbox: string, types: readonly string[], limite?: number): Observable<CollectionPprt> {
    let params = new HttpParams().set('bbox', bbox);
    if (types.length > 0) params = params.set('types', types.join(','));
    if (limite !== undefined) params = params.set('limite', String(limite));
    return this.httpClient.get<CollectionPprt>(`${this.baseUrl}/map/pprt`, { params });
  }

  /** `POST /api/map/territory-mask` : la géométrie d'un territoire, pour le masque de la carte. */
  territoryMask(scale: 'region' | 'departement' | 'cp', codes: readonly string[]): Observable<unknown> {
    return this.httpClient.post<unknown>(`${this.baseUrl}/map/territory-mask`, { scale, codes });
  }
}
