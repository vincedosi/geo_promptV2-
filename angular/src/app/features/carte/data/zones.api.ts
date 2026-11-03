import type { HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import type { Recette } from '../logique/zones/recette';

/** `POST /api/zones/apercu` : la forme calculée et ses chiffres, rien d'écrit. */
export interface ApercuZone {
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  surface_km2: number | null;
  compte: number | null;
  part_retenue: number | null;
  population: number | null;
  /**
   * D30 (sql/333) : seuil sur territoires à la maille IRIS seulement — communes entières retenues (une commune non
   * découpée = un seul IRIS) et unités du périmètre non évaluables (valeur absente, jamais retenues).
   */
  communes_entieres?: number;
  non_evaluables?: number;
}

/** `POST /api/zones` et `POST /api/zones/[id]/recalculer` : 200, ou 207 si les codes postaux n'ont pas été résolus. */
export interface ZoneEcrite {
  zone_id: string;
  count_cp?: number;
  count_iris?: number;
  surface_km2?: number | null;
  warning?: string;
  message?: string;
}

/**
 * Les zones à recette (lot 3) : `POST /api/zones/apercu`, `POST /api/zones`, `POST /api/zones/[id]/recalculer`, et
 * `POST /api/zones/[id]/dupliquer` (③ finitions).
 * Fourni par la ROUTE (`FOURNISSEURS_DISTANTS`), jamais à la racine (intercepteurs du shell AIDA).
 * ⚠ `POST /api/zones` n'est PAS idempotent (deux envois, deux zones) : c'est l'appelant qui bloque le second clic.
 */
@Injectable()
export class ZonesApi extends HttpBaseService {
  apercu(corps: { recette: Recette; geometrie?: GeoJSON.Geometry }): Observable<ApercuZone> {
    return this.httpClient.post<ApercuZone>(`${this.baseUrl}/zones/apercu`, corps);
  }

  enregistrer(corps: { nom: string; recette: Recette; geometrie?: GeoJSON.Geometry }): Observable<HttpResponse<ZoneEcrite>> {
    return this.httpClient.post<ZoneEcrite>(`${this.baseUrl}/zones`, corps, { observe: 'response' });
  }

  recalculer(id: string): Observable<HttpResponse<ZoneEcrite>> {
    return this.httpClient.post<ZoneEcrite>(`${this.baseUrl}/zones/${encodeURIComponent(id)}/recalculer`, null, { observe: 'response' });
  }

  /**
   * `POST /api/zones/[id]/dupliquer` (③ finitions, T5) : une NOUVELLE zone, la source jamais écrite. ⚠ Pas idempotente
   * (chaque appel crée une zone) : l'appelant bloque le second clic. 200, ou 207 si les codes postaux n'ont pas été résolus.
   */
  dupliquer(id: string, nom: string): Observable<HttpResponse<ZoneEcrite>> {
    return this.httpClient.post<ZoneEcrite>(`${this.baseUrl}/zones/${encodeURIComponent(id)}/dupliquer`, { nom }, { observe: 'response' });
  }
}
