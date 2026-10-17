import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../../core/http/http-base.service';
import type { ParseResult } from '../../logique/types/import-poi';

/**
 * Import POI — `app/api/admin/import-poi/**` (`requireAdmin`), lot 6. T12 : le dépôt ; T13 ajoute le
 * géocodage, l'essai à blanc et l'import en flux.
 *
 * `analyser(fichiers)` : `POST /api/admin/import-poi/parse`, multipart construit comme
 * `handleFileUpload` (`page.tsx:144-152`) — le PREMIER fichier sous `file` (support historique), puis
 * CHAQUE fichier sous `files` (un bundle Shapefile = 4 entrées `files`). Aucun `Content-Type` posé : le
 * navigateur écrit lui-même `multipart/form-data` et sa frontière (comme `adminFetch` pour un `FormData`).
 * N'écrit rien en base : la route garde le fichier une heure dans un dossier temporaire du serveur.
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
}
