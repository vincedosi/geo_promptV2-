import { Injectable } from '@angular/core';
import type { HttpResponse } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../../core/http/http-base.service';
import type { DataSource } from '../../logique/types/admin';

/** `GET /api/admin/sources` : les sources ACTIVES, triées par date d'import décroissante. */
export interface ReponseSources {
  success: boolean;
  sources?: DataSource[];
  error?: string;
}

/**
 * `GET /api/admin/sources-stats` (RPC `get_sources_stats`, `success` + le JSON de la RPC à plat).
 * ⚠ `ooh` ne porte plus que `total` depuis sql/082 (amendement A6) : `nb_villes`, `regies`,
 * `sources`, `types`, `top_villes` du type React (`_lib/types.ts:64`) n'arrivent plus — ils sont
 * déclarés optionnels ici, et l'écran ne les lit pas.
 */
export interface StatsSources {
  success: boolean;
  error?: string;
  ooh: { total: number; nb_villes?: number; regies?: string[] };
  poi: { total: number; by_category: Array<{ categorie: string; nb: number }> };
  transport: { total: number; bus: number; train: number; tram: number; metro: number };
  flux: { total: number; cerema: number; osm: number };
  carreaux: { total: number };
  iris: { total: number; enrichis: number };
}

/** `GET /api/admin/custom-geo/stats` (RPC `admin_get_custom_geo_stats`) — `AdminCustomGeoStats` de React. */
export interface StatsZones {
  total_zones: number;
  total_iris: number;
  total_cp: number;
  nb_workspaces: number;
  top_workspaces: Array<{ org_id: string; org_name: string | null; nb_zones: number }>;
}

/** Corps accepté par `PATCH /api/admin/sources/[id]` qu'émet l'écran : le nom, ou les champs filtres. */
export type ModificationSource = { name: string } | { filter_fields: string[] };

/** Réponse de `PATCH` / `DELETE` : `success`, et `error` en cas d'échec (409 campagne, 500…). */
export interface ReponseEcriture {
  success: boolean;
  error?: string;
  source?: DataSource;
}

/** `GET /api/admin/sources/[id]/meta-keys` : clés `metadata` non vides, sur 100 POI au plus. */
export interface ReponseCles {
  success: boolean;
  keys?: string[];
  error?: string;
}

/**
 * Routes de l'écran Sources (lot 6, T18) — toutes `requireAdmin`. Les lectures des panneaux
 * (transport, IRIS, POI, DSP, zones) viendront avec T19-T20.
 *
 * Fourni par la route `admin` (`FOURNISSEURS_ADMIN`, C3).
 */
@Injectable()
export class SourcesAdminApi extends HttpBaseService {
  sources(): Observable<ReponseSources> {
    return this.httpClient.get<ReponseSources>(`${this.baseUrl}/admin/sources`);
  }

  stats(): Observable<StatsSources> {
    return this.httpClient.get<StatsSources>(`${this.baseUrl}/admin/sources-stats`);
  }

  statsZones(): Observable<StatsZones> {
    return this.httpClient.get<StatsZones>(`${this.baseUrl}/admin/custom-geo/stats`);
  }

  modifier(id: string, corps: ModificationSource): Observable<ReponseEcriture> {
    return this.httpClient.patch<ReponseEcriture>(`${this.baseUrl}/admin/sources/${encodeURIComponent(id)}`, corps);
  }

  supprimer(id: string): Observable<ReponseEcriture> {
    return this.httpClient.delete<ReponseEcriture>(`${this.baseUrl}/admin/sources/${encodeURIComponent(id)}`);
  }

  cles(id: string): Observable<ReponseCles> {
    return this.httpClient.get<ReponseCles>(`${this.baseUrl}/admin/sources/${encodeURIComponent(id)}/meta-keys`);
  }

  /**
   * Export CSV en blob, PAR `HttpClient` donc sous jeton (C8) : React fait `window.open` de la route,
   * qui part sans `Authorization` et répond 401. Le nom est celui de `Content-Disposition`
   * (`<nom>_export[_tronque].csv`), lu par `ENREGISTRER_FICHIER`.
   */
  exporter(id: string): Observable<HttpResponse<Blob>> {
    return this.httpClient.get(`${this.baseUrl}/admin/sources/${encodeURIComponent(id)}/export`, {
      observe: 'response', responseType: 'blob',
    });
  }
}
