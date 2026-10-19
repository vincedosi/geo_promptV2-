import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../../core/http/http-base.service';

/**
 * Une ligne de l'historique, telle que la rend `GET /api/admin/imports` (`ImportRow`,
 * `app/admin/imports/page.tsx:21-35`). `kind: 'ooh'` vient de `import_runs_ooh` (0 ligne depuis
 * sql/260 ; l'import ArcGIS qui l'alimentait est supprimé depuis le 2026-10-16), `kind: 'source'`
 * de `data_sources`. `total`, `inserted`, `errors` sont nullables côté base (`row_count`…).
 */
export interface LigneImport {
  id: string;
  kind: 'ooh' | 'source';
  source: string;
  started_at: string | null;
  finished_at: string | null;
  status: string | null;
  total: number | null;
  inserted: number | null;
  updated: number | null;
  duplicates: number | null;
  errors: number | null;
  type?: string | null;
  org_name: string | null;
}

/** Réponse de la route : `success` et la liste, ou `success: false` et un `error`. */
export interface ReponseImports {
  success: boolean;
  imports?: LigneImport[];
  error?: string;
}

/**
 * Historique des imports — `GET /api/admin/imports` (`requireAdmin`), lecture seule : 200 lignes
 * au plus de chaque table, triées par date de début côté serveur. Aucun paramètre : le filtre de
 * l'écran est local, comme React.
 *
 * Fourni par la route `admin` (`FOURNISSEURS_ADMIN`, C3).
 */
@Injectable()
export class ImportsApi extends HttpBaseService {
  lire(): Observable<ReponseImports> {
    return this.httpClient.get<ReponseImports>(`${this.baseUrl}/admin/imports`);
  }
}
