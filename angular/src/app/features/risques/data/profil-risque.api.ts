import { HttpParams, type HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import type { Dimension } from '../logique/dimensions';

/** Une unité territoriale et sa ventilation par classe (`use-bandes.ts:36-54`). */
export interface UniteBandes {
  unite: string;
  /** Libellé lisible. `null` si le référentiel ne connaît pas ce code. */
  nom: string | null;
  total: number;
  classes: Record<string, number>;
  /** Dénominateur de la part ; `null` à la maille code postal (le référentiel surcompte de 10,5 %). */
  pop_totale: number | null;
  /** Dénominateur de la densité. Mêmes limites. */
  surface_km2: number | null;
}

/** Réponse de GET /api/risques/profil/bandes (`use-bandes.ts:56-99`). */
export interface Bandes {
  maille: string;
  cible: string;
  parent: string | null;
  region?: string | null;
  n_unites: number;
  tronquee: boolean;
  n_carreaux: number;
  /** Somme EXACTE de `par_classe` — l'arrondi a lieu au grain le plus fin. */
  total: number;
  par_classe: Record<string, number>;
  /** Habitants de carreaux PROCHES d'un site que le profil ne retient pas — pas la population non exposée de France. */
  hors_zone: number;
  /** Codes postaux TOUCHÉS (invariant à la maille affichée). */
  n_codes_postaux: number;
  population_reference: number;
  pop_unites_touchees: number | null;
  unites: UniteBandes[];
}

/** Une cible calculable (`AnalysePopulationOverlay.tsx:189-193`). */
export interface Cible {
  code: string;
  libelle: string;
  famille: string;
}

/** Requête de `bandes` (`use-bandes.ts:180-186`). */
export interface RequeteBandes {
  profil: string;
  cible: string;
  maille: Dimension;
  /** Code de DÉPARTEMENT. */
  parent: string | null;
  /** Code de RÉGION — distinct de `parent` (18 codes INSEE se recouvrent, sql/171). */
  region: string | null;
  natures: string[];
}

// Fourni par la ROUTE (FOURNISSEURS_DISTANTS, app.routes.ts), jamais à la racine.
@Injectable()
export class ProfilRisqueApi extends HttpBaseService {
  /** `profil`, `cible`, `maille` toujours ; `parent`, `region`, `natures` seulement si renseignés. */
  bandes(q: RequeteBandes): Observable<Bandes> {
    let params = new HttpParams().set('profil', q.profil).set('cible', q.cible).set('maille', q.maille);
    if (q.parent) params = params.set('parent', q.parent);
    if (q.region) params = params.set('region', q.region);
    const natures = q.natures.join(',');
    if (natures) params = params.set('natures', natures);
    return this.httpClient.get<Bandes>(`${this.baseUrl}/risques/profil/bandes`, { params });
  }

  /** Catalogue lu en base — jamais une liste écrite en dur. */
  cibles(): Observable<{ cibles: Cible[] }> {
    return this.httpClient.get<{ cibles: Cible[] }>(`${this.baseUrl}/risques/exposition/cibles`);
  }

  /** Classeur du profil. Les paramètres sont ceux de `BoutonExportProfil.tsx:55-63`, posés par l'appelant. */
  exportProfil(q: URLSearchParams): Observable<HttpResponse<Blob>> {
    return this.httpClient.get(`${this.baseUrl}/risques/profil/export`, {
      params: versHttpParams(q), observe: 'response', responseType: 'blob',
    });
  }

  /** Classeur interactif du rayon (`BoutonExportRayon.tsx:36-44`). */
  exportRayon(q: URLSearchParams): Observable<HttpResponse<Blob>> {
    return this.httpClient.get(`${this.baseUrl}/risques/exposition/rayon/export`, {
      params: versHttpParams(q), observe: 'response', responseType: 'blob',
    });
  }
}

/**
 * `URLSearchParams` → `HttpParams`, paire par paire. Jamais `fromString` :
 * `URLSearchParams.toString()` écrit l'espace en `+`, que `HttpParams` ne
 * relit pas comme un espace et réencoderait en `%2B` — le serveur recevrait
 * un `+` littéral. Ici les valeurs sont celles du tableau, encodées une fois.
 */
function versHttpParams(q: URLSearchParams): HttpParams {
  let p = new HttpParams();
  q.forEach((v, k) => { p = p.append(k, v); });
  return p;
}
