import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import { lignesNdjson } from '../../../core/http/ndjson';
import type { MeteoParams, MeteoScale, MeteoZoneChunk } from '../logique/meteo/types';

/**
 * La météo Open-Meteo agrégée par zone administrative (`lib/meteo/use-meteo-data.ts`).
 *
 * `GET /api/meteo-geo?scale=…&variable=…&startDate=…&endDate=…[&bbox=o,s,e,n]` — la chaîne de React, dans le même
 * ordre (`use-meteo-data.ts:242-247`). Réponse en flux NDJSON (`lignesNdjson`) : `{status:'fetching',progress,total}`
 * par lot interrogé, puis `{status:'done',data,meta}`, ou `{status:'error',error}`. La bbox ne vaut qu'au code postal
 * (la route l'ignore ailleurs) et la route l'arrondit au demi-degré VERS L'EXTÉRIEUR (`arrondirBboxExterieur`) : c'est
 * cette bbox arrondie qui filtre les zones et forme la clé de cache serveur.
 *
 * ── QUOTA ────────────────────────────────────────────────────────────────
 * La route consomme le quota partagé `geo:rl:meteo-geo` (20 appels par minute et par utilisateur) : un appel n'est
 * lancé QUE par « Appliquer », jamais par un déplacement de la carte (React n'en fait pas non plus).
 *
 * ⚠ Plafond PostgREST, MESURÉ le 2026-10-10 : au palier `cp`, la réponse ne porte que 1 000 codes postaux sur 6 187 —
 * les centroïdes viennent de `get_zone_centroids` (RPC `RETURNS TABLE`), plafonnée à 1 000 lignes par `db-max-rows`,
 * sans erreur. Voir ARCHITECTURE.md (tableau des routes, `/api/meteo-geo`) ; le correctif est côté serveur.
 *
 * Les polygones des zones (`/api/meteo-geo/zones`) ne sont PAS lus ici : `CiviqueApi.zones` (T10) les sert déjà, et
 * `ContoursZonesService` les met en cache pour l'écran — une seule lecture par échelle, partagée avec la santé
 * environnementale.
 *
 * Fourni par la ROUTE (`FOURNISSEURS_DISTANTS`), comme tout service d'API (garde `modele-aida.test.ts`).
 */
@Injectable()
export class MeteoApi extends HttpBaseService {
  donnees(scale: MeteoScale, params: MeteoParams): Observable<MeteoZoneChunk> {
    const url =
      `${this.baseUrl}/meteo-geo?scale=${scale}`
      + `&variable=${params.variable}`
      + `&startDate=${params.startDate}`
      + `&endDate=${params.endDate}`
      + (params.bbox ? `&bbox=${params.bbox}` : '');
    return lignesNdjson<MeteoZoneChunk>(
      this.httpClient.get(url, { observe: 'events', reportProgress: true, responseType: 'text' }),
    );
  }
}
