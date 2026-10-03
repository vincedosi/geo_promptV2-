import { HttpParams } from '@angular/common/http';
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

/** Filtres de `compter` — mêmes champs que `use-sites-compte.ts`. */
export interface FiltresCompte {
  gravites?: string[];
  natures?: string[];
  perimNiveau?: 'region' | 'departement' | null;
  perimCode?: string | null;
}

// Fourni par la ROUTE (FOURNISSEURS_DISTANTS, app.routes.ts) et non à la
// racine : un service racine recevrait le HttpClient de l'hôte, sans nos
// intercepteurs (jeton, limiteur, session expirée).
@Injectable()
export class SitesRisqueApi extends HttpBaseService {
  /**
   * Paramètres posés comme `use-sites-compte.ts:57-65` : `gravites` et
   * `natures` seulement s'ils sont non vides, `perim_niveau` + `perim_codes`
   * seulement ensemble.
   */
  compter(f: FiltresCompte = {}): Observable<CompteSites> {
    let params = new HttpParams();
    const gravites = (f.gravites ?? []).join(',');
    const natures = (f.natures ?? []).join(',');
    if (gravites) params = params.set('gravites', gravites);
    if (natures) params = params.set('natures', natures);
    if (f.perimNiveau && f.perimCode) {
      params = params.set('perim_niveau', f.perimNiveau).set('perim_codes', f.perimCode);
    }
    return this.httpClient.get<CompteSites>(`${this.baseUrl}/risques/sites/compter`, { params });
  }
}
