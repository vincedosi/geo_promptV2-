import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../../core/http/http-base.service';
import { lignesNdjson } from '../../../../core/http/ndjson';

/**
 * Réponse de `POST /api/iris-crawler/manual-upload` (`app/api/iris-crawler/manual-upload/route.ts:152-161`) :
 * la session de dépôt (les lignes parsées restent côté serveur, `data/iris-uploads/<sessionId>.json`) et la
 * correspondance calculée par `autoMap` (`lib/iris-crawler/auto-map.ts`).
 */
export interface ResultatDepotIris {
  sessionId: string;
  filename: string;
  headers: string[];
  totalRows: number;
  previewRows: Record<string, string>[];
  autoMapResult: {
    /** Colonne du CSV qui porte le code IRIS (9 chiffres). */
    irisKeyCol: string;
    /** Colonne CSV → colonne de `iris` (ou `ignore`, ou le nom CSV pour un indicateur JSONB). */
    mapping: Record<string, string>;
    coreCols: string[];
    jsonbCols: string[];
  };
  detectedSeparator?: string;
  parseWarnings: string[];
}

/** Corps de `POST /api/iris-crawler/manual-import` (`ImportManuelSchema`, `manual-import/route.ts:24-30`). */
export interface CorpsImportIris {
  sessionId: string;
  irisKeyCol: string;
  mapping: Record<string, string>;
}

/**
 * Un événement du flux NDJSON de `manual-import` : `send(type, message, extra)` sérialise
 * `{ type, message, ...extra }` (`route.ts:63-67`). `progress` porte `percent`, `totalInserted`,
 * `totalErrors` (l.185-189) — pas de total de lignes ; `done` le bilan (l.233-236).
 */
export type EvenementImportIris =
  | { type: 'log' | 'status' | 'error'; message: string }
  | { type: 'progress'; message: string; percent: number; totalInserted: number; totalErrors: number }
  | {
    type: 'done'; message: string; totalInserted: number; totalErrors: number;
    status: 'success' | 'partial' | 'error'; historyId: string | null; columns: string[];
  };

/**
 * IRIS crawler — `app/api/iris-crawler/{manual-upload,manual-import}` (`requireAdmin` toutes deux).
 *
 * - `deposer` : multipart aux TROIS champs de React (`dashboard/iris-crawler/page.tsx:98-101`). N'écrit
 *   qu'une session temporaire sur le disque du serveur, rien en base.
 * - `importer` : flux NDJSON par `lignesNdjson` (arbitrage C4), réponse en TEXTE ; un corps d'erreur
 *   (HTTP ≠ 2xx) arrive donc en texte, à relire (`JSON.parse`). ⚠ L'import RÉÉCRIT des colonnes d'`iris`
 *   (`update_iris_core_batch`) et occupe une place du limiteur (3 appels simultanés) pendant toute sa durée.
 *
 * Fourni par la route `admin` (`FOURNISSEURS_ADMIN`, C3).
 */
@Injectable()
export class IrisCrawlerApi extends HttpBaseService {
  deposer(fichier: File): Observable<ResultatDepotIris> {
    const form = new FormData();
    form.append('file', fichier);
    form.append('encoding', 'utf-8');
    form.append('separator', 'auto');
    return this.httpClient.post<ResultatDepotIris>(`${this.baseUrl}/iris-crawler/manual-upload`, form);
  }

  importer(corps: CorpsImportIris): Observable<EvenementImportIris> {
    return lignesNdjson<EvenementImportIris>(
      this.httpClient.post(`${this.baseUrl}/iris-crawler/manual-import`, corps, {
        observe: 'events', reportProgress: true, responseType: 'text',
      }),
    );
  }
}
