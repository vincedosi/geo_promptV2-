/**
 * Service d'API des batailles d'isochrones (lot 4, T17) et les types de leurs flux NDJSON.
 */
import { Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import { lignesNdjson } from '../../../core/http/ndjson';
import { erreurDeFlux, type EvenementFlux } from '../logique/bataille/flux';
import type { CorpsBatailleV2Zone } from '../logique/bataille/parametres';
import type { CacheStatus, DirectBattleV2Params } from '../logique/modes-isochrones';

export type { EvenementFlux };

/** Ce que rend la vérification du cache (`CacheStatus` non nul). */
export type StatutCache = NonNullable<CacheStatus>;

/**
 * La bataille d'isochrones V2 de la carte principale (lot 4, T17) — les routes que `use-isochrone-battle.ts` et
 * `useMapDirectActions.ts` appellent par `fetch`, pour la V2 et son remplissage.
 *
 * La bataille V1 (« Isochrones routiers (ORS) ») est RETIRÉE d'Angular (décision de Vincent, 27/10) : plus d'appel V1
 * ni d'`apply-battle`. Reste `POST /api/isochrone-battle`, route PROTÉGÉE (CLAUDE.md), qui sert AUSSI le remplissage
 * ORS du cache de la V2 (`remplirCache`) : appelée exactement comme React, corps compris (`corpsRemplissage`), jamais
 * modifiée. Les deux flux sont du NDJSON lu ligne à ligne au fil des morceaux (`lignesNdjson`) : un calcul de 30 à 120 s
 * affiche sa progression en direct. Chaque flux occupe une place du limiteur (3 appels simultanés) tant qu'il coule —
 * voulu : c'est un calcul lourd côté base.
 *
 * `@Injectable()` sans `providedIn` : fourni par `FOURNISSEURS_DISTANTS` (doc AIDA §4.2-4.3).
 */
@Injectable()
export class IsochronesApi extends HttpBaseService {
  /** `POST /api/isochrone-cache-check` (`buildCheckParams`) : la couverture du cache pour la sélection. */
  verifierCache(corps: object): Observable<StatutCache> {
    return this.httpClient.post<StatutCache>(`${this.baseUrl}/isochrone-cache-check`, corps);
  }

  /** `POST /api/isochrone-battle` : le remplissage ORS du cache de la V2 (la route de l'ancienne V1, inchangée). */
  remplirCache(corps: object): Observable<EvenementFlux> {
    return this.flux('isochrone-battle', corps);
  }

  /** `POST /api/isochrone-battle-v2` : la découpe multi-paliers depuis le cache, sans appel ORS. */
  batailleV2(corps: DirectBattleV2Params | CorpsBatailleV2Zone): Observable<EvenementFlux> {
    return this.flux('isochrone-battle-v2', corps);
  }

  /**
   * Un flux NDJSON, dont l'événement `{ type: 'error' }` devient une ERREUR de l'Observable (`erreurDeFlux` : une page
   * HTML relayée devient une phrase, le reste est coupé à 200 caractères) — les boucles de React levaient là.
   */
  private flux(chemin: string, corps: object): Observable<EvenementFlux> {
    return lignesNdjson<EvenementFlux>(
      this.httpClient.post(`${this.baseUrl}/${chemin}`, corps, { observe: 'events', reportProgress: true, responseType: 'text' }),
    ).pipe(map((e) => {
      if (e.type === 'error') throw new Error(erreurDeFlux(e['message']));
      return e;
    }));
  }
}
