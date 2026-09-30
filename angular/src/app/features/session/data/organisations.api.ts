import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';

/** Une organisation accessible à l'utilisateur (app/api/user/organizations/route.ts). */
export interface Organisation {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
}

/** Réponse de GET /api/user/organizations. */
export interface ReponseOrganisations {
  organizations: Organisation[];
  /** `null` = « toutes les organisations » (super_admin seulement). */
  active_org_id: string | null;
  is_super_admin: boolean;
}

/** Réponse de POST /api/user/switch-org (app/api/user/switch-org/route.ts). */
export interface ReponseChangement {
  success: boolean;
  organization_id: string | null;
}

// Fourni par la ROUTE (FOURNISSEURS_DISTANTS, app.routes.ts) et non à la
// racine : un service racine recevrait le HttpClient de l'hôte, sans nos
// intercepteurs (jeton, limiteur, session expirée).
@Injectable()
export class OrganisationsApi extends HttpBaseService {
  lister(): Observable<ReponseOrganisations> {
    return this.httpClient.get<ReponseOrganisations>(`${this.baseUrl}/user/organizations`);
  }

  /** `null` est une valeur MÉTIER (« toutes les organisations »), distincte de l'absence de clé. */
  changer(organisationId: string | null): Observable<ReponseChangement> {
    return this.httpClient.post<ReponseChangement>(`${this.baseUrl}/user/switch-org`, { organization_id: organisationId });
  }
}
