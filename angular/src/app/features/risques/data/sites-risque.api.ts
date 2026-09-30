import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';

/** Réponse de GET /api/risques/sites/compter (app/api/risques/sites/compter/route.ts). */
export interface CompteSites {
  /** Sites retenus par les filtres. */
  retenus: number;
  /** Sites du même périmètre, sans filtre de risque. */
  total: number;
  par_nature: Record<string, number>;
}

// Fourni par la ROUTE (FOURNISSEURS_DISTANTS, app.routes.ts) et non à la
// racine : un service racine recevrait le HttpClient de l'hôte, sans nos
// intercepteurs (jeton, limiteur, session expirée).
@Injectable()
export class SitesRisqueApi extends HttpBaseService {
  compter(): Observable<CompteSites> {
    return this.httpClient.get<CompteSites>(`${this.baseUrl}/risques/sites/compter`);
  }
}
