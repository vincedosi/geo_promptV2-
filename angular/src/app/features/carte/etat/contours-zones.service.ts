import { Injectable, inject } from '@angular/core';
import { type Observable, catchError, shareReplay, throwError } from 'rxjs';
import { CiviqueApi } from '../data/civique.api';
import type { MeteoScale } from '../logique/meteo/types';

/**
 * Les polygones des zones administratives (`/api/meteo-geo/zones?scale=region|departement|cp`), lus UNE fois par
 * échelle et par écran, et PARTAGÉS : la santé environnementale (T10) et la météo (T11) lisent la même route. React
 * tenait deux caches séparés (`meteoZonesCacheRef` de `useMeteoLayer.ts:124`, aucun dans `CivicHealthMapLayer.tsx`) ;
 * au code postal, les polygones pèsent ~3,8 Mo — les relire pour la seconde couche coûterait autant pour rien.
 *
 * Une requête EN VOL est partagée aussi (`shareReplay`) : appliquer la météo pendant que la santé lit les mêmes zones
 * ne lance pas de seconde lecture. Un échec n'est pas retenu : l'appel suivant relit.
 *
 * `refCount: false` assumé : changer de jeu santé (ou ré-appliquer la météo) pendant le téléchargement des contours
 * CP (~3,8 Mo) ne l'annule PAS — la réponse est gardée pour l'écran, la prochaine demande la lit sans requête.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte, détruit avec elle (« par écran »).
 */
@Injectable()
export class ContoursZonesService {
  private readonly api = inject(CiviqueApi);
  private readonly cache = new Map<MeteoScale, Observable<GeoJSON.FeatureCollection>>();

  zones(echelle: MeteoScale): Observable<GeoJSON.FeatureCollection> {
    let zones$ = this.cache.get(echelle);
    if (!zones$) {
      zones$ = this.api.zones(echelle).pipe(
        catchError((e: unknown) => {
          this.cache.delete(echelle);
          return throwError(() => e);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      this.cache.set(echelle, zones$);
    }
    return zones$;
  }
}
