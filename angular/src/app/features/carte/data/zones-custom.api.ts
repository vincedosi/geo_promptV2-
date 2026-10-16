import type { HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import type { EntiteZone } from '../logique/zones/zone-du-lien';
import type { CibleKey } from '../logique/zones/cibles';
import type { ItemAudience, corpsInstantane, corpsPlan } from '../logique/zones/plan-media';
import type { GeometrieContribuee } from '../logique/zones/capture';
import type { ReponseCodesPostaux, ReponseSurface } from '../logique/zones/creation-zone';
import type { Recette } from '../logique/zones/recette';

/**
 * Une zone enregistrée, telle que `GET /api/custom-geo/list` la rend — recopie de `CustomGeoZoneSummary`
 * (`types/custom-geo.ts:46-61`), forme de la réponse de `app/api/custom-geo/list/route.ts`.
 */
export interface ZoneCustomResume {
  id: string;
  name: string;
  description: string | null;
  source_type: string;
  source_metadata: Record<string, unknown>;
  feature_count_iris: number;
  feature_count_cp: number;
  bbox: [number, number, number, number] | null;
  created_at: string;
  created_by: string | null;
  /** Codes département INSEE résolus (`custom_geo_zone_codes`, `code_type='dept'`). */
  dept_codes?: string[];
  /** Codes région INSEE résolus (`custom_geo_zone_codes`, `code_type='region'`). */
  region_codes?: string[];
  /** La recette de la zone (lot 3, `custom_geo_zones.recette`) ; `null` pour une zone d'avant le lot 3. */
  recette?: Recette | null;
}

/** `GET /api/custom-geo/stats` (`get_custom_geo_zones_stats`) : champs lus par `ZonesOverlay.tsx:171-175`. */
export interface StatsZones {
  total?: number;
  total_iris?: number;
  total_cp?: number;
}

/** Une campagne du sélecteur de rattachement (`GET /api/custom-geo/media-plan`). */
export interface CampagnePlan {
  id: string;
  name: string;
  dsp_source: string;
  /** La campagne porte déjà un plan (`geo_strategy.media_plan.zones` non vide) : « ● » devant son nom. */
  has_plan: boolean;
}

/** Le plan stocké dans `dsp_campaigns.geo_strategy.media_plan` (`PlanSchema` de la route, plus l'horodatage). */
export interface PlanStocke {
  zones?: Array<{ id: string; name: string }>;
  budget: number | null;
  cpm: number | null;
  cible: CibleKey;
  weights: Record<string, number>;
  updated_at?: string;
}

/** Les formats de `GET /api/custom-geo/[id]/export` — `CustomGeoExportFormat` (`types/custom-geo.ts:84-91`). */
export type FormatExportZone = 'csv_cp' | 'csv_iris' | 'geojson' | 'dv360_cp' | 'dv360_sdf' | 'bidding_script' | 'tiktok_geo';

/**
 * Les zones enregistrées de l'organisation (`custom_geo_zones`) : liste (T5), puis tout ce que le panneau Zones et le
 * lien `?customZone=` emploient (T14).
 *
 * Fourni par la ROUTE (`FOURNISSEURS_DISTANTS`, `app.routes.ts`), jamais à la racine : un service racine
 * recevrait le `HttpClient` du shell, sans nos intercepteurs (jeton, limiteur, session expirée).
 *
 * Pas de `renommer` : aucun écran de la carte React ne renomme une zone (`PATCH /api/custom-geo/[id]` sert la page
 * `/map/custom-geo`, hors de ce lot) — une méthode sans appelant serait du code mort.
 */
@Injectable()
export class ZonesCustomApi extends HttpBaseService {
  /**
   * `GET /api/custom-geo/list?…`. Les paramètres arrivent COMPOSÉS par l'appelant (`URLSearchParams`), et partent
   * tels quels — même chaîne que React (`PanneauFiltre.tsx:251-252`), sans le réencodage de `HttpParams`.
   */
  lister(params: URLSearchParams): Observable<{ zones: ZoneCustomResume[] }> {
    return this.httpClient.get<{ zones: ZoneCustomResume[] }>(`${this.baseUrl}/custom-geo/list?${params.toString()}`);
  }

  /** `GET /api/custom-geo/stats?org_id=…&_t=…` — horodatage anti-cache comme React (`ZonesOverlay.tsx:155`). */
  stats(org: string, horodatage: number): Observable<StatsZones> {
    const p = new URLSearchParams({ org_id: org, _t: String(horodatage) });
    return this.httpClient.get<StatsZones>(`${this.baseUrl}/custom-geo/stats?${p.toString()}`);
  }

  /** `GET /api/custom-geo/[id]/geometry` : la zone en `Feature` GeoJSON (404 si inaccessible). */
  geometrie(id: string): Observable<EntiteZone> {
    return this.httpClient.get<EntiteZone>(`${this.baseUrl}/custom-geo/${encodeURIComponent(id)}/geometry`);
  }

  /** `DELETE /api/custom-geo/[id]` — 409 si elle est citée (`zone_referencee` : stratégie, jeu de zones, zone composée, périmètre d’une recette). */
  supprimer(id: string): Observable<{ deleted: boolean; id: string }> {
    return this.httpClient.delete<{ deleted: boolean; id: string }>(`${this.baseUrl}/custom-geo/${encodeURIComponent(id)}`);
  }

  // Les opérations booléennes (`/source/{composite,intersection,difference}`) et `/api/custom-geo/save` ne sont plus
  // appelées par l'Angular depuis le lot 3 (T10) : toute écriture passe par `ZonesApi.enregistrer` avec une recette.

  /**
   * `GET /api/custom-geo/[id]/export?format=…` en `blob`, réponse complète (`Content-Disposition` donne le nom) —
   * `downloadZoneExport` (`lib/custom-geo/download-export.ts`). Le format part en PREMIER, comme React.
   */
  exporter(id: string, format: FormatExportZone, params?: Record<string, string>): Observable<HttpResponse<Blob>> {
    const p = new URLSearchParams({ format, ...(params ?? {}) });
    return this.httpClient.get(`${this.baseUrl}/custom-geo/${encodeURIComponent(id)}/export?${p.toString()}`, {
      observe: 'response', responseType: 'blob',
    });
  }

  // ── Plan média des zones affichées (T15, `ZoneMediaPlanPanel.tsx`) ─────────────────────────────────────────────────

  /** `GET /api/custom-geo/national-totals` : population France par clé de cible (cache serveur 24 h). */
  totauxNationaux(): Observable<{ totals?: Record<string, number> }> {
    return this.httpClient.get<{ totals?: Record<string, number> }>(`${this.baseUrl}/custom-geo/national-totals`);
  }

  /**
   * `GET /api/custom-geo/[id]/items-audience` : l'audience de chaque item d'une zone (les CIRFA d'une bataille) ;
   * `items: null` pour une zone non décomposable. Le premier appel peut lancer le calcul serveur (~10 s).
   */
  audienceItems(id: string): Observable<{ items: ItemAudience[] | null }> {
    return this.httpClient.get<{ items: ItemAudience[] | null }>(`${this.baseUrl}/custom-geo/${encodeURIComponent(id)}/items-audience`);
  }

  /** `GET /api/custom-geo/[id]` : le détail d'une zone, dont `audience_stats` — le repli du plan média sur la zone entière. */
  zone(id: string): Observable<{ audience_stats?: unknown }> {
    return this.httpClient.get<{ audience_stats?: unknown }>(`${this.baseUrl}/custom-geo/${encodeURIComponent(id)}`);
  }

  /** `GET /api/custom-geo/media-plan` : les campagnes de l'organisation, pour le sélecteur de rattachement. */
  campagnesPlan(): Observable<{ campaigns?: CampagnePlan[] }> {
    return this.httpClient.get<{ campaigns?: CampagnePlan[] }>(`${this.baseUrl}/custom-geo/media-plan`);
  }

  /** `GET /api/custom-geo/media-plan?campaign_id=…` : le plan stocké dans `geo_strategy.media_plan`, ou `null`. */
  planMedia(campagne: string): Observable<{ plan: PlanStocke | null }> {
    const p = new URLSearchParams({ campaign_id: campagne });
    return this.httpClient.get<{ plan: PlanStocke | null }>(`${this.baseUrl}/custom-geo/media-plan?${p.toString()}`);
  }

  /** `POST /api/custom-geo/media-plan` : ÉCRIT le plan dans `geo_strategy` de la campagne (403 hors organisation). */
  enregistrerPlan(corps: ReturnType<typeof corpsPlan>): Observable<{ ok: boolean; plan?: PlanStocke }> {
    return this.httpClient.post<{ ok: boolean; plan?: PlanStocke }>(`${this.baseUrl}/custom-geo/media-plan`, corps);
  }

  /** `DELETE /api/custom-geo/media-plan?campaign_id=…` : retire `media_plan` de la campagne, garde ses autres clés. */
  detacherPlan(campagne: string): Observable<{ ok: boolean }> {
    const p = new URLSearchParams({ campaign_id: campagne });
    return this.httpClient.delete<{ ok: boolean }>(`${this.baseUrl}/custom-geo/media-plan?${p.toString()}`);
  }

  /** `POST /api/custom-geo/media-plan/snapshot` : fige le plan poussé au DSP (suivi plan-vs-réel). */
  instantane(corps: NonNullable<ReturnType<typeof corpsInstantane>>): Observable<unknown> {
    return this.httpClient.post(`${this.baseUrl}/custom-geo/media-plan/snapshot`, corps);
  }

  // ── Créer une zone (T16, `CreerZone*.tsx`, `CustomGeoCaptureModal.tsx`) ───────────────────────────────────────────────

  /**
   * `POST /api/custom-geo/source/codes-postaux` : une liste COLLÉE part en JSON (`{ saisie }`), un fichier DÉPOSÉ en
   * multipart (champ `file`, lu par `fichierDeFormulaire`, plafond serveur 2 Mo). `Content-Type` n'est jamais fixé à
   * la main : pour un `FormData`, c'est le navigateur qui l'écrit avec sa frontière — la fixer la perdrait.
   */
  depuisCodesPostaux(saisie: string | File): Observable<ReponseSourceCodesPostaux> {
    const url = `${this.baseUrl}/custom-geo/source/codes-postaux`;
    if (typeof saisie === 'string') return this.httpClient.post<ReponseSourceCodesPostaux>(url, { saisie });
    const formulaire = new FormData();
    formulaire.append('file', saisie);
    return this.httpClient.post<ReponseSourceCodesPostaux>(url, formulaire);
  }

  /** `POST /api/custom-geo/source/rayon` : le disque clippé sur le territoire (409 en pleine mer). */
  depuisRayon(corps: { lon: number; lat: number; rayon_m: number }): Observable<ReponseSourceSurface> {
    return this.httpClient.post<ReponseSourceSurface>(`${this.baseUrl}/custom-geo/source/rayon`, corps);
  }

  /** `POST /api/custom-geo/source/dessin` : le tracé tel quel ; la base le répare (`corrige`) et le clippe. */
  depuisDessin(geometry: GeoJSON.Polygon): Observable<ReponseSourceSurface> {
    return this.httpClient.post<ReponseSourceSurface>(`${this.baseUrl}/custom-geo/source/dessin`, { geometry });
  }

  /** `POST /api/custom-geo/source/<route>` d'une couche contributive de la capture : sa géométrie (`{ geometry }`). */
  source(route: RouteSourceCapture, corps: Record<string, unknown>): Observable<{ geometry?: GeometrieContribuee }> {
    return this.httpClient.post<{ geometry?: GeometrieContribuee }>(`${this.baseUrl}/custom-geo/source/${route}`, corps);
  }

  /**
   * `POST /api/custom-geo/capture` : ÉCRIT la zone fusionnée des couches capturées. Un 207 arrive ici comme une
   * réussite : il porte `warning` (`recette_non_enregistree`, `zone_created_but_resolution_failed`) et `message`.
   */
  capturer(corps: Record<string, unknown>): Observable<ReponseCapture> {
    return this.httpClient.post<ReponseCapture>(`${this.baseUrl}/custom-geo/capture`, corps);
  }
}

/** La réponse de `/source/codes-postaux` : la géométrie et les deux familles de perte, comptées séparément. */
export interface ReponseSourceCodesPostaux extends ReponseCodesPostaux {
  geometry: GeoJSON.Geometry;
  /** Les codes RETENUS (connus du référentiel) : la recette `codes_postaux` de la zone (lot 3). */
  codes?: string[];
  codes_inconnus?: string[];
  rejetes?: string[];
}

/** La réponse de `POST /api/custom-geo/capture` : 200, ou 207 avec `warning` et `message`. */
export interface ReponseCapture {
  zone_id?: string;
  count_iris?: number;
  count_cp?: number;
  warning?: string;
  message?: string;
}

/** La réponse de `/source/rayon` et `/source/dessin`. */
export interface ReponseSourceSurface extends ReponseSurface {
  geometry: GeoJSON.Geometry;
}

/** Les routes de `/api/custom-geo/source/` qu'une couche contributive de la capture peut appeler. */
export type RouteSourceCapture = 'carreaux' | 'iris' | 'radio' | 'tmja' | 'battle' | 'voronoi' | 'indicator-threshold' | 'score' | 'composite';
