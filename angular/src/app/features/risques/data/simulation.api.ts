import { HttpParams, type HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import { lignesNdjson } from '../../../core/http/ndjson';
import type { EvenementSimulation, ReponseSimulation } from '../logique/simulation/payload';

export type { EvenementSimulation, ReponseSimulation };

/** Réglages envoyés au POST (`ContexteSimulation.tsx:32-39`). */
export interface ReglagesSimulation {
  budget: number;
  intensite: number;
  fuite: number;
  bruit: number;
  amortissement: number;
  graine: number;
}

// Fourni par la ROUTE (FOURNISSEURS_DISTANTS, app.routes.ts), jamais à la racine.
@Injectable()
export class SimulationApi extends HttpBaseService {
  private url(id: string, suite = ''): string {
    return `${this.baseUrl}/zones/jeux/${id}/simulation${suite}`;
  }

  /** Tout ce que l'étape ⑤ lit, en UN appel. */
  lire(id: string): Observable<ReponseSimulation> {
    return this.httpClient.get<ReponseSimulation>(this.url(id));
  }

  /** Flux NDJSON de progression : corps `{ version, params }` (`ContexteSimulation.tsx:163`). */
  simuler(id: string, version: number, params: Partial<ReglagesSimulation>): Observable<EvenementSimulation> {
    return lignesNdjson<EvenementSimulation>(
      this.httpClient.post(this.url(id), { version, params }, {
        observe: 'events', reportProgress: true, responseType: 'text',
      }),
    );
  }

  /** Flux NDJSON, POST sans corps. */
  recaler(id: string): Observable<EvenementSimulation> {
    return lignesNdjson<EvenementSimulation>(
      this.httpClient.post(this.url(id, '/recaler'), null, {
        observe: 'events', reportProgress: true, responseType: 'text',
      }),
    );
  }

  purger(id: string): Observable<unknown> {
    return this.httpClient.delete(this.url(id));
  }

  /** Bassins et sites dans le cadre visible — `bbox` obligatoire, aucune donnée de diffusion. */
  carte(id: string, bbox: string): Observable<GeoJSON.FeatureCollection> {
    return this.httpClient.get<GeoJSON.FeatureCollection>(this.url(id, '/carte'), {
      params: new HttpParams().set('bbox', bbox),
    });
  }

  exportSimulation(id: string): Observable<HttpResponse<Blob>> {
    return this.httpClient.get(this.url(id, '/export'), { observe: 'response', responseType: 'blob' });
  }
}
