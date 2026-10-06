import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';

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

/**
 * Les zones enregistrées de l'organisation (`custom_geo_zones`). Étendu par la tâche 14 (panneau Zones).
 *
 * Fourni par la ROUTE (`FOURNISSEURS_DISTANTS`, `app.routes.ts`), jamais à la racine : un service racine
 * recevrait le `HttpClient` du shell, sans nos intercepteurs (jeton, limiteur, session expirée).
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
}
