import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';

/** Réponse de GET /api/risques/exposition/rayon (app/api/risques/exposition/rayon/route.ts). */
export interface ReponseCourbe {
  rayon_max_m: number;
  n_sites: number;
  courbes: { cle: string; total: number; points: { r: number; p: number; i: number }[] }[];
}

@Injectable({ providedIn: 'root' })
export class ZonesRisqueApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(HttpBaseService);

  /** Construit (ou retrouve) la géométrie des zones d'un profil, AVANT d'allumer les tuiles. */
  preparer(codeProfil: string): Observable<unknown> {
    return this.http.post(this.base.url('risques/zones/preparer'), { profil: codeProfil });
  }

  /** Sites de la bbox visible — jamais sans bbox (règle I/O de CLAUDE.md). */
  sites(bbox: string): Observable<GeoJSON.FeatureCollection> {
    const params = new HttpParams().set('bbox', bbox).set('limite', '800');
    return this.http.get<GeoJSON.FeatureCollection>(this.base.url('map/risques-industriels'), { params });
  }

  courbe(gravites: string): Observable<ReponseCourbe> {
    const params = new HttpParams().set('gravites', gravites);
    return this.http.get<ReponseCourbe>(this.base.url('risques/exposition/rayon'), { params });
  }
}
