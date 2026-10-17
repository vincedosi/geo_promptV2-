import { Injectable } from '@angular/core';
import { HttpParams, type HttpResponse } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../../core/http/http-base.service';
import { lignesSse } from '../../../../core/http/sse';
import type { DataSource } from '../../logique/types/admin';

/** `GET /api/admin/sources` : les sources ACTIVES, triées par date d'import décroissante. */
export interface ReponseSources {
  success: boolean;
  sources?: DataSource[];
  error?: string;
}

/**
 * `GET /api/admin/sources-stats` (RPC `get_sources_stats`, `success` + le JSON de la RPC à plat).
 * ⚠ `ooh` ne porte plus que `total` depuis sql/082 (amendement A6) : `nb_villes`, `regies`,
 * `sources`, `types`, `top_villes` du type React (`_lib/types.ts:64`) n'arrivent plus — ils sont
 * déclarés optionnels ici, et l'écran ne les lit pas.
 */
export interface StatsSources {
  success: boolean;
  error?: string;
  ooh: { total: number; nb_villes?: number; regies?: string[] };
  poi: { total: number; by_category: Array<{ categorie: string; nb: number }> };
  transport: { total: number; bus: number; train: number; tram: number; metro: number };
  flux: { total: number; cerema: number; osm: number };
  carreaux: { total: number };
  iris: { total: number; enrichis: number };
}

/** `GET /api/admin/custom-geo/stats` (RPC `admin_get_custom_geo_stats`) — `AdminCustomGeoStats` de React. */
export interface StatsZones {
  total_zones: number;
  total_iris: number;
  total_cp: number;
  nb_workspaces: number;
  top_workspaces: Array<{ org_id: string; org_name: string | null; nb_zones: number }>;
}

/** Corps accepté par `PATCH /api/admin/sources/[id]` qu'émet l'écran : le nom, ou les champs filtres. */
export type ModificationSource = { name: string } | { filter_fields: string[] };

/** Réponse de `PATCH` / `DELETE` : `success`, et `error` en cas d'échec (409 campagne, 500…). */
export interface ReponseEcriture {
  success: boolean;
  error?: string;
  source?: DataSource;
}

/** `GET /api/admin/sources/[id]/meta-keys` : clés `metadata` non vides, sur 100 POI au plus. */
export interface ReponseCles {
  success: boolean;
  keys?: string[];
  error?: string;
}

/**
 * Une campagne de `GET /api/admin/campaigns` (`CampaignListItem` de React, `types/campaign.ts:46`) :
 * les champs que lit l'onglet DSP. La route rend aussi `organization_name`, `organizations_linked`,
 * `last_data_date`… que l'écran n'affiche pas.
 */
export interface CampagneDsp {
  id: string;
  name: string;
  dsp_source: string;
  date_start: string | null;
  date_end: string | null;
  total_tracked_ads: number;
  countries: string[] | null;
  total_rows: number;
  france_rows: number;
  matched_iris: number;
}

/** Rapport final de l'import (`CampaignImportReport`, `types/campaign.ts:78`). */
export interface RapportImportDsp {
  campaign_id: string;
  campaign_name: string;
  total_rows: number;
  countries: string[];
  total_france: number;
  matched_iris: number;
  pct_matched: number;
}

/**
 * Un événement du flux SSE de `POST /api/admin/campaigns/import` (`CampaignImportEvent`,
 * `types/campaign.ts:70`), dans l'ordre où la route les émet (`route.ts:170-449`) : `parsing`, des
 * `progress` (`processed` / `total` : 0 / N à la détection, puis toutes les 200 lignes insérées et à la
 * fin), deux `matching` (avant / après le rattachement aux IRIS, s'il y a des lignes France), `rollups`,
 * puis `complete` — ou `error` à la place de la suite.
 */
export type EvenementImportDsp =
  | { type: 'parsing'; message: string }
  | { type: 'progress'; processed: number; total: number; message: string }
  | { type: 'matching'; matched: number; total_france: number; message: string }
  | { type: 'rollups'; message: string }
  | { type: 'complete'; report: RapportImportDsp }
  | { type: 'error'; message: string };

/** Les trois champs du formulaire d'import de React (`useDspImport.ts:90-93`). */
export interface DemandeImportDsp {
  fichier: File;
  /** `dsp_source` : `adform`, `dv360`… ; la route ne connaît que les sources qui ont un mapping en base. */
  source: string;
  /** Nom saisi : envoyé seulement s'il n'est pas vide une fois rogné (sinon la route le déduit du fichier). */
  nom: string;
}

/** Une zone de `GET /api/admin/custom-geo/list` (`AdminCustomZone`, `useAdminCustomZones.ts:6-19`). */
export interface ZoneAdmin {
  id: string;
  name: string;
  description: string | null;
  org_id: string;
  org_name: string | null;
  source_type: string;
  source_metadata: Record<string, unknown>;
  feature_count_iris: number;
  feature_count_cp: number;
  bbox: [number, number, number, number] | null;
  created_at: string;
  created_by: string | null;
}

/** Filtres de l'onglet Zones perso ; un filtre vide n'est pas envoyé (`useAdminCustomZones.ts:39-42`). */
export interface FiltresZones {
  orgId: string | null;
  sourceType: string | null;
  recherche: string;
}

/**
 * Routes de l'écran Sources — toutes `requireAdmin`. T18 : sources, statistiques, export ; T20 :
 * campagnes DSP (liste, import en flux, suppression) et zones perso (liste filtrée, suppression).
 *
 * Fourni par la route `admin` (`FOURNISSEURS_ADMIN`, C3).
 */
@Injectable()
export class SourcesAdminApi extends HttpBaseService {
  sources(): Observable<ReponseSources> {
    return this.httpClient.get<ReponseSources>(`${this.baseUrl}/admin/sources`);
  }

  stats(): Observable<StatsSources> {
    return this.httpClient.get<StatsSources>(`${this.baseUrl}/admin/sources-stats`);
  }

  statsZones(): Observable<StatsZones> {
    return this.httpClient.get<StatsZones>(`${this.baseUrl}/admin/custom-geo/stats`);
  }

  modifier(id: string, corps: ModificationSource): Observable<ReponseEcriture> {
    return this.httpClient.patch<ReponseEcriture>(`${this.baseUrl}/admin/sources/${encodeURIComponent(id)}`, corps);
  }

  supprimer(id: string): Observable<ReponseEcriture> {
    return this.httpClient.delete<ReponseEcriture>(`${this.baseUrl}/admin/sources/${encodeURIComponent(id)}`);
  }

  cles(id: string): Observable<ReponseCles> {
    return this.httpClient.get<ReponseCles>(`${this.baseUrl}/admin/sources/${encodeURIComponent(id)}/meta-keys`);
  }

  /**
   * Export CSV en blob, PAR `HttpClient` donc sous jeton (C8) : React fait `window.open` de la route,
   * qui part sans `Authorization` et répond 401. Le nom est celui de `Content-Disposition`
   * (`<nom>_export[_tronque].csv`), lu par `ENREGISTRER_FICHIER`.
   */
  exporter(id: string): Observable<HttpResponse<Blob>> {
    return this.httpClient.get(`${this.baseUrl}/admin/sources/${encodeURIComponent(id)}/export`, {
      observe: 'response', responseType: 'blob',
    });
  }

  /**
   * Campagnes DSP de l'ESPACE ACTIF (`profile.organization_id`, toutes si « Toutes »), hors simulations.
   * React ajoute `?_t=<Date.now()>` et `cache: 'no-store'` (`useDspImport.ts:60`) contre le cache de
   * `fetch` de Next : SANS OBJET ici, `HttpClient` ne met rien en cache et la route répond `no-store`.
   */
  campagnes(): Observable<CampagneDsp[]> {
    return this.httpClient.get<CampagneDsp[]>(`${this.baseUrl}/admin/campaigns`);
  }

  /**
   * `POST /api/admin/campaigns/import` — multipart aux trois champs de React (`file`, `dsp_source`, et
   * `campaign_name` s'il est saisi), réponse en flux SSE lue par `lignesSse` (C4) : en TEXTE, donc un
   * corps d'erreur (HTTP ≠ 2xx) arrive en texte, à relire.
   *
   * ⚠ ÉCRIT : `dsp_campaigns`, `campaign_organizations`, `dsp_campaign_data`, puis les rollups. Occupe
   * une place du limiteur (3 appels simultanés) pendant toute sa durée.
   */
  importerCampagne(demande: DemandeImportDsp): Observable<EvenementImportDsp> {
    const form = new FormData();
    form.append('file', demande.fichier);
    form.append('dsp_source', demande.source);
    const nom = demande.nom.trim();
    if (nom) form.append('campaign_name', nom);
    return lignesSse<EvenementImportDsp>(
      this.httpClient.post(`${this.baseUrl}/admin/campaigns/import`, form, {
        observe: 'events', reportProgress: true, responseType: 'text',
      }),
    );
  }

  /** `DELETE /api/admin/campaigns/[id]` — les données et rollups suivent par `ON DELETE CASCADE`. */
  supprimerCampagne(id: string): Observable<{ success?: boolean; deleted?: number; error?: string }> {
    return this.httpClient.delete<{ success?: boolean; deleted?: number; error?: string }>(
      `${this.baseUrl}/admin/campaigns/${encodeURIComponent(id)}`,
    );
  }

  /** Zones perso de TOUS les espaces ; paramètres `org_id`, `source_type`, `q`, chacun seulement s'il est renseigné. */
  zones(filtres: FiltresZones): Observable<{ zones?: ZoneAdmin[]; total?: number }> {
    let params = new HttpParams();
    if (filtres.orgId) params = params.set('org_id', filtres.orgId);
    if (filtres.sourceType) params = params.set('source_type', filtres.sourceType);
    if (filtres.recherche) params = params.set('q', filtres.recherche);
    return this.httpClient.get<{ zones?: ZoneAdmin[]; total?: number }>(`${this.baseUrl}/admin/custom-geo/list`, { params });
  }

  /** `DELETE /api/admin/custom-geo/[id]` (service role, tous espaces). */
  supprimerZone(id: string): Observable<{ deleted?: boolean; id?: string; error?: string }> {
    return this.httpClient.delete<{ deleted?: boolean; id?: string; error?: string }>(
      `${this.baseUrl}/admin/custom-geo/${encodeURIComponent(id)}`,
    );
  }
}
