import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, of, throwError, type Observable } from 'rxjs';
import { HttpBaseService } from '../../../../core/http/http-base.service';

/** Une maille à insérer (`LigneCarreauSchema`, `app/api/admin/import-geo/route.ts:18-24`). */
export interface LigneCarreau {
  idcar: string;
  resolution: string;
  millesime: string;
  geom_wkt: string;
  metadata: Record<string, unknown>;
}

/** Réponse d'un lot : `{ success: true, inserted }`, ou `{ success: false, error }` (400 / 500). */
export interface ReponseLot {
  success: boolean;
  inserted?: number;
  error?: string;
}

/** Corps de `register` (`EnregistrerCarreauxSchema`, `app/api/admin/import-geo/register/route.ts:15-22`). */
export interface CorpsEnregistrement {
  name: string;
  resolution: string;
  millesime: string;
  row_count: number;
  columns: string[];
  filename: string | null;
}

export interface ReponseEnregistrement {
  success: boolean;
  source_id?: string;
  error?: string;
}

/**
 * Import Shapefile — `app/api/admin/import-geo/{route,register/route}.ts` (`requireAdmin` toutes deux).
 *
 * - `envoyerLot` : `POST /api/admin/import-geo`, `{ rows }` (1 à 2 000 lignes). ⚠ ÉCRIT : la route appelle
 *   `import_carreaux_batch`, qui insère dans **`carreaux_filosofi`** (`ON CONFLICT (idcar, resolution,
 *   millesime) DO UPDATE` : un identifiant existant voit sa géométrie et ses métadonnées RÉÉCRITES).
 * - `enregistrer` : `POST /api/admin/import-geo/register`. ⚠ ÉCRIT une ligne `data_sources` (type `carreaux`).
 *
 * Lecture des refus comme `res.json()` de React (`carreaux-import/page.tsx:304,383`) : un corps JSON
 * `{ success: false, error }` (400, 500) est RENDU comme une réponse, jamais levé. Un corps illisible lève
 * (`Failed to fetch` sans réponse, `HTTP <statut>` sinon) — sauf un **413** (proxy qui refuse un lot trop
 * gros, corps HTML) : rendu `{ success: false, error: 'HTTP 413 — payload too large' }`, pour que la
 * reprise par DEMI-LOT de React (déclenchée par « 413 », « too large », « payload ») ait lieu. Écart voulu :
 * chez React, `res.json()` levait sur ce corps HTML et la reprise prévue pour lui ne se déclenchait jamais.
 *
 * Fourni par la route `admin` (`FOURNISSEURS_ADMIN`, C3).
 */
@Injectable()
export class ImportGeoApi extends HttpBaseService {
  envoyerLot(rows: readonly LigneCarreau[]): Observable<ReponseLot> {
    return this.httpClient.post<ReponseLot>(`${this.baseUrl}/admin/import-geo`, { rows }).pipe(catchError(lireRefus<ReponseLot>));
  }

  enregistrer(corps: CorpsEnregistrement): Observable<ReponseEnregistrement> {
    return this.httpClient.post<ReponseEnregistrement>(`${this.baseUrl}/admin/import-geo/register`, corps)
      .pipe(catchError(lireRefus<ReponseEnregistrement>));
  }
}

function lireRefus<T>(e: unknown): Observable<T> {
  if (!(e instanceof HttpErrorResponse)) return throwError(() => e);
  const corps: unknown = e.error;
  if (corps !== null && typeof corps === 'object' && 'success' in corps) return of(corps as T);
  if (e.status === 413) return of({ success: false, error: 'HTTP 413 — payload too large' } as T);
  return throwError(() => new Error(e.status === 0 ? 'Failed to fetch' : `HTTP ${e.status}`));
}
