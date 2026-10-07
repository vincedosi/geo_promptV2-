import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../../core/http/http-base.service';
import type { HealthResponse } from '../../logique/types/admin';

/**
 * Diagnostic système — `GET /api/admin/health` (`app/api/admin/health/route.ts`, `requireAdmin`).
 *
 * Fourni par la route `admin` (`FOURNISSEURS_ADMIN`, arbitrage C3) et non à la racine : un service
 * racine recevrait le `HttpClient` de l'hôte, sans nos intercepteurs (jeton, limiteur, session
 * expirée).
 */
@Injectable()
export class HealthApi extends HttpBaseService {
  lire(): Observable<HealthResponse> {
    return this.httpClient.get<HealthResponse>(`${this.baseUrl}/admin/health`);
  }
}
