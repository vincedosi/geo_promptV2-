import { HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';

/** Réponse de GET /api/risques/exposition/rayon (app/api/risques/exposition/rayon/route.ts). */
export interface ReponseCourbe {
  rayon_max_m: number;
  n_sites: number;
  courbes: { cle: string; total: number; points: { r: number; p: number; i: number }[] }[];
}

// Fourni par la ROUTE (FOURNISSEURS_DISTANTS, app.routes.ts) et non à la
// racine : un service racine recevrait le HttpClient de l'hôte, sans nos
// intercepteurs (jeton, limiteur, session expirée).
@Injectable()
export class ZonesRisqueApi extends HttpBaseService {
  /** Construit (ou retrouve) la géométrie des zones d'un profil, AVANT d'allumer les tuiles. */
  preparer(codeProfil: string): Observable<unknown> {
    return this.httpClient.post(`${this.baseUrl}/risques/zones/preparer`, { profil: codeProfil });
  }

  /** Modèle d'adresse des tuiles MVT des zones d'un profil (absolue, `{z}/{x}/{y}` laissés à MapLibre). */
  urlTuilesZones(codeProfil: string): string {
    return `${this.urlAbsolue('tiles/zones-risque/{z}/{x}/{y}')}?profil=${encodeURIComponent(codeProfil)}`;
  }

  /** Sites de la bbox visible — jamais sans bbox (règle I/O de CLAUDE.md). */
  sites(bbox: string): Observable<GeoJSON.FeatureCollection> {
    const params = new HttpParams().set('bbox', bbox).set('limite', '800');
    return this.httpClient.get<GeoJSON.FeatureCollection>(`${this.baseUrl}/map/risques-industriels`, { params });
  }

  courbe(gravites: string): Observable<ReponseCourbe> {
    const params = new HttpParams().set('gravites', gravites);
    return this.httpClient.get<ReponseCourbe>(`${this.baseUrl}/risques/exposition/rayon`, { params });
  }
}
