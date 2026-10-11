import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import { type CampagneItem, type ResultatCorrelation, urlCorrelation } from '../logique/analyses/correlation';
import type { CorpsScore, IndicateurRegistre, ParametreIndicateur, Rejeu, ResultatScore } from '../logique/analyses/score';

/** Une ligne de `GET /api/analyses` : les colonnes légères seulement (pas les jsonb). */
export interface AnalyseResume {
  id: string;
  type: string;
  nom: string;
  maillage: string | null;
  statut: string;
  created_at: string;
  updated_at: string;
}

/** `POST /api/analyses/[id]/rejouer` : de quoi relancer, et si un moteur est branché pour ce type. */
export interface ReponseRejeu {
  rejeu: Rejeu & { maillage: string | null };
  moteur: { cable: boolean; endpoint: string | null; methode: string | null };
}

/** `POST /api/custom-geo/source/score` : la géométrie des CP au-dessus du seuil, et leur nombre. */
export interface ReponseZoneScore {
  geometry: GeoJSON.Geometry;
  count: number;
  codes: string[];
  scale: 'cp';
}

/**
 * Les analyses de la carte principale (lot 4, T18) : le score composite, la corrélation et « Mes analyses » — les
 * appels `adminFetch` de `ScoreCompositeTool.tsx`, `CorrelationTool.tsx` et `use-analyses.ts`, plus le rejeu et la
 * suppression d'une analyse enregistrée (routes existantes que React n'appelait pas).
 *
 * Pas de `GET /api/analyses/[id]` : le rejeu rend déjà les paramètres, et aucun écran n'affiche le détail — une
 * méthode sans appelant serait du code mort.
 *
 * `@Injectable()` sans `providedIn` : fourni par `FOURNISSEURS_DISTANTS` (doc AIDA §4.2-4.3).
 */
@Injectable()
export class AnalysesApi extends HttpBaseService {
  /** `GET /api/cibles/indicators` — le catalogue de `cible_indicator_registry`, jamais une liste en dur. */
  indicateurs(): Observable<{ indicators: IndicateurRegistre[] }> {
    return this.httpClient.get<{ indicators: IndicateurRegistre[] }>(`${this.baseUrl}/cibles/indicators`);
  }

  /** `GET /api/digital/campaigns` — les campagnes de l'organisation, simulations écartées par la route. */
  campagnes(): Observable<CampagneItem[]> {
    return this.httpClient.get<CampagneItem[]>(`${this.baseUrl}/digital/campaigns`);
  }

  /** `POST /api/analyses/score` — périmètre de filtre (`france` admis) ou liste de codes postaux. */
  score(corps: CorpsScore): Observable<ResultatScore> {
    return this.httpClient.post<ResultatScore>(`${this.baseUrl}/analyses/score`, corps);
  }

  /** `GET /api/analyses/correlation?campaignId=&variable=`. */
  correlation(campagneId: string, variable: string): Observable<ResultatCorrelation> {
    return this.httpClient.get<ResultatCorrelation>(`${this.baseUrl}/${urlCorrelation(campagneId, variable)}`);
  }

  /** `POST /api/custom-geo/source/score` — la route recalcule le score côté serveur, elle ne croit pas le client. */
  zoneDepuisScore(corps: { indicateurs: ParametreIndicateur[]; codes_postaux: string[]; seuil: number }): Observable<ReponseZoneScore> {
    return this.httpClient.post<ReponseZoneScore>(`${this.baseUrl}/custom-geo/source/score`, corps);
  }

  /** `GET /api/analyses` — 50 lignes au plus, les plus récentes. */
  lister(): Observable<{ analyses: AnalyseResume[] }> {
    return this.httpClient.get<{ analyses: AnalyseResume[] }>(`${this.baseUrl}/analyses`);
  }

  /** `POST /api/analyses/[id]/rejouer` — n'écrit rien : la route dit quoi rappeler. */
  rejouer(id: string): Observable<ReponseRejeu> {
    return this.httpClient.post<ReponseRejeu>(`${this.baseUrl}/analyses/${encodeURIComponent(id)}/rejouer`, {});
  }

  /** `DELETE /api/analyses/[id]` — ÉCRIT : supprime la ligne de l'organisation. */
  supprimer(id: string): Observable<{ supprime: number }> {
    return this.httpClient.delete<{ supprime: number }>(`${this.baseUrl}/analyses/${encodeURIComponent(id)}`);
  }
}
