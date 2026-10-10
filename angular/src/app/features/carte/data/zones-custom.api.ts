import type { HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import type { EntiteZone } from '../logique/zones/zone-du-lien';
import type { SourceOperation } from '../logique/zones/operations-zones';

/**
 * Une zone enregistrée, telle que `GET /api/custom-geo/list` la rend — recopie de `CustomGeoZoneSummary`
 * (`types/custom-geo.ts:46-61`), forme de la réponse de `app/api/custom-geo/list/route.ts`.
 */
export interface ZoneCustomResume {
  id: string;
  name: string;
  description: string | null;
  source_type: string;
  source_metadata: Record<string, unknown>;
  feature_count_iris: number;
  feature_count_cp: number;
  bbox: [number, number, number, number] | null;
  created_at: string;
  created_by: string | null;
  /** Codes département INSEE résolus (`custom_geo_zone_codes`, `code_type='dept'`). */
  dept_codes?: string[];
  /** Codes région INSEE résolus (`custom_geo_zone_codes`, `code_type='region'`). */
  region_codes?: string[];
}

/** `GET /api/custom-geo/stats` (`get_custom_geo_zones_stats`) : champs lus par `ZonesOverlay.tsx:171-175`. */
export interface StatsZones {
  total?: number;
  total_iris?: number;
  total_cp?: number;
}

/** Ce que rend une opération booléenne `POST /api/custom-geo/source/{composite,intersection,difference}`. */
export interface ResultatOperation {
  geometry: GeoJSON.Geometry;
  surface_km2?: number | null;
}

/** Le corps de `POST /api/custom-geo/save` tel que les opérations l'envoient (`ZonesOperations.tsx:117-131`). */
export interface ZoneAEnregistrer {
  name: string;
  source_type: string;
  source_metadata: Record<string, unknown>;
  geometry: GeoJSON.Geometry;
  org_id: string;
}

/** `POST /api/custom-geo/save` : 200 avec les comptes, ou 207 si la résolution des codes a échoué. */
export interface ZoneEnregistree {
  zone_id: string;
  count_iris?: number;
  count_cp?: number;
  warning?: string;
}

/** Les formats de `GET /api/custom-geo/[id]/export` — `CustomGeoExportFormat` (`types/custom-geo.ts:84-91`). */
export type FormatExportZone = 'csv_cp' | 'csv_iris' | 'geojson' | 'dv360_cp' | 'dv360_sdf' | 'bidding_script' | 'tiktok_geo';

/**
 * Les zones enregistrées de l'organisation (`custom_geo_zones`) : liste (T5), puis tout ce que le panneau Zones et le
 * lien `?customZone=` emploient (T14).
 *
 * Fourni par la ROUTE (`FOURNISSEURS_DISTANTS`, `app.routes.ts`), jamais à la racine : un service racine
 * recevrait le `HttpClient` du shell, sans nos intercepteurs (jeton, limiteur, session expirée).
 *
 * Pas de `renommer` : aucun écran de la carte React ne renomme une zone (`PATCH /api/custom-geo/[id]` sert la page
 * `/map/custom-geo`, hors de ce lot) — une méthode sans appelant serait du code mort.
 */
@Injectable()
export class ZonesCustomApi extends HttpBaseService {
  /**
   * `GET /api/custom-geo/list?…`. Les paramètres arrivent COMPOSÉS par l'appelant (`URLSearchParams`), et partent
   * tels quels — même chaîne que React (`PanneauFiltre.tsx:251-252`), sans le réencodage de `HttpParams`.
   */
  lister(params: URLSearchParams): Observable<{ zones: ZoneCustomResume[] }> {
    return this.httpClient.get<{ zones: ZoneCustomResume[] }>(`${this.baseUrl}/custom-geo/list?${params.toString()}`);
  }

  /** `GET /api/custom-geo/stats?org_id=…&_t=…` — horodatage anti-cache comme React (`ZonesOverlay.tsx:155`). */
  stats(org: string, horodatage: number): Observable<StatsZones> {
    const p = new URLSearchParams({ org_id: org, _t: String(horodatage) });
    return this.httpClient.get<StatsZones>(`${this.baseUrl}/custom-geo/stats?${p.toString()}`);
  }

  /** `GET /api/custom-geo/[id]/geometry` : la zone en `Feature` GeoJSON (404 si inaccessible). */
  geometrie(id: string): Observable<EntiteZone> {
    return this.httpClient.get<EntiteZone>(`${this.baseUrl}/custom-geo/${encodeURIComponent(id)}/geometry`);
  }

  /** `DELETE /api/custom-geo/[id]` — 409 si une stratégie ou un composite la référence encore. */
  supprimer(id: string): Observable<{ deleted: boolean; id: string }> {
    return this.httpClient.delete<{ deleted: boolean; id: string }>(`${this.baseUrl}/custom-geo/${encodeURIComponent(id)}`);
  }

  /**
   * `POST /api/custom-geo/source/{composite,intersection,difference}` — UNE méthode pour les trois routes : elles ne
   * diffèrent que par le chemin et le corps (`corpsOperation`), comme la table `OPERATIONS` de React.
   */
  operation(source: SourceOperation, corps: Record<string, unknown>): Observable<ResultatOperation> {
    return this.httpClient.post<ResultatOperation>(`${this.baseUrl}/custom-geo/source/${source}`, corps);
  }

  /** `POST /api/custom-geo/save`, réponse COMPLÈTE : le statut 207 (codes non résolus) se lit sur elle. */
  enregistrer(zone: ZoneAEnregistrer): Observable<HttpResponse<ZoneEnregistree>> {
    return this.httpClient.post<ZoneEnregistree>(`${this.baseUrl}/custom-geo/save`, zone, { observe: 'response' });
  }

  /**
   * `GET /api/custom-geo/[id]/export?format=…` en `blob`, réponse complète (`Content-Disposition` donne le nom) —
   * `downloadZoneExport` (`lib/custom-geo/download-export.ts`). Le format part en PREMIER, comme React.
   */
  exporter(id: string, format: FormatExportZone): Observable<HttpResponse<Blob>> {
    const p = new URLSearchParams({ format });
    return this.httpClient.get(`${this.baseUrl}/custom-geo/${encodeURIComponent(id)}/export?${p.toString()}`, {
      observe: 'response', responseType: 'blob',
    });
  }
}
