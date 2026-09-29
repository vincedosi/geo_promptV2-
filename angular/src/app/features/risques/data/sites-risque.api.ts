import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
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

@Injectable({ providedIn: 'root' })
export class SitesRisqueApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(HttpBaseService);

  compter(): Observable<CompteSites> {
    return this.http.get<CompteSites>(this.base.url('risques/sites/compter'));
  }
}
