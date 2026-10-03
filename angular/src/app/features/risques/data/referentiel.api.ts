import { HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';

/**
 * Réponse de GET /api/ref/geo : départements IMBRIQUÉS dans leur région
 * (`AnalysePopulationOverlay.tsx:452-458`). Route lue au COOKIE par le
 * middleware ; le Bearer que `jetonInterceptor` ajoute est sans effet.
 */
export interface ReponseRefGeo {
  regions?: {
    code_region: string;
    nom_region: string;
    depts?: { code_dept: string; nom_dept: string }[];
  }[];
}

// Fourni par la ROUTE (FOURNISSEURS_DISTANTS, app.routes.ts), jamais à la racine.
@Injectable()
export class ReferentielApi extends HttpBaseService {
  /** Référentiel régions/départements INSEE, lu en base. */
  geo(): Observable<ReponseRefGeo> {
    return this.httpClient.get<ReponseRefGeo>(`${this.baseUrl}/ref/geo`);
  }

  /** Contours d'une maille (`scale=null` répondrait 400 : l'appelant n'appelle pas à la maille commune). */
  contours(scale: 'region' | 'departement'): Observable<GeoJSON.FeatureCollection> {
    const params = new HttpParams().set('scale', scale);
    return this.httpClient.get<GeoJSON.FeatureCollection>(`${this.baseUrl}/meteo-geo/zones`, { params });
  }
}
