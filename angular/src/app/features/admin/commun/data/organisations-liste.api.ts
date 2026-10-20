import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../../core/http/http-base.service';

/**
 * Une organisation de `GET /api/admin/organizations` : les champs que lisent les écrans (filtre
 * d'espace des Zones perso, choix de l'espace de l'import POI). La route rend toute la ligne
 * (`select('*')`) enrichie de `member_count`, `source_count`, `campaign_count`.
 */
export interface OrganisationListe {
  id: string;
  name: string;
  slug?: string;
  active?: boolean;
}

/** Réponse de la route : `{ success, organizations }`, ou `{ success: false, error }` (500). */
export interface ReponseOrganisationsListe {
  success: boolean;
  organizations?: OrganisationListe[];
  error?: string;
}

/**
 * La liste des organisations pour les écrans de l'administration (amendement A2 du lot 6) : créée par
 * le premier écran qui la lit (T20, filtre « workspace » des Zones perso, `WorkspaceFilter.tsx:20`),
 * réutilisée par l'import POI (T12, `import/page.tsx:94`). Un seul service pour cette route.
 *
 * Ce n'est PAS `EspacesApi.lister()` : celle-ci lit `/api/admin/espaces`, une autre route, une autre
 * forme — la parité porte aussi sur la requête.
 *
 * Pas de cache ici : le service vit autant que la route `admin`, donc d'un écran à l'autre, et une
 * organisation créée dans « Accès » doit apparaître ailleurs. Le cache est PAR ÉCRAN, tenu par l'écran
 * qui lit (une lecture à sa première demande, règle d'I/O « cache avant appel »).
 *
 * Fourni par la route `admin` (`FOURNISSEURS_ADMIN`, C3).
 */
@Injectable()
export class OrganisationsListeApi extends HttpBaseService {
  lister(): Observable<ReponseOrganisationsListe> {
    return this.httpClient.get<ReponseOrganisationsListe>(`${this.baseUrl}/admin/organizations`);
  }
}
