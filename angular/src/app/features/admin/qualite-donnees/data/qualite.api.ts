import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../../core/http/http-base.service';

/** Les quatre vérifications (`app/api/admin/qualite-donnees/route.ts`, `VERIFICATIONS`). */
export type CleVerification = 'indicateurs' | 'fraicheur' | 'invariants' | 'colonnes';

/** Une vérification telle que la rend le GET (`releve` à `null` = jamais lancée). */
export interface Verification {
  cle: CleVerification;
  libelle: string;
  cout: string;
  releve: unknown;
  calcule_le: string | null;
  duree_ms: number | null;
}

/** Réponse du GET : les DERNIERS relevés persistés, dans l'ordre de la route. */
export interface ReponseQualite {
  verifications: Verification[];
}

/** Réponse du POST : le relevé d'UNE vérification, et s'il a pu être persisté. */
export interface ReponseVerification {
  cle: CleVerification;
  libelle: string;
  releve: unknown;
  calcule_le: string;
  duree_ms: number;
  persiste: boolean;
}

/**
 * Qualité des données — `GET`/`POST /api/admin/qualite-donnees` (`requireAdmin`).
 *
 * Le GET lit `qualite_releves` (sql/149) et ne recalcule RIEN. Le POST relance UNE
 * vérification — le corps n'admet qu'une clé, jamais un tableau (pas de « tout vérifier ») ;
 * quota serveur `geo:rl:qualite-donnees` 2/min, trois des quatre vérifications lisant ~220 Mo.
 *
 * `cache: 'no-store'` de React (`page.tsx:115,135`) : sans objet ici. `HttpClient` ne passe
 * pas par le cache de données de Next, et le navigateur ne met pas en cache ces requêtes
 * authentifiées dont la réponse porte `Cache-Control: no-store`.
 *
 * Fourni par la route `admin` (`FOURNISSEURS_ADMIN`, C3).
 */
@Injectable()
export class QualiteApi extends HttpBaseService {
  lire(): Observable<ReponseQualite> {
    return this.httpClient.get<ReponseQualite>(`${this.baseUrl}/admin/qualite-donnees`);
  }

  verifier(verification: CleVerification): Observable<ReponseVerification> {
    return this.httpClient.post<ReponseVerification>(`${this.baseUrl}/admin/qualite-donnees`, { verification });
  }
}
