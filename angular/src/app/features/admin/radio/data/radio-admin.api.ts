import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../../core/http/http-base.service';
import { lignesNdjson } from '../../../../core/http/ndjson';

/**
 * `GET /api/radio/stats` (RPC `get_radio_stats`) — les champs que React déclare (`RadioStats`,
 * `app/admin/radio/page.tsx:22-28`). La RPC en rend d'autres (`radios_matchees`, `total_relations`).
 */
export interface StatsRadio {
  total_emetteurs: number;
  emetteurs_fm: number;
  emetteurs_dab: number;
  total_radios: number;
  emetteurs_matches: number;
  emetteurs_orphelins: number;
  pct_matching: number | null;
  par_categorie: Record<string, number>;
  par_portee: Record<string, number>;
  par_genre: Record<string, number>;
  /** Date du fichier ANFR (`'2026-09-06'`), `null` si aucun import. */
  derniere_maj_anfr: string | null;
  archives_count: number;
}

/** Une ligne de `radio_imports_log` (`ImportLog`, `page.tsx:29-33`) ; la route rend `select('*')`. */
export interface ImportRadio {
  id: string;
  type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  stats: Record<string, unknown> | null;
  error_message: string | null;
}

/** Une entrée de `radio_import_log_entries`, telle que la rend `import-logs/[logId]` (l.37-38). */
export interface EntreeJournalRadio {
  timestamp: string;
  level: string;
  phase: string;
  message: string;
  details?: Record<string, unknown> | null;
  duration_ms?: number | null;
}

/** `GET /api/radio/import-logs/[logId]` : l'import et ses entrées (500 au plus, dans l'ordre). */
export interface JournalRadio {
  import: ImportRadio;
  entries: EntreeJournalRadio[];
}

/**
 * Un événement des flux d'import radio. `ImportLogger.log` (`lib/radio/import-logger.ts:53-63`) envoie
 * `type` (`status` / `done` / `error` selon le niveau), `level`, `phase`, `message` déjà horodaté,
 * `raw_message`, `details`, `duration_ms`, `timestamp` ; `importAnfrData` y ajoute des `progress`
 * (`percent`, `inserted`/`updated`/`errors` ou `deleted`, ni `phase` ni `level`) ; une route qui
 * échoue envoie `{ type: 'error', message }` sans niveau.
 */
export interface EvenementImportRadio {
  type: string;
  message: string;
  level?: string;
  phase?: string;
  raw_message?: string;
  timestamp?: string;
  percent?: number;
  inserted?: number;
  updated?: number;
  errors?: number;
  deleted?: number;
}

/** Cibles proposées par l'écran (`deleteTarget`, `page.tsx:300`) ; la route accepte aussi `radios`. */
export type CibleSuppressionRadio = 'emetteurs' | 'all';

/** `DELETE /api/radio/data` : `{ dry_run, would_delete }` si `confirm: false`, `{ success, deleted }` sinon. */
export interface ReponseSuppressionRadio {
  dry_run?: boolean;
  would_delete?: Record<string, number>;
  success?: boolean;
  deleted?: Record<string, number>;
}

/**
 * Routes radio de l'administration — un seul service pour `/api/radio/*`. Créé par T18 avec `stats()`
 * (tuile et bloc « Radio » des Sources), complété par T16 (onglet Import de l'écran Radio).
 *
 * ⚠ Les TROIS imports écrivent ou effacent des données irremplaçables : ANFR archive puis purge les
 * émetteurs (`archive_and_purge_radio`), l'enrichissement vide d'abord la table des liaisons (phase
 * RESET de `matchRadios`), l'ODS réécrit `radios`. Chacun est un flux NDJSON lu par `lignesNdjson`
 * (C4), réponse en TEXTE — un corps d'erreur (HTTP ≠ 2xx) arrive donc en texte, à relire — et occupe
 * une place du limiteur (3 appels simultanés) pendant toute sa durée.
 *
 * Fourni par la route `admin` (`FOURNISSEURS_ADMIN`, C3).
 */
@Injectable()
export class RadioAdminApi extends HttpBaseService {
  stats(): Observable<StatsRadio> {
    return this.httpClient.get<StatsRadio>(`${this.baseUrl}/radio/stats`);
  }

  /** Les 50 derniers imports (`imports-history`, `{ imports }`). */
  historique(): Observable<{ imports?: ImportRadio[] }> {
    return this.httpClient.get<{ imports?: ImportRadio[] }>(`${this.baseUrl}/radio/imports-history`);
  }

  /** Le journal d'un import passé, sans filtre (React n'en passe aucun). */
  journal(id: string): Observable<JournalRadio> {
    return this.httpClient.get<JournalRadio>(`${this.baseUrl}/radio/import-logs/${encodeURIComponent(id)}`);
  }

  /** `POST /api/radio/import-anfr`, sans corps. */
  importerAnfr(): Observable<EvenementImportRadio> {
    return this.flux('import-anfr', null);
  }

  /** `POST /api/radio/crawl-arcom` (« Enrichissement »), sans corps. */
  enrichir(): Observable<EvenementImportRadio> {
    return this.flux('crawl-arcom', null);
  }

  /** `POST /api/radio/import-arcom-ods`, multipart au seul champ `file`. */
  importerOds(fichier: File): Observable<EvenementImportRadio> {
    const form = new FormData();
    form.append('file', fichier);
    return this.flux('import-arcom-ods', form);
  }

  /** `DELETE /api/radio/data` : `confirm: false` compte sans rien effacer, `confirm: true` EFFACE. */
  supprimer(target: CibleSuppressionRadio, confirm: boolean): Observable<ReponseSuppressionRadio> {
    return this.httpClient.delete<ReponseSuppressionRadio>(`${this.baseUrl}/radio/data`, { body: { target, confirm } });
  }

  private flux(chemin: string, corps: FormData | null): Observable<EvenementImportRadio> {
    return lignesNdjson<EvenementImportRadio>(
      this.httpClient.post(`${this.baseUrl}/radio/${chemin}`, corps, {
        observe: 'events', reportProgress: true, responseType: 'text',
      }),
    );
  }
}
