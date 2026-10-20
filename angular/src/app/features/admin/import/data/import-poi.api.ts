import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../../core/http/http-base.service';
import { lignesSse } from '../../../../core/http/sse';
import type {
  DryRunResult, GeoConfig, GeocodeDetailedResult, ImportProgress, ParseResult,
} from '../../logique/types/import-poi';

/** Compteurs du géocodage relu (`stats` de `geocode/batch` et `geocode/update`). */
export interface StatsGeocodage {
  green: number;
  orange: number;
  red: number;
}

/** Corps de `POST /api/admin/geocode/batch` (`handleGeocodeBatch`, `page.tsx:232-237`). */
export interface DemandeGeocodage {
  fileId: string;
  colAdresse?: string;
  colCodePostal?: string;
  colVille?: string;
}

/** Réponse de `geocode/batch` : les résultats et leurs compteurs, ou `{ success: false, error }` (400 / 404 / 500). */
export interface ReponseGeocodage {
  success: boolean;
  geocodeId?: string;
  totalRows?: number;
  results?: GeocodeDetailedResult[];
  stats?: StatsGeocodage;
  error?: string;
}

/** Les trois corrections d'une ligne (`ActionSchema` de `geocode/update/route.ts`). */
export type ActionGeocodage =
  | { type: 'manual'; lat: number; lng: number }
  | { type: 'reGeocode'; address: string }
  | { type: 'ignore' };

/** Corps de `POST /api/admin/geocode/update` (`handleGeocodeUpdateRow`, `page.tsx:266-270`). */
export interface DemandeCorrection {
  geocodeId: string;
  rowIndex: number;
  action: ActionGeocodage;
}

/** Réponse de `geocode/update` : la ligne corrigée et les compteurs recalculés. */
export interface ReponseCorrection {
  success: boolean;
  updatedResult?: GeocodeDetailedResult;
  stats?: StatsGeocodage;
  error?: string;
}

/**
 * Configuration d'import (`ConfigImportSchema`), corps commun à l'essai à blanc et à l'import :
 * `handleDryRun` (`page.tsx:299-311`) et `handleImport` (`page.tsx:342-357`).
 */
export interface ConfigImport {
  fileId: string;
  dataType: 'poi';
  category?: string;
  mapping: Record<string, string | undefined>;
  geolocation: GeoConfig;
  limit?: number;
  geocodeId?: string;
  sourceName?: string;
  organizationId?: string;
  importedColumns?: string[];
  filterFields?: string[];
}

/**
 * Import POI — `app/api/admin/import-poi/**` et `app/api/admin/geocode/**` (`requireAdmin`), lot 6.
 *
 * - `analyser(fichiers)` (T12) : `POST /api/admin/import-poi/parse`, multipart construit comme
 *   `handleFileUpload` (`page.tsx:144-152`) — le PREMIER fichier sous `file` (support historique), puis
 *   CHAQUE fichier sous `files`. Aucun `Content-Type` posé (le navigateur écrit la frontière). N'écrit rien
 *   en base : la route garde le fichier une heure dans un dossier temporaire du serveur.
 * - `geocoder(demande)` (T13) : `POST /api/admin/geocode/batch`. Appelle la BAN (service EXTERNE,
 *   `api-adresse.data.gouv.fr`) pour TOUTES les lignes du fichier, puis écrit les résultats dans un fichier
 *   temporaire du serveur. Rien en base.
 * - `corrigerGeocodage(demande)` (T13) : `POST /api/admin/geocode/update` — réécrit ce fichier temporaire
 *   (et rappelle la BAN pour un `reGeocode`). Rien en base.
 * - `essayer(config)` (T13) : `POST /api/admin/import-poi/dry-run` — les 100 premières lignes passées au
 *   validateur. Rien en base.
 * - `importer(config)` (T13) : `POST /api/admin/import-poi/execute`, réponse `text/event-stream` lue en
 *   TEXTE et en flux par `lignesSse` (C4 : `EventSource` ne fait que des GET). ⚠ ÉCRIT : une ligne
 *   `data_sources`, puis les POI dans `poi_france` (lots de 50, identité déterministe). Occupe une place
 *   du limiteur (3 appels simultanés) pendant toute sa durée.
 *
 * Fourni par la route `admin` (`FOURNISSEURS_ADMIN`, C3).
 */
@Injectable()
export class ImportPoiApi extends HttpBaseService {
  analyser(fichiers: readonly File[]): Observable<ParseResult> {
    const form = new FormData();
    fichiers.forEach((fichier, i) => {
      if (i === 0) form.append('file', fichier);
      form.append('files', fichier);
    });
    return this.httpClient.post<ParseResult>(`${this.baseUrl}/admin/import-poi/parse`, form);
  }

  geocoder(demande: DemandeGeocodage): Observable<ReponseGeocodage> {
    return this.httpClient.post<ReponseGeocodage>(`${this.baseUrl}/admin/geocode/batch`, demande);
  }

  corrigerGeocodage(demande: DemandeCorrection): Observable<ReponseCorrection> {
    return this.httpClient.post<ReponseCorrection>(`${this.baseUrl}/admin/geocode/update`, demande);
  }

  essayer(config: ConfigImport): Observable<DryRunResult> {
    return this.httpClient.post<DryRunResult>(`${this.baseUrl}/admin/import-poi/dry-run`, config);
  }

  importer(config: ConfigImport): Observable<ImportProgress> {
    return lignesSse<ImportProgress>(
      this.httpClient.post(`${this.baseUrl}/admin/import-poi/execute`, config, {
        observe: 'events', reportProgress: true, responseType: 'text',
      }),
    );
  }
}
