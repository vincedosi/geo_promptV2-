import { Injectable } from '@angular/core';
import { type Observable, map } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import type { CorpsLancementClustering, StatutJobClustering, TypePoiClustering } from '../logique/clustering/assistant';
import type {
  ClustersGeoJSON, EntreeHistorique, MoyennesFrance, ProfilsPoi, ReponseModele, ResumeModele,
} from '../logique/clustering/types';

/**
 * Le clustering POI × Filosofi : en LECTURE (lot 4, T19), les routes `/api/poi-clusters/*` que lisent `page.tsx`,
 * `ClusteringSection.tsx`, `ClusterPanel.tsx` et `components/ClusterDetails.tsx` ; en CALCUL (T20), celles de
 * l'assistant `ClusteringWizard.tsx` — types de POI, comptage, lancement d'un job et son sondage. Toutes sont réservées au super admin
 * côté serveur (`reserverAuSuperAdmin`) : les modèles sont calculés sur les POI de toutes les organisations.
 *
 * Non portées, et c'est voulu :
 * - `…/models/[version]/analysis` et `…/generate-analysis` : l'analyse Gemini, jamais AFFICHÉE par React (elle ne
 *   servait qu'à l'export PDF, lui-même non restauré) — décision du propriétaire, aucune IA portée ;
 * - `DELETE …/models/[version]`, `…/[clusterId]`, `…/model` : aucun écran React ne les appelle.
 *
 * ── LE LANCEMENT ÉCRIT EN BASE ET APPELLE ORS ────────────────────────────
 * `POST …/run` crée une ligne `clustering_jobs` et lance `scripts/clustering_poi_filosofi.py --mode cache-isochrones`
 * en processus fils : appels ORS, lignes `isochrones_cache`, puis TOUJOURS un `full-retrain` (la route passe
 * `--features`, les 16 variables quand `features` est nul — T-serveur 5) qui écrit un nouveau modèle ; en dry-run,
 * il tourne sans rien persister. N'appeler `lancer` qu'APRÈS la garde du panneau Analyse
 * (`verifierPerimetreOutil('clustering')`). Script absent : 503, dont le message est affiché tel quel.
 *
 * `…/poi-types` : totaux comptés en base par `types_poi_clustering` (sql/248), plus de plafond à 1 000 lignes.
 *
 * ── TRONCATURE ───────────────────────────────────────────────────────────
 * `GET /api/poi-clusters` et `…/models/[version]` lisent `poi_clusters` paginée par `lireTout`, plafond 20 000 au-delà
 * duquel la route répond 500 plutôt que de tronquer (`lib/clustering/lire-clusters.ts`).
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

  /** `GET /api/poi-clusters/poi-types` : les types de POI, leur total et s'ils sont déjà clustérisés (étape 1). */
  typesPoi(): Observable<TypePoiClustering[]> {
    return this.httpClient.get<{ types?: TypePoiClustering[] }>(`${this.baseUrl}/poi-clusters/poi-types`).pipe(map((r) => r.types ?? []));
  }

  /** `GET /api/poi-clusters/count` : les POI du périmètre, à l'entrée de l'étape 3 (`refreshCount`). */
  compter(types: readonly string[], metropolitaine: boolean, depts: readonly string[]): Observable<number> {
    const params: Record<string, string> = { poi_types: types.join(','), metropolitaine: String(metropolitaine) };
    if (depts.length) params['depts'] = depts.join(',');
    return this.httpClient.get<{ count?: number }>(`${this.baseUrl}/poi-clusters/count`, { params }).pipe(map((r) => r.count ?? 0));
  }

  /** `POST /api/poi-clusters/run` : crée le job et rend son identifiant. ⚠ Écrit en base — voir l'en-tête. */
  lancer(corps: CorpsLancementClustering): Observable<string> {
    return this.httpClient.post<{ job_id: string }>(`${this.baseUrl}/poi-clusters/run`, corps).pipe(map((r) => r.job_id));
  }

  /** `GET /api/poi-clusters/run?job_id=` : le statut et la fin du journal d'un job (sondé toutes les 3 s). */
  statut(jobId: string): Observable<StatutJobClustering> {
    return this.httpClient.get<StatutJobClustering>(`${this.baseUrl}/poi-clusters/run`, { params: { job_id: jobId } });
  }
}
