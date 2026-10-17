import { HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../../core/http/http-base.service';
import type { DspApiLogRow, DspConnectionPublic, DspLogLevel, DspProvider } from '../../logique/types/dsp';

/** Les fournisseurs qui ont des routes de connexion (`app/api/admin/dsp/{dv360,tiktok}/**`). */
export type FournisseurConnectable = Extract<DspProvider, 'dv360' | 'tiktok'>;

/** `GET /api/admin/dsp/connections`. */
export interface ReponseConnexions {
  connections: DspConnectionPublic[];
}

/** `GET /api/admin/dsp/dv360/config` (`app/api/admin/dsp/dv360/config/route.ts`). */
export interface ConfigDv360 {
  env: {
    enc_key: boolean;
    oauth_client_id: boolean;
    oauth_client_secret: boolean;
    oauth_redirect_uri: boolean;
    redirect_uri_value: string | null;
  };
  ready: { service_account: boolean; oauth: boolean };
}

/** Corps de `POST /api/admin/dsp/dv360/connect` tel que React l'envoie (`dv360/page.tsx:88`). */
export interface CorpsConnexionDv360 {
  auth_method: 'service_account' | 'oauth';
  partner_id: string;
  service_account_json: string;
}

/** `GET /api/admin/dsp/tiktok/config` (`app/api/admin/dsp/tiktok/config/route.ts`) : pas de `ready`. */
export interface ConfigTiktok {
  env: {
    enc_key: boolean;
    app_id: boolean;
    app_secret: boolean;
    redirect_uri: boolean;
    redirect_uri_value: string | null;
  };
}

/** Corps de `POST /api/admin/dsp/tiktok/connect` tel que React l'envoie (`tiktok/page.tsx:84`). */
export interface CorpsConnexionTiktok {
  app_id: string;
  app_secret: string;
}

/** Corps de `POST /api/admin/dsp/dv360/oauth/config` (`dv360/page.tsx:117`). */
export interface CorpsConfigOAuthDv360 {
  partner_id: string;
  oauth_client_id: string;
  oauth_client_secret: string;
}

/** `POST …/test` : la liste lue chez le fournisseur (DV360 : `advertisers`). */
export interface ReponseTest {
  ok?: boolean;
  advertisers?: { id: string; name: string }[];
}

/** `POST …/oauth/start` : l'URL de consentement à suivre. */
export interface ReponseDemarrageOAuth {
  url?: string;
  error?: string;
}

/**
 * Filtres de `GET /api/admin/dsp/logs` (`logsQuerySchema`, `lib/dsp/validation.ts`). Le filtre
 * « Erreurs uniquement » du journal est `level: 'error'` (`logs/page.tsx:18` : `?level=error`) —
 * la route ne lit aucun `errors_only`.
 */
export interface FiltresJournal {
  provider?: DspProvider;
  level?: DspLogLevel;
  limit?: number;
}

/**
 * Connexions aux plateformes DSP — `app/api/admin/dsp/**` (`requireDspAccess`, Bearer lu).
 *
 * Une méthode par route, le fournisseur en paramètre : T9 sert DV360, T10 y branche TikTok sans
 * second service (ruling T9/T10). Aucune route n'est modifiée (D4).
 *
 * Fourni par la route `admin` (`FOURNISSEURS_ADMIN`, arbitrage C3) et non à la racine : un service
 * racine recevrait le `HttpClient` de l'hôte, sans nos intercepteurs (jeton, limiteur, session).
 */
@Injectable()
export class DspApi extends HttpBaseService {
  connexions(): Observable<ReponseConnexions> {
    return this.httpClient.get<ReponseConnexions>(`${this.baseUrl}/admin/dsp/connections`);
  }

  configDv360(): Observable<ConfigDv360> {
    return this.httpClient.get<ConfigDv360>(`${this.baseUrl}/admin/dsp/dv360/config`);
  }

  configTiktok(): Observable<ConfigTiktok> {
    return this.httpClient.get<ConfigTiktok>(`${this.baseUrl}/admin/dsp/tiktok/config`);
  }

  connecter(fournisseur: FournisseurConnectable, corps: object): Observable<unknown> {
    return this.httpClient.post(`${this.baseUrl}/admin/dsp/${fournisseur}/connect`, corps);
  }

  /** Déconnexion simple, ou purge COMPLÈTE (`?scope=full` : la ligne entière est supprimée). */
  deconnecter(fournisseur: FournisseurConnectable, complet = false): Observable<unknown> {
    const params = complet ? new HttpParams().set('scope', 'full') : undefined;
    return this.httpClient.delete(`${this.baseUrl}/admin/dsp/${fournisseur}/connect`, { params });
  }

  configurerOAuthDv360(corps: CorpsConfigOAuthDv360): Observable<unknown> {
    return this.httpClient.post(`${this.baseUrl}/admin/dsp/dv360/oauth/config`, corps);
  }

  /** DV360 poste `{ partner_id }` ; TikTok, rien (`tiktok/page.tsx:98`) : corps `null` par défaut. */
  demarrerOAuth(fournisseur: FournisseurConnectable, corps: object | null = null): Observable<ReponseDemarrageOAuth> {
    return this.httpClient.post<ReponseDemarrageOAuth>(`${this.baseUrl}/admin/dsp/${fournisseur}/oauth/start`, corps);
  }

  /** React poste sans corps (`dv360/page.tsx:102`). */
  tester(fournisseur: FournisseurConnectable): Observable<ReponseTest> {
    return this.httpClient.post<ReponseTest>(`${this.baseUrl}/admin/dsp/${fournisseur}/test`, null);
  }

  journal(filtres: FiltresJournal = {}): Observable<{ logs: DspApiLogRow[] }> {
    let params = new HttpParams();
    if (filtres.provider) params = params.set('provider', filtres.provider);
    if (filtres.level) params = params.set('level', filtres.level);
    if (filtres.limit !== undefined) params = params.set('limit', String(filtres.limit));
    return this.httpClient.get<{ logs: DspApiLogRow[] }>(`${this.baseUrl}/admin/dsp/logs`, { params });
  }
}
