import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import type { Decoupage, ResultatCouverture } from '../logique/analyses/couverture';
import type { ResultatCouvertureRayon } from '../logique/analyses/couverture-rayon';

/**
 * ④ Analyse — la couverture d'une zone enregistrée (lot 4, T7) : `GET /api/zones/[id]/couverture?cible=&decoupage=` ;
 * et la couverture par rayon autour d'un type de POI (T12) : `GET /api/analyses/couverture-rayon?<requeteRayon>`.
 * Un refus arrive en erreur HTTP (404 zone hors espace, 422 borne, 503 base non construite, 429 quota) avec
 * `{ error, refus }` ; `messageErreurCouverture` le lit.
 *
 * Fourni par la ROUTE (`FOURNISSEURS_DISTANTS`, `app.routes.ts`), jamais à la racine : un service racine recevrait le
 * `HttpClient` du shell, sans nos intercepteurs.
 */
@Injectable()
export class CouvertureApi extends HttpBaseService {
  couverture(zoneId: string, cible: string, decoupage: Decoupage): Observable<ResultatCouverture> {
    const p = new URLSearchParams({ cible, decoupage });
    return this.httpClient.get<ResultatCouverture>(`${this.baseUrl}/zones/${encodeURIComponent(zoneId)}/couverture?${p.toString()}`);
  }

  /** `requete` : la chaîne de `requeteRayon` (logique/analyses/couverture-rayon.ts). */
  rayon(requete: string): Observable<ResultatCouvertureRayon> {
    return this.httpClient.get<ResultatCouvertureRayon>(`${this.baseUrl}/analyses/couverture-rayon?${requete}`);
  }
}
