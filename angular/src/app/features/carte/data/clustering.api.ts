import { Injectable } from '@angular/core';
import { type Observable, map } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import type {
  ClustersGeoJSON, EntreeHistorique, MoyennesFrance, ProfilsPoi, ReponseModele, ResumeModele,
} from '../logique/clustering/types';

/**
 * Le clustering POI × Filosofi en LECTURE (lot 4, T19) : les routes `/api/poi-clusters/*` que lisent `page.tsx`,
 * `ClusteringSection.tsx`, `ClusterPanel.tsx` et `components/ClusterDetails.tsx`. Toutes sont réservées au super admin
 * côté serveur (`reserverAuSuperAdmin`) : les modèles sont calculés sur les POI de toutes les organisations.
 *
 * Non portées, et c'est voulu :
 * - `…/models/[version]/analysis` et `…/generate-analysis` : l'analyse Gemini, jamais AFFICHÉE par React (elle ne
 *   servait qu'à l'export PDF, lui-même non restauré) — décision du propriétaire, aucune IA portée ;
 * - `DELETE …/models/[version]`, `…/[clusterId]`, `…/model` : aucun écran React ne les appelle ;
 * - `…/run`, `…/count`, `…/poi-types` : l'assistant de calcul (T20).
 *
 * ── TRONCATURE ───────────────────────────────────────────────────────────
 * `GET /api/poi-clusters` et `…/models/[version]` lisent `poi_clusters` SANS pagination : au-delà de 1 000 POI par
 * modèle, le plafond PostgREST local (`db-max-rows`) les couperait en silence. Les deux modèles en base en ont 95.
 *
 * Fourni par la ROUTE (`FOURNISSEURS_DISTANTS`), comme tout service d'API (garde `modele-aida.test.ts`).
 */
@Injectable()
export class ClusteringApi extends HttpBaseService {
  /** `GET /api/poi-clusters?duration=` : le DERNIER modèle de cette durée, ses POI en points (`page.tsx:442`). */
  clusters(duree: number): Observable<ClustersGeoJSON> {
    return this.httpClient.get<ClustersGeoJSON>(`${this.baseUrl}/poi-clusters?duration=${duree}`);
  }

  /** `GET /api/poi-clusters/models` : tous les modèles, version décroissante (`ClusteringSection.tsx:88`). */
  modeles(): Observable<ResumeModele[]> {
    return this.httpClient.get<{ models?: ResumeModele[] }>(`${this.baseUrl}/poi-clusters/models`).pipe(map((r) => r.models ?? []));
  }

  /** `GET /api/poi-clusters/models/[version]` : le modèle, son résumé par cluster, ses POI (`ClusterDetails.tsx:1000`). */
  modele(version: number): Observable<ReponseModele> {
    return this.httpClient.get<ReponseModele>(`${this.baseUrl}/poi-clusters/models/${version}`);
  }

  /** `GET /api/poi-clusters/france-averages` : les moyennes nationales, référence des radars (404 si non calculées). */
  moyennesFrance(): Observable<MoyennesFrance> {
    return this.httpClient.get<{ averages: MoyennesFrance }>(`${this.baseUrl}/poi-clusters/france-averages`).pipe(map((r) => r.averages));
  }

  /** `GET /api/poi-clusters/poi/[poiId]` : les profils d'un POI pour chaque durée calculée (« Durées »). */
  profilsPoi(poiId: string): Observable<ProfilsPoi> {
    return this.httpClient.get<ProfilsPoi>(`${this.baseUrl}/poi-clusters/poi/${encodeURIComponent(poiId)}`);
  }

  /** `GET /api/poi-clusters/history/[poiId]` : les 20 derniers changements de cluster d'un POI (« Historique »). */
  historique(poiId: string): Observable<EntreeHistorique[]> {
    return this.httpClient.get<EntreeHistorique[]>(`${this.baseUrl}/poi-clusters/history/${encodeURIComponent(poiId)}`);
  }
}
