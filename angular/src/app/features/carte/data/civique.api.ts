import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import { lignesNdjson } from '../../../core/http/ndjson';
import type { MeteoScale } from '../logique/meteo/types';
import type { CodeVariableCivique } from '../logique/palettes-donnees-carte';
import type { EchelleSante, JeuSante } from '../logique/sante';

export type { EchelleSante, JeuSante };

/** Le pollen d'une commune représentative (`lib/civic-health/types.ts`, `PollenIndicator`), réduit à ce que la carte lit. */
export interface PollenDepartement {
  indice_global: number;
  especes: Record<string, number>;
  concentrations?: Record<string, number>;
  alerte?: boolean;
}

/** L'air d'une commune représentative (`AirIndicator`), réduit à ce que la carte lit. */
export interface AirDepartement {
  indice: number;
  sous_indices: Partial<Record<'no2' | 'o3' | 'pm10' | 'pm25' | 'so2', number | null>>;
}

/** Une ligne du flux NDJSON départemental (`DeptLine`, `CivicHealthMapLayer.tsx:66-74`). */
export interface LigneDepartement {
  type: 'meta' | 'dept' | 'done';
  total?: number;
  code_dept?: string;
  nom_dept?: string;
  pollen?: PollenDepartement | null;
  air?: AirDepartement | null;
  stale?: boolean;
}

/** Une ligne de `pollen_map_daily` / `atmo_map_daily` (`CpRow`, `CivicHealthMapLayer.tsx:76-82`). */
export interface LigneCp {
  code_postal: string;
  indice_global: number;
  nb_communes: number;
  alerte?: boolean;
  [metrique: string]: string | number | boolean | undefined;
}

/** `GET …?scale=cp` : la date la plus récente disponible, ou `null` si l'ingestion n'a jamais tourné. */
export interface ReponseSanteCp {
  date: string | null;
  rows: LigneCp[];
  error?: string;
}

/** `GET /api/insee-variables/cp-detail?cp=` : la commune principale d'un code postal. */
export interface DetailCp {
  code_postal: string;
  commune_principale: string | null;
  nb_communes: number;
  communes?: string[];
}

/** L'indicateur air + pollen d'une commune (`HealthIndicator`, `lib/civic-health/types.ts:66-77`). */
export interface SanteCommune {
  code_insee: string;
  commune: string;
  air: {
    date: string;
    indice: number;
    qualificatif: string;
    sous_indices: Partial<Record<'pm10' | 'pm25' | 'no2' | 'o3' | 'so2', number | null>>;
    previsionJ1?: { indice: number; qualificatif: string };
  } | null;
  pollen: {
    date: string;
    indice_global: number;
    especes: Record<string, number>;
    concentrations?: Record<string, number>;
    alerte?: boolean;
    previsionJ1?: { indice: number };
    previsionJ2?: { indice: number };
  } | null;
  fetchedAt: string;
  source: string;
  stale: boolean;
}

/** `GET /api/civic-indicators/health/<commune>` (`HealthApiResponse`). */
export interface ReponseSanteCommune {
  data: SanteCommune | null;
  provider?: string;
  error?: 'unavailable' | 'invalid_code';
  message?: string;
}

/** Une ligne du flux d'ingestion (`use-civic-ingest.ts:374-381`). */
export interface LigneIngestion {
  type: string;
  message?: string;
  summary?: {
    pollen: { cps_written?: number; date?: string; error?: string };
    atmo: { cps_written?: number; date?: string; error?: string };
  };
}

/**
 * Les indicateurs civiques et la santé environnementale de la carte principale (`CivicIndicatorsLayer.tsx`,
 * `CivicHealthMapLayer.tsx`, `use-civic-ingest.ts`).
 *
 * ── RÈGLES D'I/O (CLAUDE.md § Disk I/O) ─────────────────────────────────
 * - Indicateur civique : la bbox VISIBLE, jamais le monde. React demandait `-180,-90,180,90` : 6 186 polygones,
 *   21,6 Mo de jsonb et 3,9 s de RPC mesurés le 2026-10-10 ; la carte visible du département 13 : 225 polygones,
 *   0,6 Mo, 34 ms.
 * - Santé au code postal : `bbox` SEULEMENT si un filtre est actif (`bboxPourRequete`), comme React.
 * - Santé au département : flux NDJSON (`lignesNdjson`) — la progression avance ligne à ligne.
 * - Aucune de ces routes n'est une requête de TABLE plafonnée à 1 000 lignes par `db-max-rows` côté carte : les deux
 *   GeoJSON sont des RPC `jsonb` ; la lecture CP (`pollen_map_daily`, requête de table `.limit(10 000)`) rendrait au plus
 *   1 000 lignes, mais n'en porte que 100 par jour en base locale (mesuré le 2026-10-10) — voir le rapport T10.
 *
 * Fourni par la ROUTE (`FOURNISSEURS_DISTANTS`), comme tout service d'API (garde `modele-aida.test.ts`).
 */
@Injectable()
export class CiviqueApi extends HttpBaseService {
  /** `GET /api/insee-variables/<code>/geojson?bbox=o,s,e,n` — polygones des codes postaux, propriété `value`. */
  geojsonVariable(code: CodeVariableCivique, bbox: string): Observable<GeoJSON.FeatureCollection> {
    return this.httpClient.get<GeoJSON.FeatureCollection>(
      `${this.baseUrl}/insee-variables/${code}/geojson?bbox=${bbox}`,
    );
  }

  /** `GET /api/insee-variables/cp-detail?cp=…` (popup d'un code postal). */
  detailCp(cp: string): Observable<DetailCp> {
    return this.httpClient.get<DetailCp>(`${this.baseUrl}/insee-variables/cp-detail?cp=${encodeURIComponent(cp)}`);
  }

  /** `GET /api/civic-indicators/health/<commune>` — la fiche air + pollen de la commune de l'IRIS (`HealthIndicatorCard.tsx:72`). */
  santeCommune(codeCommune: string): Observable<ReponseSanteCommune> {
    return this.httpClient.get<ReponseSanteCommune>(`${this.baseUrl}/civic-indicators/health/${encodeURIComponent(codeCommune)}`);
  }

  /**
   * `GET /api/meteo-geo/zones?scale=…` — polygones des régions, des départements ou des codes postaux. Lu par la santé
   * environnementale (T10) et la météo (T11), toujours à travers `ZonesMeteoService`, qui les met en cache pour l'écran.
   */
  zones(echelle: EchelleSante | MeteoScale): Observable<GeoJSON.FeatureCollection> {
    return this.httpClient.get<GeoJSON.FeatureCollection>(`${this.baseUrl}/meteo-geo/zones?scale=${echelle}`);
  }

  /** `GET /api/civic-indicators/health-map?dataset=…&scale=departement` — flux NDJSON, une ligne par département. */
  santeDepartement(jeu: JeuSante): Observable<LigneDepartement> {
    return lignesNdjson<LigneDepartement>(
      this.httpClient.get(`${this.baseUrl}/civic-indicators/health-map?dataset=${jeu}&scale=departement`, {
        observe: 'events', reportProgress: true, responseType: 'text',
      }),
    );
  }

  /**
   * `GET /api/civic-indicators/health-map?dataset=…&scale=cp&min_level=0&metric=global[&bbox=…]` — la chaîne de React,
   * dans le même ordre (`CivicHealthMapLayer.tsx:311-312`) : le seuil et la métrique sont appliqués à la PEINTURE.
   */
  santeCp(jeu: JeuSante, bbox: string | null): Observable<ReponseSanteCp> {
    return this.httpClient.get<ReponseSanteCp>(
      `${this.baseUrl}/civic-indicators/health-map?dataset=${jeu}&scale=cp&min_level=0&metric=global`
        + (bbox ? `&bbox=${bbox}` : ''),
    );
  }

  /** `POST /api/admin/civic-ingest` — flux NDJSON ; la route exige un administrateur (403 sinon). ÉCRIT en base. */
  ingerer(): Observable<LigneIngestion> {
    return lignesNdjson<LigneIngestion>(
      this.httpClient.post(`${this.baseUrl}/admin/civic-ingest`, null, {
        observe: 'events', reportProgress: true, responseType: 'text',
      }),
    );
  }
}
