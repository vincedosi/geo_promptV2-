import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import type { CatalogueBornesIris } from '../logique/iris-echelle';
import { IRIS_TILE_VERSION } from '../logique/versions';

/**
 * Le détail socio-démographique d'un IRIS, tel que `GET /api/iris/detail` le rend — recopie de `IrisDetailData`
 * (`app/map/_components/IrisDetailPanel.tsx:23-31`). Les colonnes sont celles d'`IRIS_DB_COLUMNS`, lues par nom.
 */
export interface IrisDetailData {
  code_iris: string;
  nom_iris: string | null;
  code_commune: string | null;
  nom_commune?: string | null;
  code_dept: string | null;
  is_true_iris: boolean | null;
  [key: string]: unknown;
}

/**
 * Les IRIS : tuiles MVT en cascade (`get_iris_tile`, sql/139), bornes nationales de l'échelle (`iris_bornes_echelle`,
 * sql/140) et détail d'un IRIS au clic.
 *
 * ── RÈGLES D'I/O (CLAUDE.md § Disk I/O) ─────────────────────────────────
 * - Les TUILES portent toutes les colonnes : changer d'indicateur ne fait qu'une nouvelle expression MapLibre, zéro
 *   requête. Aucun appel `HttpClient` pour elles — MapLibre les lit dans son worker, avec le cookie de session.
 * - Les BORNES de toutes les colonnes arrivent en UN appel (~4 kB), lu une fois par écran par `IrisService`.
 * - Le DÉTAIL vise UN IRIS à la fois — jamais un préchargement de plusieurs.
 *
 * Fourni par la ROUTE (`FOURNISSEURS_DISTANTS`), comme tout service d'API (garde `modele-aida.test.ts`).
 */
@Injectable()
export class IrisApi extends HttpBaseService {
  /**
   * `…/api/tiles/iris/{z}/{x}/{y}?v=<IRIS_TILE_VERSION>` (`useMapInit.ts:855`), adresse ABSOLUE : le worker de
   * MapLibre ne résout pas une adresse relative. La version invalide le cache quand le schéma de tuile change.
   */
  urlTuiles(): string {
    return `${this.urlAbsolue('tiles/iris/{z}/{x}/{y}')}?v=${IRIS_TILE_VERSION}`;
  }

  /** `GET /api/iris/bornes` : les bornes de TOUTES les colonnes, en un appel (`useMapLayers.ts:860`). */
  bornes(): Observable<CatalogueBornesIris> {
    return this.httpClient.get<CatalogueBornesIris>(`${this.baseUrl}/iris/bornes`);
  }

  /**
   * `GET /api/iris/detail?code_iris=…` (`useIrisDetail.ts:69`). Le paramètre s'appelle `code_iris` — c'est le nom que
   * la route lit (`app/api/iris/detail/route.ts:17`).
   */
  detail(code: string): Observable<IrisDetailData> {
    return this.httpClient.get<IrisDetailData>(`${this.baseUrl}/iris/detail?code_iris=${encodeURIComponent(code)}`);
  }
}
