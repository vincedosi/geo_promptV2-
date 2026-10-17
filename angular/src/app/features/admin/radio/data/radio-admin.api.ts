import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../../core/http/http-base.service';

/**
 * `GET /api/radio/stats` (RPC `get_radio_stats`) — les champs lus par l'administration. La RPC en
 * rend d'autres (`par_genre`, `pct_matching`…), que l'écran Radio (T16-T17) déclarera ici.
 */
export interface StatsRadio {
  total_emetteurs: number;
  emetteurs_fm: number;
  emetteurs_dab: number;
  total_radios: number;
}

/**
 * Routes radio de l'administration. Créé par T18 avec la seule `stats()` (tuile et bloc « Radio »
 * des Sources, ruling du registre l. 26 inversé par l'ordre A5) ; T16 le complète (import, journal,
 * historique, zone dangereuse) — un seul service pour `/api/radio/*`.
 *
 * Fourni par la route `admin` (`FOURNISSEURS_ADMIN`, C3).
 */
@Injectable()
export class RadioAdminApi extends HttpBaseService {
  stats(): Observable<StatsRadio> {
    return this.httpClient.get<StatsRadio>(`${this.baseUrl}/radio/stats`);
  }
}
