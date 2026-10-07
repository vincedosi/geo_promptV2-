import { Injectable } from '@angular/core';
import { HttpBaseService } from '../../../core/http/http-base.service';
import { CARREAUX_TILE_VERSION } from '../logique/versions';

/**
 * Les tuiles MVT des carreaux Filosofi (`/api/tiles/{z}/{x}/{y}`, `get_tile`, sql/129).
 *
 * Aucun appel `HttpClient` : MapLibre lit les tuiles lui-même, dans son worker, avec le cookie de session (la route
 * est sous `PROTECTED_API_PREFIXES`). Le service ne sert qu'à composer l'adresse ABSOLUE contre l'API — le worker ne
 * résout pas une adresse relative — comme `ZonesRisqueApi.urlTuilesZones` (lot 3).
 *
 * Fourni par la ROUTE (`FOURNISSEURS_DISTANTS`), comme tout service d'API (garde `modele-aida.test.ts`).
 */
@Injectable()
export class CarreauxApi extends HttpBaseService {
  /**
   * `…/api/tiles/{z}/{x}/{y}?v=<CARREAUX_TILE_VERSION>` (`useMapInit.ts:926`) : la version dans l'adresse invalide les
   * tuiles en cache quand le schéma de tuile change (`lib/version.ts`).
   */
  urlTuiles(): string {
    return `${this.urlAbsolue('tiles/{z}/{x}/{y}')}?v=${CARREAUX_TILE_VERSION}`;
  }
}
